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
 * ★**차명도 해석하지 않는다**(사장님 2026-08-19 — 「제조사·모델까지만, 안 틀리는 게 중요」).
 *   제조사·모델은 공급사 「제조사(정제)/제조사」「모델명/모델」만.
 *   차명은 「차명(정제)」(모델+세부모델+세부트림 한 칸)을 싣고, 없으면 공급사 원문.
 *   차종구분은 「차종분류」 한 칸(준대형 세단) 또는 「차종분류코드」가 가리키는 글자.
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
import { canonMakerDisplay } from '../lib/domain/maker-display';
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { NOT_SHEET_BACKED, SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { companyAlias, supplierNameKeys } from '../lib/domain/identity';
import { fetchHubPartners } from '../lib/domain/sheet-hub-sync';
import { buildSalesFormatRequests, columnWidths, rgb, LINK, FONT, SIZE, ITALIC } from '../lib/domain/sales-sheet-format';
import { productType } from '../lib/domain/sales-sheet-clean';
import { parsePublishedSalesMapping, SALES_ALIAS, SALES_COLUMNS } from '../lib/domain/sales-sheet-mapping';
import { salesPublishedTabIndex } from '../lib/domain/sales-published-tabs';
import { HANDOVER_TAB, STALE_DAYS, daysSince, readLog } from '../lib/domain/supplier-handover-log';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { mileageCompact, pickPolicy, policyCell, readPolicyTab, type PolicyBook } from '../lib/domain/supplier-policy-read';
import { POLICY_TAB_ALIASES } from '../lib/domain/supplier-template-sheet';
import { classifyVehicleClass, composeRefinedVehicleName } from '../lib/domain/vehicle-class';
import { vehicleClassDisplay } from '../lib/domain/vehicle-class-catalog';
import { substFromAiRefineRows } from '../lib/domain/ai-refine-guard';
/** 정책 탭 값 — 「운영정책」 먼저, 없으면 옛 「정책」(사장님 2026-08-19 탭 개명 · 아직 안 바꾼 시트 호환). */
/**
 * 정책 탭을 읽는다. 이름이 「운영정책」·「정책」이 아닐 수 있다 —
 * ★**관계사가 한 문서를 나눠 쓰면 「빌린카운영정책」·「엘씨운영정책」처럼 회사 이름이 앞에 붙는다.**
 *   별칭 둘만 찾던 예전 코드는 그 여섯 곳(빌린카·엘씨·스타·스카이·경진카·경진렌트)을 통째로 못 읽어,
 *   재고 탭에 정책코드가 멀쩡히 있어도 **정책 칸이 전부 비어 나갔다**(실측 2026-08-21 · 67대).
 *   그래서 탭 목록을 받아 «이름에 정책이 든 탭»을 차례로 본다. `brand` 가 있으면 그 회사 탭을 먼저 본다.
 */
async function readPolicyValues(id: string, brand = ''): Promise<string[][]> {
  let titles: string[] = [];
  try {
    const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties(title,hidden)`) as Rec;
    titles = ((meta.sheets || []) as Rec[]).map((sh) => S(sh.properties?.title)).filter((t) => /정책/.test(t));
  } catch { /* 목록을 못 받으면 별칭만 본다 */ }
  const b = norm(brand).replace(/재고/g, '');
  const order = [
    ...(b ? titles.filter((t) => norm(t).includes(b)) : []),
    ...POLICY_TAB_ALIASES.filter((t) => titles.includes(t)),
    ...titles,
    ...POLICY_TAB_ALIASES,
  ];
  for (const tab of [...new Set(order)]) {
    try {
      const pv = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${tab.replace(/'/g, "''")}'`)}`) as { values?: string[][] };
      if (pv.values?.length) return pv.values as string[][];
    } catch { /* 다음 후보 */ }
  }
  return [];
}
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
/**
 * ★`--only=공급사코드[:탭글자]` — 그 공급사(그 탭)만 실어 **별도 탭**을 찍는다(사장님 2026-08-19 「상품리스트 · 손오공구독(반납/인수) · 오플구독 탭 3개로 회귀」).
 *   같은 발행기·같은 정본 차명·같은 열이라 상품리스트와 규격이 갈리지 않는다. @제외는 무시한다(그 공급사를 실으려는 것이니까).
 *   예) --only=RP012:구독 --tab=손오공구독 · --only=RP023 --tab=오플구독 (그 뒤 publish-sonogong-tab 이 원본 요금 블록을 덧붙인다)
 * ★탭 자리 — 상품리스트 0 · 손오공구독 1 · 오플구독 2 (`salesPublishedTabIndex`). `--at=N` 은 덮어쓸 때만.
 */
const ONLY = (() => { const v = arg('only'); if (!v) return null; const [code, tab = ''] = v.split(':'); return { code: code.trim(), tab: tab.trim() }; })();
const AT = process.argv.some((a) => a.startsWith('--at=')) ? (Number(arg('at')) || 0) : salesPublishedTabIndex(TAB);
const inScope = (code: string, tabTitle: string) => !ONLY || (ONLY.code === code && (!ONLY.tab || S(tabTitle).includes(ONLY.tab)));
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

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
// drive 는 「○○ 프리패스 재고」 시트를 **이름으로 찾는 데만**(files.list) 쓴다 — fill-supplier-ai-columns 와 같은 위임 스코프.
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
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
    const parsed = parsePublishedSalesMapping(rows);
    ALIAS = parsed.aliases;
    COLUMNS = parsed.columns;
    const retired = parsed.retired;
    console.log(`  매핑을 판매시트 「AI 인계」에서 읽었다 — ${COLUMNS.length}열 · 후보 있는 칸 ${Object.keys(ALIAS).length}${retired.length ? ` · 뺀 열 ${retired.join('·')} 은 안 세운다` : ''}
`);
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
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent("'AI 정제'!A1:D4000")}`) as { values?: string[][] };
  const subst = substFromAiRefineRows((v.values || []) as string[][]);
  for (const [k, val] of subst.map) SUBST.set(k, val);
  console.log(`  치환 사전 「AI 정제」 ${SUBST.size}줄${subst.skipped ? ` · 개발코드 떨기 ${subst.skipped}줄 무시` : ''}\n`);
} catch (e) { console.log(`  ⚠ 「AI 정제」를 못 읽어 치환 없이 돈다 — ${String((e as Error).message).slice(0, 60)}\n`); }
/** 열 이름 그대로 사전을 찾는다 — 외장/내장/제조사/모델/차명. */
const clean = (col: string, val: string) => {
  const v = SUBST.get(`${col}|${S(val)}`) ?? S(val);
  // ★제조사 표기 규격(maker-display) — 사장님 2026-08-18 「르노라고만 하고 KGM」. 치환 사전보다 뒤에, 사전에 없어도 맞춘다.
  return col === '제조사' ? canonMakerDisplay(v) : v;
};

