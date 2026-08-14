/**
 * **공급사 시트를 ERP 안 거치고 영업자 표로 그대로 찍는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-12 — 「erp 의존하지말고 일단 니가 ai로 작업해서 올리자고」)
 *   영업자가 ERP 를 안 믿는다. 오늘 하루에 오플 요금 92대 밀림·유령 48개월 72대·아이카 37대가
 *   나왔고, 전부 **우리가 옮기다 생긴 오류**였다. 공급사 시트에는 맞게 적혀 있었다.
 *   그래서 옮기는 단계를 뺀다 — 공급사가 쓴 글자를 그대로 싣는다.
 *
 * ★**돈은 해석하지 않는다.** 요금·보증금·상태는 시트 칸에 있는 글자를 그 자리에 옮길 뿐이다.
 *   보증금을 규칙으로 계산하지 않고, 기간을 자리로 짐작하지 않는다 — 오늘 틀린 게 전부 그거였다.
 * ★**차명만 차종마스터로 올린다**(사장님 2026-08-12 — 「니가 학습해서 차종마스터 값으로 옮겨줄수 있어?」).
 *   공급사마다 「G70」·「제네시스 G70 2.0T」처럼 제각각이라 그대로 두면 정렬도 검색도 안 된다.
 *   ★이건 오늘 틀린 것과 **다른 일**이다. 차종 스냅은 실측 98.5% 맞았고, 틀린 건 요금 매핑이었다.
 *   ⚠ 확신도가 낮으면(low) **안 올린다** — 공급사 원문을 그대로 둔다. 틀린 차명이 붙느니 낫다.
 *   ⚠ 원문은 「공급사표기」 칸에 그대로 남긴다. 무엇을 무엇으로 바꿨는지 눈으로 확인할 수 있어야 한다.
 *   ⚠ 그래서 공급사 시트가 틀리면 여기도 틀린다. 그건 «공급사에 물어볼 일»이 되고,
 *     영업자가 우리를 의심할 일은 없어진다 — 이 표의 값어치는 정확히 거기에 있다.
 * ★읽는 법만 `readSupplierSheet` 를 쓴다(숨긴 행·숨긴 탭·어댑터 헤더). 그건 «해석»이 아니라
 *   «어디가 표인지» 찾는 일이라 빼면 엉뚱한 줄을 싣는다.
 * ★열 배치는 영업자가 보던 것과 같게 둔다 — 공급사마다 열이 다르다고 표를 들쭉날쭉하게 두면
 *   그게 또 «못 믿을 표»가 된다. 시트에 없는 칸은 **비운다**(지어내지 않는다).
 *
 *   npx tsx scripts/publish-origin-tab.mts
 *   npx tsx scripts/publish-origin-tab.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { NOT_SHEET_BACKED, SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { companyAlias } from '../lib/domain/identity';
import { fetchHubPartners } from '../lib/domain/sheet-hub-sync';
import { snapToMaster } from '../lib/domain/vehicle-master-match';
import { buildSalesFormatRequests, columnWidths, rgb, LINK, FONT, SIZE, ITALIC } from '../lib/domain/sales-sheet-format';
import { productType } from '../lib/domain/sales-sheet-clean';
import { SALES_ALIAS, SALES_COLUMNS } from '../lib/domain/sales-sheet-mapping';
import { HANDOVER_TAB, STALE_DAYS, daysSince, readLog } from '../lib/domain/supplier-handover-log';
import { pickPolicy, policyCell, readPolicyTab, type PolicyBook } from '../lib/domain/supplier-policy-read';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const SHEET = arg('sheet', '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
/**
 * 탭 이름. **기본값을 바꾸지 마라** — 아래 377행이 «이름으로» 기존 탭을 찾는다.
 * ⚠ 이름이 어긋나면 못 찾고 **새 탭을 하나 더 만든다.** 그러면 영업자 문서에
 *   「상품리스트」가 둘이 되고, 누가 어느 걸 보는지 알 수 없어진다(실측 2026-08-14 · 두 번째 사고).
 */
const TAB = arg('tab', '상품리스트');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
/** 「공급사시트정리」 — 공급사명 | 공급사코드 | 시트주소. 주소의 정본이다. */
const INDEX_SHEET = arg('index', '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY');

/**
 * ★영업자가 **원래 쓰던 시트**(「전체시트」)의 열 그대로다 — 사장님 2026-08-12
 *   「영업자들이 그냥 기존걸 원했어 · 이 스타일대로」. 순서·이름을 임의로 바꾸지 마라.
 *   손에 익은 자리가 곧 그 표의 값어치다.
 * ★단 하나 덧붙인 것이 「공급사」다. 원본은 **아이카 한 곳만** 담은 시트라 필요가 없었지만
 *   (차고지·전용계좌가 전부 아이카다), 우리 표는 17곳을 합치므로 이게 없으면
 *   어느 회사 차인지 알 수가 없다.
 * ★「입고일자」는 원본에 열이 있고 값은 비어 있다. 자리를 지키되 채우지 않는다 —
 *   영업자용에는 필요 없는 값이다(사장님 2026-08-12).
 */
