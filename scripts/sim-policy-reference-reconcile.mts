import assert from 'node:assert/strict';
import { groupPoliciesByProvider, reconcilePolicyReference } from '../lib/domain/supplier-policy-link';

const policies = [
  { policy_code: 'RP031_S01', provider_company_code: 'RP031', policy_name: '신차렌트' },
  { policy_code: 'RP031_S02', provider_company_code: 'RP031', policy_name: '중고렌트' },
  { policy_code: 'POL-0020', provider_company_code: 'RP012', policy_name: '만 26세 이상 구독' },
  { policy_code: 'POL-0046', provider_company_code: 'RP012', policy_name: '만 26세 이상 렌트' },
  { policy_code: 'FP-RP032-RENT', provider_company_code: 'RP032', policy_name: '공통 렌트' },
  { policy_code: 'P1', provider_company_code: 'RP001', policy_name: '단순 정책' },
];
const byProvider = groupPoliciesByProvider(policies);
assert.deepEqual(reconcilePolicyReference({ provider_company_code: 'RP031', policy_code: 'RP031_S1' }, byProvider), { code: 'RP031_S01', sourceCode: 'RP031_S1', state: 'normalized' });
assert.deepEqual(reconcilePolicyReference({ provider_company_code: 'RP001', policy_code: 'P01' }, byProvider), { code: 'P1', sourceCode: 'P01', state: 'normalized' });
assert.equal(reconcilePolicyReference({ provider_company_code: 'RP012', product_type: '중고구독', policy_code: 'pol_freepassstd' }, byProvider).code, 'POL-0020');
assert.equal(reconcilePolicyReference({ provider_company_code: 'RP012', product_type: '중고렌트', policy_code: '' }, byProvider).code, 'POL-0046');
assert.equal(reconcilePolicyReference({ provider_company_code: 'RP032', policy_code: 'obsolete' }, byProvider).code, 'FP-RP032-RENT');
assert.deepEqual(reconcilePolicyReference({ provider_company_code: 'UNKNOWN', policy_code: 'obsolete' }, byProvider), { code: '', sourceCode: 'obsolete', state: 'missing' });
assert.equal(reconcilePolicyReference({ provider_company_code: 'RP031', policy_code: 'RP031_S02' }, byProvider).state, 'valid');
assert.deepEqual(reconcilePolicyReference({ provider_company_code: 'RP031', product_type: '신차렌트', policy_code: 'obsolete' }, byProvider), { code: '', sourceCode: 'obsolete', state: 'missing' });
const ambiguousByProvider = groupPoliciesByProvider([
  { policy_code: 'RP031_S01', provider_company_code: 'RP031', policy_name: '신차렌트' },
  { policy_code: 'RP031_S001', provider_company_code: 'RP031', policy_name: '중고렌트' },
]);
assert.deepEqual(reconcilePolicyReference({ provider_company_code: 'RP031', product_type: '중고렌트', policy_code: 'RP031_S1' }, ambiguousByProvider), { code: '', sourceCode: 'RP031_S1', state: 'missing' });
console.log('✓ 정책 참조 정규화·추론·미입력·정본 유지·모호성 차단 8가지 통과');
