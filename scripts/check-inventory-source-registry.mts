import assert from 'node:assert/strict';
import { INVENTORY_SOURCES, getInventorySource, getPolicySource, inventorySourceLocationCount, matchesSharedSourceTab, policySourceLocationCount } from '../lib/domain/inventory-source-registry';
import { sheetsServiceAccountEmail } from '../lib/server/google-sheets';
import { readErp5InventoryServiceAccount } from '../lib/server/erp5-inventory-service-account';
import { sonokongDepositNote, sonokongErpRentalDeposit, sonokongProductClassification, sonokongProductKind, sonokongSalesGroup } from '../lib/domain/sonokong-product-kind';
import { hasDepositRuleViolation } from '../lib/domain/inventory-contract';
import { directSourceStatusBase } from '../lib/domain/direct-source-status';
import { resolveStatus } from '../lib/domain/atom-status';

assert.equal(INVENTORY_SOURCES.length, 24, '현재 연동 공급사 코드는 24개여야 한다');
assert.equal(inventorySourceLocationCount(), 21, '공유 시트를 합친 1차 원천 위치는 21곳이어야 한다');
assert.equal(new Set(INVENTORY_SOURCES.map((v) => v.partnerCode)).size, 24, '공급사 코드는 중복될 수 없다');
assert.equal(getInventorySource('RP006').sourceUrl, 'https://www.ironrentcar.com');
assert.equal(getInventorySource('RP023').sourceUrl, 'https://www.reborncar.co.kr');
assert.equal(getInventorySource('RP012').kind, 'erp_api');
assert.deepEqual(getInventorySource('RP012').channels, ['LOW_SONOKONG_DAILY', 'LOW_SONOKONG', 'LOW_TCAR']);
assert.equal(sonokongProductKind({ sourceBucket: 'LOW_SONOKONG_DAILY', responseBucket: 'SON_NO_KONG' }), '중고렌트');
assert.equal(sonokongProductKind({ sourceBucket: 'LOW_SONOKONG', responseBucket: 'SON_NO_KONG' }), '오공구독');
assert.equal(sonokongProductKind({ sourceBucket: 'LOW_TCAR', responseBucket: 'TCAR_EXTERNAL' }), '픽업구독');
assert.equal(sonokongErpRentalDeposit({ sourceBucket: 'LOW_SONOKONG_DAILY', estimateType: 'RENT_RETURN', deposits: { RENT_RETURN: 1750000 } }), 1750000, '중고렌트는 ERP 보증금 원문을 그대로 쓴다');
assert.equal(sonokongErpRentalDeposit({ sourceBucket: 'LOW_SONOKONG', estimateType: 'RENT_RETURN', deposits: { RENT_RETURN: 1750000 } }), null, '구독 버킷에 중고렌트 ERP 보증금을 섞지 않는다');
assert.equal(sonokongErpRentalDeposit({ sourceBucket: 'LOW_SONOKONG_DAILY', estimateType: 'RENT_BUYOUT', deposits: { RENT_BUYOUT: '1234567' } }), 1234567, 'ERP 보증금은 천원 반올림하지 않는다');
assert.equal(sonokongDepositNote({ sourceBucket: 'LOW_SONOKONG_DAILY' }), '', '중고렌트에 구독 보증금 규칙을 싣지 않는다');
assert.equal(sonokongDepositNote({ sourceBucket: 'LOW_SONOKONG' }), '월 대여료 × 약정연수 (최대 3개월)', '오공구독은 규칙 문구를 유지한다');
assert.equal(hasDepositRuleViolation({ product_type: '중고렌트', deposit_note: '월 대여료 × 약정연수 (최대 3개월)', price: { '36': { deposit: 1234567 } } }), false, '과거 규칙 문구가 남아도 중고렌트 ERP 숫자를 막지 않는다');
assert.equal(hasDepositRuleViolation({ product_type: '오공구독', deposit_note: '월 대여료 × 약정연수 (최대 3개월)', price: { '36': { deposit: 1234567 } } }), true, '구독 규칙 문구와 숫자 보증금의 모순은 막는다');
assert.deepEqual(sonokongProductClassification({ sourceBucket: 'LOW_SONOKONG_DAILY', responseBucket: 'SON_NO_KONG' }), {
  schema: 'sonokong-product-v1', source_bucket: 'LOW_SONOKONG_DAILY', response_bucket: 'SON_NO_KONG', product_type: '중고렌트', sales_group: '손오공상품',
});
assert.deepEqual(sonokongProductClassification({ sourceBucket: 'LOW_SONOKONG', responseBucket: 'SON_NO_KONG' }), {
  schema: 'sonokong-product-v1', source_bucket: 'LOW_SONOKONG', response_bucket: 'SON_NO_KONG', product_type: '오공구독', sales_group: '손오공상품',
});
assert.deepEqual(sonokongProductClassification({ sourceBucket: 'LOW_TCAR', responseBucket: 'TCAR_EXTERNAL' }), {
  schema: 'sonokong-product-v1', source_bucket: 'LOW_TCAR', response_bucket: 'TCAR_EXTERNAL', product_type: '픽업구독', sales_group: '픽업구독',
});
assert.equal(sonokongSalesGroup({ product_type: '중고렌트', sonokong_classification: sonokongProductClassification({ sourceBucket: 'LOW_TCAR' }) }), '픽업구독', '명시 Firestore 분류가 과거 product_type 추정보다 우선한다');
assert.equal(sonokongSalesGroup({ product_type: '픽업구독', sonokong_classification: { schema: 'sonokong-product-v1', source_bucket: '', response_bucket: '', product_type: '', sales_group: '' } }), '픽업구독', '빈 명시 분류는 과거 product_type 하위호환을 막지 않는다');
assert.equal(directSourceStatusBase('계약중', 'sonokong'), '계약중');
assert.equal(directSourceStatusBase('계약중', 'sheet'), '출고불가');
assert.equal(resolveStatus({ base: directSourceStatusBase('계약중', 'sonokong'), raw: '계약중' }).listable, true);
assert.equal(getInventorySource('RP004').spreadsheetId, '1LqWVs2o1-wpPqFiYkOjcQldmIXqtBMKYp0A1SKEir5w');
assert.equal(getInventorySource('RP031').spreadsheetId, '1fJuFSdaW559niD0ow7vVC3qcgjy8KRb8Cr3U8Of01vs');
assert.equal(INVENTORY_SOURCES.filter((source) => source.kind === 'google_sheet').length, 21);
assert.equal(new Set(INVENTORY_SOURCES.filter((source) => source.kind === 'google_sheet').map((source) => source.spreadsheetId)).size, 18);
assert.equal(policySourceLocationCount(), 21, '공유 시트를 합친 정책 원천 위치는 21곳이어야 한다');
assert.equal(getPolicySource('RP004').spreadsheetId, '1-2ptJgwzPBVgDWMkyedjtVxcSXrNtepEQM0YgAVpYtI');
assert.equal(getPolicySource('RP006').spreadsheetId, '1Xm7Nl6yK7DcPQPF6w2OI_0-sphWHFVt2u6IKrYT8S4U');
assert.equal(getPolicySource('RP012').spreadsheetId, '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA');
assert.equal(getPolicySource('RP023').spreadsheetId, '1Tvd5IioF5y_yu3L1BQMRP4J1R8hcZHwkgl3vl-TsgY0');
assert.equal(getPolicySource('RP031').spreadsheetId, '1r1EP4oMP9V2iV-G5Q3nNNBHW7ttLMNycipFkfccHvOA');
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

const beforeErp5 = process.env.ERP5_FIREBASE_SERVICE_ACCOUNT_JSON;
try {
  process.env.ERP5_FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'freepasserp3', client_email: 'wrong@example.invalid', private_key: 'wrong' });
  assert.throws(() => readErp5InventoryServiceAccount(), /필수: freepasserp5/, 'ERP3 자격증명을 원천 writer가 받아들이면 안 된다');
  process.env.ERP5_FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'freepasserp5', client_email: 'erp5@example.invalid', private_key: 'key' });
  assert.equal(readErp5InventoryServiceAccount().project_id, 'freepasserp5');
} finally {
  if (beforeErp5 === undefined) delete process.env.ERP5_FIREBASE_SERVICE_ACCOUNT_JSON;
  else process.env.ERP5_FIREBASE_SERVICE_ACCOUNT_JSON = beforeErp5;
}

console.log(`inventory source registry: providers=${INVENTORY_SOURCES.length} inventory_locations=${inventorySourceLocationCount()} policy_locations=${policySourceLocationCount()} PASS`);