/**
 * ★**열 구성도 매핑표가 정한다.** 판매시트 「AI 인계」 @매핑 의 줄 차례가 곧 열 차례다.
 *   열을 더하거나 자리를 바꾸려면 그 표를 고치면 된다 — 코드를 안 고쳐도 된다.
 * ★아래는 표를 못 읽을 때 쓰는 예비다.
 */
/**
 * ⚠ 예비 열 목록과 예비 매핑을 **따로 적지 마라.** 따로 적었더니 서로 어긋나서,
 *   매핑을 못 읽는 날엔 「배차상태·모델·파워트레인·세부트림」 네 열이 경고 없이 통째로 비었다
 *   (실측 2026-08-14). 둘 다 `lib/domain/sales-sheet-mapping` 한 곳에서 나온다.
 */
let COLUMNS: string[] = SALES_COLUMNS;

/**
 * 영업자 열 ← 공급사 시트 열 이름 후보. **먼저 맞는 것**을 쓴다.
 * ⚠ 여기 없는 이름은 안 옮긴다 — 짐작해서 붙이면 그게 곧 «우리가 만든 오류»다.
 *
 * ★**정본은 판매시트의 숨긴 탭 「AI 인계」 @매핑 표다**(사장님 2026-08-14 —
 *   「판매시트에 매뉴얼 숨겨서 그 매뉴얼대로 갖고오자」).
 *   아래 값은 그 표를 못 읽을 때만 쓰는 예비다. 규칙을 고치려면 코드가 아니라 시트를 고친다.
 */
/** 실제로 쓸 매핑. 아래에서 판매시트 「AI 인계」 @매핑 표를 읽어 채운다. */
let ALIAS: Record<string, string[]> = SALES_ALIAS;

/** 차종마스터 — 차명을 올릴 때만 쓴다. 돈에는 손대지 않는다. */
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec;
const MASTER = ((Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || []) as MasterEntry[];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
/**
 * ⚠ 시트 API 는 «분당 읽기» 쿼터가 있다. 공급사 18곳을 연달아 읽으면 중간에 429 가 난다.
 *   재시도가 없으면 그 공급사가 「시트를 못 읽었다」 한 줄로 떨어지고, 그날 표에서
 *   그 집 재고가 통째로 빠진다 — «조용히 사라진 차»가 바로 이 경로다.
 */
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) {
      const wait = Math.min(60_000, 5_000 * 2 ** n);
      console.log(`  … ${res.status} — ${Math.round(wait / 1000)}초 쉬고 다시`);
      await new Promise((ok) => setTimeout(ok, wait));
      continue;
    }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};

/**
 * ★**파이어베이스를 거치지 않는다**(사장님 2026-08-13 — 「안 통하고 다이렉트로 붙일 수 있냐」).
 *   이 발행기가 쓰는 것은 구글시트뿐이다 — 문패에서 주소를 읽고, 공급사 시트를 읽어,
 *   영업자 시트에 쓴다. RTDB 는 한 번도 안 부른다.
 *   ⚠ 파트너 레코드를 다시 끌어오지 마라 — v3·v4 가 갈려 있어 거기서 주소를 찾다가
 *     이안카 84대·오플 100대가 통째로 빠졌다(실측 2026-08-13).
 */
const [t3, t4]: [Rec, Rec] = [{}, {}];
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
/**
 * 한 공급사에 시트 주소가 **두 벌**일 수 있다(v3·v4 파트너가 같은 코드를 쓴다).
 * 하나는 옛 시트라 읽으면 표가 안 나온다 — 실측 2026-08-12: 아이카가 그래서 0대로 나왔다.
 * 그래서 주소를 **후보로 모아 두고**, 아래에서 «읽어서 표가 나오는 쪽»을 쓴다.
 * 이름만 보고 고르면 또 틀린다.
 */
