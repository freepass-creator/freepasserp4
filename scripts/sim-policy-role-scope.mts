import assert from 'node:assert/strict';
import { scopeInventoryPolicies, scopeManagedPolicies } from '../lib/domain/policy-access';

const policies = [
  { policy_code: 'A-1', provider_company_code: 'A', screening_criteria: 'A 내부기준' },
  { policy_code: 'B-1', provider_company_code: 'B', screening_criteria: 'B 내부기준' },
  { policy_code: 'COMMON', provider_company_code: '', screening_criteria: '공용 내부기준' },
];

assert.deepEqual(scopeManagedPolicies(policies, 'admin').map((row) => row.policy_code), ['A-1', 'B-1', 'COMMON']);
assert.deepEqual(scopeManagedPolicies(policies, 'provider', 'A').map((row) => row.policy_code), ['A-1']);
assert.deepEqual(scopeManagedPolicies(policies, 'provider', 'B').map((row) => row.policy_code), ['B-1']);
assert.deepEqual(scopeManagedPolicies(policies, 'provider', '').map((row) => row.policy_code), []);
assert.deepEqual(scopeManagedPolicies(policies, 'sales').map((row) => row.policy_code), []);

assert.deepEqual(scopeInventoryPolicies(policies, 'admin').map((row) => row.policy_code), ['A-1', 'B-1', 'COMMON']);
assert.deepEqual(scopeInventoryPolicies(policies, 'provider', 'A').map((row) => row.policy_code), ['A-1']);
assert.deepEqual(scopeInventoryPolicies(policies, 'sales').map((row) => row.policy_code), []);

console.log('sim-policy-role-scope: PASS');
