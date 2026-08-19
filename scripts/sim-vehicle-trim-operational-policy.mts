import assert from 'node:assert/strict';
import { planOperationalPromotions } from '../lib/domain/vehicle-trim-operational-policy';
import type { VehicleTrimMasterRecord } from '../lib/domain/vehicle-trim-master';

const row = (overrides: Partial<VehicleTrimMasterRecord> = {}): VehicleTrimMasterRecord => ({
  trim_row_key: 'mf-001.md-001.sm-test::v01::t01', master_id: 'mf-001.md-001.sm-test',
  powertrain_seq: 1, trim_seq: 1, management_status: '검증중', verification_status: '1차확인', usage_tier: 'manual',
  market_status: '신차', origin: '국산', maker: '현대', model: '테스트', sub_model: '테스트 X1',
  powertrain: '가솔린 2.0 2WD', trim: '프리미엄', generation_name: '1세대', development_code: 'X1',
  production_start: '2026-01', production_end: '현재', model_year_start: '2026', model_year_end: '현재',
  fuel: '가솔린', engine_cc: 1999, displacement_l: 2, turbo: false, drivetrain: '2WD', seats: 5,
  battery_kwh: null, trim_aliases: [], evidence_url: 'https://www.hyundai.com/kr/ko/test',
  evidence_note: '현대 공식 제원과 원본 대조', data_as_of: '2026-08-15', ...overrides,
});

