import assert from 'node:assert/strict';
import { esignIssueBlockers, esignProductAvailabilityBlocker } from '../lib/domain/esign-center';
import { applyPolicyDefaults } from '../lib/domain/policy-defaults';

const partner = {
  partner_code: 'RP012', name: '손오공', business_number: '8828700650', ceo: '대표', address: '서울',
  rental_business_no: '제 강서-68호', bank_name: '은행', bank_account: '100-200', bank_holder: '손오공',
};
const policy = applyPolicyDefaults({
  policy_code: 'POL-1', provider_company_code: 'RP012',
  contract_authoring: '프리패스가 작성', insurance_included: '포함', basic_driver_age: '만 26세 이상',
  insurer_name: '전국렌터카공제조합',
  injury_compensation_limit: '무한', injury_deductible: '30만원',
  property_compensation_limit: '2억원', property_deductible: '30만원',
  self_body_accident: '총 1억원 · 1인 1,500만원', self_body_deductible: '없음',
  uninsured_damage: '2억원', uninsured_deductible: '없음',
  own_damage_compensation: '차량가액', own_damage_repair_ratio: '20%',
  own_damage_min_deductible: '50만원', own_damage_max_deductible: '100만원',
  annual_roadside_assistance: '연 5회',
}).next;
const valid = {
  provider_company_code: 'RP012', policy_code: 'POL-1', customer_name: '테스트 고객', customer_phone: '01012345678',
  customer_address: '서울특별시 테스트구 1', auto_debit_date: '매월 10일',
  vehicle_name_snapshot: '테스트 차량', rent_month_snapshot: 48, rent_amount_snapshot: 600_000,
  deposit_amount_snapshot: 0,
};

assert.deepEqual(esignIssueBlockers({ ...valid, contract_source: 'direct' }, partner, policy), [], '직접 작성은 ERP 약정 단계 없이 발송 가능해야 한다');
assert.deepEqual(esignIssueBlockers({ ...valid, contract_source: 'excel' }, partner, policy), [], 'Excel 입력은 ERP 약정 단계 없이 발송 가능해야 한다');
assert.deepEqual(
  esignIssueBlockers({ ...valid, contract_source: 'direct', customer_name: '', customer_phone: '' }, partner, policy),
  [],
  '직접 전자계약은 고객명·연락처 없이 링크를 만들고 고객이 직접 입력할 수 있어야 한다',
);
assert.ok(
  esignIssueBlockers({ ...valid, contract_source: 'excel', customer_name: '', customer_phone: '' }, partner, policy)
    .some((row) => row.key === 'customer_name' || row.key === 'customer_phone'),
  'Excel 계약은 기존 입력값 검증을 유지해야 한다',
);

const missingLegalProfile = esignIssueBlockers(
  { ...valid, contract_source: 'direct' },
  { ...partner, business_number: '', rental_business_no: '' },
  policy,
);
assert.ok(missingLegalProfile.some((row) => row.key === 'company_biz_no'), '임대인 사업자등록번호가 없으면 발행을 차단해야 한다');
// 사장님 2026-08-19 「대여사업등록정보까지는 필요없을 거 같음」 — 등록번호는 없어도 막지 않는다.
assert.ok(!missingLegalProfile.some((row) => row.key === 'rental_business_no'), '자동차대여사업 등록번호는 발행을 막지 않는다');

const partialDriver = esignIssueBlockers({
  ...valid,
  contract_source: 'direct',
  contract_draft: JSON.stringify({ drv1_name: '김추가' }),
}, partner, policy);
assert.ok(partialDriver.some((row) => row.key === 'additional_driver'), '추가 운전자는 성명·관계·연락처를 모두 받아야 한다');
assert.deepEqual(esignIssueBlockers({
  ...valid,
  contract_source: 'direct',
  contract_draft: JSON.stringify({ drv1_name: '김추가', drv1_relation: '배우자', drv1_phone: '01022223333' }),
}, partner, policy), [], '추가 운전자 3개 기본정보가 모두 있으면 발행 가능해야 한다');

const missingPhone = esignIssueBlockers({ ...valid, contract_source: 'excel', customer_phone: '' }, partner, policy);
assert.ok(missingPhone.some((row) => row.key === 'customer_phone'), 'Excel 입력도 공통 BLOCK 검증을 우회할 수 없어야 한다');

