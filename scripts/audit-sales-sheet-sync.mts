/** 영업자 상품리스트 → ERP 계획 검수. 외부 write 없음. */
import { readFileSync } from 'node:fs';
import { fetchSalesInventorySheet } from '../lib/server/sales-inventory-sheet';
import { planDailySheetSync } from '../lib/domain/sheet-daily-sync';
import { findSheetSyncExistingConflicts } from '../lib/domain/sheet-sync-all';
import { applySheetConflictResolutions } from '../lib/domain/sheet-conflict-resolution';
import { buildPriceChangesValue } from '../lib/domain/sheet-conflict-report';
import type { EntityRecord } from '../lib/intake/entities';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import { mergeNodes, snapshot } from './lib/db-snapshot.mts';

const S = (value: unknown) => String(value ?? '').trim();
const snap = await snapshot({ refresh: process.argv.includes('--refresh') });
const partners = Object.values(mergeNodes(snap.partners, snap.v4Partners)) as EntityRecord[];
const allProducts = Object.entries(snap.v4Products || {}).map(([key, row]) => ({ ...row, _key: key })) as EntityRecord[];
const active = allProducts.filter((row) => row._deleted !== true && !row.deletedAt && S(row.status) !== 'deleted');
const deleted = allProducts.filter((row) => row._deleted === true || !!row.deletedAt || S(row.status) === 'deleted');
const contracts = Object.values(mergeNodes(snap.contracts, snap.v4Contracts)) as EntityRecord[];
const raw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
const entries = Array.isArray(raw) ? raw : raw.entries || [];
const fetched = await fetchSalesInventorySheet({ partners, entries });
const plan = planDailySheetSync({ fetched, existing: active, deleted, partners, contracts, resolutions: [] });
const conflicts = findSheetSyncExistingConflicts(fetched, active, deleted);
const remainingConflicts = applySheetConflictResolutions({
  conflicts,
  priceChangesValue: buildPriceChangesValue({
    conflicts,
    existing: active,
    deleted,
    incoming: fetched.products,
    contracts,
    providerCodes: fetched.lines.map((line) => line.code),
  }),
  resolutions: [],
  existing: active,
  contracts,
}).conflicts;
const patchFields = new Map<string, number>();
for (const item of plan.patches) {
  for (const field of Object.keys(item.patch)) patchFields.set(field, (patchFields.get(field) || 0) + 1);
}
const afterByKey = new Map(active.map((row) => [S(row._key || row.product_code), { ...row }]));
for (const item of plan.patches) afterByKey.set(item.key, { ...(afterByKey.get(item.key) || {}), ...item.patch, _key: item.key, product_code: item.key });
for (const row of plan.creates) afterByKey.set(S(row.product_code || row._key), row);
const secondPlan = plan.ok ? planDailySheetSync({
  fetched,
  existing: [...afterByKey.values()],
  deleted,
  partners,
  contracts,
  resolutions: [],
}) : null;

console.log(JSON.stringify({
  source: {
    rows: fetched.lines.reduce((sum, line) => sum + line.sourceRowCount, 0),
    imported: fetched.products.length,
    noPrice: fetched.lines.reduce((sum, line) => sum + line.noPriceCount, 0),
    duplicate: fetched.lines.reduce((sum, line) => sum + line.duplicateCount, 0),
    invalid: fetched.lines.reduce((sum, line) => sum + line.invalidCount, 0),
    providers: fetched.lines.map((line) => ({ code: line.code, name: line.label, count: line.imported })),
  },
  plan: {
    ok: plan.ok,
    blockReason: plan.blockReason,
    counts: plan.counts,
    notes: plan.notes,
    missingPricePeriods: remainingConflicts.missingPricePeriods,
    patchFields: Object.fromEntries([...patchFields].sort((a, b) => b[1] - a[1])),
    repeat: secondPlan ? {
      ok: secondPlan.ok,
      blockReason: secondPlan.blockReason,
      created: secondPlan.counts.created,
      updated: secondPlan.counts.updated,
      unchanged: secondPlan.counts.unchanged,
    } : null,
  },
}, null, 2));

if (!plan.ok) process.exitCode = 2;