const byCode = new Map<string, Rec & { sheet_urls: string[] }>();
for (const p of Object.values<Rec>(partners)) {
  if (dead(p)) continue;
  const c = S(p.partner_code);
  if (!c) continue;
  const cur = byCode.get(c);
  const urls = [...(cur?.sheet_urls || []), S(p.sheet_url)].filter(Boolean);
  byCode.set(c, { ...(cur || {}), ...p, sheet_urls: [...new Set(urls)] });
}
/**
 * ★**시트 주소의 정본은 문패 시트「공급사시트정리」다**(사장님 2026-08-13 —
 *   「v3 반영하지 말고 그냥 공급사시트 기반으로 간다」).
 *   RTDB 파트너 레코드는 보지 않는다 — v3·v4 가 갈려 있고 v4 는 껍데기라(실측 18곳 중 0곳만 완비)
 *   거기서 주소를 찾다가 이안카 84대가 통째로 빠져 있었다.
 * ★문패에 있는 공급사는 파트너 레코드가 없어도 **읽는다.** 시트가 정본이지 레코드가 정본이 아니다.
 * ⚠ `fetchHubPartners` 를 쓰지 마라 — 앱 API 를 거쳐 관리자 로그인이 필요하다(스크립트에서 늘 실패했다).
 *   Sheets API 로 문패를 직접 읽는다.
 */
/**
 * ★**매핑의 정본은 판매시트 숨긴 탭 「AI 인계」의 @매핑 표다.**
 *   [A열 표식][B열 판매시트 열][C열 공급사 열 이름 후보(쉼표)] — @매핑 부터 @매핑끝 까지.
 *   시트를 고치면 발행이 바로 그대로 따른다. 코드를 안 고쳐도 된다.
 * ⚠ 표를 못 읽으면 예비값으로 돈다. 그때는 반드시 화면에 알린다 —
 *   조용히 옛 규칙으로 도는 게 제일 나쁘다.
 */
{
  try {
    const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent("'AI 인계'!A1:C400")}`) as { values?: string[][] };
    const rows = (v.values || []) as string[][];
    const from = rows.findIndex((r) => S(r[0]) === '@매핑');
    if (from < 0) throw new Error('@매핑 줄이 없다');
    const map: Record<string, string[]> = {};
    for (const r of rows.slice(from + 1)) {
      if (S(r[0]) === '@매핑끝') break;
      const col = S(r[1]);
      const cands = S(r[2]).split(',').map((x) => x.trim()).filter((x) => x && !x.startsWith('('));
      if (col && cands.length) map[col] = cands;
    }
    if (!Object.keys(map).length) throw new Error('@매핑 표가 비었다');
    ALIAS = map;
    // 표에 적힌 차례가 곧 열 차례다. 「공급사」는 문패 이름으로 채우므로 후보가 없어도 열은 세운다.
    const order: string[] = [];
    for (const r of rows.slice(from + 1)) {
      if (S(r[0]) === '@매핑끝') break;
      const col = S(r[1]);
      if (col) order.push(col);
    }
    if (order.length) COLUMNS = order;
    console.log(`  매핑을 판매시트 「AI 인계」에서 읽었다 — ${COLUMNS.length}열 · 후보 있는 칸 ${Object.keys(map).length}\n`);
  } catch (e) {
    console.log(`  ⚠ @매핑 표를 못 읽어 **코드의 예비값**으로 돈다 — ${String((e as Error).message).slice(0, 80)}\n`);
  }
}

/**
 * ★**치환 사전은 숨긴 탭 「AI 정제」다**(사장님 2026-08-14 —
 *   「익스크루스비 → 익스클루시브」·「벤츠 이클래스 → E-클래스」 이런 식으로).
 *   [A열 @구분][B열 공급사가 쓴 말][C열 바꿀 값]. C가 비면 원문 그대로 둔다.
 * ⚠ 표에 없는 말은 **손대지 않는다.** 짐작해서 바꾸는 게 곧 «우리가 만든 오류»다.
 */
const SUBST = new Map<string, string>();
try {
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent("'AI 정제'!A1:D2000")}`) as { values?: string[][] };
  for (const r of ((v.values || []) as string[][])) {
    const kind = S(r[0]), from = S(r[1]), to = S(r[2]);
    if (!kind.startsWith('@') || kind === '@설명' || !from || !to) continue;
    SUBST.set(`${kind.slice(1)}|${from}`, to);
  }
  console.log(`  치환 사전 「AI 정제」 ${SUBST.size}줄\n`);
} catch (e) { console.log(`  ⚠ 「AI 정제」를 못 읽어 치환 없이 돈다 — ${String((e as Error).message).slice(0, 60)}\n`); }
/** 열 이름 그대로 사전을 찾는다 — 외장/내장/제조사/모델/세부모델/세부트림. */
const clean = (col: string, val: string) => SUBST.get(`${col}|${S(val)}`) ?? S(val);

/**
 * ★**상품리스트에서 뺄 것** — 「AI 인계」 @제외 표가 정한다.
 *   오플·손오공 구독은 별도 탭이 원본을 통째로 싣는다. 여기에도 실으면 **같은 차가 두 탭에 선다** —
 *   한쪽만 갱신되면 영업자가 옛 값을 본다(오플 유령 48개월이 그렇게 났다).
 *   적는 법: 「RP023」(그 공급사 전부) 또는 「RP012:구독」(그 공급사의 탭 이름에 «구독»이 든 것만).
 */
