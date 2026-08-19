/**
 * **차종 검수 — 영업자에게 나가는 차종 값이 맞는가.** 읽기 전용.
 *
 * ★왜(사장님 2026-08-15 — 「일단 차종 검수해봐」)
 *   돈은 매일 대조하는데 **차종은 아무도 안 센다.** 그런데 오늘 하루에만 차종에서 셋이 났다 —
 *   배터리 용량이 배기량으로(77400) · 파워트레인 44대 뒤집힘 · 세대 오판 27대.
 *   전부 «값이 있는데 틀린» 것이라 빈칸을 세는 것만으로는 안 잡힌다.
 *
 * ★그래서 세 가지를 본다.
 *   ① 비었나 — 축마다 몇 대가 비었나
 *   ② 스스로 모순인가 — 연료 ↔ 파워트레인 ↔ 배기량이 서로 안 맞나
 *   ③ 공급사가 적은 것과 어긋나나 — 우리가 바꿔 놓은 값이 원문과 크게 다르면 세대 오판 신호다
 *
 * ★**차종마스터 탭을 쓴다**(사장님 2026-08-18 — 「차종마스터 탭 활용하면 되고」). 판매시트에서 「파워트레인」 열을 뺀 뒤로
 *   연료·배기량의 모순은 «판매시트 안»이 아니라 «차번의 차종코드가 가리키는 차종마스터 행»과 견준다 —
 *   상품마스터(차량번호→차종코드) → 원천대장 「차종마스터」(트림행키→연료·정확배기량). 코드 없는 차는 견줄 기준이 없어 따로 센다.
 * ⚠ 세부트림은 **없는 차가 정상**이다. 빈 것을 구멍으로 세지 않는다.
 *
 *   npx tsx scripts/audit-vehicle-spec.mts
 *   npx tsx scripts/audit-vehicle-spec.mts --list      어긋난 차를 전부 찍는다
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { NOT_SHEET_BACKED, SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { companyAlias } from '../lib/domain/identity';
import { isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';
import type { EntityRecord } from '../lib/intake/entities';
import { DEFAULT_PRODUCT_MASTER_SHEET_ID, PRODUCT_MASTER_TAB } from '../lib/domain/product-master-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const plate = (v: unknown) => S(v).replace(/\s/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const LIST = process.argv.includes('--list');
const SALES = arg('sales', '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
const INDEX_SHEET = arg('index', '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${gT}` } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));
const digits = (v: unknown) => Number(S(v).replace(/[^\d]/g, '')) || 0;
/** 배기량을 리터로. 정확값(1,999)과 표시값(2,000)을 같게 본다. */
const liters = (cc: unknown) => { const n = digits(cc); return n > 0 ? Math.round(n / 100) / 10 : 0; };

/** ── 판매시트 상품리스트 */
type Car = Rec & { plate: string; who: string };
const cars: Car[] = [];
/** 상품리스트에 실제로 있는 열 이름 — «열이 없다»와 «값이 비었다»를 가르는 데 쓴다. */
let salesCols: string[] = [];
{
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SALES}?fields=${encodeURIComponent('sheets.properties(title)')}`);
  const tab = ((meta.sheets || []) as Rec[]).map((s) => S(s.properties?.title)).find((t) => t.startsWith('상품리스트'));
  if (!tab) throw new Error('상품리스트 탭을 못 찾았다');
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SALES}/values/${encodeURIComponent(a1Tab(tab))}`) as { values?: string[][] };
  const rows = ((v.values || []) as string[][]);
  const h = rows.findIndex((r) => r.some((c) => S(c) === '차량번호'));
  const hdr = (rows[h] || []).map(S);
  salesCols = hdr.filter(Boolean);
  for (const r of rows.slice(h + 1)) {
    const p = plate(r[hdr.indexOf('차량번호')]);
    if (!p) continue;
    const o: Car = { plate: p, who: '' };
    hdr.forEach((c, i) => { if (c) o[c] = S(r[i]); });
    o.who = S(o['공급사']);
    cars.push(o);
  }
  console.log(`\n■ 차종 검수 — 「${tab}」 ${cars.length}대\n`);
}