/** 모델명이 비어 영업자가 분류를 못 하는 차 — 세어 화면에 보인다. */
const missingModel: string[] = [];

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
  ONLY ? !inScope(code, tabTitle) : EXCLUDE.some((x) => x.code === code && (!x.tab || S(tabTitle).includes(x.tab)));

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

/**
 * ★**정책의 정본은 우리 「○○ 프리패스 재고」 시트의 「정책」 탭이다 — 문패가 어디를 가리키든.**
 *   (사장님 2026-08-18 — 「옵션 다음으로 각 가지고와야 하는 것들 아직 안 가지고 온 거지?」)
 *   실측 2026-08-18: 정책 탭이 안 읽힌 8곳(렌트존·SA·리더스·손오공·스타·우리캐피탈·오플·이안카) 중 7곳은
 *   우리 시트에 정책이 **다 적혀 있는데** 문패가 공급사 자체 시트/규격화시트를 가리켜 그 문서의 「정책」을 찾다 빈손이었다.
 *   재고는 문패를 따라 읽되(돈은 공급사 글자 그대로), 정책은 여기서 찾은 우리 시트에서 읽는다.
 *   문패 시트에 정책이 있으면 그것을 먼저 쓴다(같은 문서인 경우가 대부분이다).
 * ⚠ 이름으로 잇는다 — `supplierNameKeys`(문패명 ↔ 시트명 「SA」↔「에스에이」 같은 짝) 하나만 쓴다. 따로 짐작하지 않는다.
 */
const OUR_POLICY_SHEETS: { id: string; name: string; keys: Set<string> }[] = [];
try {
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) {
    const who = supplierSheetLabel(f.name);
    OUR_POLICY_SHEETS.push({ id: S(f.id), name: who, keys: supplierNameKeys(who) });
  }
  console.log(`  우리 제공시트 ${OUR_POLICY_SHEETS.length}곳을 드라이브에서 찾았다 — 정책은 여기서 읽는다\n`);
} catch (e) { console.log(`  ⚠ 우리 제공시트 목록을 못 읽어 정책은 문패 시트에서만 읽는다 — ${String((e as Error).message).slice(0, 60)}\n`); }
const ourPolicySheetFor = (partnerName: string, code: string) => {
  const keys = new Set([...supplierNameKeys(partnerName), ...supplierNameKeys(companyAlias(partnerName) || ''), code].filter(Boolean));
  return OUR_POLICY_SHEETS.find((sh) => [...sh.keys].some((k) => keys.has(k))) || null;
};
/** 정책을 어디서 읽었나 — 문패 시트 / 우리 제공시트 / 못 읽음. 화면에 센다. */
const policySource: Record<string, number> = { 문패시트: 0, 우리제공시트: 0, 없음: 0 };