const EXCLUDE: { code: string; tab: string }[] = [];
try {
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent("'AI 인계'!A1:C400")}`) as { values?: string[][] };
  const rows2 = (v.values || []) as string[][];
  const from = rows2.findIndex((r) => S(r[0]) === '@제외');
  if (from >= 0) {
    for (const r of rows2.slice(from + 1)) {
      if (S(r[0]) === '@제외끝') break;
      const spec = S(r[1]);
      if (!spec) continue;
      const [code, tab = ''] = spec.split(':');
      if (code) EXCLUDE.push({ code: code.trim(), tab: tab.trim() });
    }
  }
  console.log(`  제외 규칙 ${EXCLUDE.length}개 — ${EXCLUDE.map((x) => x.code + (x.tab ? `:${x.tab}` : '')).join(' · ') || '(없음)'}\n`);
} catch { /* 없으면 아무것도 안 뺀다 */ }
const excluded = (code: string, tabTitle: string) =>
  EXCLUDE.some((x) => x.code === code && (!x.tab || S(tabTitle).includes(x.tab)));

{
  const idx = await api(`https://sheets.googleapis.com/v4/spreadsheets/${INDEX_SHEET}/values/A1:Z200`) as { values?: string[][] };
  let n = 0;
  for (const r of (idx.values || [])) {
    const name = S(r[0]);
    const c = S(r[1]);
    const url = S(r[2]);
    if (!c || !url || !/^https?:/.test(url)) continue;
    const cur = byCode.get(c);
    byCode.set(c, {
      ...(cur || {}),
      partner_name: S(cur?.partner_name || cur?.name) || name,
      partner_code: c,
      // 문패 주소를 **맨 앞 후보**로 — 그게 정본이다.
      sheet_urls: [...new Set([url, ...(cur?.sheet_urls || [])])],
    } as Rec & { sheet_urls: string[] });
    n++;
  }
  console.log(`  문패 「공급사시트정리」에서 ${n}곳을 읽었다\n`);
}

