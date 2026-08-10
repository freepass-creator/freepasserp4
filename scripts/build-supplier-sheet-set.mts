/**
 * **공급사 시트 한 벌**을 통째로 만든다 — ②공급사시트 정리 + ③공급사별 제공시트 13개.
 *
 * 우리가 다루는 시트는 세 종류다. 이 스크립트는 ②③을 맡는다.
 *   ① 영업자용 「프리패스 상품리스트」  — 신버전(상품리스트)·구버전(종합표) 두 탭. `publish-sales-sheet` 가 맡는다.
 *   ② 공급사시트 정리                — 어느 공급사가 어떤 시트로 몇 대 들어오나. ③으로 가는 문패.
 *   ③ 공급사별 시트                  — 외부시트(공급사 것, 링크만) + 우리 제공시트(여기서 만든다).
 *
 * ★왜 새로 만드나(2026-08-10)
 *   기존 우리 제공시트 13곳은 개인 지메일(`tbag4783`) 소유에 **링크만 알면 누구나 편집**이었다.
 *   그 계정이 막히면 13곳 유입이 한 번에 멈추고, 공급사 A 가 B 의 재고를 고칠 수 있다.
 *   원본은 그대로 두고 새 시트를 만들어 「앞으로 여기 입력해 주세요」로 갈아탄다.
 *
 * ★제외 4곳 — 공급사가 원래 쓰던 자기 시트다. 우리가 갈아엎을 자리가 아니라 ②에 링크만 싣는다.
 *   오토플러스(RP023) · 아이카(RP004) · 아이언(RP006) · 이안카(RP031)
 *
 * ⚠ 도메인 위임이 있어야 돈다. 서비스계정은 저장용량이 0 이라 **제 이름으로는 파일을 못 만든다**
 *   (403 The caller does not have permission). `--as=` 계정을 대행해서 만든다 —
 *   그래야 소유자가 처음부터 회사 계정이고, 나중에 소유권을 옮길 일이 없다.
 *   관리콘솔 → 보안 → API 제어 → 도메인 전체 위임에 client_id 와 drive·spreadsheets 범위를 등록한다.
 *
 * ⚠ RTDB `sheet_url` 은 **바꾸지 않는다.** 공급사가 새 시트를 채우기 전에 갈아타면 재고가 0 이 된다.
 *   옮겨 담고 확인한 뒤 `--switch` 를 따로 돌린다.
 *
 *   npx tsx scripts/build-supplier-sheet-set.mts                 미리보기
 *   npx tsx scripts/build-supplier-sheet-set.mts --apply         ②③ 생성
 *   npx tsx scripts/build-supplier-sheet-set.mts --apply --only=RP020,RP021
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { HANDLED_MAKER_OPTIONS } from '../lib/domain/handled-makers';
import { canonProductType, isListableProduct } from '../lib/domain/product';
import { companyAlias } from '../lib/domain/identity';
import {
  ROW_HEADER, TEMPLATE_COLUMNS, buildNumberFormats, buildTableRequest,
  buildTableUpdateRequest, buildTemplateFormat, buildTemplateValues, yearOptions,
} from '../lib/domain/supplier-template-sheet';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const AS = arg('as', 'pyh@teamjpk.com');
const ONLY = arg('only').split(',').map(S).filter(Boolean);
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/** 공급사가 자기 시트를 쓰는 곳 — 만들지 않고 ②에 링크만 싣는다. */
const KEEP_OWN = new Set(['RP023', 'RP004', 'RP006', 'RP031']);
const idOf = (u: string) => (u.match(/\/spreadsheets\/d\/([\w-]+)/) || [])[1] || '';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'];

/** RTDB 는 서비스계정 제 이름으로 읽는다 — 대행 토큰에는 firebase 범위가 없다. */
const dbToken = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;

