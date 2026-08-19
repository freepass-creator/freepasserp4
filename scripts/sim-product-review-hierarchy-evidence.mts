import assert from 'node:assert/strict';
import { productReviewHierarchyEvidenceOverride } from '../lib/domain/product-review-hierarchy-evidence';

const bmw = {
  maker: 'BMW', model: '5시리즈', subModel: '5시리즈 G60', rawTrim: '',
  supplierName: 'BMW · 준대형 · 520i M Spt · 가솔린 · 배기 1,999 · 최초등록 25-3-20',
  fuel: '가솔린', engineCc: 1999, drive: '', registrationMonth: '2025-03',
};
assert.deepEqual(productReviewHierarchyEvidenceOverride(bmw), {
  ruleId: 'bmw_g60_520i_m_spt', sourcePhrase: '520i M Spt',
  targetSubModel: '5시리즈 G60', targetTrim: '520i M 스포츠',
});
assert.equal(productReviewHierarchyEvidenceOverride({ ...bmw, subModel: '5시리즈 G30' }), null);
assert.equal(productReviewHierarchyEvidenceOverride({ ...bmw, rawTrim: 'E34' }), null);
assert.equal(productReviewHierarchyEvidenceOverride({ ...bmw, rawTrim: '520i 럭셔리' }), null);
assert.equal(productReviewHierarchyEvidenceOverride({ ...bmw, engineCc: 2998 }), null);

const tesla = {
  maker: '테슬라', model: '모델 3', subModel: '모델 3', rawTrim: 'Premium',
  supplierName: '테슬라 모델3 Long Range Premium · 준중형 · EV · 배기 239 · 최초등록 26-4-8',
  fuel: '전기', engineCc: 239, drive: 'AWD', registrationMonth: '2026-04',
};
assert.deepEqual(productReviewHierarchyEvidenceOverride(tesla), {
  ruleId: 'tesla_model3_pre_2026_07_long_range_awd', sourcePhrase: '모델3 Long Range Premium',
  targetSubModel: '모델 3 FL', targetTrim: 'Long Range',
  ignoredSourceAxes: ['engine_cc', 'drive'],
});
assert.deepEqual(productReviewHierarchyEvidenceOverride({ ...tesla, drive: '' }), {
  ruleId: 'tesla_model3_pre_2026_07_long_range_awd', sourcePhrase: '모델3 Long Range Premium',
  targetSubModel: '모델 3 FL', targetTrim: 'Long Range', ignoredSourceAxes: ['engine_cc', 'drive'],
});
assert.equal(productReviewHierarchyEvidenceOverride({ ...tesla, registrationMonth: '2026-07' }), null);
assert.equal(productReviewHierarchyEvidenceOverride({
  ...tesla, supplierName: '테슬라 모델3 Premium Long Range · EV · AWD',
}), null);
assert.equal(productReviewHierarchyEvidenceOverride({ ...tesla, rawTrim: '' }), null);

console.log('PASS product review hierarchy evidence — two scoped recoveries and unsafe boundaries blocked');
