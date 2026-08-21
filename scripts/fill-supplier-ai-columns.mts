/**
 * **공급사 시트의 정제칸을 채운다 — 차번당 한 번.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-21 — 「신규 차종은 차종마스터화하고, 그 내용대로 정제시트 정제칸에 박는다」
 *   · 2026-08-14 — 「매물을 접하면 우리식으로 바꿔서 상태값만 공급사거를 참고한다」)
 *   사전은 `vehicle-master.json`(우리 차종마스터)이다. 엔카 원자로 모델 이름을 짓지 않는다.
 *   마스터에 없는 차는 비슷한 차로 안 붙이고 비운다. 넣은 뒤에 이 도구가 그 글자를 정제칸에 누른다.
 *
 * ★**지금 발행기가 내는 답을 그대로 옮긴다.** 새 규칙을 만들지 않는다 —
 *   여기서 다른 답을 내면 채우는 순간 영업자 표의 차명이 «소리 없이» 바뀐다.
 *   그래서 입력도 `publish-origin-tab` 과 똑같이 «값이 든 첫 칸»으로 고른다.
 *
 * ⚠ **빈 칸에만 쓴다.** 이미 글자가 있으면 그게 사람이 고친 값이든 지난번에 채운 값이든
 *   손대지 않는다. 이 규칙 하나가 이 도구를 몇 번 돌려도 안전하게 만든다.
 * ⚠ **확신도가 낮으면 안 쓴다.** 차명 다섯 축은 high·medium 일 때만 채우고, 낮으면 비워 둔다.
 *   빈 칸은 «사람이 볼 목록»으로 남지만, 틀린 차명은 아무도 안 본다.
 * ⚠ 돈·상태·주행거리에는 손대지 않는다. 그건 공급사가 정하는 값이라 정제할 것이 없다.
 *
 *   npx tsx scripts/fill-supplier-ai-columns.mts                 # 미리보기(전 공급사)
 *   npx tsx scripts/fill-supplier-ai-columns.mts --who=아이카   # 한 곳만
 *   npx tsx scripts/fill-supplier-ai-columns.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { INCLUDE_MIRROR, isMirrorSheet } from '../lib/domain/mirror-sources';
import { canonMakerDisplay } from '../lib/domain/maker-display';
import { snapToMaster } from '../lib/domain/vehicle-master-match';
import { fuelDisplay } from '../lib/domain/vehicle-master-format';
import { snapColorOrEtc } from '../lib/domain/color-master';
import { codeMatchesRawName } from '../lib/domain/code-vs-name';
import { loadColorMasterAliases } from '../lib/domain/color-master-sheet';
import { classifyVehicleClass } from '../lib/domain/vehicle-class';
import { SALES_ALIAS } from '../lib/domain/sales-sheet-mapping';
import { AI_TAIL_COLUMNS, ENCAR_CODE_BLOCK, ENCAR_MASTER_CODE_COLUMN, ENCAR_MASTER_LABEL_COLUMN, ENCAR_OLD_TRIM_CODE_COLUMN, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { companyAlias, supplierNameKeys } from '../lib/domain/identity';
import { MASTER_SHEET_ID, MASTER_TAB, masterCells, pickConfirmedMasterCode, readMasterSheet } from '../lib/domain/vehicle-master-sheet';
import type { MasterEntry, VehicleTrimMasterArtifact } from '../lib/domain/vehicle-master-types';
import { adoptedSpecByKey, adoptedVehicleClassText, buildPlateNormalization, type AdoptedSpecName, type NormalizedVehicleName } from '../lib/domain/product-vehicle-normalization';
import { loadProductVehicleReviewDecisions } from '../lib/domain/product-vehicle-review-decisions';
import { VEHICLE_CLASS_VALUES, type EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
/**
 * ★**이미 잘못 써 놓은 「배기량(정제)」만 고친다** — 「빈 칸에만 쓴다」의 **유일한 예외**다.
 *   2026-08-14 에 파워트레인 «글자»에서 숫자를 긁어 배터리 용량(77400)·구동축 숫자(2000·4000)를
 *   배기량으로 찍었다. 빈 칸이 아니라 **틀린 값이 들어 있어** 평소 규칙으로는 못 고친다.
 * ⚠ 아무 값이나 덮지 않는다. **옛 방식으로 계산한 값과 똑같을 때만** 덮는다 —
 *   그래야 사람이 손으로 적은 값을 안 건드린다.
 *   npx tsx scripts/fill-supplier-ai-columns.mts --fix-cc --apply
 */