const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbToken}`)).text()) || {}));
const dead = (v: Rec) => v?._deleted === true || !!v?.deletedAt || S(v?.status) === 'deleted';

const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) {
  for (const [k, v] of Object.entries(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
}
/**
 * ★같은 공급사가 두 줄로 서지 않게 코드로 접는다.
 * 파트너 레코드가 v3·v4 두 벌인 곳이 있고(제이앤제이 RP030) 한쪽에만 `sheet_url` 이 있다.
 * 시트 주소가 **있는 쪽**을 남긴다 — 그게 실제로 연동되는 레코드다.
 */
const folded = new Map<string, Rec>();
for (const p of Object.values(partners)) {
  if (dead(p)) continue;
  const code = S(p.partner_code) || S(p._key);
  const prev = folded.get(code);
  if (!prev || (!S(prev.sheet_url) && S(p.sheet_url))) folded.set(code, p);
}

type Stat = { total: number; listable: number; types: Map<string, number>; latest: string };
const blank = (): Stat => ({ total: 0, listable: 0, types: new Map(), latest: '' });
const stat = new Map<string, Stat>();
for (const [key, v] of Object.entries(prods as Record<string, Rec>)) {
  if (!v || typeof v !== 'object' || dead(v)) continue;
  const code = S(v.provider_company_code) || '(코드없음)';
  if (!stat.has(code)) stat.set(code, blank());
  const s = stat.get(code)!;
  s.total++;
  if (isListableProduct({ ...v, _key: key } as EntityRecord)) s.listable++;
  const t = canonProductType(v.product_type) || '(빈)';
  s.types.set(t, (s.types.get(t) || 0) + 1);
  const up = S(v.updatedAt) || S(v._snap_at);
  if (up > s.latest) s.latest = up;
}

type Row = {
  code: string; name: string; oldUrl: string; tab: string; n: number; listable: number;
  types: string; latest: string; mine: boolean; newUrl: string; note: string;
};
const rows: Row[] = [...folded.values()]
  .map((p) => {
    const code = S(p.partner_code) || S(p._key);
    const s = stat.get(code) || blank();
    const oldUrl = S(p.sheet_url);
    return {
      code,
      name: companyAlias(S(p.partner_name || p.name || p.company_name), p.alias) || code,
      oldUrl, tab: S(p.sheet_tab), n: s.total, listable: s.listable,
      types: [...s.types.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '),
      latest: s.latest ? s.latest.slice(0, 10) : '',
      mine: !!oldUrl && !KEEP_OWN.has(code),
      newUrl: '',
      note: !oldUrl && s.total > 0 ? '시트 미등록 — 재고가 갱신되지 않는다'
        : !oldUrl ? '시트 없음'
          : s.total === 0 ? '시트는 있는데 재고 0 — 탭·헤더 확인' : '',
    };
  })
  .filter((r) => r.oldUrl || r.n > 0)
  .sort((a, b) => b.n - a.n);

const mine = rows.filter((r) => r.mine).filter((r) => !ONLY.length || ONLY.includes(r.code));

console.log(`■ 공급사 시트 한 벌 ${APPLY ? '만들기' : '미리보기(dry-run)'} — ${AS} 이름으로\n`);
console.log(`  ② 공급사시트 정리 — ${rows.length}곳`);
console.log(`  ③ 우리 제공시트   — ${mine.length}개 새로 만든다`);
console.log(`     제외(공급사 자기 시트) — 오토플러스 · 아이카 · 아이언 · 이안카\n`);
console.log(`  ${'공급사'.padEnd(16)}${'코드'.padEnd(10)}재고  목록  시트`);
for (const r of rows) {
  console.log(`  ${r.name.slice(0, 15).padEnd(16)}${r.code.padEnd(10)}${String(r.n).padStart(4)}${String(r.listable).padStart(6)}  ${r.mine ? '우리 제공 → 새로 만듦' : r.oldUrl ? '외부(공급사 것) — 링크만' : r.note}`);
}

if (!APPLY) { console.log('\n※ dry-run. 실제 생성은 --apply\n'); process.exit(0); }

// ── 여기부터 쓰기. 대행 토큰이 없으면 아무것도 만들지 않고 멈춘다 ────────────
let token: string;
try {
  token = (await new JWT({ email: sa.client_email, key: sa.private_key, scopes: SCOPES, subject: AS }).getAccessToken()).token!;
} catch (e) {
  console.error(`\n✗ ${AS} 대행 실패 — ${String((e as Error).message).split(':')[0]}`);
  console.error(`  서비스계정은 저장용량이 0 이라 제 이름으로는 파일을 못 만든다. 도메인 위임이 있어야 한다.`);
  console.error(`  관리콘솔 → 보안 → API 제어 → 도메인 전체 위임 → 새로 추가`);
  console.error(`    클라이언트 ID  ${sa.client_id}`);
  console.error(`    OAuth 범위     ${SCOPES.join(',')}\n`);
  process.exit(1);
}
const head = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/**
 * ★쿼터·일시장애는 재시도한다 — 한 번에 14개를 만들면 구글이 429/503 을 던진다.
 * 2026-08-10 첫 실행에서 센트로가 껍데기로, 퍼시픽·정리시트가 통째로 날아갔다.
 */
const call = async (url: string, init?: RequestInit, tries = 5): Promise<any> => {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { ...init, headers: head });
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : {};
    if ((res.status === 429 || res.status >= 500) && i < tries) { await sleep(2000 * 2 ** i); continue; }
    throw new Error(`${res.status} ${text.slice(0, 600)}`);
  }
};
/** 같은 이름이 이미 있으면 그걸 쓴다 — 두 번 돌려도 시트가 두 벌 생기지 않는다. */
const findByName = async (title: string): Promise<string> => {
  const q = encodeURIComponent(`name = '${title.replace(/'/g, "\\'")}' and trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'`);
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=2`) as { files?: { id: string }[] };
  return r.files?.[0]?.id || '';
};

