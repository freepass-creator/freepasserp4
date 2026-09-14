import assert from 'node:assert/strict';
import { INVENTORY_SOURCES, getInventorySource, inventorySourceLocationCount, matchesSharedSourceTab } from '../lib/domain/inventory-source-registry';
import { createInventorySourceSnapshot } from '../lib/domain/inventory-source-snapshot';
import { isContractLocked, sourceExitPatch, sourceSnapshotSafeToRetire } from '../lib/domain/inventory-retirement';
import { SUPPLIER_SOURCES } from '../lib/adapters/source-registry';
import { sheetsServiceAccountEmail } from '../lib/server/google-sheets';

assert.equal(INVENTORY_SOURCES.length, 24, '현재 연동 공급사 코드는 24개여야 한다');
assert.equal(inventorySourceLocationCount(), 21, '공유 시트를 합친 1차 원천 위치는 21곳이어야 한다');
assert.equal(new Set(INVENTORY_SOURCES.map((v) => v.partnerCode)).size, 24, '공급사 코드는 중복될 수 없다');
assert.equal(getInventorySource('RP006').sourceUrl, 'https://www.ironrentcar.com');
assert.equal(getInventorySource('RP023').sourceUrl, 'https://www.reborncar.co.kr');
assert.equal(getInventorySource('RP012').kind, 'erp_api');
assert.equal(getInventorySource('RP004').spreadsheetId, '1LqWVs2o1-wpPqFiYkOjcQldmIXqtBMKYp0A1SKEir5w');
assert.equal(getInventorySource('RP031').spreadsheetId, '1fJuFSdaW559niD0ow7vVC3qcgjy8KRb8Cr3U8Of01vs');
assert.equal(INVENTORY_SOURCES.filter((source) => source.kind === 'google_sheet').length, 21);
assert.equal(new Set(INVENTORY_SOURCES.filter((source) => source.kind === 'google_sheet').map((source) => source.spreadsheetId)).size, 18);
assert.equal(matchesSharedSourceTab('경진렌트카', '경진렌트카 재고'), true);
assert.equal(matchesSharedSourceTab('경진렌트카', '경진카 재고'), false);
assert.equal(matchesSharedSourceTab('스카이렌트카', '스타 재고'), false);

for (const source of INVENTORY_SOURCES) {
  assert.ok(source.sourceUrl, `${source.partnerCode}: 원천 URL 누락`);
  assert.ok(source.adapterId, `${source.partnerCode}: 어댑터 누락`);
  if (source.kind === 'google_sheet') assert.ok(source.spreadsheetId, `${source.partnerCode}: 시트 ID 누락`);
  if (source.kind !== 'google_sheet') assert.equal(source.spreadsheetId, undefined, `${source.partnerCode}: 홈페이지/API를 시트로 가장하면 안 된다`);
}

const first = createInventorySourceSnapshot({ partnerCode: 'RP004', carNumber: '12가3456', sourceUrl: 'sheet', sourceLocation: '재고', sourceRecordId: '2', raw: { b: 2, a: 1 } });
const second = createInventorySourceSnapshot({ partnerCode: 'RP004', carNumber: '12가3456', sourceUrl: 'sheet', sourceLocation: '재고', sourceRecordId: '2', raw: { a: 1, b: 2 } });
assert.equal(first.source_revision, second.source_revision, '원문 키 순서만 달라져도 같은 revision이어야 한다');
assert.equal(JSON.parse(first.raw_payload).a, 1, '원문 전체를 JSON으로 복원할 수 있어야 한다');
const moved = createInventorySourceSnapshot({ partnerCode: 'RP004', carNumber: '12가3456', sourceUrl: 'sheet', sourceLocation: '재고', sourceRecordId: '3', raw: { a: 1, b: 2 } });
assert.notEqual(first.source_revision, moved.source_revision, '같은 원문도 원천 행이 이동하면 새 provenance revision이어야 한다');
assert.deepEqual(sourceExitPatch(1), { listable: false, vehicle_status: '출고불가', status: '출고불가', status_kind: '불가', status_reason: '원천 이탈(직접수집)', _direct_ingest_at: 1 });
assert.equal(sourceSnapshotSafeToRetire(49, 100), false);
assert.equal(sourceSnapshotSafeToRetire(50, 100), true);
assert.equal(isContractLocked({ status: '계약중' }), true);
for (const adapterInput of SUPPLIER_SOURCES) {
  const source = getInventorySource(adapterInput.partnerCode);
  assert.equal(adapterInput.sourceUrl, source.sourceUrl);
  assert.equal(adapterInput.sourceKind, source.kind);
  if (source.kind !== 'google_sheet') assert.equal(adapterInput.spreadsheetRole, 'PROJECTION', `${source.partnerCode}: 홈페이지/API의 보조 시트는 PROJECTION이어야 한다`);
}

const beforeSheets = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
const beforeFirebase = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
try {
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'firebase@example.invalid', private_key: 'firebase-key' });
  process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'sheets@example.invalid', private_key: 'sheets-key' });
  assert.equal(sheetsServiceAccountEmail(), 'sheets@example.invalid', 'Sheets 전용 자격증명이 Firebase 자격증명보다 우선해야 한다');
} finally {
  if (beforeSheets === undefined) delete process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
  else process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = beforeSheets;
  if (beforeFirebase === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = beforeFirebase;
}

console.log(`inventory source registry: providers=${INVENTORY_SOURCES.length} locations=${inventorySourceLocationCount()} PASS`);