const wrongSupplierPolicy = esignIssueBlockers(
  { ...valid, contract_source: 'direct' },
  partner,
  { ...policy, provider_company_code: 'RP999' },
);
assert.ok(wrongSupplierPolicy.some((row) => row.key === 'policy'), '다른 공급사의 정책으로 계약할 수 없어야 한다');

const incompletePolicy = esignIssueBlockers(
  { ...valid, contract_source: 'direct' },
  partner,
  { ...policy, basic_driver_age: '', own_damage_max_deductible: '' },
);
assert.ok(incompletePolicy.some((row) => row.key === 'policy_readiness' && /운전자 연령|자차 최대 면책금/.test(row.message)), '정책 누락은 개수가 아니라 실제 항목명을 알려야 한다');
assert.ok(!incompletePolicy.some((row) => row.key === 'driver_age'), '정책 완성도에서 잡은 운전자 연령을 중복 차단하지 않아야 한다');

const erpBlocked = esignIssueBlockers({ ...valid, contract_source: 'erp' }, partner, policy);
assert.ok(erpBlocked.some((row) => row.key === 'erp_agreement'), 'ERP 계약은 기존 약정 단계가 필요해야 한다');
assert.deepEqual(esignIssueBlockers({ ...valid, contract_source: 'erp', provider_agreement_done: 'yes' }, partner, policy), []);

const erpWrongPolicy = esignIssueBlockers(
  { ...valid, contract_source: 'erp', provider_agreement_done: 'yes' },
  partner,
  { ...policy, provider_company_code: 'RP999' },
);
assert.ok(erpWrongPolicy.some((row) => row.key === 'policy'), 'ERP 계약도 공급사-정책 불일치를 우회할 수 없어야 한다');

const negativeDeposit = esignIssueBlockers(
  { ...valid, contract_source: 'direct', deposit_amount_snapshot: -1 },
  partner,
  policy,
);
assert.ok(negativeDeposit.some((row) => row.key === 'deposit_amount'), '음수 보증금은 0원으로 조용히 바꾸지 말고 발행을 차단해야 한다');

const pricedProduct = {
  product_code: 'RP012_12가3456', provider_company_code: 'RP012', vehicle_status: '출고가능', product_type: '중고렌트',
  price: { '48_3만': { rent: 600_000, deposit: 0 }, '48_4만': { rent: 700_000, deposit: 0 } },
};
const pricedPolicy = { ...policy, annual_mileage: '연 3만km', mileage_upcharge_per_10000km: 100_000 };
const pricedContract = {
  ...valid, contract_source: 'direct', product_code: pricedProduct.product_code,
  pricing_snapshot_version: 'v1', annual_mileage_snapshot: '연 4만km', price_variant_snapshot: '48_4만',
  mileage_surcharge_snapshot: 0, age_surcharge_snapshot: 0, rent_amount_snapshot: 700_000,
  driver_age_snapshot: '만 26세 이상',
  special_terms_choice_snapshot: '없음', special_terms_snapshot: '없음',
};
assert.ok(!esignIssueBlockers(pricedContract, partner, pricedPolicy, pricedProduct).some((row) => row.key === 'pricing_snapshot'), '가격표 기준의 주행거리 선택은 발행 가능해야 한다');
assert.ok(esignIssueBlockers({ ...pricedContract, rent_amount_snapshot: 699_000 }, partner, pricedPolicy, pricedProduct)
  .some((row) => row.key === 'pricing_snapshot'), '기간·주행거리·연령과 다른 월대여료는 발행을 막아야 한다');
assert.ok(esignIssueBlockers({ ...pricedContract, special_terms_choice_snapshot: '있음', special_terms_snapshot: '' }, partner, pricedPolicy, pricedProduct)
  .some((row) => row.key === 'special_terms'), '특약 있음인데 내용이 비어 있으면 발행을 막아야 한다');

const missingVehicle = esignIssueBlockers(
  { ...valid, contract_source: 'direct', vehicle_name_snapshot: '' },
  partner,
  policy,
);
assert.ok(missingVehicle.some((row) => row.key === 'vehicle'), '차량명이 없는 계약은 고객에게 발행할 수 없어야 한다');