console.log(`■ 공급사 시트를 그대로 영업자 표로 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
const rows: string[][] = [];
const failures: string[] = [];
/** @제외 로 안 실은 탭 — 몇 줄짜리였는지 같이 남긴다. 「조용히 빠진 차」가 없어야 한다. */
const skippedTabs: string[] = [];
/** 규격화시트인데 동기화가 멈춘 곳 — 값이 조용히 낡는 유일한 경로다. */
const staleSheets: string[] = [];
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
/** 차번 → 우리 시트에서 왔나. 대수·금액 빠짐을 늘 이 둘로 갈라 보고한다. */
const fromOurs = new Map<string, boolean>();
let dupes = 0;
/** @제외 규칙으로 건너뛴 탭 수 — 조용히 빠지면 «왜 줄었나»를 못 찾는다. */
let skippedByRule = 0;
/**
 * ★**한 문서를 관계사 둘이 나눠 쓰면 «탭 이름»으로 가른다**(스타/스카이 · 빌린카/엘씨 · 경진카/경진렌트).
 *   문패 「공급사시트정리」는 공급사명 | 공급사코드 | 시트주소 세 칸뿐이라, 관계사 두 줄이 **같은 주소**를 물면
 *   그 문서가 통째로 한쪽 코드에 붙는다 — 실측 2026-08-20: 「빌린카재고」 47대가 **엘씨 46대**로 세어졌고
 *   (엘씨재고 탭은 0대였다) 「빌린카 45대→0」 가드에 걸려 상품리스트 발행이 멈췄다. ERP 가 네 시간 낡았다.
 *   그래서 같은 주소를 쓰는 코드가 둘 이상이면, 재고 탭은 **이름이 자기 회사를 말하는 코드**에만 준다.
 *   어느 회사 이름도 아닌 탭(그냥 「재고」)은 **문패에 먼저 적힌 코드**가 가져간다 — 한 장짜리 옛 문서가 그렇다.
 */
const codesBySheet = new Map<string, string[]>();
for (const [code, p] of byCode) {
  for (const url of ((p.sheet_urls || []) as string[])) {
    const id = (S(url).match(/\/d\/([\w-]+)/) || [])[1]; if (!id) continue;
    const list = codesBySheet.get(id) || []; if (!list.includes(code)) list.push(code);
    codesBySheet.set(id, list);
  }
}
const partnerNameKey = (c: string) => norm(S(byCode.get(c)?.partner_name || byCode.get(c)?.name || c)).replace(/렌트카|렌터카|주식회사|\(주\)/g, '');
/** 이 탭이 이 코드의 것인가 — 문서를 혼자 쓰면 늘 참. */
const tabBelongsTo = (sheetId: string, code: string, title: string): boolean => {
  const mates = codesBySheet.get(sheetId) || [];
  if (mates.length < 2) return true;
  const t = norm(title);
  const claimed = mates.map((c) => ({ c, n: partnerNameKey(c) })).filter((x) => x.n && t.includes(x.n));
  // ⚠ 이름이 서로 «포함»되는 짝이 있다(경진 ⊂ 경진카). 그러면 **더 긴 이름**이 이긴다 —
  //   안 그러면 「경진카재고」를 둘이 같이 실어 같은 차가 두 번 선다.
  if (claimed.length) {
    const longest = Math.max(...claimed.map((x) => x.n.length));
    return claimed.some((x) => x.c === code && x.n.length === longest);
  }
  return mates[0] === code;
};
for (const [code, p] of [...byCode].sort()) {
  if (ONLY && ONLY.code !== code) continue;   // 범위 밖 공급사는 읽지도 않는다(--only)
  if (NOT_SHEET_BACKED.has(code)) { failures.push(`${S(p.partner_name || p.name)}(${code}) — 홈페이지 수집이라 시트가 없다`); continue; }
  // 후보 주소를 차례로 열어 **표가 나오는 첫 번째**를 쓴다. 하나도 안 나오면 그 공급사는 «모름»이다.
  let read: ReturnType<typeof readSupplierSheet> | null = null;
  let lastErr = '';
  let readId = '';
  /** 읽은 «문서» 이름 — 우리가 만든 시트인지 가르는 표식이다. */
  let readTitle = '';
  for (const url of (p.sheet_urls || [])) {
    const id = (S(url).match(/\/d\/([\w-]+)/) || [])[1];
    if (!id) continue;
    try {
      const grid = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`);
      const got = readSupplierSheet(grid as never, p as Rec);
      if (got.tabs.length) { read = got; readId = id; readTitle = S((grid as Rec).properties?.title); break; }
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
    /**
     * ⚠ **우리가 만든 탭은 «못 읽은 것»이 아니다.** 「정책」·「AI 인계」는 재고표가 아니라
     *   애초에 읽을 대상이 아니다. 이걸 안 거르면 문패를 우리 시트로 넘기는 순간
     *   「못 읽은 것」이 1건 → 8건으로 뛰고, 진짜 구멍이 그 소음에 묻힌다(실측 2026-08-14).
     */
    if (isOurNonInventoryTab(title)) continue;
    if (excluded(code, title)) { skippedByRule++; skippedTabs.push(`${who0(p)}(${code}) 「${title}」 (못 읽는 탭)`); continue; }
    failures.push(`${S(p.partner_name || p.name)}(${code}) 「${title}」 — ${S((f as Rec).reason)}`);
  }
  const who = companyAlias(S(p.partner_name || p.name)) || S(p.partner_name || p.name) || code;
  /**
   * ★**우리가 만든 시트인가.** 문패가 우리 제공시트(「○○ 프리패스 재고」)나 규격화시트
   *   (「이안카_프리패스」)를 가리키면 «우리 시트»다. 공급사 자체 시트면 아니다.
   *   ⚠ 이 구분이 있어야 대수가 뜻을 갖는다 — 우리 시트 차는 정제칸·정책이 붙어 나가고,
   *     아닌 시트 차는 공급사가 적은 것만 나간다. 총 대수만 말하면 그 차이가 안 보인다
   *     (사장님 2026-08-14 — 「대수를 말할 때는 우리 시트 몇 대, 아닌 시트 몇 대에 총 몇 대로」).
   */
  const ours = /프리패스/.test(readTitle);
  /**
   * ★**부가정보는 「정책」 탭에서 온다**(사장님 2026-08-14 — 「영업자한테는 사실 다 보여줘도 되는데」).
   *   예전엔 재고탭에 우연히 있는 칸만 낱개로 긁어 20~94% 였고 표기도 제각각이었다.
   *   차마다 적힌 정책코드로 조인하면 100% 가 되고 표기가 하나가 된다.
   * ⚠ 정책 탭을 못 읽으면 그 공급사 부가정보가 통째로 빈다 — 세어서 화면에 알린다.
   */
  let book: PolicyBook = new Map();
  try {
    book = readPolicyTab(await readPolicyValues(readId, S(p.partner_name || p.name)));
  } catch { /* 정책 탭이 없는 시트도 있다 */ }
  if (book.size) policySource['문패시트']++;
  else {
    // ★문패 시트에 정책이 없으면 우리 「○○ 프리패스 재고」 정책 탭에서 읽는다(정책의 정본).
    const mine = ourPolicySheetFor(S(p.partner_name || p.name), code);
    if (mine && mine.id !== readId) {
      try {
        book = readPolicyTab(await readPolicyValues(mine.id, S(p.partner_name || p.name)));
      } catch { /* 우리 시트에 정책 탭이 없으면 아래에서 센다 */ }
    }
    if (book.size) policySource['우리제공시트']++; else policySource['없음']++;
  }
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
    if (isOurNonInventoryTab(S(t.title))) continue;    // 우리 탭은 재고표가 아니다
    // 관계사가 한 문서를 나눠 쓰면 그 탭의 임자만 싣는다(빌린카재고→빌린카 · 엘씨재고→엘씨).
    if (!tabBelongsTo(readId, code, S(t.title))) continue;
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
    /**
     * ★**규격 밖 요금 열** — 「그 밖 요금」 한 칸에 모아 ERP 로 나른다
     *   (사장님 2026-08-23 「ERP 에는 다 반영할 수 있고 기존 시트에는 우리 규격만」).
     *   공급사가 「72개월」·「18개월2만」처럼 우리 열에 없는 기간을 쓰면 그 요금이 통째로 버려졌다.
     *   여기서 **판매시트 열·별칭 어디에도 안 잡힌 요금 헤더**를 골라 둔다.
     */
    const claimed = new Set<number>();
    for (const list of idx.values()) for (const i of list) claimed.add(i);
    const FEE_HEADER = /^(\d+)개월(?:[1-9]\d*만|[（(]?(?:인수형|반납형)[)）]?)?$/;
    const extraFeeAt = hdr
      .map((h, i) => ({ name: S(h).replace(/\s+/g, ''), i }))
      .filter(({ name, i }) => name && !claimed.has(i) && FEE_HEADER.test(name));
    const first = (c: string) => (idx.get(c) || [])[0] ?? -1;
    if (first('차량번호') < 0) continue;
    for (const r of t.table.slice(1)) {
      const plate = norm(r[first('차량번호')]);
      /**
       * ★**번호 전 신차도 싣는다 — 차대번호가 있으면**(사장님 2026-08-21).
       *   출고가 확정돼도 번호판은 며칠 뒤에 나온다. 그때까지 영업자 표에서 빠지면 팔 수가 없다.
       *   차량번호 칸은 비워 두고(없는 번호를 지어내지 않는다) 「차대번호」로 그 차를 가린다.
       * ⚠ 둘 다 없으면 여전히 안 싣는다 — 그 줄은 어느 차인지 알 방법이 없다.
       */
      const vinAt = first('차대번호');
      const vin = vinAt >= 0 ? norm(r[vinAt]) : '';
      if (!plate && !vin) continue;
      const key = plate || `VIN:${vin}`;
      if (seenPlate.has(key)) { dupes++; continue; }
      seenPlate.add(key);

      // 사진은 번호판·폴더·OCR 증거를 승인한 별도 복구 경로에서만 넣는다.
      // 원본 행의 URL을 여기서 그대로 재발행하면 외부 정제시트의 사진 오매칭이
      // 중앙 판매시트와 ERP까지 다시 전파된다.
      /** 후보를 차례로 보고 **값이 든 첫 칸**을 쓴다. 정제칸이 비면 공급사 원문으로 떨어진다. */
      const cell = (c: string) => { for (const i of idx.get(c) || []) { const v = S(r[i]); if (v) return v; } return ''; };
      /**
       * ★제조사·모델·차명만 시트에서 옮긴다(사장님 2026-08-19).
       *   마스터 스냅·상품마스터 3축·정제칸 재판단 없음 — 틀린 세부축이 붙느니 원문이 낫다.
       *   모델이 비면 목록에만 남긴다(지어내지 않는다).
       */
      if (!cell('모델')) missingModel.push(`${who} ${S(r[first('차량번호')])} 「${cell('차명').slice(0, 44)}」`);
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
      fromOurs.set(plate, ours);
      rows.push(COLUMNS.map((c) => {
        if (c === '공급사') return who;
        /**
         * 「그 밖 요금」 = 규격 밖 기간의 요금을 `이름:값|이름:값` 로 모은다. 값이 없으면 빈칸.
         * ⚠ 사람이 읽는 칸이 아니다 — `sheet-import` 가 풀어서 `price` 에 담는다.
         */
        if (c === '그 밖 요금') {
          const parts: string[] = [];
          for (const { name, i } of extraFeeAt) {
            const raw = S(r[i]).replace(/[^\d]/g, '');
            const n = Number(raw);
            if (n > 0) parts.push(`${name}:${n}`);
          }
          return parts.join('|');
        }
        if (c === '입고일자') return '';          // 원본도 비어 있다. 자리만 지킨다.
        /**
         * ★구분은 **세 가지로만** 선다 — 신차렌트·중고렌트·중고구독(사장님 2026-08-14).
         *   공급사 시트에 「신차」·「재렌트」·「신차(선출고)」가 섞여 있어, 그대로 옮기면
         *   같은 상품이 네 이름으로 서고 필터가 안 걸린다. 뜻은 그대로 두고 «이름»만 캐논으로 갈아 넣는다.
         */
        if (c === '구분') return productType(clean(c, cell(c)));
        /**
         * ★**정책 칸 — ERP 가 조인할 수 있는 값을 싣는다**(사장님 2026-08-28 「ERP 에서 받을 수
         *   있게끔」 · 「판매시트에도 반영될 수 있게끔」).
         *
         *   예전엔 공급사 정책 탭의 `__uid`(pol_…)를 그대로 실었다. 그런데 **ERP 정책 레코드에는
         *   그 UID 가 어디에도 없다**(실측 2026-08-28: 정책 80건 중 uid 칸을 가진 것 0건).
         *   그래서 매물이 `pol_…` 를 들고도 정책을 못 찾아, 863대 중 39대만 정책이 붙어 있었다.
         *   ERP 가 아는 이름은 **정책코드**(POL-0020 · FP-RP012-RENT …)다 — 그걸 싣는다.
         *
         *   ⚠ 못 정했으면 **비운다.** 짐작해 넣으면 남의 조건이 그 차에 붙는다.
         *   ⚠ 언젠가 ERP 정책이 UID 를 갖게 되면 그때 UID 로 바꾼다(이름이 바뀌어도 안 깨지므로).
         *     지금 UID 를 싣는 것은 «아무도 못 읽는 이름»을 싣는 것이다.
         */
        if (c === '정책UID') return picked.code;
        /**
         * ★차종구분 = 정제칸 「차종분류」 한 칸(준대형 세단). 코드면 표에서 글자를 불러온다.
         *   크기+구분을 붙이지 않는다(실측 2026-08-21 A6=중형 SUV · 팰리세이드=대형 MPV).
         */
        if (c === '차종구분') {
          const classAt = hdr.indexOf('차종분류');
          const codeAt = hdr.indexOf('차종분류코드');
          const fromClass = vehicleClassDisplay(classAt >= 0 ? S(r[classAt]) : '');
          const fromCode = vehicleClassDisplay(codeAt >= 0 ? S(r[codeAt]) : '');
          if (fromClass) return fromClass;
          if (fromCode) return fromCode;
          const own2 = vehicleClassDisplay(clean(c, cell(c)));
          if (own2) return own2;
          return classifyVehicleClass({ model: cell('모델'), sub_model: cell('차명') } as never);
        }
        if (c === '차명') {
          const refinedAt = hdr.indexOf('차명(정제)');
          const refined = refinedAt >= 0 ? S(r[refinedAt]) : '';
          if (refined) return refined;
          const combined = composeRefinedVehicleName(
            S(r[hdr.indexOf('모델')] || ''),
            S(r[hdr.indexOf('세부모델')] || ''),
            S(r[hdr.indexOf('세부트림')] || ''),
          );
          if (combined) return combined;
        }
        /**
         * ★재고탭에 값이 있으면 **그쪽이 이긴다** — 그 차만의 예외일 수 있다.
         *   없을 때만 「정책」 탭에서 가져온다. 정책은 «그 공급사의 기본 조건»이다.
         */
        const own = clean(c, cell(c));
        if (own) return c === '연주행' ? mileageCompact(own) : own;   // 연주행은 「2만」 꼴로(사장님 2026-08-19)
        // ★전용계좌 — 정책 탭에서 뺐다(사장님 2026-08-19 「정책에 계좌는 빼자, 통장사본 받아서 업로드」). 파트너 레코드(회사정보)의 계좌가 정본.
        if (c === '전용계좌') {
          const bank = [S(p.bank_name), S(p.bank_account), S(p.bank_holder)].filter(Boolean).join(' ');
          return bank || policyCell(c, pol);
        }
        return policyCell(c, pol);
      }));
      n++;
    }
  }
  console.log(`  ${who.padEnd(14)}${String(n).padStart(4)}대${ours ? '' : '   (우리 시트 아님)'}`);
}
/**
 * ★**대수는 늘 «우리 시트 / 아닌 시트 / 총»으로 센다**(사장님 2026-08-14).
 *   총 대수만 말하면 «정제칸·정책이 붙어 나가는 차»와 «공급사가 적은 것만 나가는 차»가
 *   한 숫자에 섞여 구분이 사라진다. 어디를 더 손봐야 하는지가 그 갈림에 있다.
 *
 * ★**금액 빠진 차도 같은 방식으로 센다.** 기간 대여료가 한 칸도 없는 차는 영업자가
 *   **견적을 못 낸다** — 목록에 서 있어도 팔 수 없는 차다. 총 대수에 묻히면 안 보인다.
 *   ⚠ 「팔 수 있는데 값이 없다」와 「원래 출고불가라 값이 없다」는 다르다. 상태를 같이 본다.
 */
