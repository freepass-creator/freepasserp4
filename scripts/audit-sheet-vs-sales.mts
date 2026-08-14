/**
 * **공급사시트 ↔ 영업자 판매리스트 정합성** — 차량번호 기준으로 보증금·대여료를 견준다. 읽기 전용.
 *
 * ★사장님 2026-08-14 — 「적어도 차량번호 좌측으로 보증금 대여료는 맞아야 해」.
 *   차명·색은 표기가 갈릴 수 있어도 **돈은 갈리면 안 된다.** 틀리면 손님에게 잘못 말한다.
 *
 * ★파이어베이스를 안 쓴다. 문패 → 공급사 시트 → 판매리스트, 전부 구글시트다.
 * ★비교는 **숫자로만** 한다 — 「1,070,000」과 「1070000」은 같은 값이다. 콤마·원·공백은 떼고 본다.
 *   ⚠ 값을 고치려 들지 마라. 이 도구는 «어긋난 자리를 보여 주는» 것까지다.
 *
 *   npx tsx scripts/audit-sheet-vs-sales.mts
 *   npx tsx scripts/audit-sheet-vs-sales.mts --code=RP021 --list
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONLY = arg('code');
const LIST = process.argv.includes('--list');
const SALES = arg('sales', S(process.env.INVENTORY_EXPORT_SHEET_ID) || '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
const INDEX_SHEET = arg('index', '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY');

/** 견줄 칸 — 돈만. 판매리스트 열 이름 ← 공급사 시트 열 이름 후보. */
const MONEY: Record<string, string[]> = {
  단기보증: ['단기보증'],
  장기보증: ['장기보증', '보증금', '보증금 반납형'],
  '1개월': ['1개월', '월렌트', '월세'],
  '12개월': ['12개월', '12개월 반납형'],
  '24개월': ['24개월', '24개월 반납형'],
  '36개월': ['36개월', '36개월 반납형'],
  '48개월': ['48개월', '48개월 반납형'],
  '60개월': ['60개월', '60개월 반납형'],
};
/** 숫자만 남긴다. 숫자가 아닌 말(「연수×대여료」·「협의」·「-」)은 «값 없음»으로 본다. */
const money = (v: unknown) => {
  const s = S(v);
  if (!s || !/\d/.test(s)) return '';
  const n = Number(s.replace(/[^\d]/g, ''));
  return n > 0 ? String(n) : '';
};

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const tok = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;
/**
 * ⚠ 재시도가 없으면 «분당 읽기» 쿼터에 걸린 순간부터 그 공급사들이 통째로 빠지고,
 *   그게 「판매리스트에만 있는 차 114대」 같은 **가짜 어긋남**으로 보고된다(실측 2026-08-14).
 *   감사가 거짓말을 하면 감사가 아니다.
 */
const api = async (u: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
    const t = await r.text();
    if (r.ok) return JSON.parse(t);
    if ((r.status === 429 || r.status >= 500) && n < 6) {
      await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n)));
      continue;
    }
    throw new Error(`${r.status} ${t.slice(0, 200)}`);
  }
};
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

// ── ① 판매리스트 읽기 ────────────────────────────────────────────────────────
const salesMeta = await api(`${SHEETS}/${SALES}?fields=sheets.properties(title,hidden)`);
const salesTab = ((salesMeta.sheets || []) as Rec[])
  .find((s) => !s.properties.hidden && S(s.properties.title).startsWith('상품리스트'))?.properties.title;
if (!salesTab) throw new Error('판매리스트 탭을 못 찾음');
const sv = await api(`${SHEETS}/${SALES}/values/${encodeURIComponent(`'${String(salesTab).replace(/'/g, "''")}'`)}`) as { values?: string[][] };
const srows = (sv.values || []) as string[][];
const shdr = (srows[0] || []).map(S);
const sPlate = shdr.indexOf('차량번호');
if (sPlate < 0) throw new Error('판매리스트에 차량번호 열이 없다');
/** 차번 → 판매리스트가 든 돈. */
const sales = new Map<string, Record<string, string>>();
for (const r of srows.slice(1)) {
  const pl = norm(r[sPlate]);
  if (!pl) continue;
  const rec: Record<string, string> = {};
  for (const name of Object.keys(MONEY)) {
    const i = shdr.indexOf(name);
    if (i >= 0) rec[name] = money(r[i]);
  }
  sales.set(pl, rec);
}
console.log(`■ 공급사시트 ↔ 판매리스트 — 돈 대조\n`);
console.log(`  판매리스트 「${salesTab}」 ${sales.size}대`);

