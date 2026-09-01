/** 판매용 Google Sheet 3개 탭 → ERP 차량상태 전용 계획 검수. 외부 write 없음. */
import { planSheetLiveStatusSync } from '../lib/domain/sheet-live-status';
import type { EntityRecord } from '../lib/intake/entities';
import { fetchSalesInventorySheet } from '../lib/server/sales-inventory-sheet';
import { mergeNodes, snapshot } from './lib/db-snapshot.mts';

const S = (value: unknown) => String(value ?? '').trim();
const snap = await snapshot({ refresh: process.argv.includes('--refresh') });
const partners = Object.values(mergeNodes(snap.partners, snap.v4Partners)) as EntityRecord[];
const existing = Object.entries(snap.v4Products || {})
  .map(([key, row]) => ({ ...row, _key: key }))
  .filter((row) => row._deleted !== true && !row.deletedAt && S(row.status) !== 'deleted') as EntityRecord[];
const fetched = await fetchSalesInventorySheet({ partners });
const plan = planSheetLiveStatusSync({ fetched, existing, partners });
const samples = plan.patches.slice(0, 20).map((item) => ({
  key: item.key,
  plate: S(item.expected.car_number),
  from: S(item.expected.vehicle_status),
  to: S(item.patch.vehicle_status || item.expected.vehicle_status),
  reason: S(item.patch.sheet_block_reason),
}));
const fields = new Set(plan.patches.flatMap((item) => Object.keys(item.patch)));

console.log(JSON.stringify({
  source: {
    tabs: 3,
    rows: fetched.lines.reduce((sum, line) => sum + line.sourceRowCount, 0),
    imported: fetched.products.length,
    excluded: fetched.lines.reduce((sum, line) => sum + line.excludedCount, 0),
    providers: fetched.lines.length,
  },
  erp: { active: existing.length },
  plan: {
    ok: plan.ok,
    blockReason: plan.blockReason,
    counts: plan.counts,
    patchFields: [...fields].sort(),
    samples,
  },
}, null, 2));

const { deleteApp, getApps } = await import('firebase-admin/app');
await Promise.all(getApps().map((app) => deleteApp(app)));
if (!plan.ok) process.exitCode = 2;