/** ── 공급사 원문(문패 시트) — 배기량·연료만 견준다. 차명은 우리가 일부러 바꾼다. */
const raw = new Map<string, { cc: number; fuel: string; name: string; ours: boolean }>();
{
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${INDEX_SHEET}/values/A1:Z300`) as { values?: string[][] };
  for (const r of ((v.values || []) as string[][])) {
    const id = (S(r[2]).match(/\/d\/([\w-]+)/) || [])[1];
    const code = S(r[1]);
    if (!id || !code || NOT_SHEET_BACKED.has(code)) continue;
    let grid: Rec;
    try { grid = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`); } catch { continue; }
    const ours = /프리패스/.test(S(grid.properties?.title));
    const read = readSupplierSheet(grid as never, { partner_code: code, partner_name: S(r[0]) } as EntityRecord);
    for (const t of read.tabs) {
      if (isOurNonInventoryTab(S(t.title))) continue;
      const hdr = (t.table[0] || []).map(S);
      const at = (n: string) => hdr.indexOf(n);
      const pi = at('차량번호') >= 0 ? at('차량번호') : at('차번');
      if (pi < 0) continue;
      /** ⚠ 공급사가 적은 칸만 본다 — 「배기량(정제)」·「연료(정제)」는 우리가 채운 칸이다. */
      const ci = at('배기량'), fi = at('연료'), ni = at('차명(트림)');
      for (const row of t.table.slice(1)) {
        const p = plate(row[pi]);
        if (!p || raw.has(p)) continue;
        raw.set(p, { cc: ci >= 0 ? digits(row[ci]) : 0, fuel: fi >= 0 ? S(row[fi]) : '', name: ni >= 0 ? S(row[ni]) : '', ours });
      }
    }
  }
  console.log(`  공급사 원문 ${raw.size}대를 읽었다 (배기량·연료 대조용)\n`);
}

const isOurs = (p: string) => raw.get(p)?.ours ?? false;
const split = (list: Car[]) => {
  const a = list.filter((c) => isOurs(c.plate)).length;
  return `우리 시트 ${a}대 · 아닌 시트 ${list.length - a}대 · 총 ${list.length}대`;
};

// ── ① 비었나
console.log(`  ── ① 비었나`);
const AXES = ['제조사', '모델', '세부모델', '세부트림', '연료', '배기량', '차종분류'];
console.log(`  ${pad('축', 12)}빈 차`);
for (const ax of AXES) {
  /**
   * ⚠ **«열이 없다»와 «값이 비었다»는 다르다.**
   *   실측 2026-08-15: 상품리스트에 「차종분류」 열이 아예 없는데 379대 전부 비었다고 셌다.
   *   열이 없으면 그건 «안 채워진 것»이 아니라 «안 싣는 것»이다 — 할 일이 전혀 다르다.
   */
  if (!salesCols.includes(ax)) { console.log(`  ${pad(ax, 12)}★열이 아예 없다 — 상품리스트가 이 값을 안 싣는다`); continue; }
  const empty = cars.filter((c) => !S(c[ax]));
  if (!empty.length) { console.log(`  ${pad(ax, 12)}없음`); continue; }
  console.log(`  ${pad(ax, 12)}${split(empty)}`);
}
const noTrim = cars.filter((c) => !S(c['세부트림']));
console.log(`  ${pad('세부트림', 12)}${noTrim.length}대 — ⚠ 트림이 없는 차가 있으므로 이것만으로는 구멍이 아니다`);

// ── ② 스스로 모순인가
console.log(`\n  ── ② 스스로 모순인가`);
const bad: { why: string; cars: Car[] }[] = [];
/**
 * ★차번 → 차종코드 → 차종마스터 행. 판매시트에 파워트레인 열이 없으니 연료·배기량의 기준은 여기다.
 *   상품마스터(원천대장) 「차량번호·차종코드」와 「차종마스터」 「트림행키·연료·정확배기량(cc)·세부모델·세부트림」만 읽는다.
 */