const FIX_CC = process.argv.includes('--fix-cc');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
/** 한 곳만 손볼 때 — 공급사 «이름»으로 거른다(문서를 이름으로 찾으므로 코드가 없다). */
const ONLY = new Set(arg('who').split(/[,\s]+/).map(S).filter(Boolean));
/** 제공시트 이름 표식 — `add-supplier-ai-columns` 와 같은 값을 써야 같은 문서를 본다. */
const DOC_NAME = arg('name', '프리패스 재고');
/** 판매시트 — 「AI 정제」 치환 사전이 여기 있다. 발행기와 같은 사전을 써야 답이 같다. */
const SALES_SHEET = arg('sales', '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec;
const MASTER = ((Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || []) as MasterEntry[];
/** 차명에 적힌 배기(가솔린 3.5 · LPG 3.0). 연식 21MY 숫자를 배기로 읽지 않는다. */
const ccFromCarName = (name: string) => {
  const m = /(?:가솔린|디젤|LPG|lpg|하이브리드)\s*(\d+(?:\.\d+)?)/i.exec(name) || /\b([1-6]\.\d)\b/.exec(name);
  const n = Number(m?.[1] || 0);
  return n >= 0.8 && n < 10 ? Math.round(n * 1000) : 0;
};
const fuelFromCarName = (name: string) => {
  if (/LPG|엘피지/i.test(name)) return 'LPG';
  if (/하이브리드|HEV/i.test(name)) return '하이브리드';
  if (/(?:^|[\s])(전기|EV)(?:[\s]|$)/i.test(name) && !/가솔린|디젤|LPG/i.test(name)) return '전기';
  if (/디젤|TDI/i.test(name)) return '디젤';
  if (/가솔린|TFSI|GDI/i.test(name)) return '가솔린';
  return '';
};

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;

/** ⚠ 18곳을 연달아 읽으면 429 가 난다. 재시도가 없으면 그 집이 «안 채워진 채» 조용히 넘어간다. */
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

/** 열 번호를 A1 글자로. 정제칸은 45열 뒤라 **두 글자**가 나온다 — 한 글자만 만들면 엉뚱한 칸에 쓴다. */
const colA1 = (i: number) => { let s = ''; for (let n = i + 1; n > 0;) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
/** 탭 이름에 작은따옴표가 들어가면 A1 표기가 깨진다 — 두 번 겹쳐 쓰는 것이 규격이다. */
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;

/** 「AI 정제」 치환 사전 — 발행기와 **같은 것**을 쓴다. 사전이 다르면 채운 값과 표시 값이 갈린다. */
const SUBST = new Map<string, string>();
try {
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SALES_SHEET}/values/${encodeURIComponent("'AI 정제'!A1:C2000")}`) as { values?: string[][] };
  for (const r of ((v.values || []) as string[][])) {
    const kind = S(r[0]), from = S(r[1]), to = S(r[2]);
    if (!kind.startsWith('@') || kind === '@설명' || !from || !to) continue;
    SUBST.set(`${kind.slice(1)}|${from}`, to);
  }
  console.log(`  치환 사전 「AI 정제」 ${SUBST.size}줄`);
} catch (e) { console.log(`  ⚠ 「AI 정제」를 못 읽어 치환 없이 돈다 — ${String((e as Error).message).slice(0, 60)}`); }
const clean = (col: string, val: string) => SUBST.get(`${col}|${S(val)}`) ?? S(val);

/**
 * ★**차종코드 책** — 「ERP4 차종마스터 원천대장」에서 읽는다.
 *   차번에 코드를 박으면 다시 알아맞힐 일이 없어진다(사장님 2026-08-14).
 * ⚠ 못 읽으면 코드 칸만 비우고 나머지는 예전대로 돈다 — 조용히 멈추지 않는다.
 */
let BOOK = readMasterSheet([]);
try {
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/${encodeURIComponent(`'${MASTER_TAB}'`)}`) as { values?: string[][] };
  BOOK = readMasterSheet((v.values || []) as string[][]);
  console.log(`  차종마스터 ${BOOK.byCode.size}줄 · 다섯값으로 하나로 정해지는 조합 ${[...BOOK.byFive.values()].filter((x) => x.length === 1).length}`);
} catch (e) { console.log(`  ⚠ 차종마스터를 못 읽어 «차종코드»는 못 채운다 — ${String((e as Error).message).slice(0, 60)}`); }

/**
 * ★★**차량번호 정본이 먼저다 — 상품마스터의 확정 차종코드**(사장님 2026-08-18 —
 *   「차종마스터를 안 거치고 왔어?? 정제시트 AI 칸에 모델·세부모델·세부트림 미리 정제해 놓고 갖다 쓰기로 했잖아 — 완전 엉망이네」).
 *   실측: 손오공 375어8056 은 상품마스터에 「카니발 KA4 · 프레스티지」 확정 코드가 있는데, 정제칸은 글자 스냅으로
 *   「카니발 II KV-II」(1990년대 세대)를 박고 코드는 비워 두었다 — 공급사가 배기량을 안 적어 세대 검산이 꺼진 탓.
 *   그래서 스냅보다 **상품마스터(차량번호→차종코드, 검증상태 확정)** 를 먼저 본다. 확정 코드가 있으면 그 코드로 정하고,
 *   뒤 칸(제조사(정제)·모델·세부모델·세부트림·배기량(정제)·연료(정제))은 코드에서 나온다(아래 「코드가 이긴다」 규칙이 옛 값을 바로잡는다).
 *   정제칸에 다른 코드가 적혀 있어도 상품마스터 확정 코드가 이긴다(차량번호 정본).
 */
const PM_CODE = new Map<string, string>();
/** 차량번호 정본 — 상품마스터 코드(규격채택 이름) + 3축 검토 결정. 발행기(publish-origin-tab)와 같은 길. */
let NORMALIZED = new Map<string, NormalizedVehicleName>();
/** 트림행키 → 규격채택(차종구분 = 규격_차종분류+차체형태 포함). */
let ADOPTED = new Map<string, AdoptedSpecName>();
/** 차량번호 → 공급사 원문(트림 근거 판정용). */
const EVIDENCE = new Map<string, string>();
const trimEvidenced = (plate: string, trim: string, extra = '') => {
  const t = S(trim).toLowerCase().replace(/[\s\-_./()（）·]/g, '');
  if (t.length < 2) return false;
  const blob = `${EVIDENCE.get(plate.replace(/\s/g, '')) || ''}${extra.toLowerCase().replace(/[\s\-_./()（）·]/g, '')}`;
  if (blob.includes(t)) return true;
  if (t === '프리미엄' && /premium/i.test(extra)) return true;
  return false;
};
try {
  const { DEFAULT_PRODUCT_MASTER_SHEET_ID, PRODUCT_MASTER_TAB } = await import('../lib/domain/product-master-sheet');
  const pmBase = `https://sheets.googleapis.com/v4/spreadsheets/${DEFAULT_PRODUCT_MASTER_SHEET_ID}/values/`;
  const pm = await api(`${pmBase}${encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A:AZ`)}`) as { values?: unknown[][] };
  const adoptedValues = await api(`${pmBase}${encodeURIComponent("'차종마스터_규격채택'!A:AD")}`) as { values?: unknown[][] };
  const artifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as VehicleTrimMasterArtifact;
  let preferMasterNames = false;
  try { preferMasterNames = Number(JSON.parse(readFileSync('data/vehicle-trim-key-registry.json', 'utf8')).schemaVersion) >= 3; } catch { /* keep false */ }
  ADOPTED = adoptedSpecByKey(adoptedValues.values || []);
  // ★트림 근거 = 상품마스터 「공급사 입력 차명」·「공급사 원문보존」(공급사가 적은 그대로). 우리가 옛 ERP 값으로 미리 채운 시트 차명(세부모델+트림)은 근거가 아니다(순환).
  { const rows = ((pm.values || []) as unknown[][]).map((r) => (r || []).map((c) => S(c))); const h = rows[0] || []; const pi = h.indexOf('차량번호'); const cols = ['공급사 입력 차명', '공급사 원문보존'].map((c) => h.indexOf(c)).filter((i) => i >= 0);
    for (const r of rows.slice(1)) { const pl = S(r[pi]).replace(/\s/g, ''); if (pl) EVIDENCE.set(pl, cols.map((i) => S(r[i])).join(' ').toLowerCase().replace(/[\s\-_./()（）·]/g, '')); }
    // 결정 파일의 supplier_text(검토 때 본 공급사 원문)도 근거다 — 상품마스터 원문보존이 옛 것일 수 있다.
    for (const d of loadProductVehicleReviewDecisions().decisions as { car_number?: string; supplier_text?: string }[]) { const pl = S(d.car_number).replace(/\s/g, ''); if (pl && d.supplier_text) EVIDENCE.set(pl, `${EVIDENCE.get(pl) || ''}${S(d.supplier_text).toLowerCase().replace(/[\s\-_./()（）·]/g, '')}`); } }
  try { const n = await loadColorMasterAliases(api as (u: string) => Promise<Record<string, unknown>>); if (n) console.log(`  색상마스터 별칭 ${n}개 얹음`); } catch (e) { console.log(`  (색상마스터 탭 없음/못 읽음 — 코드 기본 별칭만: ${String((e as Error).message).slice(0, 60)})`); }
  const built = buildPlateNormalization({ productMasterValues: pm.values || [], adopted: ADOPTED, artifact, decisions: loadProductVehicleReviewDecisions().decisions, preferMasterNames });
  NORMALIZED = built.byPlate;
  for (const [pl, n] of NORMALIZED) if (n.trim_row_key) PM_CODE.set(pl, n.trim_row_key);
  console.log(`  차량번호 정본 ${NORMALIZED.size}대(코드 ${PM_CODE.size} · 결정 3축/부분 ${NORMALIZED.size - PM_CODE.size}) — 정제칸은 이것과 대조해 채운다`);
} catch (e) { console.log(`  ⚠ 차량번호 정본(상품마스터·규격채택·결정)을 못 읽어 스냅으로만 돈다 — ${String((e as Error).message).slice(0, 80)}`); }
let pmCodeUsed = 0, pmCodeOverrode = 0, normalUsed = 0, clearedLow = 0, snapFixed = 0; const clearedList: string[] = []; const snapFixList: string[] = [];

/**
 * ★**채우는 곳은 「프리패스 재고」 제공시트다** — 문패가 가리키는 곳이 아니다.
 *   정제칸은 우리가 만든 제공시트에 있다. 문패는 아직 열여섯 곳이 «공급사 자체 시트»를
 *   가리키고 있어서, 문패를 따라가면 정제칸이 없는 문서를 열게 된다(실측 2026-08-14 —
 *   그래서 「정제칸이 없는 시트 16」이 떴다).
 *   ⚠ 그러니 여기서 채운 값이 영업자 표에 보이려면 **그 집 문패를 우리 시트로 넘겨야** 한다.
 *     넘기기 전까지는 채워 놓고 기다리는 것이 맞다 — 넘기는 날 한꺼번에 살아난다.
 * ★찾는 법은 `add-supplier-ai-columns` 와 **같다**(드라이브에서 이름으로). 두 도구가 다른 문서를
 *   보면 「칸은 만들었는데 안 채워지는」 일이 생긴다.
 */
const targets: { code: string; name: string; id: string }[] = [];
{
  const q = `name contains '${DOC_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) {
    const nm = S(f.name);
    const who = companyAlias(supplierSheetLabel(nm)) || supplierSheetLabel(nm);
    if (ONLY.size && ![...supplierNameKeys(who)].some((k) => ONLY.has(k))) continue;
    if (!INCLUDE_MIRROR && isMirrorSheet(S(f.id))) continue;   // 정제시트는 사장님·제미나이 몫(2026-08-18) — --include-mirror 로만
    targets.push({ code: '', name: who, id: S(f.id) });
  }
    targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
