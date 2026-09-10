import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventoryCountSnapshot, isOpenInventoryAtom } from '../lib/domain/inventory-contract';
import { isStockedProduct } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';
import { captureSalesPublishSnapshot, readSalesPublishSnapshot, salesPublishMark } from '../lib/server/sales-publish-snapshot';
import { channelColumnName, salesPublishedColumns } from '../lib/domain/sales-published-tab-columns';

const rows = [
  { car_number: '테스트1', vehicle_status: '출고가능', status_kind: '가용', listable: true, provider_company_code: 'P1', source: 'sheet' },
  { car_number: '테스트2', vehicle_status: '계약중', status_kind: '선점', listable: true, provider_company_code: 'P1', source: 'sheet' },
  { car_number: '테스트3', vehicle_status: '출고협의', status_kind: '협의', listable: true, provider_company_code: 'P1', source: 'sheet' },
  { car_number: '테스트4', vehicle_status: '출고불가', status_kind: '불가', listable: false, provider_company_code: 'P1', source: 'sheet' },
  { car_number: '테스트5', vehicle_status: '', status_kind: '준비', listable: true, provider_company_code: 'P1', source: 'sheet' },
];
const snapshot = inventoryCountSnapshot(rows);
assert.deepEqual(
  { registered: snapshot.registered, unavailable: snapshot.unavailable, open: snapshot.open },
  { registered: 5, unavailable: 1, open: 4 },
);
assert.equal(snapshot.listableDrift, 0);
assert.equal(snapshot.statusKindDrift, 0);
assert.equal(snapshot.sourceIdentityViolations, 0);
assert.equal(snapshot.blankPlateViolations, 0);
assert.equal(snapshot.invalidPlateViolations, 5);
assert.equal(isOpenInventoryAtom({ vehicle_status: ' 출고 불가 ' }), false);
assert.equal(isOpenInventoryAtom({ vehicle_status: '계약중', listable: false }), true);
assert.equal(isStockedProduct({ vehicle_status: '계약중' } as EntityRecord), true);
assert.equal(isStockedProduct({ vehicle_status: '출고가능', price: {} } as EntityRecord), true);
assert.equal(isStockedProduct({ vehicle_status: '출고가능', _deleted: true } as EntityRecord), false);
assert.equal(inventoryCountSnapshot([{ vehicle_status: '출고가능', listable: false }]).listableDrift, 1);
assert.equal(inventoryCountSnapshot([{ vehicle_status: '출고가능', status_kind: '', listable: true, provider_company_code: 'P1', source: 'sheet' }]).statusKindDrift, 1);
assert.equal(inventoryCountSnapshot([{ vehicle_status: '출고가능', status_kind: '가용', listable: true }]).sourceIdentityViolations, 1);
assert.equal(inventoryCountSnapshot([{ vehicle_status: '출고불가', listable: false, _deleted: true }]).deletedMarkerViolations, 1);
assert.equal(inventoryCountSnapshot([{ vehicle_status: '출고가능', listable: true, _deleted: 'true' }]).deletedMarkerViolations, 1);
assert.equal(inventoryCountSnapshot([{ vehicle_status: '출고가능', listable: true, deletedAt: '2026-01-01' }]).deletedMarkerViolations, 1);
assert.equal(inventoryCountSnapshot([{ vehicle_status: '출고가능', listable: true, status: 'deleted' }]).deletedMarkerViolations, 1);
assert.equal(inventoryCountSnapshot([
  { car_number: '12가 3456', vehicle_status: '출고가능', listable: true },
  { car_number: '12가3456', vehicle_status: '출고불가', listable: false },
]).duplicatePlateViolations, 1);
assert.equal(inventoryCountSnapshot([{ car_number: '차량번호아님1', vehicle_status: '출고불가', listable: false }]).invalidPlateViolations, 1);
assert.equal(salesPublishedColumns('상품리스트').length, 69);
for (const tab of ['상품리스트', '손오공구독', '픽업구독', '오플구독']) {
  assert.ok(salesPublishedColumns(tab).includes('옵션(원문)'));
  assert.ok(salesPublishedColumns(tab).includes('세부모델'));
}
assert.equal(channelColumnName('반납형보증금'), '보증금 반납형');

for (const file of [
  'scripts/make-sample-sheet-google.mts',
  'scripts/build-channel-supplier-sheet.mts',
  'scripts/check-sales-publish-context.mts',
  'scripts/audit-sheet-vs-atom.mts',
  'scripts/materialize-product-list-atom.mts',
]) {
  const source = readFileSync(file, 'utf8');
  assert.match(source, /isOpenInventoryAtom/);
  assert.doesNotMatch(source, /filter\(\(v\) => v\.listable === true\)/);
}