const fractionalTerm = esignIssueBlockers(
  { ...valid, contract_source: 'direct', rent_month_snapshot: 36.5 },
  partner,
  policy,
);
assert.ok(fractionalTerm.some((row) => row.key === 'rent_month'), '소수 계약기간은 인도일 확정 단계까지 흘러가면 안 된다');

const negativeAdditionalDriverFee = esignIssueBlockers(
  { ...valid, contract_source: 'direct' },
  partner,
  { ...policy, additional_driver_allowance_count: '1인', additional_driver_cost: '-10,000원' },
);
assert.ok(
  negativeAdditionalDriverFee.some((row) => row.key === 'additional_driver_cost'),
  '추가 운전자 요금이 음수면 정책값이 있어도 발행을 차단해야 한다',
);

const invalidEarlyTermination = esignIssueBlockers(
  { ...valid, contract_source: 'direct' },
  partner,
  { ...policy, early_termination_rate_under1y: '130%', early_termination_rate_over1y: '-20%' },
);
assert.ok(
  invalidEarlyTermination.some((row) => row.key === 'early_termination_rate'),
  '중도해지 위약률은 0% 초과 100% 이하 범위만 허용해야 한다',
);

const reversedOwnDamageDeductible = esignIssueBlockers(
  { ...valid, contract_source: 'direct' },
  partner,
  { ...policy, own_damage_min_deductible: '100만원', own_damage_max_deductible: '50만원' },
);
assert.ok(
  reversedOwnDamageDeductible.some((row) => row.key === 'own_damage_deductible'),
  '자차 최대 면책금이 최소 면책금보다 작으면 발행을 차단해야 한다',
);

const guarantorMixedIntoMainContract = esignIssueBlockers(
  {
    ...valid,
    contract_source: 'direct',
    contract_draft: JSON.stringify({ guarantor_name: '보증인', guarantee_limit: '30,000,000원' }),
  },
  partner,
  policy,
);
assert.ok(
  guarantorMixedIntoMainContract.some((row) => row.key === 'guarantor_separate'),
  '연대보증은 주계약 서명에 섞지 않고 별도 약정으로 처리해야 한다',
);

const vehicleContract = { ...valid, contract_code: 'CT-1', contract_source: 'direct', product_code: 'PD-1' };
const availableProduct = {
  product_code: 'PD-1', provider_company_code: 'RP012', vehicle_status: '출고가능',
  vehicle_name: '테스트 차량',
};
assert.equal(esignProductAvailabilityBlocker(vehicleContract, availableProduct), null);
assert.equal(
  esignProductAvailabilityBlocker(vehicleContract, { ...availableProduct, provider_company_code: 'RP999' })?.key,
  'vehicle_provider',
  '다른 공급사의 차량은 발행할 수 없어야 한다',
);
assert.equal(
  esignProductAvailabilityBlocker(vehicleContract, { ...availableProduct, vehicle_status: '출고불가', locked_by_contract: 'CT-OTHER' })?.key,
  'vehicle_availability',
  '다른 계약이 선점한 차량은 발행·최종승인을 차단해야 한다',
);
assert.equal(
  esignProductAvailabilityBlocker(vehicleContract, { ...availableProduct, vehicle_status: '계약중', locked_by_contract: 'CT-1' }),
  null,
  '현재 계약이 선점한 차량은 계속 진행할 수 있어야 한다',
);
// ★즉시출고 = 출고가능(차량 목록 `isContractAvailableVehicle` 과 같은 규칙). 목록엔 뜨는데 게이트가 막으면 «고를 수는 있는데 못 보내는» 차가 생긴다(2026-08-20 실측 5대).
assert.equal(
  esignProductAvailabilityBlocker(vehicleContract, { ...availableProduct, vehicle_status: '즉시출고' }),
  null,
  '즉시출고 차량은 발행할 수 있어야 한다',
);
assert.equal(
  esignProductAvailabilityBlocker(vehicleContract, { ...availableProduct, vehicle_status: '상품화중' })?.key,
  'vehicle_availability',
  '상품화중 차량은 막아야 한다',
);

console.log('✓ 전자계약 source gate: direct/excel 독립 발송 · ERP 약정 유지 · BLOCK 우회 차단');
