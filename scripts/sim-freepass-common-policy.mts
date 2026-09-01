import assert from 'node:assert/strict';
import { applyPolicyDefaults, FREEPASS_POLICY_PACK } from '@/lib/domain/policy-defaults';
import { canIssueContract, isUsableInsurerName } from '@/lib/domain/policy-tier';

const common = applyPolicyDefaults({ policy_code: 'SIM-COMMON' }).next;
assert.equal(common.policy_default_pack, FREEPASS_POLICY_PACK);
assert.equal(common.insurance_included, '보험료 포함'); // 2026-08-19 시트 규격 글자
// 사장님 2026-08-19 프리패스 기본 정책(손오공 시트 기본행): 대물 1억원 · 자손 1억원 · 승계 가능 · 면허 1년 이상 · 약정 연 30,000km
assert.equal(common.property_compensation_limit, '1억원');
assert.equal(common.self_body_accident, '1억원');
assert.equal(common.succession_allowed, '가능');
assert.equal(common.license_period, '1년 이상');
assert.equal(common.annual_mileage, '연 30,000km');
assert.equal(common.uninsured_damage, '없음'); // 사장님 2026-08-19 프리패스 기본 정책(무보험보상 없음)
assert.equal(common.late_fee_rate, 0.24);
assert.equal(common.succession_fee, '100만원'); // 2026-08-19 — 정액·정률 겸용 글자(시트 규격). 돈으로 굳히는 건 policy-money-rate.
assert.equal(common.early_termination_rate_under1y, '30%');
assert.equal(common.basic_driver_age, '만 26세 이상');
assert.equal(canIssueContract(common).ok, false, '기본 보험사 안내문만으로는 보험포함 계약을 발행하면 안 된다');
assert.equal(isUsableInsurerName(common.insurer_name), false);
const confirmedInsurer = { ...common, insurer_name: '테스트손해보험 주식회사' };
assert.equal(canIssueContract(confirmedInsurer).ok, true, canIssueContract(confirmedInsurer).reason);
assert.equal(isUsableInsurerName(confirmedInsurer.insurer_name), true);
for (const placeholder of [
  '공급사기재', '공급사 기재', '입력요망', '기재요망', '추후기재', '미기재', '미가입', 'N/A', 'NA', '?',
]) {
  assert.equal(isUsableInsurerName(placeholder), false, `${placeholder}은(는) 실제 보험사명이 아니다`);
}
assert.equal(isUsableInsurerName('AXA손해보험(차량별 상이)'), true, '실제 보험사 표기는 차단하지 않는다');
const directInsurance = { ...common, insurance_included: '보험료 별도(고객 직접 가입)' };
assert.equal(canIssueContract(directInsurance).ok, true, '고객 직접가입형은 회사 보험사명을 요구하면 안 된다');

const custom = applyPolicyDefaults({
  policy_code: 'SIM-CUSTOM',
  property_compensation_limit: '5억원',
  payment_timing: '후불',
  insurer_name: '샘플공제조합',
}).next;
assert.equal(custom.property_compensation_limit, '5억원');
assert.equal(custom.payment_timing, '후불');
assert.equal(canIssueContract(custom).ok, true, canIssueContract(custom).reason);

console.log('PASS: 공통 정책 신규 기본값·실제 보험사 확인 게이트·공급사 예외 보존');