const RENT_COLUMNS = ['1개월', '12개월', '24개월', '36개월', '48개월', '60개월'];
const plateAt0 = COLUMNS.indexOf('차량번호');
const stateAt0 = COLUMNS.indexOf('배차상태');
/**
 * ★**대여료 칸에 숫자가 없으면 「-」**(사장님 2026-08-18 — 「숫자 없는 곳을 0으로 보면 — 「-」를 넣어서 이곳은 대여료가 없다·운영 안 함으로 / 불가도 필요 없다」).
 *   공급사가 「불가」·「x」·빈칸으로 적은 기간은 전부 「-」로 싣는다 — 영업자가 «그 기간은 안 판다»로 한눈에 읽게. 숫자 아닌 글자(「연수×대여료」 같은 규칙 문장)는 그대로 둔다.
 */
{
  const MONEY_COLS = ['단기보증', '1개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월'];
  const idxs = MONEY_COLS.map((c) => COLUMNS.indexOf(c)).filter((i) => i >= 0);
  const NONE = /^(불가|불가능|x|X|-|—|―|없음|미운영|미판매|해당없음|n\/a|N\/A)$/;
  let dashed = 0;
  for (const r of rows) for (const i of idxs) { const v = S(r[i]); if (!v || NONE.test(v)) { if (v !== '-') dashed++; r[i] = '-'; } }
  console.log(`  대여료 칸 「-」 표시 ${dashed}칸(빈칸·불가 → 그 기간 운영 안 함)`);
}
/**
 * ★**출고불가는 판매시트에 싣지 않는다**(사장님 2026-08-18 — 「출고불가 빼고 해줘야지」).
 *   영업자 표는 «팔 수 있는 차»의 표다. 출고불가 줄은 공급사 시트·상품마스터에는 그대로 남는다(지우는 게 아니라 안 싣는 것).
 *   판정은 공급사 시트 글자 그대로(우리 규격 시트는 「출고불가」 하나로 적는다). 빼는 수를 화면에 남긴다.
 */
{
  const before = rows.length;
  const kept = rows.filter((r) => !/출고불가/.test(S(r[stateAt0])));
  const dropped = before - kept.length;
  rows.length = 0; rows.push(...kept);
  console.log(`  출고불가 ${dropped}대는 판매시트에 안 싣는다(공급사 시트·상품마스터에는 그대로) → ${rows.length}대`);
  /**
   * ★**차량번호가 없는 줄(「미정」)도 안 싣는다**(사장님 2026-08-20 「어찌 됐든 상품시트랑 동일해야 하고, 영업자가 불편하더라도 매칭이 중요함」).
   *   차량번호가 이 표의 열쇠다 — 번호가 없으면 ERP·계약·사진 어디에도 못 붙어 영업자 표에만 남는 «맞출 수 없는 줄»이 된다.
   *   번호가 나오면 다음 발행에 자동으로 합류한다(공급사 시트에는 그대로 있다).
   */
  const REAL_PLATE = /^\d{2,3}[가-힣]\d{4}$/;
  const beforePlate = rows.length;
  /**
   * ★**번호가 없어도 차대번호가 있으면 싣는다**(사장님 2026-08-21 「실제로 출고 확정되면 차량번호 없이 올린다고 ·
   *   차량번호 없이 노출 구현할 수 있을 거 같은데 · 그렇게 해야 해」).
   *   출고 확정과 번호판 발급 사이에 며칠이 뜬다. 그 사이 표에서 빠지면 팔 수가 없다.
   *   차량번호 칸은 **비워 둔 채** 「차대번호」로 그 차를 가린다 — 없는 번호를 지어내지 않는다.
   *   VIN 은 번호 나오기 전에도 안 바뀌어서, 실번호가 붙는 날 같은 차로 이어붙는다(product.vehicleIdentity).
   * ⚠ 둘 다 없는 줄만 뺀다. 그건 어느 차인지 알 방법이 없다.
   */
  const vinAt0 = COLUMNS.indexOf('차대번호');
  const keep = rows.filter((r) => REAL_PLATE.test(S(r[plateAt0]).replace(/\s/g, ''))
    || (vinAt0 >= 0 && S(r[vinAt0]).replace(/\s/g, '').length >= 6));
  const noPlate = beforePlate - keep.length;
  const vinOnly = keep.filter((r) => !REAL_PLATE.test(S(r[plateAt0]).replace(/\s/g, ''))).length;
  rows.length = 0; rows.push(...keep);
  if (noPlate) console.log(`  차번·차대번호가 다 없는 ${noPlate}대는 안 싣는다 → ${rows.length}대`);
  if (vinOnly) console.log(`  번호 전 신차 ${vinOnly}대는 차대번호로 싣는다(번호가 나오면 같은 차로 이어붙는다)`);
  console.log('');
}
const rentAt = RENT_COLUMNS.map((c) => COLUMNS.indexOf(c)).filter((i) => i >= 0);
const hasMoney = (v: string) => /\d/.test(S(v));   // 「-」·빈칸은 돈이 아니다
const split = (pick: (r: string[]) => boolean) => {
  let a = 0, b = 0;
  for (const r of rows) { if (!pick(r)) continue; if (fromOurs.get(S(r[plateAt0]))) a++; else b++; }
  return { ours: a, other: b, all: a + b };
};
const all = split(() => true);
const noMoney = split((r) => !rentAt.some((i) => hasMoney(r[i])));
const noMoneySellable = split((r) => !rentAt.some((i) => hasMoney(r[i])) && !/출고불가|계약중/.test(S(r[stateAt0])));
console.log(`\n  ${'─'.repeat(58)}`);
console.log(`  우리 시트 ${all.ours}대 · 아닌 시트 ${all.other}대 · 총 ${all.all}대`
  + `${dupes ? `   (같은 차가 두 번 나와 건너뛴 줄 ${dupes})` : ''}${skippedByRule ? ` (@제외 탭 ${skippedByRule})` : ''}`);