const masterOf = new Map<string, { code: string; fuel: string; cc: number; name: string }>();
let codeless = 0;
try {
  const pm = await api(`https://sheets.googleapis.com/v4/spreadsheets/${DEFAULT_PRODUCT_MASTER_SHEET_ID}/values/${encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A:AX`)}`) as { values?: string[][] };
  const pv = (pm.values || []) as string[][];
  const ph = (pv[0] || []).map(S);
  const pPlate = ph.indexOf('차량번호'), pCode = ph.indexOf('차종코드');
  const vm = await api(`https://sheets.googleapis.com/v4/spreadsheets/${DEFAULT_PRODUCT_MASTER_SHEET_ID}/values/${encodeURIComponent("'차종마스터'!A:AH")}`) as { values?: string[][] };
  const mv = (vm.values || []) as string[][];
  const mh = (mv[0] || []).map(S);
  const mKey = mh.indexOf('트림행키'), mFuel = mh.indexOf('연료'), mCc = mh.indexOf('정확배기량(cc)'), mSub = mh.indexOf('세부모델'), mTrim = mh.indexOf('세부트림');
  if (pPlate < 0 || pCode < 0 || mKey < 0 || mFuel < 0 || mCc < 0) throw new Error('상품마스터/차종마스터 머리글이 다르다');
  const byKey = new Map<string, { fuel: string; cc: number; name: string }>();
  for (const r of mv.slice(1)) { const k = S(r[mKey]); if (k) byKey.set(k, { fuel: S(r[mFuel]), cc: digits(r[mCc]), name: `${S(r[mSub])} · ${S(r[mTrim])}` }); }
  const codeOf = new Map<string, string>();
  for (const r of pv.slice(1)) { const p = plate(r[pPlate]); if (p) codeOf.set(p, S(r[pCode])); }
  for (const c of cars) {
    const code = codeOf.get(c.plate) || '';
    const m = code ? byKey.get(code) : undefined;
    if (m) masterOf.set(c.plate, { code, ...m }); else if (!code) codeless++;
  }
  console.log(`  차종마스터 ${byKey.size}행 · 상품마스터 코드 ${codeOf.size}대 → 판매시트 차 ${cars.length}대 중 마스터 행이 있는 차 ${masterOf.size}대 · 코드 없는 차 ${codeless}대\n`);
} catch (e) { console.log(`  ⚠ 차종마스터를 못 읽어 ②는 건너뛴다 — ${String((e as Error).message).slice(0, 80)}\n`); }
/**
 * ⚠ **연료는 «뜻»으로 견준다.** 글자로 견주면 「HEV」와 「하이브리드 1.6」이 다르다고 나온다 —
 *   실측 2026-08-15: 그렇게 세다 60대를 어긋남으로 잡을 뻔했다. 전부 표기 차이였다.
 *   거짓 숫자는 «모름»보다 나쁘다.
 */
