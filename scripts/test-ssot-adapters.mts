import assert from 'node:assert/strict';
import { iankaAdapter } from '../lib/adapters/ianka';
import { ironAdapter } from '../lib/adapters/iron';
import { getSupplierAdapter, hasSupplierAdapter } from '../lib/adapters';
import { evaluateEligibility } from '../lib/domain/product-eligibility';

const ianka5709 = {
  차량번호: '133호5709',
  배차상태: '출고가능',
  제조사: '기아',
  모델: '카니발',
  단기보증: '500,000',
  '1개월': '1,170,000',
  '6개월': '1,140,000',
  '12개월': '1,110,000',
  장기보증: '2,500,000',
  '24개월': '1,080,000',
  '36개월': '1,050,000',
  '48개월': '1,020,000',
  '60개월': '990,000',
};

const got = iankaAdapter.adapt(ianka5709, {
  spreadsheetId: '1fJuFSdaW559niD0ow7vVC3qcgjy8KRb8Cr3U8Of01vs',
  tab: '이안카',
  row: 1,
});

assert.equal(got.atom.plateNumber, '133호5709');
assert.equal(got.atom.shortDeposit, 500_000, '단기보증은 장기보증으로 바뀌면 안 된다');
assert.equal(got.atom.longDeposit, 2_500_000);
assert.equal(got.atom.rent[1], 1_170_000);
assert.equal(got.atom.rent[6], 1_140_000, '6개월도 정식 판매기간이다');
assert.equal(got.atom.rent[12], 1_110_000);
assert.equal(got.atom.rent[24], 1_080_000);
assert.equal(got.atom.rent[36], 1_050_000);
assert.equal(got.atom.rent[48], 1_020_000);
assert.equal(got.atom.rent[60], 990_000);
assert.equal(got.atom.provenance.shortDeposit.sourceHeader, '단기보증');
assert.equal(got.atom.provenance.longDeposit.sourceHeader, '장기보증');
assert.equal(evaluateEligibility(got.atom, 'ATOM').eligible, true);
assert.equal(evaluateEligibility(got.atom, 'F01').eligible, true);

// 아이언 실제 '재고' 스키마 회귀 fixture.
// 원본에는 6개월 열이 없으므로 어댑터가 다른 기간값을 6개월로 추정하면 안 된다.
const iron2330 = ironAdapter.adapt({
  차량번호: '151호2330',
  상태: '즉시출고',
  분류: '신차렌트',
  제조사: '현대',
  모델명: '싼타페',
  '차명(세부모델+트림)': '싼타페 하이브리드 2WD H-PICK 5인승',
  연료: '하이브리드',
  배기량: '1,600',
  장기보증: '4,000,000',
  '36개월': '980,000',
  '48개월': '900,000',
  '60개월': '850,000',
  '72개월': '750,000',
}, {
  spreadsheetId: '1Xm7Nl6yK7DcPQPF6w2OI_0-sphWHFVt2u6IKrYT8S4U',
  tab: '재고',
  row: 12,
});
assert.equal(iron2330.atom.plateNumber, '151호2330');
assert.equal(iron2330.atom.status, '즉시출고');
assert.equal(iron2330.atom.longDeposit, 4_000_000);
assert.equal(iron2330.atom.rent[6], undefined, '원본에 없는 6개월은 생성하지 않는다');
assert.equal(iron2330.atom.rent[24], undefined, '원본에 없는 24개월은 생성하지 않는다');
assert.equal(iron2330.atom.rent[36], 980_000);
assert.equal(iron2330.atom.rent[48], 900_000);
assert.equal(iron2330.atom.rent[60], 850_000);
assert.equal(iron2330.atom.rent[12], undefined);
assert.equal(evaluateEligibility(iron2330.atom, 'F01').eligible, true);
assert.equal(hasSupplierAdapter('IRON'), true);
assert.equal(getSupplierAdapter('iron').adapterName, 'IronAdapter');

const noRent = iankaAdapter.adapt({
  차량번호: '123가4567',
  배차상태: '출고가능',
  모델: '테스트차량',
});
assert.equal(evaluateEligibility(noRent.atom, 'ATOM').eligible, true, 'SSOT에는 실제 차량을 보존한다');
assert.deepEqual(evaluateEligibility(noRent.atom, 'F01'), {
  eligible: false,
  reasons: ['RENT_MISSING'],
});

const ambiguousStatus = iankaAdapter.adapt({
  차량번호: '123가4568',
  배차상태: '확인중',
  모델: '테스트차량',
  '12개월': '900,000',
});
assert.equal(evaluateEligibility(ambiguousStatus.atom, 'ATOM').eligible, true);
assert.deepEqual(evaluateEligibility(ambiguousStatus.atom, 'F01'), {
  eligible: false,
  reasons: ['STATUS_NOT_EXPLICITLY_SELLABLE'],
});

const unavailable = iankaAdapter.adapt({
  차량번호: '123가4569',
  배차상태: '출고불가',
  모델: '테스트차량',
  '12개월': '900,000',
});
assert.equal(evaluateEligibility(unavailable.atom, 'F01').eligible, false);
assert.ok(evaluateEligibility(unavailable.atom, 'F01').reasons.includes('STATUS_NOT_EXPLICITLY_SELLABLE'));

console.log('SSOT adapter/eligibility regression tests: OK');