const dropdownExtras = { 제조사: [...HANDLED_MAKER_OPTIONS], 연식: yearOptions(new Date().getFullYear()) };
const templateValues = buildTemplateValues();
const ROWS = 300;

// ── ③ 공급사별 제공시트 ────────────────────────────────────────────────
for (const r of mine) {
  const title = `프리패스 재고 · ${r.name}`;
  try {
    // 이미 있으면 그 시트에 다시 찍는다 — 첫 실행에서 쿼터로 반쯤 만들어진 것들을 여기서 여민다.
    let id = await findByName(title);
    const reused = !!id;
    if (!id) {
      const doc = await call('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        body: JSON.stringify({ properties: { title }, sheets: [{ properties: { title: '재고', sheetId: 0 } }] }),
      }) as { spreadsheetId: string };
      id = doc.spreadsheetId;
    }
    const api = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;

    await call(`${api}/values/${encodeURIComponent('재고')}!A1?valueInputOption=USER_ENTERED`, {
      method: 'PUT', body: JSON.stringify({ values: templateValues }),
    });
    await call(`${api}:batchUpdate`, {
      method: 'POST', body: JSON.stringify({ requests: buildTemplateFormat(0, TEMPLATE_COLUMNS, dropdownExtras, { asTable: true }) }),
    });
    // 표(Table)로 만들어야 드롭다운이 칩으로 뜬다. 순서를 지켜야 한다 —
    // 필터가 남아 있으면 변환이 거부되고, 표를 만든 뒤에야 필터를 걸 수 있다.
    // 표(Table)는 이미 있으면 다시 못 만든다 — 되돌려 만드는 판이라 실패해도 넘어간다.
    await call(`${api}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [
        { clearBasicFilter: { sheetId: 0 } },
        buildTableRequest(0, TEMPLATE_COLUMNS, dropdownExtras, ROWS),
        { setBasicFilter: { filter: { range: {
          sheetId: 0, startRowIndex: ROW_HEADER, endRowIndex: ROWS, startColumnIndex: 0, endColumnIndex: TEMPLATE_COLUMNS.length,
        } } } },
      ] }),
    }).catch(async () => {
      // 표가 이미 있으면 **갱신**한다. 이걸 빼면 드롭다운이 옛 목록에 머문다(2026-08-10 상태값 6개).
      const meta = await call(`${api}?fields=sheets(tables(tableId))`) as { sheets?: { tables?: { tableId: string }[] }[] };
      const tableId = meta.sheets?.[0]?.tables?.[0]?.tableId;
      await call(`${api}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: [
          // ★필터가 걸린 채로는 표를 못 고친다 —
          //   「데이터를 표로 변환하기 전에 변환 영역과 겹치는 필터를 삭제하세요」(400).
          //   한 배치 안에서 지우고·고치고·다시 건다.
          { clearBasicFilter: { sheetId: 0 } },
          ...(tableId ? [buildTableUpdateRequest(tableId, TEMPLATE_COLUMNS, dropdownExtras, ROWS)] : []),
          { setBasicFilter: { filter: { range: {
            sheetId: 0, startRowIndex: ROW_HEADER, endRowIndex: ROWS, startColumnIndex: 0, endColumnIndex: TEMPLATE_COLUMNS.length,
          } } } },
        ] }),
      });
    });
    await call(`${api}:batchUpdate`, {
      method: 'POST', body: JSON.stringify({ requests: buildNumberFormats(0, TEMPLATE_COLUMNS, ROWS) }),
    });
    // ★서비스계정을 편집자로 — 이게 빠지면 ERP 가 새 시트를 못 읽는다.
    await call(`https://www.googleapis.com/drive/v3/files/${id}/permissions?sendNotificationEmail=false`, {
      method: 'POST', body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: sa.client_email }),
    }).catch(() => {});   // 이미 편집자면 그대로 둔다
    r.newUrl = `https://docs.google.com/spreadsheets/d/${id}/edit`;
    r.note = '새 시트 준비됨 — 공급사에게 배포 후 --switch';
    console.log(`  ${reused ? '↻' : '✓'} ${r.name} — ${id}`);
  } catch (e) {
    r.note = `생성 실패 — ${String((e as Error).message).slice(0, 90)}`;
    console.log(`  △ ${r.name} — ${r.note}`);
  }
}