// ── ② 공급사 시트 읽기(문패 기준) ─────────────────────────────────────────────
const idx = await api(`${SHEETS}/${INDEX_SHEET}/values/A1:Z200`) as { values?: string[][] };
const supplierRows = new Map<string, { code: string; name: string; money: Record<string, string> }>();
const readNote: string[] = [];
let sheetCount = 0;
for (const r of (idx.values || [])) {
  const name = S(r[0]), code = S(r[1]), url = S(r[2]);
  if (!code || !/^https?:/.test(url)) continue;
  if (ONLY && code !== ONLY) continue;
  const id = url.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1];
  if (!id) continue;
  sheetCount++;
  try {
    const grid = await api(`${SHEETS}/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`);
    const read = readSupplierSheet(grid, { partner_code: code, partner_name: name } as unknown as EntityRecord);
    for (const tab of read.tabs) {
      const hdr = (tab.table[0] || []).map(S);
      const pi = hdr.findIndex((h) => /^(차량번호|차번)$/.test(h));
      if (pi < 0) continue;
      /** 판매리스트 열 → 이 탭의 열 번호. 먼저 맞는 이름을 쓴다. */
      const pick: Record<string, number> = {};
      for (const [want, cands] of Object.entries(MONEY)) {
        const i = hdr.findIndex((h) => cands.some((c) => norm(h) === norm(c)));
        if (i >= 0) pick[want] = i;
      }
      if (!Object.keys(pick).length) continue;
      for (const row of tab.table.slice(1)) {
        const pl = norm(row[pi]);
        if (!pl || supplierRows.has(pl)) continue;
        const rec: Record<string, string> = {};
        for (const [want, i] of Object.entries(pick)) rec[want] = money(row[i]);
        supplierRows.set(pl, { code, name, money: rec });
      }
    }
  } catch (e) { readNote.push(`${name}(${code}) — ${(e as Error).message.slice(0, 60)}`); }
}
console.log(`  공급사 시트 ${sheetCount}곳 · 차 ${supplierRows.size}대\n`);
if (readNote.length) { console.log('  못 읽은 시트'); for (const n of readNote) console.log(`     ${n}`); console.log(''); }

// ── ③ 대조 ─────────────────────────────────────────────────────────────────
type Diff = { plate: string; sup: string; col: string; sheet: string; sale: string };
const diffs: Diff[] = [];
let matched = 0, sameAll = 0, onlySheet = 0, onlySale = 0;
/**
 * ★**한 칸도 못 견준 차는 「같다」에 넣지 않는다.**
 * ⚠ 예전엔 넣었다. 그래서 돈 열이 통째로 빈 차가 그대로 «100% 일치»의 분자에 들어갔다 —
 *   감사가 「전부 맞다」고 말하는데 정작 그 차는 영업자 화면에서 요금이 비어 있었다
 *   (실측 2026-08-14 · 아이카 1대 · 웰릭스 1대). 못 견준 것은 «모름»이지 «맞음»이 아니다.
 */
const blank: string[] = [];
for (const [pl, sup] of supplierRows) {
  const sale = sales.get(pl);
  if (!sale) { onlySheet++; continue; }
  matched++;
  let ok = true;
  let compared = 0;
  for (const [col, sheetVal] of Object.entries(sup.money)) {
    const saleVal = S(sale[col]);
    // 한쪽이 비면 «어긋남»으로 세지 않는다 — 없는 값과 틀린 값은 다른 문제다.
    if (!sheetVal || !saleVal) continue;
    compared++;
    if (sheetVal !== saleVal) { ok = false; diffs.push({ plate: pl, sup: sup.name, col, sheet: sheetVal, sale: saleVal }); }
  }
  if (!compared) { blank.push(`${pl} (${sup.name})`); continue; }
  if (ok) sameAll++;
}
for (const pl of sales.keys()) if (!supplierRows.has(pl)) onlySale++;

const fmt = (n: string) => Number(n).toLocaleString('ko-KR');
console.log(`■ 결과`);
console.log(`   양쪽에 다 있는 차        ${matched}대`);
const judged = matched - blank.length;
console.log(`     └ 돈이 전부 같음       ${sameAll}대  (${judged ? (sameAll / judged * 100).toFixed(1) : 0}% · 견준 ${judged}대 기준)`);
console.log(`     └ 어긋난 칸            ${diffs.length}칸 · 차 ${new Set(diffs.map((d) => d.plate)).size}대`);
console.log(`     └ 한 칸도 못 견줌       ${blank.length}대  ← 돈이 양쪽 다 비었다. «맞음»이 아니라 «모름»이다`);
for (const b of blank.slice(0, 10)) console.log(`          ${b}`);
console.log(`   공급사시트에만 있는 차    ${onlySheet}대`);
console.log(`   판매리스트에만 있는 차    ${onlySale}대`);

if (diffs.length) {
  const bySup = new Map<string, Diff[]>();
  for (const d of diffs) (bySup.get(d.sup) || bySup.set(d.sup, []).get(d.sup)!).push(d);
  console.log(`\n■ 어긋난 자리 — 공급사시트가 정본이다`);
  for (const [sup, xs] of [...bySup].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ── ${sup} ${xs.length}칸 · 차 ${new Set(xs.map((x) => x.plate)).size}대`);
    for (const d of (LIST ? xs : xs.slice(0, 6))) {
      console.log(`     ${d.plate.padEnd(10)} ${d.col.padEnd(6)} 시트 ${fmt(d.sheet).padStart(11)}  ≠  표 ${fmt(d.sale).padStart(11)}`);
    }
    if (!LIST && xs.length > 6) console.log(`     … 그 밖 ${xs.length - 6}칸 (--list 로 전부)`);
  }
}
