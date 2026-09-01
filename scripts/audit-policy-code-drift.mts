/**
 * **정책코드 — 판매시트와 ERP 가 어디서 갈렸나.** 읽기 전용. 아무것도 안 고친다.
 *
 * ★왜 만들었나(2026-08-30): `audit-sheet-erp-parity` 가 「정책코드 불일치 391대」라고 하는데,
 *   그 감사기는 판매시트에서 **「정책코드」라는 이름의 열**을 찾는다. 실제 판매시트의 열 이름은
 *   **「정책UID」**(숨김 열)다 — 없는 이름을 찾으니 391대가 전부 «판매시트 빈칸»으로 읽혔다.
 *   그래서 «진짜 값»을 나란히 놓고 보는 자를 따로 만든다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/audit-policy-code-drift.mts
 */
import nextEnv from '@next/env';
import { mkdirSync, writeFileSync } from 'node:fs';
import { inventoryPlate } from '../lib/domain/sheet-inventory-identity';

nextEnv.loadEnvConfig(process.cwd());
process.env.NEXT_PUBLIC_DATA_BACKEND = 'rtdb';

const [{ firebaseAdminDatabase }, { fetchSalesInventorySheet }, { readProducts, readPartners }] = await Promise.all([
  import('../lib/server/firebase-admin'),
  import('../lib/server/sales-inventory-sheet'),
  import('../lib/server/sheet-daily-sync'),
]);

const S = (v: unknown) => String(v ?? '').trim();
const mask = (p: string) => (p.length <= 4 ? '****' : `${p.slice(0, -4)}****`);
const companyId = S(process.env.SHEET_SYNC_COMPANY_ID || 'freepass');

const db = firebaseAdminDatabase();
const partners = await readPartners(db, companyId);
const [products, sales] = await Promise.all([
  readProducts(db, companyId),
  fetchSalesInventorySheet({ partners }),
]);

/** 판매시트 쪽 정책 값 — 열 이름이 갈릴 수 있으니 셋 다 본다. */
const salesPolicy = new Map<string, { value: string; column: string; tab: string }>();
for (const row of sales.products as Record<string, unknown>[]) {
  const plate = inventoryPlate(row.car_number || row.차량번호);
  if (!plate) continue;
  for (const column of ['정책UID', '정책코드', 'policy_code'] as const) {
    const value = S((row as Record<string, unknown>)[column]);
    if (value) { salesPolicy.set(plate, { value, column, tab: S(row.sheet_source_tab).split(' ')[0] }); break; }
  }
  if (!salesPolicy.has(plate)) salesPolicy.set(plate, { value: '', column: '(없음)', tab: S(row.sheet_source_tab).split(' ')[0] });
}

type Row = { plate: string; provider: string; tab: string; sheet: string; sheetColumn: string; erp: string };
const rows: Row[] = [];
for (const p of products.active as unknown as Record<string, unknown>[]) {
  const plate = inventoryPlate(p.car_number || p.car_number_snapshot);
  if (!plate) continue;
  const erp = S(p.policy_code);
  const s = salesPolicy.get(plate);
  if (!s) continue;                       // 판매시트에 없는 차는 이 자의 몫이 아니다
  if (erp === s.value) continue;          // 같으면 볼 것 없다
  rows.push({ plate, provider: S(p.provider_company_code), tab: s.tab, sheet: s.value, sheetColumn: s.column, erp });
}

const tally = (pick: (r: Row) => string) => {
  const out: Record<string, number> = {};
  for (const r of rows) out[pick(r) || '(빈칸)'] = (out[pick(r) || '(빈칸)'] || 0) + 1;
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
};
const show = (title: string, pairs: [string, number][]) => {
  console.log(`\n■ ${title}`);
  for (const [k, v] of pairs) console.log(`   ${String(v).padStart(4)}대  ${k}`);
};

console.log(`■ 판매시트 ${sales.products.length}행 · ERP 활성 상품 ${products.active.length}건`);
console.log(`■ 정책코드가 다른 차 ${rows.length}대`);
show('판매시트가 실제로 값을 담고 있는 열', tally((r) => r.sheetColumn));
show('어디서 → 어디로 (판매시트 값 → ERP 값)', tally((r) => `${r.sheet || '(빈칸)'}  →  ${r.erp || '(빈칸)'}`));
show('탭별', tally((r) => r.tab));
show('공급사별', tally((r) => r.provider));

console.log('\n■ 보기 (앞 12대)');
for (const r of rows.slice(0, 12)) {
  console.log(`   ${mask(r.plate)} ${r.provider.padEnd(8)} ${r.tab.padEnd(6)} 판매시트[${r.sheetColumn}]=「${r.sheet}」 → ERP=「${r.erp}」`);
}

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/policy-code-drift.json', JSON.stringify({ at: new Date().toISOString(), 총: rows.length, rows }, null, 1));
console.log('\n기록 tmp/policy-code-drift.json · 여기서 고치지 않는다 — 보여만 준다');