const fuelKind = (v: unknown) => {
  const x = S(v).toLowerCase();
  if (/phev|플러그인/.test(x)) return 'PHEV';
  if (/hev|하이브리드|hybrid/.test(x)) return '하이브리드';
  if (/전기|ev|electric/.test(x)) return '전기';
  if (/수소|fcev/.test(x)) return '수소';
  if (/디젤|경유|diesel/.test(x)) return '디젤';
  if (/lpg|lpi|lpe/.test(x)) return 'LPG';
  if (/가솔린|휘발유|gasoline|gsl/.test(x)) return '가솔린';
  return '';
};
const evLike = (c: Car) => { const m = masterOf.get(c.plate); return /전기|수소/.test(`${S(c['연료'])} ${m ? m.fuel : ''}`); };
bad.push({ why: '전기·수소인데 배기량이 있다', cars: cars.filter((c) => evLike(c) && digits(c['배기량']) > 0) });
bad.push({ why: '엔진차인데 배기량이 없다', cars: cars.filter((c) => !evLike(c) && masterOf.has(c.plate) && !digits(c['배기량'])) });
bad.push({
  why: '연료가 차종마스터(코드)와 다르다',
  cars: cars.filter((c) => { const m = masterOf.get(c.plate); if (!m) return false; const a2 = fuelKind(c['연료']), b2 = fuelKind(m.fuel); return !!a2 && !!b2 && a2 !== b2; }),
});
bad.push({
  why: '배기량이 차종마스터(코드)와 다르다',
  cars: cars.filter((c) => { const m = masterOf.get(c.plate); if (!m || !m.cc) return false; const L = liters(c['배기량']); return L > 0 && Math.abs(m.cc / 1000 - L) > 0.15; }),
});
for (const b of bad) {
  console.log(`  ${pad(b.why, 34)}${b.cars.length ? split(b.cars) : '없음'}`);
  if (b.cars.length) for (const c of (LIST ? b.cars : b.cars.slice(0, 5))) {
    const m = masterOf.get(c.plate);
    console.log(`     ${c.who} ${c.plate} — ${S(c['세부모델'])} ${S(c['세부트림'])} · 연료 ${S(c['연료']) || '(빈)'} · ${S(c['배기량']) || '(빈)'}${m ? ` ↔ 마스터 ${m.name} · ${m.fuel} ${m.cc || ''}` : ' (코드 없음)'}`);
  }
  if (!LIST && b.cars.length > 5) console.log(`     … 그 밖 ${b.cars.length - 5}대`);
}

// ── ③ 공급사 원문과 어긋나나
console.log(`\n  ── ③ 공급사가 적은 것과 어긋나나`);
const ccGap = cars.filter((c) => {
  const r = raw.get(c.plate); if (!r || !r.cc) return false;
  const L = liters(c['배기량']); if (!L) return false;
  return Math.abs(r.cc / 1000 - L) > 0.15;      // 0.15L 넘게 벌어지면 세대를 잘못 잡았다는 신호
});
console.log(`  ${pad('배기량이 공급사 기재와 다르다', 34)}${ccGap.length ? split(ccGap) : '없음'}`);
for (const c of (LIST ? ccGap : ccGap.slice(0, 10))) {
  console.log(`     ${c.who} ${c.plate} — 공급사 ${raw.get(c.plate)!.cc}cc ↔ 우리 ${S(c['배기량'])} · ${S(c['세부모델'])} ${S(c['세부트림'])}`);
}
if (!LIST && ccGap.length > 10) console.log(`     … 그 밖 ${ccGap.length - 10}대`);

const fuelGap = cars.filter((c) => {
  const r = raw.get(c.plate); if (!r || !r.fuel) return false;
  const a = S(c['연료']).toLowerCase(), b = r.fuel.toLowerCase();
  if (!a) return false;
  const x = fuelKind(a), y = fuelKind(b);
  return !!x && !!y && x !== y;
});
console.log(`  ${pad('연료가 공급사 기재와 다르다', 34)}${fuelGap.length ? split(fuelGap) : '없음'}`);
for (const c of (LIST ? fuelGap : fuelGap.slice(0, 8))) {
  console.log(`     ${c.who} ${c.plate} — 공급사 「${raw.get(c.plate)!.fuel}」 ↔ 우리 「${S(c['연료'])}」 · ${S(c['세부모델'])} ${S(c['세부트림'])}`);
}
if (!LIST && fuelGap.length > 8) console.log(`     … 그 밖 ${fuelGap.length - 8}대`);

// ── 코드 없는 차 — 견줄 기준이 없다. 3축 검토 큐(data/product-vehicle-review-decisions.json)로 닫는다.
console.log(`\n  ── 차종코드가 없어 마스터와 못 견준 차 ${codeless}대 — 3축 검토 결정·상품마스터 코드로 닫는다`);

const total = bad.reduce((a, b) => a + b.cars.length, 0) + ccGap.length + fuelGap.length;
console.log(`\n  ${'─'.repeat(60)}`);
console.log(`  손볼 곳 합계 ${total}건${LIST ? '' : '  (전부 보려면 --list)'}\n`);