console.log(`■ 공급사 시트를 그대로 영업자 표로 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
const rows: string[][] = [];
const failures: string[] = [];
/** @제외 로 안 실은 탭 — 몇 줄짜리였는지 같이 남긴다. 「조용히 빠진 차」가 없어야 한다. */
const skippedTabs: string[] = [];
/** 규격화시트인데 동기화가 멈춘 곳 — 값이 조용히 낡는 유일한 경로다. */
const staleSheets: string[] = [];
/** 차종마스터가 못 알아본 차 — 정제칸으로 사람이 닫아야 할 목록이다. */
const unmatched: string[] = [];
/** 정책 탭을 못 읽은 공급사 — 그 집 부가정보가 통째로 빈다. */
const noPolicy: string[] = [];
/** 정책이 여럿인데 코드가 비어 «어느 정책인지 못 정한» 차. */
const ambiguous: string[] = [];
const who0 = (p: Rec) => companyAlias(S(p.partner_name || p.name)) || S(p.partner_name || p.name);
const seenPlate = new Set<string>();
/**
 * ★차량번호 셀에 걸 **공급사가 올려놓은 사진 링크**(사장님 2026-08-14).
 *   시트에는 사진 «열»이 없다 — 공급사는 차번 칸에 링크를 건다
 *   (아이카=상세페이지 하이퍼링크, 오플·리더스=드라이브 폴더 스마트칩).
 *   `readSupplierSheet` 가 `photoByPlate` 로 뽑아 준다.
 * ⚠ 없는 차는 손대지 않는다 — 우리 카탈로그로 돌리지 마라. «사진 보러 눌렀더니 딴 데»가 된다.
 */
const photoOf = new Map<string, string>();
let dupes = 0;
/** @제외 규칙으로 건너뛴 탭 수 — 조용히 빠지면 «왜 줄었나»를 못 찾는다. */
let skippedByRule = 0;
for (const [code, p] of [...byCode].sort()) {
  if (NOT_SHEET_BACKED.has(code)) { failures.push(`${S(p.partner_name || p.name)}(${code}) — 홈페이지 수집이라 시트가 없다`); continue; }
  // 후보 주소를 차례로 열어 **표가 나오는 첫 번째**를 쓴다. 하나도 안 나오면 그 공급사는 «모름»이다.
  let read: ReturnType<typeof readSupplierSheet> | null = null;
  let lastErr = '';
  let readId = '';
  for (const url of (p.sheet_urls || [])) {
    const id = (S(url).match(/\/d\/([\w-]+)/) || [])[1];
    if (!id) continue;
    try {
      const grid = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`);
      const got = readSupplierSheet(grid as never, p as EntityRecord);
      if (got.tabs.length) { read = got; readId = id; break; }
      lastErr = '표가 있는 탭이 없다';
    } catch (e) { lastErr = String((e as Error).message).slice(0, 50); }
  }
  if (!read) {
    if (p.sheet_urls?.length) failures.push(`${S(p.partner_name || p.name)}(${code}) — 시트를 못 읽었다: ${lastErr}`);
    continue;
  }
  /**
   * ⚠ @제외 로 «안 싣기로 한» 탭은 못 읽었다고 세지 않는다 — 애초에 실을 대상이 아니다.
   *   실을 것과 안 실을 것을 한 목록에 섞으면 「5건 모름」이 늘 떠 있어 진짜 구멍이 안 보인다
   *   (사장님 2026-08-14 — 「아이카 월렌트는 시트에 올리는 대상이 아님」).
   */
  for (const f of read.failures) {
    const title = S((f as Rec).title);
    if (excluded(code, title)) { skippedByRule++; skippedTabs.push(`${who0(p)}(${code}) 「${title}」 (못 읽는 탭)`); continue; }
    failures.push(`${S(p.partner_name || p.name)}(${code}) 「${title}」 — ${S((f as Rec).reason)}`);
  }
  const who = companyAlias(S(p.partner_name || p.name)) || S(p.partner_name || p.name) || code;
  /**
   * ★**부가정보는 「정책」 탭에서 온다**(사장님 2026-08-14 — 「영업자한테는 사실 다 보여줘도 되는데」).
   *   예전엔 재고탭에 우연히 있는 칸만 낱개로 긁어 20~94% 였고 표기도 제각각이었다.
   *   차마다 적힌 정책코드로 조인하면 100% 가 되고 표기가 하나가 된다.
   * ⚠ 정책 탭을 못 읽으면 그 공급사 부가정보가 통째로 빈다 — 세어서 화면에 알린다.
   */
  let book: PolicyBook = new Map();
  try {
    const pv = await api(`https://sheets.googleapis.com/v4/spreadsheets/${readId}/values/${encodeURIComponent("'정책'")}`) as { values?: string[][] };
    book = readPolicyTab((pv.values || []) as string[][]);
  } catch { /* 정책 탭이 없는 시트도 있다 */ }
  if (!book.size) noPolicy.push(`${who}(${code})`);
  /**
   * ★**규격화시트가 낡았는지 본다.**
   *   자체시트 공급사(아이카·오플·이안카)는 우리 규격화시트를 거쳐 온다. 그 시트는
   *   `sync-mirror-sheet` 가 원본에서 채워 주는데, 그게 멈추면 아무도 안 죽고 화면에도
   *   표시가 없고 **값만 조용히 낡는다.** 이 구조의 유일한 조용한 실패 경로다.
   *   숨긴 탭 「AI 인계」의 @이력을 보고 오래됐으면 알린다. 이력이 없으면 규격화시트가 아니다.
   */
  try {
    const lg = await api(`https://sheets.googleapis.com/v4/spreadsheets/${readId}/values/${encodeURIComponent(`'${HANDOVER_TAB}'!A1:C400`)}`) as { values?: string[][] };
    const days = daysSince(readLog((lg.values || []) as string[][]));
    if (days !== null && days > STALE_DAYS) staleSheets.push(`${who}(${code}) — ${Math.floor(days)}일째 동기화 안 됨`);
  } catch { /* 「AI 인계」가 없으면 규격화시트가 아니다 — 알릴 것이 없다 */ }
  let n = 0;
  for (const t of read.tabs) {
    // 별도 탭이 따로 싣는 것은 여기서 뺀다 — 같은 차가 두 탭에 서면 사고다.
    // ⚠ 몇 대를 들고 있던 탭인지 같이 적는다 — 안 적으면 «조용히 사라진 차»를 못 본다.
    if (excluded(code, S(t.title))) {
      skippedByRule++;
      skippedTabs.push(`${who0(p)}(${code}) 「${S(t.title)}」 ${Math.max(0, t.table.length - 1)}줄`);
      continue;
    }
    const hdr = (t.table[0] || []).map(S);
    /**
     * ★후보를 **전부** 모은다. 「앞에서부터 먼저 맞는 것」은 «열이 있는 것»이 아니라
     *   «값이 든 것»이라야 한다.
     * ⚠ 예전엔 열이 있기만 하면 그걸로 굳혔다. 정제칸(제조사(정제)·모델·세부모델…)을
     *   붙인 뒤로는 그 칸이 **비어 있어도 먼저 잡혀** 공급사 원문으로 안 떨어졌다 —
     *   아이카 122대의 제조사·모델이 통째로 빈 채 나갔다(실측 2026-08-14).
     *   차명을 못 읽으니 차종마스터 스냅도 못 돌아 다섯 축이 다 비었다.
     */
    const pickAll = (name: string) => (ALIAS[name] || []).map((c) => hdr.indexOf(c)).filter((i) => i >= 0);
    const idx = new Map(COLUMNS.map((c) => [c, pickAll(c)]));
    const first = (c: string) => (idx.get(c) || [])[0] ?? -1;
    if (first('차량번호') < 0) continue;
    for (const r of t.table.slice(1)) {
      const plate = norm(r[first('차량번호')]);
      if (!plate) continue;
      // 같은 차가 두 탭에 있으면 먼저 나온 쪽만 싣는다 — 영업자 표에 같은 차가 두 줄이면 안 된다.
      if (seenPlate.has(plate)) { dupes++; continue; }
      seenPlate.add(plate);
      // 그 탭에서 뽑힌 사진 링크가 있으면 담아 둔다(맨 마지막에 셀에 건다).
      const photo = S((t as Rec).photoByPlate?.[plate] || (t as Rec).photoByPlate?.[S(r[first('차량번호')])]);
      if (photo.startsWith('http')) photoOf.set(plate, photo);
      /** 후보를 차례로 보고 **값이 든 첫 칸**을 쓴다. 정제칸이 비면 공급사 원문으로 떨어진다. */
      const cell = (c: string) => { for (const i of idx.get(c) || []) { const v = S(r[i]); if (v) return v; } return ''; };
      /**
       * 차명을 마스터에 올린다. 공급사 원문은 「차종 + 세부모델」을 이어 붙인 문장을 쓴다 —
       * 트림까지 한 문장으로 줘야 세대·사양이 잡힌다(짧은 이름은 엉뚱한 세대로 붙는다).
       */
      /**
       * ★공급사마다 **긴 차명이 다른 칸에 온다.** 어떤 곳은 「세부모델」에,
       *   어떤 곳은 「세부트림」 자리에 「그랜저IG F/L 자가용 가솔린 2.5 PREMIUM A/T」를 통째로 넣는다.
       *   그래서 **세 칸을 다 이어 붙여** 한 문장으로 만들어 마스터에 올린다.
       *   짧은 이름만 주면 엉뚱한 세대로 붙는다(「쏘나타」→1990년대 Y3).
       */
      const rawName = [cell('모델'), cell('세부모델'), cell('세부트림')].filter(Boolean).join(' ').trim();
      const snap = rawName ? snapToMaster({
        maker: cell('제조사'), model: cell('모델'), sub_model: [cell('세부모델'), cell('세부트림')].filter(Boolean).join(' '),
        fuel_type: cell('연료'),
      } as EntityRecord, MASTER) : null;
      // ⚠ 낮은 확신도는 안 쓴다 — 틀린 차명이 붙느니 공급사 원문이 낫다.
      const ok = snap && (snap.confidence === 'high' || snap.confidence === 'medium');
      /**
       * ★못 알아본 차는 **세어서 보여 준다.** 화면 밖에 두면 잊힌다.
       *   공급사 입력은 안 건드린다 — 고칠 자리는 우리 «정제칸»과 「AI 정제」 치환 사전이다.
       */
      if (!ok && rawName) unmatched.push(`${who} ${S(r[first('차량번호')])} 「${rawName.slice(0, 44)}」`);
      /**
       * 그 차에 적용될 정책. 코드가 비면 그 공급사 정책이 **하나뿐일 때 그것**을 쓴다.
       * ⚠ 여럿인데 비면 «못 정했다»로 세어 화면에 알린다 — 짐작해 붙이면 그게 우리 오류다.
       *   예전엔 곧장 「프리패스 기본」으로 떨어져 205대(57%)가 남의 조건을 달고 나갔다.
       */
      const picked = pickPolicy(book, cell('정책코드'));
      const pol = picked.p;
      if (picked.how === '기본' && [...book.keys()].filter(Boolean).length > 1) {
        ambiguous.push(`${who} ${S(r[first('차량번호')])}`);
      }
      rows.push(COLUMNS.map((c) => {
        if (c === '공급사') return who;
        if (c === '입고일자') return '';          // 원본도 비어 있다. 자리만 지킨다.
        /**
         * 차명 축 넷만 마스터로 올린다. **돈·상태·비고는 시트 글자 그대로** —
         * 여기서 숫자를 건드리면 그게 곧 «우리가 만든 오류»다.
         */
        if (ok) {
          if (c === '제조사') return clean(c, S(snap!.maker) || cell(c));
          if (c === '모델') return clean(c, S(snap!.model) || cell(c));
          if (c === '세부모델') return clean(c, S(snap!.sub_model) || cell(c));
          if (c === '파워트레인') return clean(c, S(snap!.variant) || cell(c));
          // 마스터가 트림을 못 고르면 **비운다.** 긴 문장을 트림 칸에 남기지 않는다.
          if (c === '세부트림') return clean(c, S(snap!.trim_name));
        }
        /**
         * ★구분은 **세 가지로만** 선다 — 신차렌트·중고렌트·중고구독(사장님 2026-08-14).
         *   공급사 시트에 「신차」·「재렌트」·「신차(선출고)」가 섞여 있어, 그대로 옮기면
         *   같은 상품이 네 이름으로 서고 필터가 안 걸린다. 뜻은 그대로 두고 «이름»만 캐논으로 갈아 넣는다.
         */
        if (c === '구분') return productType(clean(c, cell(c)));
        /**
         * ★재고탭에 값이 있으면 **그쪽이 이긴다** — 그 차만의 예외일 수 있다.
         *   없을 때만 「정책」 탭에서 가져온다. 정책은 «그 공급사의 기본 조건»이다.
         */
        const own = clean(c, cell(c));
        if (own) return own;
        return policyCell(c, pol);
      }));
      n++;
    }
  }
  console.log(`  ${who.padEnd(14)}${String(n).padStart(4)}대`);
}
console.log(`\n  모두 ${rows.length}대${dupes ? ` · 같은 차가 두 번 나와 건너뛴 줄 ${dupes}` : ''}${skippedByRule ? ` · @제외 규칙으로 건너뛴 탭 ${skippedByRule}` : ''}`);
if (ambiguous.length) {
  console.log('');
  console.log(`  ▲ 정책이 여럿인데 코드가 빈 차 ${ambiguous.length}대 — 프리패스 기본으로 떨어졌다`);
  console.log(`     ${ambiguous.slice(0, 12).join(' · ')}${ambiguous.length > 12 ? ` … 모두 ${ambiguous.length}` : ''}`);
  console.log('     공급사 시트 「정책코드」 칸을 채워야 그 집 조건이 붙는다.');
}
if (noPolicy.length) {
  console.log('');
  console.log(`  ▲ 정책 탭을 못 읽은 공급사 ${noPolicy.length} — 그 집 부가정보가 빈다`);
  console.log(`     ${noPolicy.join(' · ')}`);
}
if (unmatched.length) {
  console.log(`
  ▲ 차종마스터가 못 알아본 차 ${unmatched.length}대 — 모델·파워트레인·세부트림이 빈다`);
  for (const u of unmatched.slice(0, 15)) console.log(`     ${u}`);
  if (unmatched.length > 15) console.log(`     … 모두 ${unmatched.length}대`);
  console.log('     ⚠ 공급사 입력은 건드리지 마라. 고칠 자리는 제공시트 «정제칸»과 「AI 정제」 치환 사전이다.');
}
if (staleSheets.length) {
  console.log(`
  ⚠ 규격화시트가 낡았다 ${staleSheets.length}곳 — 원본과 어긋난 값을 영업자가 보고 있다`);
  for (const t of staleSheets) console.log(`     ${t}`);
  console.log('     고치려면 — npx tsx scripts/sync-mirror-sheet.mts --code=… --from=… --to=… --apply');
}
if (skippedTabs.length) {
  console.log(`\n  ⏭ @제외로 안 실은 탭 ${skippedTabs.length}`);
  for (const t of skippedTabs) console.log(`     ${t}`);
}
if (failures.length) {
  console.log(`\n  ✗ 못 읽은 것 ${failures.length}건 — 이만큼은 «모름»이다`);
  for (const f of failures) console.log(`     ${f}`);
}
if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

