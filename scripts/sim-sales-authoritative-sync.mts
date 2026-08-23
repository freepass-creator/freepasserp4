/** 판매시트 3탭 → ERP 직접 정본 계약 회귀검사. 외부 read/write 없음. */
import assert from 'node:assert/strict';
import { importSalesInventorySheet } from '../lib/domain/sales-inventory-sheet';
import { planDailySheetSync } from '../lib/domain/sheet-daily-sync';
import { findSheetSyncExistingConflicts } from '../lib/domain/sheet-sync-all';
import { softMergeProduct, stripSheetPrivatePatchFields } from '../lib/domain/sheet-merge';
import type { EntityRecord } from '../lib/intake/entities';

const partners: EntityRecord[] = [{
  _key: 'RP999',
  partner_code: 'RP999',
  name: '테스트렌트',
  partner_type: 'provider',
}];

const header = [
  '차량번호', '상태', '구분', '제조사', '모델', '세부모델', '세부트림',
  '외장', '내장', '연식', '주행거리', '연료', '12개월', '배기량',
  '차종구분', '옵션', '공급사',
];
const row = [
  '109호4733', '출고가능', '중고렌트', '기아', '니로', '니로 SG2', '',
  '흰색', '검정', '2024', '1,234', '하이브리드', '640,000\n1,500,000', '1,580',
  '소형 SUV', '', '테스트렌트',
];

const fetched = importSalesInventorySheet({
  table: [header, row],
  partners,
  tabTitle: '상품리스트',
  tabGid: '1',
});
assert.equal(fetched.sourceKind, 'sales_inventory');
assert.equal(fetched.products.length, 1);
const incoming = fetched.products[0]!;
assert.equal(incoming._sales_sheet_authoritative, true);
assert.equal(incoming.variant, '', '폐지한 파워트레인 축을 다시 만들지 않는다');
assert.equal(incoming.trim_name, '', '판매시트 빈칸을 마스터 추정값으로 채우지 않는다');
assert.equal(incoming.options, '', '판매시트의 빈 옵션도 현재값으로 명시한다');
assert.equal(incoming.engine_cc, '1580');
assert.deepEqual(incoming.price, { '12': { rent: 640000, deposit: 1500000 } });

const existing: EntityRecord = {
  _key: 'RP999_109호4733',
  product_code: 'RP999_109호4733',
  provider_company_code: 'RP999',
  car_number: '109호4733',
  vehicle_status: '출고불가',
  maker: '옛제조사',
  model: '옛모델',
  sub_model: '옛세부모델',
  trim_name: '옛트림',
  variant: '옛파워트레인',
  options: '옛옵션',
  fuel_type: '가솔린',
  engine_cc: '2000',
  _sheet_manual_fields: ['maker', 'trim_name', 'options'],
  price: {
    '12': { rent: 700000, deposit: 2000000 },
    '36': { rent: 500000, deposit: 1000000 },
  },
};

const merged = softMergeProduct(existing, incoming);
assert.equal(merged.vehicle_status, '출고가능', '계약 엔진 락 없는 옛 ERP 상태를 판매시트로 맞춘다');
assert.equal(merged.maker, '기아', '수기 필드 표식보다 판매시트 현재값이 우선한다');
assert.equal(merged.sub_model, '니로 SG2');
assert.equal(merged.trim_name, '', '빈 세부트림이 옛 ERP 트림을 지운다');
assert.equal(merged.variant, '', '옛 파워트레인 잔재를 지운다');
assert.equal(merged.options, '', '빈 옵션이 옛 ERP 옵션을 지운다');
assert.deepEqual(merged.price, { '12': { rent: 640000, deposit: 1500000 } }, '판매시트에 없는 옛 기간은 보존하지 않는다');

const conflicts = findSheetSyncExistingConflicts(fetched, [existing], []);
assert.deepEqual(conflicts.missingPricePeriods, [], '판매시트 직접 정본에는 옛 가격기간 유지 승인을 요구하지 않는다');

const plan = planDailySheetSync({ fetched, existing: [existing], deleted: [], partners });
assert.equal(plan.ok, true, plan.blockReason);
const pricePatch = plan.patches.find((item) => item.key === existing._key)?.patch.price;
assert.deepEqual(pricePatch, { '12': { rent: 640000, deposit: 1500000 } });