const hourly = readFileSync('scripts/hourly-sync.mts', 'utf8');
assert.match(hourly, /sales-publish-snapshots\/\$\{RUN_ID\}\.json/);
assert.match(hourly, /if \(!pub\.ok\) stop/);
assert.match(hourly, /if \(!ch\.ok\) stop/);
assert.match(hourly, /else stop\(parity\.picked/);
assert.match(hourly, /if \(!erp\.ok\) stop/);
assert.match(hourly, /if \(!mir\.ok\) stop/);
assert.match(hourly, /heal-atom-provenance\.mts'.*'--apply'/);
assert.match(hourly, /audit-pipeline-destinations\.mts/);
assert.match(hourly, /publish-origin-tab\.mts'.*\.\.\.STAGE/);
const daily = readFileSync('scripts/run-daily.mts', 'utf8');
assert.match(daily, /publish-origin-tab\.mts'.*\.\.\.STAGE/);
assert.match(daily, /const LOCKDIR = 'tmp\/hourly-sync\.lock'/);
assert.match(daily, /if \(!acquireLock\(\)\) stop/);
assert.match(daily, /HEARTBEAT_STALE_MS/);
assert.match(daily, /renameSync\(LOCKDIR, stale\)/);
assert.match(daily, /heal-atom-provenance\.mts'.*'--apply'/);
assert.match(daily, /audit-pipeline-destinations\.mts/);
for (const workflow of ['.github/workflows/sheet-sync.yml', '.github/workflows/sales-erp-hourly.yml']) {
  assert.match(readFileSync(workflow, 'utf8'), /group: freepass-sales-publish/);
}
for (const file of ['scripts/publish-origin-tab.mts', 'scripts/publish-sonogong-tab.mts']) {
  assert.match(readFileSync(file, 'utf8'), /구형 .* 발행기는 운영 F01을 쓸 수 없다/);
}
const captureSource = readFileSync('scripts/capture-sales-publish-snapshot.mts', 'utf8');
assert.match(captureSource, /flag: 'wx'/);
assert.doesNotMatch(readFileSync('scripts/mirror-to-firestore.mts', 'utf8'), /검수상태 === '원문없음'\) doc\.listable = false/);
assert.match(readFileSync('scripts/heal-atom-status.mts', 'utf8'), /파생값 어긋남/);
const auditSource = readFileSync('scripts/audit-sheet-vs-atom.mts', 'utf8');
assert.match(auditSource, /const EQ = \(a: unknown, b: unknown\) => S\(a\) === S\(b\)/);
assert.match(auditSource, /valueRenderOption=UNFORMATTED_VALUE/);
assert.match(readFileSync('scripts/run-sheet-daily-sync-local.mts', 'utf8'), /APPLY && !sheetArg/);
assert.match(readFileSync('lib/server/sales-inventory-sheet.ts', 'utf8'), /process\.env\.SALES_INVENTORY_SHEET_ID/);
assert.match(auditSource, /title !== expectedTitle/);
assert.match(auditSource, /expectedTitles\.has\(title\)/);
assert.match(auditSource, /found\.company !== expectedCompany/);
assert.match(auditSource, /JSON\.stringify\(hdr\) !== JSON\.stringify\(expectedHeader\)/);
assert.match(auditSource, /f01OrderViolations/);
assert.match(auditSource, /f86OrderViolations/);
assert.match(auditSource, /f01BlankPlateRows/);
assert.match(auditSource, /f86BlankPlateRows/);
assert.match(auditSource, /핵심투영어긋남/);
assert.match(auditSource, /if \(!snapshotPath\) throw/);
assert.doesNotMatch(auditSource, /Number\.POSITIVE_INFINITY/);

const fakeCollections: Record<string, any[]> = {
  products: rows.map((data, index) => ({ id: `p${index + 1}`, data: () => data })),
  policy: [{ id: 'policy1', data: () => ({ name: '정책' }) }],
  partner: [{ id: 'partner1', data: () => ({ name: '공급사' }) }],
};
const fakeDb = {
  collection: (name: string) => ({ name }),
  runTransaction: async (fn: (tx: any) => Promise<any>) => fn({
    get: async (ref: { name: string }) => ({ docs: fakeCollections[ref.name] || [] }),
  }),
};
const captured = await captureSalesPublishSnapshot(fakeDb);
assert.equal(captured.inventory.open, 4);
assert.match(salesPublishMark(captured), /\d{2}\.\d{2} \d{2}:\d{2}:\d{2} · \d{17}-[0-9a-f]{12}/);
const dir = mkdtempSync(join(tmpdir(), 'sales-publish-sim-'));
const path = join(dir, 'snapshot.json');
try {
  writeFileSync(path, JSON.stringify(captured), 'utf8');
  assert.equal(readSalesPublishSnapshot(path).payloadHash, captured.payloadHash);
  const tampered = { ...captured, products: [...captured.products, { _key: 'tampered' }] };
  writeFileSync(path, JSON.stringify(tampered), 'utf8');
  assert.throws(() => readSalesPublishSnapshot(path), /해시 불일치/);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('✓ 재고 계약: 등록 원자 - 출고불가, 계약중·가격미입력 포함, 파생값 드리프트 탐지');
