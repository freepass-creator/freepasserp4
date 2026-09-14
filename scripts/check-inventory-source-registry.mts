import assert from 'node:assert/strict';
import { INVENTORY_SOURCES, getInventorySource, inventorySourceLocationCount, matchesSharedSourceTab } from '../lib/domain/inventory-source-registry';
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
