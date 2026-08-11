import assert from 'node:assert/strict';
import { esignIssueBlockers } from '../lib/domain/esign-center';

const partner = { partner_code: 'RP012', name: '손오공', ceo: '대표', address: '서울', bank_name: '은행', bank_account: '100-200', bank_holder: '손오공' };
const policy = {
  policy_code: 'POL-1', provider_company_code: 'RP012',
  contract_authoring: '프리패스가 작성', insurance_included: '포함', basic_driver_age: '만 26세 이상',
};
const valid = {
  provider_company_code: 'RP012', policy_code: 'POL-1', customer_name: '테스트 고객', customer_phone: '01012345678',
  customer_address: '서울특별시 테스트구 1', auto_debit_date: '매월 10일',
  vehicle_name_snapshot: '테스트 차량', rent_month_snapshot: 48, rent_amount_snapshot: 600_000,
};

assert.deepEqual(esignIssueBlockers({ ...valid, contract_source: 'direct' }, partner, policy), [], '직접 작성은 ERP 약정 단계 없이 발송 가능해야 한다');
assert.deepEqual(esignIssueBlockers({ ...valid, contract_source: 'excel' }, partner, policy), [], 'Excel 입력은 ERP 약정 단계 없이 발송 가능해야 한다');

const missingPhone = esignIssueBlockers({ ...valid, contract_source: 'excel', customer_phone: '' }, partner, policy);
assert.ok(missingPhone.some((row) => row.key === 'customer_phone'), 'Excel 입력도 공통 BLOCK 검증을 우회할 수 없어야 한다');

const wrongSupplierPolicy = esignIssueBlockers(
  { ...valid, contract_source: 'direct' },
  partner,
  { ...policy, provider_company_code: 'RP999' },
);
assert.ok(wrongSupplierPolicy.some((row) => row.key === 'policy'), '다른 공급사의 정책으로 계약할 수 없어야 한다');

const erpBlocked = esignIssueBlockers({ ...valid, contract_source: 'erp' }, partner, policy);
assert.ok(erpBlocked.some((row) => row.key === 'erp_agreement'), 'ERP 계약은 기존 약정 단계가 필요해야 한다');
assert.deepEqual(esignIssueBlockers({ ...valid, contract_source: 'erp', provider_agreement_done: 'yes' }, partner, policy), []);

console.log('✓ 전자계약 source gate: direct/excel 독립 발송 · ERP 약정 유지 · BLOCK 우회 차단');
