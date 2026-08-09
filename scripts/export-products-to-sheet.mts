/**
 * 현재 ERP 재고를 **영업자용 공유 시트**로 내보낸다. 기본 dry-run, 실제 쓰기는 --apply.
 *
 * 표 정의(열·서식·탭 이름)는 `lib/domain/inventory-sheet-export.ts` 하나만 쓴다 —
 * 관리자 화면의 「영업자 시트 반영」 버튼(`/api/inventory/sheet-export`)과 **같은 코드**다.
 * 두 경로가 각자 표를 만들면 영업자가 보는 시트가 갈린다.
 *
 * ★안전 계약
 *   · **운영 공급사 시트에는 쓰지 않는다.** 대상 시트 ID가 어느 파트너의 `sheet_url` 과
 *     같으면 즉시 중단한다 — 공급사 시트는 재고의 «정본»이라 덮어쓰면 원본이 사라진다.
 *   · **내부 원가·수수료·차대번호·내부메모는 내보내지 않는다**(도메인 HEADERS 가 전부).
 *   · RTDB 는 읽기만 한다(REST GET).
 *
 *   npx tsx scripts/export-products-to-sheet.mts --sheet=<ID>
 *   npx tsx scripts/export-products-to-sheet.mts --sheet=<ID> --apply
 *   npx tsx scripts/export-products-to-sheet.mts --sheet=<ID> --gid=0 --apply
 *
 *   기본은 **새 탭을 맨 왼쪽에** 만든다(최신이 왼쪽, 지난 회차는 이력).
 *   --gid=<번호> / --tab=<이름>  그 탭을 덮어쓴다
 *   --scope=listable(기본) | offerable | active
 *   --headers-only   표 틀만 올린다(권한 확인용)
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  attachPolicy, buildInventorySheet, dedupeForSales, exportTabName, policyMap, resnapForSales, sortForSales,
} from '../lib/domain/inventory-sheet-export';
import { isListableProduct, isOfferableProduct } from '../lib/domain/product';
import { companyAlias } from '../lib/domain/identity';
import type { EntityRecord } from '../lib/intake/entities';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB_URL = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const arg = (name: string, fallback = '') =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3) || fallback;
const dead = (p: Rec) => p._deleted === true || !!p.deletedAt || S(p.status) === 'deleted';

async function main() {
  const sheetId = arg('sheet');
  const tab = arg('tab');
  const scope = arg('scope', 'listable');
  const apply = process.argv.includes('--apply');
  const headersOnly = process.argv.includes('--headers-only');
  if (!sheetId) throw new Error('--sheet=<스프레드시트ID> 필요');

  const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB_URL });
  const dbToken = (await getApps()[0].options.credential!.getAccessToken()).access_token;
  const get = async (node: string): Promise<Record<string, Rec>> => {
    const res = await fetch(`${DB_URL}/${node}.json?access_token=${dbToken}`);
    if (!res.ok) throw new Error(`${node} 읽기 실패 ${res.status}`);
    return (JSON.parse(await res.text()) || {}) as Record<string, Rec>;
  };

  // 정책(연령·보험·심사)은 별도 노드다 — 조인하지 않으면 그 열이 통째로 빈다.
  const [products, live, over, pol3, pol4] = await Promise.all([
    get('v4/products'), get('partners'), get('v4/partners'), get('policies'), get('v4/policies'),
  ]);
  const policies = policyMap(pol3, pol4);
  const partners: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) partners[k] = { ...(live[k] || {}), ...(over[k] || {}), _key: k };

  const idOf = (url: string) => (url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || [])[1] || '';
  for (const p of Object.values(partners)) {
    if (S(p.sheet_url) && idOf(S(p.sheet_url)) === sheetId) {
      throw new Error(`중단 — 이 시트는 ${S(p.partner_name || p.company_name) || S(p.partner_code)} 의 운영 원본이다. 덮어쓰면 재고 정본이 사라진다.`);
    }
  }
  // 코드가 비면 «아무 공급사나» 걸리므로 먼저 끊는다 — API 경로(app/api/inventory/sheet-export)와 같은 규칙.
  const nameOf = (code: string) => {
    if (!code) return '';
    const hit = Object.values(partners).find((p) => S(p.partner_code) === code || S(p._key) === code);
    // 「주식회사」·「(주)」는 법인격이지 회사 이름이 아니다 — companyAlias 하나로 통일한다.
    return companyAlias(S(hit?.partner_name || hit?.company_name), (hit as any)?.alias);
  };

  const alive = Object.entries(products).filter(([, p]) => !dead(p))
    .map(([k, p]) => ({ ...p, _key: k, product_code: p.product_code || k } as EntityRecord));
  const selected = scope === 'listable' ? alive.filter(isListableProduct)
    : scope === 'offerable' ? alive.filter(isOfferableProduct) : alive;
  const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as {
    entries?: MasterEntry[];
  } | MasterEntry[];
  const master = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];
  if (!master.length) throw new Error('차종마스터가 비어 있어 영업자 시트 반영을 중단합니다.');
  const deduped = dedupeForSales(selected);
  const rows = sortForSales(resnapForSales(deduped, master))
    .map((p) => attachPolicy(p, policies));

  console.log(`\n══ 재고 → 시트 내보내기 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);
  console.log(`  대상 시트 ${sheetId}`);
  console.log(`  범위 ${scope} — 활성 ${alive.length}대 중 ${selected.length}대 · 실차 중복 ${selected.length - deduped.length}대 제외 · 반영 ${rows.length}대`);

  const jwt = new JWT({
    email: sa.client_email, key: sa.private_key,
    scopes: [apply ? 'https://www.googleapis.com/auth/spreadsheets' : 'https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;
  const api = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
  const head = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const metaRes = await fetch(`${api}?fields=properties.title,sheets(properties,bandedRanges,conditionalFormats,merges,filterViews,columnGroups)`, { headers: head });
  if (!metaRes.ok) {
    throw new Error(metaRes.status === 403
      ? `접근 권한 없음(403) — 시트 공유에 ${sa.client_email} 를 «편집자»로 추가해야 한다.`
      : `시트 메타 조회 실패 ${metaRes.status} ${(await metaRes.text()).slice(0, 200)}`);
  }
  const meta = await metaRes.json() as {
    properties: { title: string };
    sheets: {
      properties: { title: string; sheetId: number };
      bandedRanges?: { bandedRangeId: number }[];
      conditionalFormats?: unknown[];
      merges?: unknown[];
      filterViews?: { filterViewId: number }[];
      columnGroups?: { range: { startIndex?: number; endIndex?: number } }[];
    }[];
  };
  console.log(`  문서 「${meta.properties.title}」 · 탭 ${meta.sheets.length}개`);

  const sheetRows = headersOnly ? [] : rows;
  const tabName = exportTabName(sheetRows.length);
  console.log(`\n  쓸 내용 — 조회바 + 결과 수식 + 숨긴 원본 ${sheetRows.length}대`);

  const gidArg = arg('gid');
  const overwrite = gidArg
    ? meta.sheets.find((s) => String(s.properties.sheetId) === gidArg)
    // 탭 이름 뒤에 갱신시각·대수가 붙으므로 «앞말»로 찾는다.
    : tab ? meta.sheets.find((s) => s.properties.title.startsWith(tab)) : undefined;
  if ((gidArg || tab) && !overwrite) throw new Error(`덮어쓸 탭 없음 — ${gidArg ? `gid ${gidArg}` : `「${tab}」`}`);
  console.log(overwrite
    ? `  대상 — 기존 탭 「${overwrite.properties.title}」 덮어쓰기 (이름 유지)`
    : `  대상 — 새 탭 「${tabName}」 을 맨 왼쪽에 생성 (기존 ${meta.sheets.length}개 유지)`);

  if (!apply) { console.log('\n※ dry-run. 실제 쓰기는 --apply\n'); return; }

  let gid = overwrite?.properties.sheetId;
  // 덮어쓸 때는 **탭 이름을 바꾸지 않는다.** 영업자가 「상품리스트」를 즐겨찾기해 두는데
  // 반영할 때마다 날짜 이름으로 갈아치우면 그 링크가 매번 낯선 이름이 된다.
  let title = overwrite?.properties.title || '';
  if (gid === undefined) {
    // 같은 분에 두 번 돌리면 이름이 겹친다 — Sheets 는 중복 이름을 거부하므로 접미를 붙인다.
    let name = tabName;
    for (let i = 2; meta.sheets.some((s) => s.properties.title === name); i++) name = `${tabName} (${i})`;
    const made = await fetch(`${api}:batchUpdate`, {
      method: 'POST', headers: head,
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: name, index: 0 } } }] }),
    });
    if (!made.ok) throw new Error(`탭 생성 실패 ${made.status} ${(await made.text()).slice(0, 300)}`);
    gid = (await made.json() as Rec).replies[0].addSheet.properties.sheetId;
    title = name;
    console.log(`  탭 「${name}」 생성 (맨 왼쪽)`);
  } else {
    const clear = await fetch(`${api}/values/${encodeURIComponent(title)}!A:BZ:clear`, { method: 'POST', headers: head, body: '{}' });
    if (!clear.ok) throw new Error(`탭 비우기 실패 ${clear.status} ${(await clear.text()).slice(0, 300)}`);
  }

  const prevSheet = meta.sheets.find((s) => s.properties.sheetId === gid);
  // 카탈로그 링크 주소 — 지금 fp4 를 서비스하는 곳. 도메인 전환 전엔 freepasserp.com 이
  // erp3 를 가리키므로 그걸 쓰면 링크가 죽는다(--origin= 또는 INVENTORY_EXPORT_ORIGIN).
  const linkOrigin = arg('origin', S(process.env.INVENTORY_EXPORT_ORIGIN));
  if (!linkOrigin) console.log('  ⚠ 링크 주소 미지정 — 카탈로그 칸을 비운다 (--origin=https://… 로 지정)');
  // 사진 지도 — scripts/build-photo-map.mts 가 만든 캐시. 없으면 사진 칸이 빈다.
  const photoByPlate: Record<string, string> = (() => {
    try {
      const cache = JSON.parse(readFileSync('tmp/photo-map.json', 'utf8')) as Record<string, { url?: string }>;
      const out: Record<string, string> = {};
      for (const [plate, v] of Object.entries(cache)) if (v?.url) out[plate] = v.url;
      console.log(`  사진 지도 ${Object.keys(out).length}건`);
      return out;
    } catch {
      console.log('  ⚠ 사진 지도 없음 — npx tsx scripts/build-photo-map.mts 로 만든다');
      return {};
    }
  })();
  const built = buildInventorySheet(gid!, sheetRows, nameOf, {
    bandedRangeIds: (prevSheet?.bandedRanges || []).map((b) => b.bandedRangeId),
    conditionalCount: (prevSheet?.conditionalFormats || []).length,
    merges: (prevSheet?.merges || []).length,
    filterViewIds: (prevSheet?.filterViews || []).map((v) => v.filterViewId),
  }, linkOrigin, photoByPlate);

  // 결과 수식은 값이 아니라 «수식»으로 들어가야 한다 → USER_ENTERED.
  const put = await fetch(`${api}/values/${encodeURIComponent(title)}!A1?valueInputOption=USER_ENTERED`, {
    method: 'PUT', headers: head, body: JSON.stringify({ values: built.values }),
  });
  if (!put.ok) throw new Error(`쓰기 실패 ${put.status} ${(await put.text()).slice(0, 300)}`);

  // 서식은 값과 별개다. 실패해도 값은 이미 들어갔으므로 오류를 삼키지 말고 그대로 알린다.
  const requests = built.requests;
  /**
   * 맨 앞으로 올리고, 탭 이름에 **갱신시각·대수**를 싣는다 —
   * 탭을 열지 않고도 최신인지 알 수 있어야 영업자가 어제 것을 붙들고 팔지 않는다.
   * 앞말(`상품리스트`)은 그대로라 즐겨찾기해 둔 gid 링크는 안 깨진다.
   */
  if (overwrite) {
    const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
    const stamped = `${tab || '상품리스트'} ${kst.slice(5, 10).replace('-', '.')} ${kst.slice(11, 16)} · ${sheetRows.length}대`;
    requests.push({ updateSheetProperties: { properties: { sheetId: gid, index: 0, title: stamped }, fields: 'index,title' } });
    title = stamped;
  }
  const fmt = await fetch(`${api}:batchUpdate`, { method: 'POST', headers: head, body: JSON.stringify({ requests }) });
  if (!fmt.ok) {
    console.log(`\n  ⚠ 값은 들어갔으나 서식 적용 실패 ${fmt.status} — ${(await fmt.text()).slice(0, 400)}\n`);
    return;
  }
  console.log(`\n  반영 완료 — 탭 「${title || tabName}」 · ${built.values.length}행 · 조회바·서식 적용됨\n`);
}

main().catch((e) => { console.error(String(e?.message || e)); process.exit(1); });