// ── ② 공급사시트 정리 ─────────────────────────────────────────────────
const HEAD = ['공급사', '코드', '재고', '목록', '구분', '마지막갱신', '연동방식', '새 시트(우리 제공)', '기존 시트', '탭(gid)', '확인할 것'];
const values: (string | number)[][] = [HEAD, ...rows.map((r) => [
  r.name, r.code, r.n, r.listable, r.types, r.latest,
  r.mine ? '우리 제공시트' : r.oldUrl ? '외부시트(공급사 소유)' : '연동 없음',
  // ★외부 시트는 링크만 — 내용은 그 시트가 정본이라 복사해 두면 곧 어긋난다.
  r.newUrl ? `=HYPERLINK("${r.newUrl}","열기")` : '',
  r.oldUrl ? `=HYPERLINK("${r.oldUrl}","열기")` : '',
  r.tab, r.note,
])];

let indexUrl = '';
try {
  const INDEX_TITLE = '프리패스 공급사시트 정리';
  let id = await findByName(INDEX_TITLE);
  if (!id) {
    const doc = await call('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      body: JSON.stringify({ properties: { title: INDEX_TITLE }, sheets: [{ properties: { title: '공급사연동', sheetId: 0 } }] }),
    }) as { spreadsheetId: string };
    id = doc.spreadsheetId;
  }
  const api = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
  // 공급사가 줄면 아래에 유령이 남는다 — 비우고 쓴다.
  await call(`${api}/values/${encodeURIComponent('공급사연동')}!A1:Z500:clear`, { method: 'POST', body: '{}' });
  await call(`${api}/values/${encodeURIComponent('공급사연동')}!A1?valueInputOption=USER_ENTERED`, {
    method: 'PUT', body: JSON.stringify({ values }),
  });
  await call(`${api}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [
      { updateSheetProperties: { properties: { sheetId: 0, gridProperties: { frozenRowCount: 1, frozenColumnCount: 2 } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } },
      { repeatCell: {
        range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.15, green: 0.18, blue: 0.24 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      } },
      { setBasicFilter: { filter: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: values.length, startColumnIndex: 0, endColumnIndex: HEAD.length } } } },
      { autoResizeDimensions: { dimensions: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: HEAD.length } } },
    ] }),
  });
  await call(`https://www.googleapis.com/drive/v3/files/${id}/permissions?sendNotificationEmail=false`, {
    method: 'POST', body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: sa.client_email }),
  }).catch(() => {});
  indexUrl = `https://docs.google.com/spreadsheets/d/${id}/edit`;
  console.log(`\n  ✓ ② 공급사시트 정리 — ${indexUrl}`);
} catch (e) {
  console.log(`\n  △ ② 만들기 실패 — ${String((e as Error).message).slice(0, 140)}`);
}

