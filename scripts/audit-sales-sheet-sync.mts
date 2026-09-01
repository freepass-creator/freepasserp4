/** 판매시트 3탭 → ERP 반영 예정 diff 검수. 외부 write 없음. */
import nextEnv from '@next/env';
import { planDailySheetSync } from '../lib/domain/sheet-daily-sync';
import { findSheetSyncExistingConflicts } from '../lib/domain/sheet-sync-all';
import { applySheetConflictResolutions } from '../lib/domain/sheet-conflict-resolution';
import { buildPriceChangesValue } from '../lib/domain/sheet-conflict-report';

nextEnv.loadEnvConfig(process.cwd());
process.env.NEXT_PUBLIC_DATA_BACKEND = 'rtdb';

const [{ firebaseAdminDatabase }, { fetchSalesInventorySheet }, {
  readContracts,
  readPartners,
  readProducts,
  readResolutions,
}] = await Promise.all([
  import('../lib/server/firebase-admin'),
  import('../lib/server/sales-inventory-sheet'),
  import('../lib/server/sheet-daily-sync'),
]);

const S = (value: unknown) => String(value ?? '').trim();
const companyId = S(process.env.SHEET_SYNC_COMPANY_ID || 'freepass');
const db = firebaseAdminDatabase();
const [partners, erpState, contracts, resolutions] = await Promise.all([
  readPartners(db, companyId),
  readProducts(db, companyId),
  readContracts(db, companyId),
  readResolutions(db),
]);
const { active, deleted } = erpState;
const fetched = await fetchSalesInventorySheet({ partners });
const plan = planDailySheetSync({ fetched, existing: active, deleted, partners, contracts, resolutions });
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
  resolutions,
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
  resolutions,
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
    unownedDeletedMatches: remainingConflicts.unownedDeletedMatches,
    deletedCollisions: remainingConflicts.deletedCollisions,
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

// Firebase Admin 소켓이 열린 채 남으면 Windows에서 감사 명령이 결과를 출력하고도 끝나지 않는다.
const { deleteApp, getApps } = await import('firebase-admin/app');
await Promise.all(getApps().map((app) => deleteApp(app)));
const repeatFailed = !!secondPlan && (!secondPlan.ok
  || secondPlan.counts.created > 0
  || secondPlan.counts.updated > 0);
if (!plan.ok || repeatFailed) process.exitCode = 2;