/**
 * ★**한 대도 못 읽었으면 발행하지 않는다.**
 *   아래에서 탭을 통째로 비우고 새로 쓰므로, 빈 표로 덮으면 영업자 표가 통째로 날아간다.
 *   되돌릴 길은 구글시트 버전기록뿐이고, 탭 이름은 「… · 0대」로 갱신되며 종료코드도 0이라
 *   **화면에는 사고가 안 보인다.** 형제 발행기(publish-sonogong-tab)에는 있던 가드가 여기만 빠져 있었다.
 * ⚠ 방아쇠가 코드가 아니라 «시트 한 칸»이다 — 「AI 인계」 @매핑에서 차량번호 줄의 후보를 지우면
 *   모든 탭이 버려져 0대가 된다. 그래서 코드로 막아야 한다.
 */
if (!rows.length) throw new Error('한 대도 못 읽었다 — 발행하지 않는다(빈 표로 덮으면 영업자 표가 날아간다)');

const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}?fields=sheets.properties(sheetId,title)`);
let gid = ((meta.sheets || []) as Rec[]).find((s) => S(s.properties?.title).startsWith(TAB))?.properties?.sheetId as number | undefined;
/**
 * ★**갑자기 확 줄면 멈춘다.** 「매번 센다」는 규칙을 사람 눈이 아니라 코드가 지키게 한다.
 *   직전 대수는 탭 이름에 적혀 있다(「상품리스트 08.14 13:34 · 379대」) — 따로 저장할 것이 없다.
 * ⚠ 공급사가 실제로 재고를 줄이는 날도 있다. 그때는 `--force-shrink` 로 지나간다.
 */
{
  const prevTitle = S(((meta.sheets || []) as Rec[]).find((s) => Number(s.properties?.sheetId) === gid)?.properties?.title);
  const prev = Number((prevTitle.match(/·\s*(\d+)대/) || [])[1] || 0);
  const drop = prev ? 1 - rows.length / prev : 0;
  if (prev && drop >= 0.2 && !process.argv.includes('--force-shrink')) {
    throw new Error(`직전 ${prev}대 → 지금 ${rows.length}대 (${Math.round(drop * 100)}% 줄었다). `
      + '공급사가 실제로 뺀 것인지 우리가 못 읽은 것인지 먼저 보라 — 맞으면 --force-shrink');
  }
  if (prev && drop > 0) console.log(`  직전 ${prev}대 → 지금 ${rows.length}대 (${Math.round(drop * 100)}% 감소)`);
}
if (gid == null) {
  const made = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, index: 0 } } }] }),
  });
  gid = Number(((made.replies || []) as Rec[])[0]?.addSheet?.properties?.sheetId ?? 0);
}
const stamp = new Date(Date.now() + 9 * 3600_000).toISOString();
const title = `${TAB} ${stamp.slice(5, 10).replace('-', '.')} ${stamp.slice(11, 16)} · ${rows.length}대`;
await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({ requests: [
    { updateSheetProperties: { properties: { sheetId: gid, title }, fields: 'title' } },
    // 옛 내용을 지우고 새로 쓴다. 값만 지운다 — 서식은 아래에서 다시 입힌다.
    { updateCells: { range: { sheetId: gid }, fields: 'userEnteredValue' } },
  ] }),
});
await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(`${title}!A1`)}?valueInputOption=RAW`, {
  method: 'PUT', body: JSON.stringify({ values: [[...COLUMNS], ...rows] }),
});

