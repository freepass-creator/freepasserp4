/**
 * **워크스페이스 자동 통과가 «열려야 할 때만» 열리는가.** 순수 판정만 본다 — 네트워크 없음.
 *
 * ★사장님 2026-08-26 「프리패스 erp 우리 워크스페이스 직원들은 자동으로 통과되게 해줘」.
 *   문을 하나 여는 일이다. 열어 놓고 «잘 되네» 하면 안 되고, **안 열려야 할 때 안 열리는지**를 센다.
 *
 * ★기준 프로필을 **옛 규칙으로는 통과 못 하는 것**으로 잡는다(소속이 배정된 pending).
 *   아무 pending 이나 쓰면 «옛 문으로 들어온 것»을 «새 문이 열린 것»으로 착각한다 — 실측으로 걸렸다.
 *
 *   npx tsx scripts/check-auth-workspace.mts
 */
import { isWorkspaceEmail, selfServeActivationDecision } from '../lib/domain/self-serve-activation';

const UID = 'uid_staff_1';
/** 소속이 배정된 pending — 옛 규칙은 `identity_already_assigned` 로 막는다. */
const assigned = { uid: UID, status: 'pending', role: 'agent', company_code: 'RP006', requested_type: '영업', created_at: 1 };
/** 미배정 자가가입자 — 옛 문으로 통과하던 계정. 새 문과 섞이지 않게 따로 둔다. */
const legacy = { uid: UID, status: 'pending', role: 'agent', requested_type: '영업', created_at: 1 };

const V = (email: string, emailVerified = true) => ({ email, emailVerified });
/** **새 문으로** 열렸는가. 사유까지 봐야 옛 문과 구분된다. */
const open = (p: Record<string, unknown>, v?: { email: string; emailVerified: boolean }) => {
  const d = selfServeActivationDecision(p, UID, v);
  return d.eligible && d.reason === 'workspace_member';
};
const any = (p: Record<string, unknown>, v?: { email: string; emailVerified: boolean }) =>
  selfServeActivationDecision(p, UID, v).eligible;

type Case = [name: string, got: boolean, want: boolean];
const cases: Case[] = [
  ['우리 도메인 · 검증된 메일 → 새 문이 열린다', open(assigned, V('kjs@teamjpk.com')), true],
  ['우리 도메인인데 **메일 미검증** → 안 열린다', open(assigned, V('kjs@teamjpk.com', false)), false],
  ['★비슷한 도메인(teamjpk.com.evil.kr) → 안 열린다', open(assigned, V('x@teamjpk.com.evil.kr')), false],
  ['★앞에 붙인 것(x@notteamjpk.com) → 안 열린다', open(assigned, V('x@notteamjpk.com')), false],
  ['★서브도메인(x@a.teamjpk.com) → 안 열린다', open(assigned, V('x@a.teamjpk.com')), false],
  ['바깥 도메인 → 안 열린다', open(assigned, V('x@gmail.com')), false],
  ['이메일을 아예 안 넘기면 → 안 열린다 (검증된 것만 받는다)', open(assigned), false],
  ['★내보낸 사람(deleted)은 도메인이어도 막힘', any({ ...assigned, status: 'deleted' }, V('kjs@teamjpk.com')), false],
  ['★반려(rejected)도 막힘', any({ ...assigned, status: 'rejected' }, V('kjs@teamjpk.com')), false],
  ['★비활성(is_active=false)도 막힘', any({ ...assigned, is_active: false }, V('kjs@teamjpk.com')), false],
  ['★비활성(「아니오」)도 막힘', any({ ...assigned, is_active: '아니오' }, V('kjs@teamjpk.com')), false],
  ['이미 active 면 통과 대상이 아님', any({ ...assigned, status: 'active' }, V('kjs@teamjpk.com')), false],
  ['옛 문(미배정 자가가입)은 그대로 열려 있다', any(legacy, V('x@gmail.com')), true],
  ['대문자 메일도 같은 도메인으로 본다', isWorkspaceEmail('KJS@TeamJPK.com'), true],
];

console.log('\n■ 워크스페이스 자동 통과 — 열려야 할 때만 열리는가\n');
let bad = 0;
for (const [name, got, want] of cases) {
  if (got !== want) bad++;
  console.log(`   ${got === want ? '✓' : '⛔'} ${name}`);
}

console.log('\n   ⚠ 자동 통과는 «승인»까지다. 관리자 권한은 여전히 사람이 준다 —');
console.log('      도메인만으로 admin 을 주면 메일 하나로 전 회사 금액이 열린다.');
console.log(`\n${bad === 0 ? '■ 초록 — 우리 직원만 통과하고, 내보낸 사람은 도메인이어도 막힌다.' : `⛔ 빨강 — ${bad}가지가 어긋난다. 문이 잘못 열린다.`}\n`);
process.exit(bad === 0 ? 0 : 1);