for (const t of targets) console.log(`  → ${t.name}  ${t.id}${isMirrorSheet(t.id) ? '  (정제시트)' : ''}`);

/** 정제칸 이름 — 이 목록이 곧 «우리가 채우는 칸»의 정본이다. */
const TAIL = AI_TAIL_COLUMNS.map((c) => c.name);
/** 엔카 행키(M/SM/T)만 스탬프가 박는다. 모델·세부모델·세부트림은 차종마스터 스냅이 채운다. */
const SKIP_ENCAR_CODES = new Set([...ENCAR_CODE_BLOCK, ENCAR_OLD_TRIM_CODE_COLUMN, ENCAR_MASTER_CODE_COLUMN, ENCAR_MASTER_LABEL_COLUMN]);

console.log(`\n■ 공급사 시트 정제칸 채우기 ${APPLY ? '(반영)' : '(dry-run — 아직 안 쓴다)'} · 대상 ${targets.length}곳\n`);

let totFilled = 0, totKept = 0, totCars = 0, totLow = 0;
/** 확신도가 낮아 못 채운 차 — 사람이 손볼 목록이다. 화면 밖에 두면 잊힌다. */
const lowList: string[] = [];
/** 정제칸이 아예 없는 시트 — `add-supplier-ai-columns` 를 먼저 돌려야 한다. */
const noTail: string[] = [];
/** 공급사 배기량과 마스터 배기량이 어긋난 차 — 세대를 잘못 잡았다는 신호다. */
let badCc = 0;
const ccList: string[] = [];
/** 차명 글자를 아예 못 읽은 차 — 그 시트 열 이름이 매핑에 없다는 뜻이다. */
let noName = 0;
const nameList: string[] = [];
/** 옛 방식이 잘못 찍어 둔 배기량 — 되돌린 수. */
let badCcWritten = 0;
const ccFixList: string[] = [];
/** 차종코드를 박은 차 / 못 박은 차 — 「절대 안 틀린다」가 실제로 몇 대에 걸렸나. */
let codeSet = 0, codeUnset = 0;
let staleSheetCode = 0; const staleList: string[] = [];
/** 코드를 따라 표시칸을 고친 수 — 코드가 정본임이 실제로 지켜진 자리다. */
let codeFixed = 0;
const codeFixList: string[] = [];
/** 왜 못 박았나 — 갈래별로 세야 «마스터에 뭘 넣어야 하는지»가 보인다. */
const codeWhy = new Map<string, number>();
const codeByWhy = new Map<string, string[]>();

