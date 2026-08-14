import assert from 'node:assert/strict';
import type { EntityRecord } from '@/lib/intake/entities';
import { applyPolicyDefaults } from '@/lib/domain/policy-defaults';
import {
  policiesByProvider,
  policiesForTemplate,
  preferredContractPolicy,
  preferredPolicyForTemplate,
} from '@/lib/domain/esign-policy-selection';
import { findTemplate } from '@/lib/domain/esign-templates';
import { companyNameWithoutLegalForm, partnerCompanyDisplayName } from '@/lib/domain/identity';

const common = {
  ...applyPolicyDefaults({ policy_code: 'FP-RP012-RENT' }).next,
  provider_company_code: 'RP012',
  is_freepass_common_policy: true,
} as EntityRecord;
const legacy = {
  ...common,
  policy_code: 'POL-0046',
  is_freepass_common_policy: false,
  policy_default_pack: 'legacy',
} as EntityRecord;
const other = { ...common, policy_code: 'FP-RP004-RENT', provider_company_code: 'RP004' } as EntityRecord;
const subscription = {
  ...common,
  policy_code: 'POL-RP012-SUB',
  policy_name: '손오공 구독 · 보험포함',
  policy_type: '중고구독',
} as EntityRecord;
const rentTemplate = findTemplate('freepass-rent-standard');
const subscriptionTemplate = findTemplate('freepass-subscription-insurance-included');

assert.equal(preferredContractPolicy([legacy, other, common], 'RP012')?.policy_code, 'FP-RP012-RENT');
assert.equal(preferredContractPolicy([other], 'RP012'), null);
assert.deepEqual(policiesByProvider([legacy, other, common]).get('RP012')?.map((row) => row.policy_code), ['POL-0046', 'FP-RP012-RENT']);
assert.deepEqual(policiesForTemplate([common, subscription], 'RP012', rentTemplate).map((row) => row.policy_code), ['FP-RP012-RENT']);
assert.equal(preferredPolicyForTemplate([common, subscription], 'RP012', subscriptionTemplate)?.policy_code, 'POL-RP012-SUB');
assert.equal(companyNameWithoutLegalForm('주식회사 아이카'), '아이카');
assert.equal(companyNameWithoutLegalForm('(주)스타스카이'), '스타스카이');
assert.equal(companyNameWithoutLegalForm('경진카 주식회사'), '경진카');
assert.equal(companyNameWithoutLegalForm('리더스렌터카'), '리더스렌터카');
assert.equal(partnerCompanyDisplayName({ _key: 'RP004', partner_code: 'RP004', name: 'RP004', partner_name: '주식회사 아이카' }), '아이카');
assert.equal(partnerCompanyDisplayName({ _key: 'RP030', name: 'RP030', company_name: '', partner_name: '주식회사 제이앤제이렌트카' }), '제이앤제이렌트카');
assert.equal(partnerCompanyDisplayName({ _key: 'RP008', name: 'RP008' }), '');
console.log('PASS: 공급사별 정책 그룹화·프리패스 공통 렌트 자동선택');