console.log(`  금액 빠진 차  우리 시트 ${noMoney.ours}대 · 아닌 시트 ${noMoney.other}대 · 총 ${noMoney.all}대`
  + `${noMoneySellable.all ? `   ← 그중 «팔 수 있는데» 값이 없는 차 ${noMoneySellable.all}대` : ''}`);
if (ambiguous.length) {
  console.log('');
  console.log(`  ▲ 정책이 여럿인데 코드가 빈 차 ${ambiguous.length}대 — 프리패스 기본으로 떨어졌다`);
  console.log(`     ${ambiguous.slice(0, 12).join(' · ')}${ambiguous.length > 12 ? ` … 모두 ${ambiguous.length}` : ''}`);
  console.log('     공급사 시트 「정책코드」 칸을 채워야 그 집 조건이 붙는다.');
}
if (noPolicy.length) {
  console.log('');
  console.log(`  ▲ 정책 탭을 못 읽은 공급사 ${noPolicy.length} — 그 집 부가정보가 빈다 (정책 출처: 문패시트 ${policySource['문패시트']} · 우리 제공시트 ${policySource['우리제공시트']} · 없음 ${policySource['없음']})`);
  console.log(`     ${noPolicy.join(' · ')}`);
}
if (missingModel.length) {
  console.log(`
  ▲ 모델명이 비어 있는 차 ${missingModel.length}대 — 분류 칸이 빈다(지어내지 않았다)`);
  for (const u of missingModel.slice(0, 15)) console.log(`     ${u}`);
  if (missingModel.length > 15) console.log(`     … 모두 ${missingModel.length}대`);
  console.log('     공급사 시트 「모델명」 또는 정제칸 「모델」을 채우면 다음 발행에 실린다.');
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
/**
 * ★**찍기 전 값을 파일로 뽑는다** — `--dump=tmp/rows.json`.
 *   시트를 안 건드리고 «무엇이 나갈지»만 본다. 정제칸을 채우거나 매핑을 고칠 때
 *   **전후를 견주는** 용도다: 바꾼 뒤에도 차명이 그대로인 것을 눈이 아니라 파일로 확인한다.
 *   ⚠ 이게 없으면 «채웠더니 차명이 소리 없이 바뀐» 것을 아무도 못 잡는다.
 */
{
  const dump = arg('dump');
  if (dump) {
    const plateAt = COLUMNS.indexOf('차량번호');
    const out: Rec = {};
    for (const r of rows) out[S(r[plateAt]) || `?${Object.keys(out).length}`] = Object.fromEntries(COLUMNS.map((c, i) => [c, S(r[i])]));
    writeFileSync(dump, JSON.stringify({ columns: COLUMNS, rows: out }, null, 1), 'utf8');
    console.log(`\n  ${rows.length}대를 ${dump} 에 뽑았다(시트는 안 건드렸다)\n`);
  }
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
  /**
   * ★**공급사 하나가 통째로 0대가 되면 멈춘다** — 총 대수 20% 규칙만으로는 못 잡는다.
   *   실측 2026-08-18 16:53: 병행 작업으로 읽기 쿼터(429)가 바닥나 우리 시트 몇 곳이 «빈 표»로 읽혔고,
   *   총 475→415대(12.6%)라 20% 가드를 지나 **60대가 빠진 표가 발행됐다.** 0대는 «없다»가 아니라 «모름»이다.
   *   직전 표의 「공급사」 칸을 세어 «지난번엔 있었는데 지금 0인 공급사»가 하나라도 있으면 쓰지 않는다.
   * ★시트를 통째로 못 읽은 공급사(「시트를 못 읽었다」)가 있어도 쓰지 않는다 — 같은 이유.
   * ⚠ 공급사가 정말 재고를 다 뺐거나 문패에서 뺀 날은 `--force-shrink` 로 지나간다.
   */
  if (!process.argv.includes('--force-shrink')) {
    const unread = failures.filter((f) => /시트를 못 읽었다/.test(f));
    if (unread.length) throw new Error(`시트를 통째로 못 읽은 공급사 ${unread.length}곳 — 발행하지 않는다(0대는 «모름»이다): ${unread.join(' / ').slice(0, 300)} — 맞으면 --force-shrink`);
    if (prevTitle) {
      const supplierAt = COLUMNS.indexOf('공급사');
      const prevRows = ((await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(`'${prevTitle.replace(/'/g, "''")}'`)}`)).values || []) as string[][];
      const prevHdr = (prevRows[0] || []).map(S);
      const prevAt = prevHdr.indexOf('공급사');
      if (prevAt >= 0 && supplierAt >= 0) {
        const count = (list: string[][], at: number) => { const m = new Map<string, number>(); for (const r of list) { const w = S(r[at]); if (w) m.set(w, (m.get(w) || 0) + 1); } return m; };
        const before = count(prevRows.slice(1), prevAt);
        const now = count(rows, supplierAt);
        const gone = [...before].filter(([w, n]) => n >= 3 && !(now.get(w) || 0)).map(([w, n]) => `${w} ${n}대→0`);
        if (gone.length) throw new Error(`직전 표에 있던 공급사가 통째로 0대 — 발행하지 않는다: ${gone.join(' · ')} (못 읽은 것인지 먼저 보라 — 맞으면 --force-shrink)`);
      }
    }
  }
}
if (gid == null) {
  const made = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, index: AT } } }] }),
  });
  gid = Number(((made.replies || []) as Rec[])[0]?.addSheet?.properties?.sheetId ?? 0);
}
const stamp = new Date(Date.now() + 9 * 3600_000).toISOString();
const title = `${TAB} ${stamp.slice(5, 10).replace('-', '.')} ${stamp.slice(11, 16)} · ${rows.length}대`;
await api(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({ requests: [
    { updateSheetProperties: { properties: { sheetId: gid, title, index: AT }, fields: 'title,index' } },
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
      tabTitle: title,
      // 차량번호 셀에 사진 링크를 거는 데 쓴다(서식층 맨 끝).
      body: rows,
    }) }),
  });
}
// 차량번호 셀의 사진 링크는 서식층(`buildSalesFormatRequests` 맨 끝)이 세 탭에 똑같이 건다.
// ⚠ 여기서 따로 걸지 마라 — 여기 있던 코드는 「사진」 칸이 아니라 «원본 차번 셀 링크»만 봐서
//    갈래 탭은 되고 상품리스트만 0대로 남았다(사장님 2026-08-24 「사진링크를 좀 동일하게 처리해줘야지」).
{
  const pi = COLUMNS.indexOf('사진');
  const linked = pi < 0 ? 0 : rows.filter((r) => S(r[pi]).startsWith('http')).length;
  console.log(`  차량번호에 사진링크 ${linked}대 · 링크 없는 차 ${rows.length - linked}대는 글자만`);
}
console.log(`\n  반영 완료 — 탭 「${title}」\n  https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=${gid}\n`);
