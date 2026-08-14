import assert from 'node:assert/strict';
import { applyPolicyDefaults, FREEPASS_POLICY_PACK } from '@/lib/domain/policy-defaults';
import { canIssueContract } from '@/lib/domain/policy-tier';

const common = applyPolicyDefaults({ policy_code: 'SIM-COMMON' }).next;
assert.equal(common.policy_default_pack, FREEPASS_POLICY_PACK);
assert.equal(common.insurance_included, '포함(회사 가입)');
assert.equal(common.property_compensation_limit, '2억원');
assert.equal(common.self_body_accident, '사망·후유장애 1인당 3천만원 · 부상 1인당 1,500만원');
assert.equal(common.uninsured_damage, '미가입');
assert.equal(common.late_fee_rate, 0.24);
assert.equal(common.succession_fee, 1_000_000);
assert.equal(canIssueContract(common).ok, true, canIssueContract(common).reason);

const custom = applyPolicyDefaults({
  policy_code: 'SIM-CUSTOM',
  property_compensation_limit: '5억원',
  payment_timing: '후불',
}).next;
assert.equal(custom.property_compensation_limit, '5억원');
assert.equal(custom.payment_timing, '후불');
assert.equal(canIssueContract(custom).ok, true, canIssueContract(custom).reason);

console.log('PASS: 공통 정책 신규 기본값·공급사 예외 보존·전자계약 발송 게이트');
