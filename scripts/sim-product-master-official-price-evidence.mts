import assert from 'node:assert/strict';
import {
  assertFreshProductCoverageReport,
  parseProductCoverageRowSelection,
  productCoveragePostWriteIssues,
  productCoverageRowFingerprint,
  productCoverageSheetFingerprint,
} from '../lib/domain/product-master-coverage-audit';
import {
  decideRayOfficialPriceEvidence,
  normalizedRayOptionTokens,
  RAY_2027_OFFICIAL_PRICE_RULES,
  type ProductCoverageEvidenceRow,
} from '../lib/domain/product-master-official-price-evidence';
import type { VehicleTrimMasterRecord } from '../lib/domain/vehicle-trim-master';

const prestigeKey = RAY_2027_OFFICIAL_PRICE_RULES[0].target;
const trendyKey = RAY_2027_OFFICIAL_PRICE_RULES[2].target;
const master = (key: string, trim: string): VehicleTrimMasterRecord => ({
  trim_row_key: key,
  usage_tier: 'automatic',
  management_status: '확정',
  verification_status: '확정',
  seats: 5,
  sub_model: '더 뉴 기아 레이 TAM',
  body_configuration: '승용',
  trim,
} as VehicleTrimMasterRecord);
const byKey = new Map<string, VehicleTrimMasterRecord>([
  [prestigeKey, master(prestigeKey, '프레스티지')],
  [trendyKey, master(trendyKey, '트렌디')],
]);
assert.deepEqual([...parseProductCoverageRowSelection('')], []);
assert.deepEqual([...parseProductCoverageRowSelection('49, 114,49')], [49, 114]);
assert.deepEqual([...parseProductCoverageRowSelection('0,-1,not-a-row')], []);
const base = (): ProductCoverageEvidenceRow => ({
  row: 233,
  provider: 'RP004',
  category: '다중 자동후보',
  candidate_keys: [prestigeKey, 'van-counterexample'],
  signal_conflicts: [],
  audit_axes: { registration_month: '2026-08' },
  source_clues: {
    trim: '프레스티지', option: '기본형-드라이브와이즈,내비게이션', vehicle_price: 18_950_000,
  },
});
const mutate = (patch: Partial<ProductCoverageEvidenceRow>, clues: Record<string, unknown> = {}) => ({
  ...base(), ...patch, source_clues: { ...base().source_clues, ...clues },
});

assert.equal(decideRayOfficialPriceEvidence(base(), byKey)?.rule.id,
  'ray-2027-passenger-prestige-drivewise-navigation');
const wrongBody = new Map(byKey);
wrongBody.set(prestigeKey, { ...byKey.get(prestigeKey)!, body_configuration: '2인승 밴' });
assert.throws(() => decideRayOfficialPriceEvidence(base(), wrongBody), /대상키 계약 불일치/);
assert.deepEqual(normalizedRayOptionTokens('기본형-컴포트Ⅰ,내비게이션'), ['내비게이션', '컴포트1']);
assert.equal(decideRayOfficialPriceEvidence(mutate({ provider: 'RP031' }), byKey), null);
assert.equal(decideRayOfficialPriceEvidence(mutate({ category: '단일 자동후보(승인대기)' }), byKey), null);
assert.equal(decideRayOfficialPriceEvidence(mutate({ signal_conflicts: ['트림 충돌'] }), byKey), null);
assert.equal(decideRayOfficialPriceEvidence(mutate({ audit_axes: { registration_month: '2026-07' } }), byKey), null);
assert.equal(decideRayOfficialPriceEvidence(mutate({}, { trim: '트렌디' }), byKey), null);
assert.equal(decideRayOfficialPriceEvidence(mutate({}, { vehicle_price: 18_950_001 }), byKey), null);
assert.equal(decideRayOfficialPriceEvidence(mutate({}, {
  option: '기본형-드라이브와이즈,내비게이션,스타일',
}), byKey), null);
assert.equal(decideRayOfficialPriceEvidence(mutate({}, { option: '기본형-내비게이션' }), byKey), null);
assert.throws(() => decideRayOfficialPriceEvidence(mutate({ candidate_keys: ['van-counterexample'] }), byKey),
  /기존 후보집합에 없음/);

const initial = ['차량', '가격', '옵션'];
const fingerprint = productCoverageRowFingerprint(initial, 5);
assert.equal(productCoverageRowFingerprint([...initial], 5), fingerprint);
for (let index = 0; index < initial.length; index += 1) {
  const changed = [...initial];
  changed[index] += '!';
  assert.notEqual(productCoverageRowFingerprint(changed, 5), fingerprint);
}
assert.notEqual(productCoverageSheetFingerprint([initial], 5),
  productCoverageSheetFingerprint([['차량', '가격!', '옵션']], 5));
assertFreshProductCoverageReport('2026-08-16T00:00:00.000Z', Date.parse('2026-08-16T00:09:59.000Z'));
assert.throws(() => assertFreshProductCoverageReport(
  '2026-08-16T00:00:00.000Z', Date.parse('2026-08-16T00:10:01.000Z'),
), /유효시간/);
assert.throws(() => assertFreshProductCoverageReport('not-a-date'), /생성시각/);

const patch = new Map([['B', new Map([[1, '확정']])]]);
assert.deepEqual(productCoveragePostWriteIssues({
  beforeRows: [['A', '검수'], ['B', '검수']],
  afterRows: [['A', '검수'], ['B', '확정']],
  width: 2, identityColumn: 0, patchesByIdentity: patch,
}), []);
assert.match(productCoveragePostWriteIssues({
  beforeRows: [['A', '검수'], ['B', '검수']],
  afterRows: [['B', '확정'], ['A', '확정']],
  width: 2, identityColumn: 0, patchesByIdentity: patch,
})[0] || '', /row_changed/);
assert.ok(productCoveragePostWriteIssues({
  beforeRows: [['A', '검수'], ['B', '검수']],
  afterRows: [['A', '검수'], ['B', '확정'], ['C', '신규']],
  width: 2, identityColumn: 0, patchesByIdentity: patch,
}).includes('identity_set_changed'));
assert.match(productCoveragePostWriteIssues({
  beforeRows: [['A', '검수'], ['B', '검수']],
  afterRows: [['A', '검수'], ['B', '확정'], ['B', '확정']],
  width: 2, identityColumn: 0, patchesByIdentity: patch,
})[0] || '', /after_duplicate/);

console.log('PASS: 공식 가격 근거 판정 · 변조 차단 · 행 지문 · 보고서 TTL · 전체 행 사후대조');