/**
 * ★서식은 `lib/domain/sales-sheet-format` 한 곳에서 정한다.
 *   발행기가 둘이라 여기서 색을 따로 정하면 두 탭이 다른 문서처럼 보인다.
 */
{
  const now = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}?fields=sheets(properties(sheetId,gridProperties(columnCount)),bandedRanges(bandedRangeId),conditionalFormats)`) as Rec;
  const me = ((now.sheets || []) as Rec[]).find((s) => Number(s.properties?.sheetId) === gid) || {};
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: buildSalesFormatRequests({
      gid: gid as number,
      columns: COLUMNS,
      headerAt: 0,
      columnCountNow: Number(me.properties?.gridProperties?.columnCount) || COLUMNS.length,
      bandedRangeIds: ((me.bandedRanges || []) as Rec[]).map((b) => Number(b.bandedRangeId)),
      conditionalFormatCount: ((me.conditionalFormats || []) as unknown[]).length,
      widths: columnWidths(COLUMNS, rows),
    }) }),
  });
}
/**
 * ★차량번호 셀에 사진링크를 건다.
 * ⚠ **맨 마지막에** 넣는다 — 뒤에 `repeatCell` 이 한 번이라도 오면 링크가 통째로 지워진다.
 * ⚠ 글자 서식(run)이 칸 서식을 덮으므로 링크 색·밑줄을 여기에도 준다.
 */
{
  const rgbLink = rgb(LINK);
  const pi = COLUMNS.indexOf('차량번호');
  const linked = rows
    .map((r, k) => ({ row: k + 1, plate: S(r[pi]), url: photoOf.get(norm(r[pi])) || '' }))
    .filter((x) => pi >= 0 && x.plate && x.url.startsWith('http'));
  for (let k = 0; k < linked.length; k += 200) {
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: linked.slice(k, k + 200).map((x) => ({
        updateCells: {
          range: { sheetId: gid, startRowIndex: x.row, endRowIndex: x.row + 1, startColumnIndex: pi, endColumnIndex: pi + 1 },
          rows: [{ values: [{
            userEnteredValue: { stringValue: x.plate },
            // ⚠ 글꼴을 여기 손으로 적지 마라 — 서식 모듈만 바꾸면 이 칸만 옛 글꼴로 남는다(실측 2026-08-14).
            textFormatRuns: [{ startIndex: 0, format: { link: { uri: x.url }, foregroundColor: rgbLink, underline: true, italic: ITALIC, fontFamily: FONT, fontSize: SIZE } }],
          }] }],
          fields: 'userEnteredValue,textFormatRuns',
        },
      })) }),
    });
  }
  console.log(`  차량번호에 사진링크 ${linked.length}대 · 링크 없는 차 ${rows.length - linked.length}대는 글자만`);
}
console.log(`\n  반영 완료 — 탭 「${title}」\n  https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=${gid}\n`);