for (const t of targets) {
  let meta: Rec;
  try {
    meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}?fields=${encodeURIComponent('sheets.properties(sheetId,title,hidden)')}`);
  } catch (e) { console.log(`  ✗ ${t.name}(${t.code}) — 시트를 못 열었다: ${String((e as Error).message).slice(0, 50)}`); continue; }
  const tabTitles = ((meta.sheets || []) as Rec[])
    .filter((s) => !s.properties?.hidden && !isOurNonInventoryTab(S(s.properties?.title)))
    .map((s) => S(s.properties?.title)).filter(Boolean);
  if (!tabTitles.length) continue;

  /** 탭을 한 번에 읽는다 — 탭마다 따로 부르면 쿼터가 금방 마른다. */
  let got: Rec;
  try {
    const qs = tabTitles.map((x) => `ranges=${encodeURIComponent(a1Tab(x))}`).join('&');
    got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}/values:batchGet?${qs}&majorDimension=ROWS`);
  } catch (e) { console.log(`  ✗ ${t.name}(${t.code}) — 값을 못 읽었다: ${String((e as Error).message).slice(0, 50)}`); continue; }

  const updates: { range: string; values: string[][] }[] = [];
  let cars = 0, filled = 0, kept = 0, low = 0, sawTail = false;

  ((got.valueRanges || []) as Rec[]).forEach((vr, ti) => {
    const title = tabTitles[ti];
    const grid = ((vr.values || []) as string[][]);
    if (grid.length < 2) return;
    /**
     * 헤더 줄을 «차량번호가 있는 첫 줄»로 찾는다. 제공시트는 1행이지만 안내문이 위에 붙은
     * 시트가 있어 자리를 고정하면 엉뚱한 줄을 헤더로 잡는다.
     */
    const hRow = grid.findIndex((r) => r.some((c) => S(c) === '차량번호'));
    if (hRow < 0) return;                    // 재고표가 아닌 탭(정책·AI 인계 …)
    const hdr = (grid[hRow] || []).map(S);
    const at = new Map<string, number>();
    hdr.forEach((h, i) => { if (h && !at.has(h)) at.set(h, i); });
    const tailAt = new Map(TAIL.map((c) => [c, at.has(c) ? at.get(c)! : -1]));
    if ([...tailAt.values()].every((i) => i < 0)) return;   // 이 탭엔 정제칸이 없다
    sawTail = true;

    /** 발행기와 **같은 방식** — 후보를 차례로 보고 «값이 든 첫 칸»을 쓴다. */
    const pickAll = (name: string) => (SALES_ALIAS[name] || [name]).map((c) => (at.has(c) ? at.get(c)! : -1)).filter((i) => i >= 0);
    const idx = new Map<string, number[]>();
    for (const n of ['제조사', '모델', '세부모델', '세부트림', '연료', '외장', '내장', '옵션', '배기량']) idx.set(n, pickAll(n));
    const plateAt = at.get('차량번호') ?? -1;
    if (plateAt < 0) return;

    for (let r = hRow + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const plate = S(row[plateAt]);
      if (!plate) continue;
      cars++;
      const cell = (c: string) => { for (const i of (idx.get(c) || [])) { const v = S(row[i]); if (v) return v; } return ''; };
      /** 열 이름 그대로 그 칸만 — 별칭을 안 쓴다. 정제칸을 «있는 그대로» 볼 때 쓴다. */
      const exactCell = (name: string) => { const i = at.get(name); return i === undefined ? '' : S(row[i]); };

      /**
       * ★공급사 정보는 **차량번호 왼쪽 칸**이다(사장님 2026-08-21 — 「차종·차명 확인하면 돼.
       *   공급사는 차량번호 좌우 셀로 정보를 제공한다」). 정제칸·배기량 칸 숫자로 공급사가 틀렸다고 막지 않는다.
       */
      const carName = exactCell('차명(세부모델+트림)') || exactCell('차명');
      const carKindRaw = exactCell('차종') || exactCell('모델명');
      const kindIsClass = VEHICLE_CLASS_VALUES.some((c) => c.replace(/\s+/g, '').toLowerCase() === carKindRaw.replace(/\s+/g, '').toLowerCase());
      const carKind = kindIsClass ? '' : carKindRaw;
      const rawName = [carKindRaw, carName].filter(Boolean).join(' ').trim();
      if (!rawName) { noName++; if (nameList.length < 20) nameList.push(`${t.name} 「${title}」 ${plate}`); }
      const nameCc = ccFromCarName(rawName);
      /**
       * ⚠ `name` 필드는 스냅 신호가 아니다(`vehicle_name`·`sub_model`). 차명을 안 넣으면
       *   차종 칸이 비거나(라브4·A6 C9·SM7) 분류 글자(중형 SUV)일 때 마스터에 있는 차도 못 알아본다.
       */
      const snap = rawName ? snapToMaster({
        maker: exactCell('제조사'),
        model: carKind,
        vehicle_class: kindIsClass ? carKindRaw : undefined,
        vehicle_name: carName,
        sub_model: carName,
        fuel_type: fuelFromCarName(rawName) || exactCell('연료'),
        year: exactCell('연식'),
        engine_cc: nameCc || undefined,
      } as EntityRecord, MASTER) : null;
      let ok = !!snap && (snap.confidence === 'high' || snap.confidence === 'medium');
      const ccMismatch = false;
      if (!ok && rawName) { low++; if (lowList.length < 40) lowList.push(`${t.name} ${plate} 「${rawName.slice(0, 40)}」`); }

      const variant = ok ? S(snap!.variant) : '';

      /**
       * ★★**차종코드를 정한다 — 이게 이 도구의 진짜 일이다**(사장님 2026-08-14 —
       *   「그 차에 대해서 코드를 박아두면 절대 틀릴 일이 없음」).
       *
       *   ① 이미 코드가 박혀 있으면 **그걸 믿는다.** 다시 알아맞히지 않는다.
       *   ② 없으면 스냅이 낸 다섯 값으로 마스터의 「확정/확정」 행에서만 찾는다.
       *   ③ 후보가 여럿이거나 없으면 **안 박는다.** 목록으로 남겨 사람이 정한다 —
       *      아무거나 박으면 「절대 안 틀린다」는 약속이 그 자리에서 깨진다.
       *
       * ★코드가 정해지면 **뒤 칸들은 코드에서 나온다.** 스냅 결과를 안 쓴다 —
       *   그래야 시트에 적힌 값과 코드가 영원히 같다.
       */
      /**
       * ★시트에 남아 있는 차종코드는 «원문과 맞을 때만» 믿는다(2026-08-19 실측 — 손오공 161허1165 셀토스 줄에 쏘나타 DN8 코드가 남아
       *   상품마스터에 코드가 없자 그 시트 코드를 정본으로 믿고 매일 쏘나타를 다시 썼다). 코드 모델이 제조사·차명(세부모델+트림)·옵션 원문에 없으면 버린다.
       */
      const rawSupplierText = [exactCell('제조사'), exactCell('차명(세부모델+트림)'), exactCell('옵션')].join(' ');
      const sheetCode0 = exactCell('차종코드');
      const sheetCode = (sheetCode0 && BOOK.byCode.get(sheetCode0) && !codeMatchesRawName(BOOK.byCode.get(sheetCode0) as { model?: string; sub_model?: string }, rawSupplierText)) ? '' : sheetCode0;
      if (sheetCode0 && !sheetCode) { staleSheetCode++; if (staleList.length < 20) staleList.push(`${t.name} ${plate} 시트 코드 「${sheetCode0}」 ≠ 원문 「${rawSupplierText.slice(0, 40)}」 → 안 믿음`); }
      const pmCode = PM_CODE.get(plate.replace(/\s/g, '')) || '';
      if (pmCode && BOOK.byCode.has(pmCode)) { pmCodeUsed++; if (sheetCode && sheetCode !== pmCode) pmCodeOverrode++; }
      const already = (pmCode && BOOK.byCode.has(pmCode)) ? pmCode : sheetCode;
      const pick = already
        ? { code: already, how: '하나' as const, candidates: [already] }
        : (ok ? pickConfirmedMasterCode(BOOK, S(snap!.maker), S(snap!.model), S(snap!.sub_model), variant, S(snap!.trim_name),
                               fuelDisplay(variant), S(snap!.engine_cc), {
                                 drivetrain: snap!.drive_type,
                                 seats: snap!.seats,
                               })
              : { code: '', how: '없음' as const, candidates: [] as string[] });
      const mrow = pick.code ? BOOK.byCode.get(pick.code) : undefined;
      if (BOOK.byCode.size && ok && !pick.code) {
        codeUnset++;
        codeWhy.set(pick.how, (codeWhy.get(pick.how) || 0) + 1);
        const line = `${t.name} ${plate} — ${S(snap!.maker)} ${S(snap!.model)} ${S(snap!.sub_model)} · ${variant} · ${S(snap!.trim_name) || '(트림없음)'}`.replace(/\s+/g, ' ');
        const bucket = codeByWhy.get(pick.how) || [];
        if (bucket.length < 8) { bucket.push(line); codeByWhy.set(pick.how, bucket); }
        else codeByWhy.set(pick.how, bucket);
      }
      if (pick.code && mrow) codeSet++;

      /** 코드가 정해진 차는 **마스터 값**을, 아니면 예전처럼 스냅 값을 쓴다. */
      const fromCode = masterCells(mrow);
      if (fromCode['제조사(정제)']) fromCode['제조사(정제)'] = canonMakerDisplay(fromCode['제조사(정제)']);
      /** ★차종구분 정본 = 규격채택(차종분류+차체형태) — 코드/결정으로 트림행키가 정해진 차. 없으면 모델 이름 스냅(classifyVehicleClass). */
      const normalForClass = NORMALIZED.get(plate.replace(/\s/g, ''));
      const adoptedClass = (normalForClass?.trim_row_key ? adoptedVehicleClassText(ADOPTED.get(normalForClass.trim_row_key)) : '') || S(normalForClass?.vehicle_class);
      /**
       * 채울 값. **빈 문자열은 «채울 것이 없다»는 뜻**이고 그 칸은 건드리지 않는다.
       * ⚠ 세부트림은 없는 차가 정상이다 — 비어 있다고 사고가 아니다.
       */
      const want: Record<string, string> = {
        '차종코드': pick.code,
        // ★제조사 표기 규격(maker-display) — 마스터의 르노코리아·KG모빌리티도 시트엔 르노·KGM(사장님 2026-08-18)
        '제조사(정제)': ok ? canonMakerDisplay(clean('제조사', S(snap!.maker))) : '',
        '모델': ok ? clean('모델', S(snap!.model)) : '',
        '세부모델': ok ? clean('세부모델', S(snap!.sub_model)) : '',
        // 「파워트레인」 정제칸은 뺐다(2026-08-18) — 열이 남아 있는 시트가 있어도 더 채우지 않는다.
        '세부트림': ok ? clean('세부트림', S(snap!.trim_name)) : '',
        /**
         * ★배기량은 **마스터가 돌려준 `engine_cc` 를 그대로** 쓴다.
         * ⚠ 파워트레인 «글자»에서 숫자를 긁지 마라. 그렇게 했다가 배터리 용량과 구동축 숫자를
         *   배기량으로 찍어 넣었다(실측 2026-08-14 · 살아 있는 매물 49대) —
         *     「전기 77.4kWh AWD」(아이오닉6) → 77400
         *     「전기 2WD」(EV3·EV9·포터II 전기) → 2000     ← 2.0 엔진차로 보인다
         *     「전기 4MATIC」(벤츠 EQE) → 4000
         *     「하이브리드 2WD 6인승」(싼타페 MX5) → 2000  ← 실제 1,598cc
         *   마스터는 전기차에 `engine_cc` 를 안 준다(undefined) — 그래야 빈칸이 된다.
         *   「전기차는 빈칸이 정상」이라는 규격(supplier-template-sheet)이 그 뜻이다.
         */
        '배기량(정제)': ok ? S(snap!.engine_cc) : '',
        '연료(정제)': ok ? fuelDisplay(variant) : '',
        // 색은 마스터와 무관하다 — 차명을 못 알아봐도, 왼쪽 원문만 있으면 규격색으로 정제한다.
        // ⚠ 판매시트 별칭(외장=외장색상 먼저)으로 읽으면 빈 정제칸을 원문으로 착각한다. 왼쪽 칸만 본다.
        '외장색상': snapColorOrEtc(exactCell('외부색상') || exactCell('외장색') || exactCell('색상'), 'ext'),
        '내장색상': snapColorOrEtc(exactCell('내부색상') || exactCell('내장색'), 'int'),
        '선택옵션': clean('옵션', cell('옵션')),
        // 차종분류는 모델 이름으로 정한다 — 차명이 확실할 때만.
        '차종분류': adoptedClass || (ok ? classifyVehicleClass({ maker: S(snap!.maker), model: S(snap!.model), sub_model: S(snap!.sub_model) } as EntityRecord) : ''),
        /**
         * ★★**코드가 이긴다.** 코드가 정해진 차는 위의 스냅 값 대신 **마스터 값**을 쓴다.
         *   맨 마지막에 덮어써서 순서 때문에 뒤집히지 않게 한다 —
         *   그래야 시트에 적힌 표시값과 코드가 영원히 같은 것을 가리킨다.
         */
        ...fromCode,
      };
      /**
       * ★★**정본(상품마스터 코드·3축 결정)이 있으면 그 이름이 정제칸이다** — 사장님 2026-08-18 「정제칸부터 정확하게 대조해서 채워」.
       *   코드 없는 결정(TRIPLE/PARTIAL)도 이름을 준다. 정본이 없고 스냅 확신도가 high 가 아니면 이름 칸을 **안 쓴다**(틀린 값보다 빈 칸).
       *   이미 스냅으로 적혀 있던 이름도 정본과 다르면 정본으로 바로잡고, 정본이 없는데 확신도가 낮은 스냅 값이 남아 있으면 비운다.
       */
      const normal = NORMALIZED.get(plate.replace(/\s/g, ''));
      let clearLowSnap = false; let forceSnap = false;
      if (normal) {
        // ★정본이 «코드 없음»(TRIPLE/PARTIAL/HOLD 결정)이면 시트에 남은 옛 코드도 비운다 — 안 그러면 트림을 비운 뒤에도 옛 코드(첫 트림 t01)가 정제칸에 눌러앉는다(2026-08-19 실측 125호2615).
        want['차종코드'] = normal.trim_row_key || '';
        want['제조사(정제)'] = canonMakerDisplay(normal.maker) || want['제조사(정제)'];
        want['모델'] = normal.model || want['모델'];
        want['세부모델'] = normal.sub_model || want['세부모델'];
        // ★트림은 정본에 있는 것만. 정본(부분 결정)에 트림이 없으면 — 공급사 원문에 그 트림 글자가 있을 때만 스냅 트림을 남기고, 아니면 빈칸
        //   (사장님 2026-08-19 「트림 없는 거는 그냥 트림 비우는 거로」 — 첫 트림 추정·옛 ERP 값 재유입을 막는다).
        want['세부트림'] = normal.trim || (trimEvidenced(plate, want['세부트림'], carName) ? want['세부트림'] : '');
        if (normal.fuel) want['연료(정제)'] = fuelDisplay(normal.fuel) || normal.fuel;
        if (normal.engine_cc) want['배기량(정제)'] = String(normal.engine_cc);
        normalUsed++;
      } else if (!pick.code) {
        const strict = !!snap && snap.confidence === 'high' && !ccMismatch;
        if (!strict) { for (const k of ['모델', '세부모델', '세부트림', '배기량(정제)', '연료(정제)', '차종분류']) want[k] = ''; clearLowSnap = true; }
        else forceSnap = true;   // 정본은 없지만 확신 high — 지금 공급사 글자에서 나온 값으로 맞춘다(옛 스냅 값이 남아 있으면 바로잡음)
      }

      for (const [name, ci] of tailAt) {
        if (ci < 0) continue;
        if (SKIP_ENCAR_CODES.has(name)) continue;
        const now = S(row[ci]);
        const v = S(want[name]);
        /**
         * ⚠ 예외 하나 — **엔진이 없는 차에 배기량이 적혀 있으면 지운다.**
         *   옛 방식이 파워트레인 «글자»에서 숫자를 긁어 배터리 용량을 배기량으로 찍었다
         *   (레이 EV 16400 · 볼트 EUV 66000 · EV6 77400 — 실측 2026-08-14).
         * ★판정을 **시트에 적힌 파워트레인**으로 한다. 다시 스냅을 돌려 견주면,
         *   그 사이 마스터나 입력이 바뀐 차는 계산이 안 맞아 **못 고치고 지나간다.**
         *   「전기·수소인데 배기량이 있다」는 다시 볼 것 없이 틀린 것이다.
         */
        // ★판정 칸은 「연료(정제)」(파워트레인 칸을 뺀 뒤로). 옛 시트에 파워트레인 칸이 남아 있으면 그것도 본다.
        const fuelMark = exactCell('연료(정제)') || exactCell('파워트레인');
        if (FIX_CC && name === '배기량(정제)' && now && /전기|수소/.test(fuelMark)) {
          badCcWritten++;
          if (ccFixList.length < 25) ccFixList.push(`${t.name} ${plate} 「${fuelMark}」 ${now} → (빈칸)`);
          updates.push({ range: `${a1Tab(title)}!${colA1(ci)}${r + 1}`, values: [['']] });
          continue;
        }
        /**
         * ★★**코드가 이긴다 — 표시칸은 코드를 따라간다.**
         *   차종코드가 박힌 차는 뒤 칸들이 «코드에서 나온 표시값»이다(규격 4장).
         *   그런데 「빈 칸에만 쓴다」만 지키면 **옛 값이 그대로 남아 코드와 어긋난다** —
         *   실측 2026-08-15: 코드를 박았는데 G80 DH 가 「가솔린 3.3T」로 남아 있었다
         *   (코드는 2.5T 를 가리킨다). 그러면 코드를 박은 값어치가 없다.
         * ⚠ 코드가 있는 차의 **마스터에서 나온 칸만** 덮는다. 색·옵션·차종분류는
         *   코드에서 나오는 값이 아니라 그대로 둔다.
         * ⚠ 사람이 값을 고치고 싶으면 **코드를 고쳐야** 한다. 표시칸을 고치면 다시 덮인다 —
         *   그게 「코드가 정본」의 뜻이다.
         */
        if (normal && ['차종코드', '제조사(정제)', '모델', '세부모델', '세부트림', '배기량(정제)', '연료(정제)', ...(adoptedClass ? ['차종분류'] : [])].includes(name)) {
          const target = S(want[name]);
          // 정본(부분 결정)에 트림이 없을 때: 지금 칸의 트림이 공급사 원문(원문보존·결정 supplier_text)에 있으면 남기고, 근거 없으면 비운다(2026-08-19 「트림 없는 거는 비운다」).
          if (name === '세부트림' && !target && normal.source !== 'code' && now && trimEvidenced(plate, now, carName)) { kept++; continue; }
          if (now !== target) {
            if (now) { codeFixed++; if (codeFixList.length < 20) codeFixList.push(`${t.name} ${plate} ${name} 「${now}」 → 「${target || '(빈칸)'}」`); }
            else if (target) filled++;
            if (target || now) updates.push({ range: `${a1Tab(title)}!${colA1(ci)}${r + 1}`, values: [[target]] });
          } else if (now) kept++;
          continue;
        }
        if (forceSnap && ['모델', '세부모델', '세부트림', '배기량(정제)', '연료(정제)'].includes(name) && !exactCell('차종코드')) {
          const target = S(want[name]);
          if (now !== target && (target || now)) {
            if (now) { snapFixed++; if (snapFixList.length < 20) snapFixList.push(`${t.name} ${plate} ${name} 「${now}」 → 「${target || '(빈칸)'}」`); }
            else if (target) filled++;
            updates.push({ range: `${a1Tab(title)}!${colA1(ci)}${r + 1}`, values: [[target]] });
          } else if (now) kept++;
          continue;
        }
        if (clearLowSnap && ['모델', '세부모델', '세부트림', '배기량(정제)', '연료(정제)', '차종분류'].includes(name) && now && !exactCell('차종코드')) {
          clearedLow++; if (clearedList.length < 20) clearedList.push(`${t.name} ${plate} ${name} 「${now}」 → (빈칸 · 정본 없음·확신 낮음)`);
          updates.push({ range: `${a1Tab(title)}!${colA1(ci)}${r + 1}`, values: [['']] });
          continue;
        }
        if (pick.code && mrow && name in fromCode) {
          const target = S(fromCode[name]);
          if (now !== target) {
            if (now) { codeFixed++; if (codeFixList.length < 20) codeFixList.push(`${t.name} ${plate} ${name} 「${now}」 → 「${target || '(빈칸)'}」`); }
            else filled++;
            updates.push({ range: `${a1Tab(title)}!${colA1(ci)}${r + 1}`, values: [[target]] });
          } else if (now) kept++;
          continue;
        }
        if (!v) continue;                 // 채울 것이 없다
        /**
         * 색·옵션은 왼쪽 원문에서 매일 다시 계산한다(realign 과 같음).
         * 빈 정제칸은 채우고, 원문과 어긋난 옛 값도 규격색으로 바로잡는다.
         */
        if (name === '외장색상' || name === '내장색상' || name === '선택옵션') {
          if (now === v) { if (now) kept++; continue; }
          if (now) { /* 원문 기준으로 덮음 */ }
          else filled++;
          updates.push({ range: `${a1Tab(title)}!${colA1(ci)}${r + 1}`, values: [[v]] });
          continue;
        }
        if (now) { kept++; continue; }    // ⚠ 이미 있는 값은 절대 안 덮는다
        filled++;
        updates.push({ range: `${a1Tab(title)}!${colA1(ci)}${r + 1}`, values: [[v]] });
      }
    }
  });

  if (!sawTail) { noTail.push(`${t.name}(${t.code})`); continue; }
  totCars += cars; totFilled += filled; totKept += kept; totLow += low;
  const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));
  console.log(`  ${pad(t.name, 14)}${String(cars).padStart(4)}대   채움 ${String(filled).padStart(5)}칸   그대로 둠 ${String(kept).padStart(5)}칸${low ? `   못 알아봄 ${low}대` : ''}`);

  if (APPLY && updates.length) {
    /** 칸 단위로 쓴다 — 열을 통째로 덮으면 사람이 고친 값이 같이 날아간다. */
    for (let i = 0; i < updates.length; i += 500) {
      await api(`https://sheets.googleapis.com/v4/spreadsheets/${t.id}/values:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'RAW', data: updates.slice(i, i + 500) }),
      });
    }
  }
}

console.log(`\n  ${'─'.repeat(58)}`);
console.log(`  모두 ${totCars}대 · 채울 칸 ${totFilled} · 이미 있어 그대로 둔 칸 ${totKept}`);
console.log(`  차량번호 정본으로 정한 차 ${normalUsed}대 (코드 ${pmCodeUsed} · 시트 코드와 달라 바로잡음 ${pmCodeOverrode}) · 정본 없고 확신 낮아 비운 칸 ${clearedLow}`);
for (const x of clearedList) console.log(`     ${x}`);
console.log(`  정본 없음·확신 high 스냅으로 바로잡은 칸 ${snapFixed}`);
if (staleSheetCode) { console.log(`  시트에 남은 코드가 원문과 달라 안 믿은 차 ${staleSheetCode}대`); for (const l of staleList) console.log(`     ${l}`); }
for (const x of snapFixList) console.log(`     ${x}`);
if (codeSet || codeUnset) {
  console.log(`  차종코드   박음 ${codeSet}대 · 못 박음 ${codeUnset}대`);
}
if (codeFixed) {
  console.log(`
  ▲ 코드를 따라 표시칸을 고친 칸 ${codeFixed} — 코드와 어긋나 있던 값이다`);
  for (const l of codeFixList) console.log(`     ${l}`);
  if (codeFixed > codeFixList.length) console.log(`     … 그 밖 ${codeFixed - codeFixList.length}칸`);
}
if (badCcWritten) {
  console.log(`\n  ▲ 옛 방식이 잘못 찍어 둔 배기량 ${badCcWritten}칸을 되돌린다 (배터리 용량·구동축 숫자였다)`);
  for (const l of ccFixList) console.log(`     ${l}`);
  if (badCcWritten > ccFixList.length) console.log(`     … 그 밖 ${badCcWritten - ccFixList.length}칸`);
}
if (noTail.length) console.log(`\n  ▲ 정제칸이 없는 시트 ${noTail.length} — 먼저 add-supplier-ai-columns 를 돌려야 한다\n     ${noTail.join(' · ')}`);
if (totLow) {
  console.log(`\n  ▲ 차종마스터가 못 알아본 차 ${totLow}대 — 비워 둔다. 마스터에 넣거나 사람이 직접 적어야 한다`);
  for (const l of lowList) console.log(`     ${l}`);
  if (totLow > lowList.length) console.log(`     … 그 밖 ${totLow - lowList.length}대`);
}
if (noName) {
  console.log(`
  ▲ 차명을 한 글자도 못 읽은 차 ${noName}대 — 그 시트의 열 이름이 매핑에 없다`);
  for (const l of nameList) console.log(`     ${l}`);
  if (noName > nameList.length) console.log(`     … 그 밖 ${noName - nameList.length}대`);
}
if (codeUnset) {
  const WHY: Record<string, string> = {
    세부모델없음: '그 세부모델이 마스터에 통째로 없다 — **마스터에 넣어야 할 차**',
    트림없음: '세부모델은 있는데 그 트림이 없다 — 트림을 넣거나 이름을 맞춰야 한다',
    배기량안맞음: '세부모델·트림은 맞는데 연료/배기량이 안 맞는다 — 파워트레인 줄이 없다',
    여럿: '후보가 여럿이라 못 고른다 — 사람이 하나를 정해야 한다',
    없음: '못 찾았다',
  };
  console.log(`
  ▲ 차종코드를 못 박은 차 ${codeUnset}대 — 갈래별로 할 일이 다르다`);
  for (const [why, n] of [...codeWhy].sort((a, b) => b[1] - a[1])) {
    console.log(`
     ■ ${why} ${n}대 — ${WHY[why] || ''}`);
    for (const l of (codeByWhy.get(why) || [])) console.log(`        ${l}`);
    const shown = (codeByWhy.get(why) || []).length;
    if (n > shown) console.log(`        … 그 밖 ${n - shown}대`);
  }
}
if (badCc) {
  console.log(`\n  ▲ 공급사 배기량과 마스터가 어긋난 차 ${badCc}대 — 세대를 잘못 잡은 것이다. 한 칸도 안 채웠다`);
  for (const l of ccList) console.log(`     ${l}`);
  if (badCc > ccList.length) console.log(`     … 그 밖 ${badCc - ccList.length}대`);
}
console.log(APPLY ? '\n  반영 완료 — 이제 발행기는 즉석 판단 대신 이 글자를 읽는다.\n' : '\n  미리보기였다. 실제로 쓰려면 --apply\n');