// ── 기존 공급사 시트 복사(백업) ────────────────────────────────────────
/**
 * ★새 시트로 갈아타기 전에 원본을 떠 둔다.
 *   기존 13곳은 개인 지메일 소유에 「누구나 편집」이라, 누가 지우면 되돌릴 길이 없다.
 *   복사본은 `pyh@teamjpk.com` 소유가 되므로 그 계정이 막혀도 우리 손에 남는다.
 *   원본은 **건드리지 않는다** — 공급사가 아직 거기에 입력하고 있다.
 */
if (process.argv.includes('--backup')) {
  const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  let folder = await (async () => {
    const q = encodeURIComponent(`name = '공급사시트 백업 ${stamp}' and trashed = false and mimeType = 'application/vnd.google-apps.folder'`);
    const r = await call(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`) as { files?: { id: string }[] };
    return r.files?.[0]?.id || '';
  })();
  if (!folder) {
    const f = await call('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      body: JSON.stringify({ name: `공급사시트 백업 ${stamp}`, mimeType: 'application/vnd.google-apps.folder' }),
    }) as { id: string };
    folder = f.id;
  }
  console.log(`\n■ 기존 공급사 시트 복사 — 폴더 「공급사시트 백업 ${stamp}」`);
  for (const r of rows) {
    const src = idOf(r.oldUrl);
    if (!src) continue;
    const name = `${r.name}(${r.code}) 원본 ${stamp}`;
    try {
      if (await findByName(name)) { console.log(`  ↷ ${r.name} — 이미 복사됨`); continue; }
      await call(`https://www.googleapis.com/drive/v3/files/${src}/copy`, {
        method: 'POST', body: JSON.stringify({ name, parents: [folder] }),
      });
      console.log(`  ✓ ${r.name}`);
    } catch (e) {
      // 외부 시트는 열람 권한이 없을 수 있다 — 못 뜬 것을 분명히 남긴다.
      console.log(`  △ ${r.name} — 복사 실패 ${String((e as Error).message).slice(0, 70)}`);
    }
  }
  console.log(`  https://drive.google.com/drive/folders/${folder}`);
}

const out = 'tmp/supplier-sheet-set.csv';
mkdirSync('tmp', { recursive: true });
const esc = (v: unknown) => `"${String(v ?? '').replace(/^=HYPERLINK\("([^"]+)".*$/, '$1').replace(/"/g, '""')}"`;
writeFileSync(out, `﻿${[HEAD.join(','), ...values.slice(1).map((r) => r.map(esc).join(','))].join('\r\n')}`, 'utf8');
console.log(`  정리표 CSV: ${out}`);
console.log('\n⚠ RTDB sheet_url 은 그대로다 — 공급사가 새 시트를 채운 뒤에 바꾼다.\n');
