import { isBlocked, blockReason, mapRole, type Session } from '../lib/auth-session';
import { requirePositiveRentAmount } from '../lib/domain/contract-money';

let pass = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`${name}: expected=${String(expected)} actual=${String(actual)}`);
  pass++;
}

const base: Session = {
  uid: 'u1', email: 'qa@example.com', role: 'agent', rawRole: 'agent', name: 'QA',
  code: 'U1', company_code: '', agent_channel_code: 'A1', user_code: 'U1', status: 'active', is_active: '예',
};

check('정상 역할은 허용', isBlocked(base), false);
check('역할 미지정 활성 계정 차단', isBlocked({ ...base, rawRole: '' }), true);
check('알 수 없는 역할 차단', isBlocked({ ...base, rawRole: 'unknown' }), true);
check('역할 미지정 차단 사유', blockReason({ ...base, rawRole: '' }), 'unassigned');
check('레거시 영업관리자 허용', isBlocked({ ...base, rawRole: 'agent_manager' }), false);
check('화면 호환 역할 투영 유지', mapRole('agent_manager'), 'agent');
check('정상 월대여료 허용', requirePositiveRentAmount(550000, 'QA'), 550000);

for (const bad of [0, -1, '', null, undefined, 'not-a-number']) {
  let rejected = false;
  try { requirePositiveRentAmount(bad, 'QA'); } catch { rejected = true; }
  check(`비정상 월대여료 차단(${String(bad)})`, rejected, true);
}

console.log(`release blockers: ${pass}/${pass} PASS`);
