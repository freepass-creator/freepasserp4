import assert from 'node:assert/strict';
import {
  POLICY_VALUE_SSOT,
  createPolicyResolver,
  resolveExplicitContractPolicy,
} from '../lib/domain/policy-resolution';

type Rec = Record<string, any>;
const policies: Rec[] = [
  { _key: 'policy-doc-a', policy_code: 'POL_S01', provider_company_code: 'RP001', insurance_included: '보험료 포함' },
  { _key: 'policy-doc-b', policy_code: 'POL_RENT', provider_company_code: 'RP002', policy_type: '중고렌트' },
  { _key: 'policy-doc-c', policy_code: 'POL_SUB', provider_company_code: 'RP002', policy_type: '중고구독' },
];

assert.equal(POLICY_VALUE_SSOT, 'firestore-policy-record-v1');
const resolve = createPolicyResolver(policies);
assert.equal(resolve({ policy_code: 'POL_S01', _policy: { insurance_included: '보험료 별도' } }).policyKey, 'policy-doc-a');
assert.equal(resolve({ policy_code: 'MISSING', _policy: { insurance_included: '보험료 별도' } }).status, 'hold-orphan-code');
assert.equal(resolve({ _policy: { insurance_included: '보험료 별도' } }).status, 'hold-ambiguous-or-missing');
assert.equal(resolve({ provider_company_code: 'RP001' }).status, 'resolved-auto-unambiguous');
assert.equal(resolve({ provider_company_code: 'RP002' }).status, 'hold-ambiguous-or-missing');
assert.equal(resolveExplicitContractPolicy(policies, 'POL_S1').policyKey, 'policy-doc-a');
assert.equal(resolveExplicitContractPolicy(policies, '').status, 'hold-ambiguous-or-missing');
assert.equal(resolveExplicitContractPolicy(policies, 'MISSING').status, 'hold-orphan-code');
console.log('PASS policy value SSOT: Firestore-only values, no embedded/default read fallback, contract fail-closed');