const locked = softMergeProduct({
  ...existing,
  vehicle_status: '계약중',
  locked_by_contract: 'CT-TEST',
}, incoming);
assert.equal(locked.vehicle_status, '계약중', '계약 엔진 락만 판매시트 상태보다 우선한다');
assert.equal(locked.model, '니로', '계약 락이어도 차명 현재값은 반영한다');
assert.deepEqual(locked.price, { '12': { rent: 640000, deposit: 1500000 } }, '계약 락이어도 현재 요금은 반영한다');

for (const falseLock of [false, 0, 'false', '0']) {
  const unlocked = softMergeProduct({
    ...existing,
    vehicle_status: '계약중',
    locked_by_contract: falseLock,
  }, incoming);
  assert.equal(unlocked.vehicle_status, '출고가능', `거짓 계약락 값(${String(falseLock)})은 상태를 잠그지 않는다`);
}
assert.equal(softMergeProduct({ ...existing, vehicle_status: '계약중' }, incoming).vehicle_status, '출고가능',
  'locked_by_contract 없는 레거시 계약중은 계약엔진 락으로 추정하지 않는다');

const samePublicWithPrivateFee = stripSheetPrivatePatchFields({
  ...incoming,
  _key: incoming.product_code,
  price: { '12': { rent: 640000, deposit: 1500000, fee: 64000 } },
});
const privateFeePlan = planDailySheetSync({
  fetched,
  existing: [samePublicWithPrivateFee],
  deleted: [],
  partners,
});
assert.equal(privateFeePlan.ok, true, privateFeePlan.blockReason);
assert.equal(privateFeePlan.counts.updated, 0, 'private fee 재병합은 공개 price 반복 패치를 만들지 않는다');

const markerlessRows = fetched.products.map((product) => {
  const copy = { ...product };
  delete copy._sales_sheet_authoritative;
  return copy;
});
const markerless = {
  ...fetched,
  products: markerlessRows,
  lines: fetched.lines.map((line) => ({ ...line, products: markerlessRows })),
};
assert.equal(planDailySheetSync({ fetched: markerless, existing: [], deleted: [], partners }).ok, false,
  '판매시트 권위 표식이 빠지면 soft-merge fallback 전에 커밋을 막는다');

const blankPrice = importSalesInventorySheet({
  table: [header, row.map((value, index) => index === 12 ? '' : value)],
  partners,
  tabTitle: '상품리스트',
  tabGid: '1',
}).products[0]!;
assert.deepEqual(blankPrice.price, {});
assert.deepEqual(softMergeProduct(existing, blankPrice).price, {}, '판매시트 요금 공란은 옛 ERP 요금을 지운다');

const privateStripped = stripSheetPrivatePatchFields({
  ...incoming,
  vehicle_price: '99999999',
  vin: 'PRIVATE',
  account_number: 'PRIVATE',
  price: { '12': { rent: 1, deposit: 2, fee: 3 } },
});
assert.equal(privateStripped._sales_sheet_authoritative, undefined);
assert.equal(privateStripped.vehicle_price, undefined);
assert.equal(privateStripped.vin, undefined);
assert.equal(privateStripped.account_number, undefined);
assert.deepEqual(privateStripped.price, { '12': { rent: 1, deposit: 2 } });

const invalidStatus = importSalesInventorySheet({
  table: [header, row.map((value, index) => index === 1 ? '임의상태' : value)],
  partners,
  tabTitle: '상품리스트',
  tabGid: '1',
});
assert.equal(invalidStatus.lines[0]?.invalidCount, 1);
assert.equal(planDailySheetSync({ fetched: invalidStatus, existing: [], deleted: [], partners }).ok, false);

const excluded = importSalesInventorySheet({
  table: [header, row.map((value, index) => index === 1 ? '출고불가' : value)],
  partners,
  tabTitle: '상품리스트',
  tabGid: '1',
});
assert.equal(excluded.products.length, 0, '출고불가만 제외한다');
assert.equal(excluded.lines[0]?.excludedCount, 1);

console.log('PASS: 판매시트 3탭 직접 정본 · 빈칸/상태/차명/가격/계약락/비공개 경계');
