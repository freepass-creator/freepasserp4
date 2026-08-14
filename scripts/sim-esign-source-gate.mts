import assert from 'node:assert/strict';
import { esignIssueBlockers } from '../lib/domain/esign-center';
import { applyPolicyDefaults } from '../lib/domain/policy-defaults';

const partner = { partner_code: 'RP012', name: '손오공', ceo: '대표', address: '서울', bank_name: '은행', bank_account: '100-200', bank_holder: '손오공' };
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
};

assert.deepEqual(esignIssueBlockers({ ...valid, contract_source: 'direct' }, partner, policy), [], '직접 작성은 ERP 약정 단계 없이 발송 가능해야 한다');
assert.deepEqual(esignIssueBlockers({ ...valid, contract_source: 'excel' }, partner, policy), [], 'Excel 입력은 ERP 약정 단계 없이 발송 가능해야 한다');

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

console.log('✓ 전자계약 source gate: direct/excel 독립 발송 · ERP 약정 유지 · BLOCK 우회 차단');