assert.deepEqual(planOperationalPromotions([row()]).selected.map((item) => item.trim_row_key), ['mf-001.md-001.sm-test::v01::t01']);
assert.equal(planOperationalPromotions([row({ evidence_url: 'https://example.com' })]).selected.length, 0);
assert.equal(planOperationalPromotions([row({
  maker: '기아', model: 'EV6', sub_model: '더 뉴 EV6 GT CV PE', fuel: '전기',
  powertrain: '전기 84kWh GT 4WD', engine_cc: null, battery_kwh: 84, drivetrain: '4WD',
  evidence_url: 'https://www.hyundaimotorgroup.com/ko/news/official-ev6-gt',
})]).selected.length, 1, '기아 차량의 현대자동차그룹 공식 뉴스룸 근거를 허용해야 한다.');
assert.equal(planOperationalPromotions([row({
  maker: '벤츠', model: 'EQC', sub_model: '더 뉴 EQC N293', fuel: '전기', powertrain: '전기 AWD',
  engine_cc: null, battery_kwh: 80, evidence_url: 'https://media.mercedes-benz.com/article/official-eqc',
})]).selected.length, 1, 'Mercedes-Benz 공식 미디어 호스트를 허용해야 한다.');
assert.equal(planOperationalPromotions([row({
  maker: '푸조', model: '5008', sub_model: '올 뉴 5008 3세대 P67',
  evidence_url: 'https://www.epeugeot.co.kr/new-cars/5008hybrid.html',
})]).selected.length, 1, '푸조코리아 현행 공식 호스트를 허용해야 한다.');
assert.equal(planOperationalPromotions([row({
  maker: '푸조', model: '5008', sub_model: '올 뉴 5008 3세대 P67',
  evidence_url: 'https://epeugeot.co.kr.attacker.example/new-cars/5008hybrid.html',
})]).selected.length, 0, '공식 호스트 문자열을 포함한 외부 도메인은 허용하면 안 된다.');
assert.equal(planOperationalPromotions([row({ evidence_note: '현행 제조사 제원 대조' })]).selected.length, 1);
assert.equal(planOperationalPromotions([row({ generation_name: '', development_code: '' })]).selected.length, 0);
assert.equal(planOperationalPromotions([row({
  maker: '볼보', model: 'XC40', sub_model: 'XC40', generation_name: '', development_code: '',
  evidence_url: 'https://www.volvocars.com/kr/cars/xc40/', evidence_note: 'Volvo Cars KR 현행 공식 제원',
})]).selected.length, 1);
assert.equal(planOperationalPromotions([row({ battery_kwh: 84, fuel: '전기', powertrain: '전기 84kWh', engine_cc: null })]).selected.length, 1);
assert.equal(planOperationalPromotions([row({ fuel: '전기', powertrain: '전기', engine_cc: null, battery_kwh: null })]).selected.length, 0);
assert.equal(planOperationalPromotions([row({
  maker: '볼보', model: 'XC40', fuel: '하이브리드', powertrain: '가솔린 2.0T MHEV AWD',
  evidence_url: 'https://www.volvocars.com/kr/cars/xc40/',
})]).selected.length, 1, 'MHEV의 EV 문자열을 순수전기차로 오인하면 안 된다.');
assert.equal(planOperationalPromotions([row({
  model: '넥쏘', fuel: '수소', powertrain: '수소전기 150kW FWD', engine_cc: null,
})]).selected.length, 1, '수소전기차에 내연기관 배기량이나 구동 배터리 kWh를 요구하면 안 된다.');
assert.equal(planOperationalPromotions([row({
  maker: 'BMW', model: 'iX3', sub_model: 'iX3 NA5', fuel: '전기', powertrain: '전기 xDrive', engine_cc: null,
  battery_kwh: null, evidence_url: 'https://www.bmw.co.kr/ko/all-models/x-series/ix3/bmw-ix3.html',
  evidence_note: 'BMW 코리아 공식 페이지에서 배터리 총용량 미공개라 공란 유지',
})]).selected.length, 1);
assert.equal(planOperationalPromotions([row({
  maker: '테슬라', model: '모델 3', sub_model: '모델 3', fuel: '전기', powertrain: '전기 RWD', engine_cc: null,
  battery_kwh: null, generation_name: '', development_code: '', evidence_url: 'https://www.tesla.com/ko_kr/model3',
  evidence_note: 'Tesla 대한민국 공식 페이지에서 배터리 총용량 미공개라 공란 유지',
})]).selected.length, 1);
assert.equal(planOperationalPromotions([row({
  maker: '아우디', model: 'A6 e-트론', sub_model: 'A6 e-트론', fuel: '전기', powertrain: '전기', engine_cc: null,
  battery_kwh: 100, generation_name: '', development_code: '', evidence_url: 'https://www.audi.co.kr/ko/models/',
  evidence_note: 'Audi Korea 현행 공식 배터리·구동전동기 자료',
})]).selected.length, 1);
assert.equal(planOperationalPromotions([row({
  market_status: '중고차', production_end: '2020-12', model_year_end: '2020',
})]).selected.length, 1);
assert.equal(planOperationalPromotions([row({
  market_status: '중고차', production_end: '2015-12', model_year_end: '2015',
})]).selected.length, 0);
assert.equal(planOperationalPromotions([row({
  market_status: '중고차', production_end: '2020-12', model_year_end: '2020', generation_name: '', development_code: '',
})]).selected.length, 0);
assert.equal(planOperationalPromotions([row({
  maker: 'BMW', model: 'iX3', sub_model: 'iX3', market_status: '중고차', production_end: '2023-12', model_year_end: '2023',
  fuel: '전기', powertrain: '전기', engine_cc: null, battery_kwh: null,
  evidence_url: 'https://www.bmw.co.kr/ko/all-models/x-series/ix3/bmw-ix3.html',
  evidence_note: 'BMW 코리아 공식 페이지에서 배터리 총용량 미공개라 공란 유지',
})]).selected.length, 0);
assert.equal(planOperationalPromotions([row({
  maker: '테슬라', model: '모델 3', sub_model: '모델 3 1세대', market_status: '중고차',
  production_end: '2023-08', model_year_end: '2023', fuel: '전기', powertrain: '전기 RWD',
  engine_cc: null, battery_kwh: null, evidence_url: 'https://www.tesla.com/ko_kr/model3',
  evidence_note: 'Tesla 대한민국 공식 페이지에서 배터리 총용량 미공개라 추정하지 않고 공란 유지',
})]).selected.length, 1);
const ambiguous = planOperationalPromotions([
  row(),
  row({ trim_row_key: 'mf-001.md-001.sm-test::v01::t02', trim_seq: 2 }),
]);
assert.equal(ambiguous.selected.length, 0);
assert.equal(ambiguous.heldForAmbiguity.length, 2);
const distinguishable = planOperationalPromotions([
  row(),
  row({ trim_row_key: 'mf-001.md-001.sm-test::v01::t02', trim_seq: 2, seats: 7 }),
]);
assert.equal(distinguishable.selected.length, 2);
assert.equal(distinguishable.heldForAmbiguity.length, 0);
console.log('PASS vehicle trim operational policy');
