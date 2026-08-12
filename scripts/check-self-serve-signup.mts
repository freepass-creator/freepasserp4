import { readFileSync } from 'node:fs';
import { isBlocked, type Session } from '../lib/auth-session';

let failed = 0;
function check(label: string, ok: boolean): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failed += 1;
}

const authSource = readFileSync(new URL('../lib/firebase/auth.ts', import.meta.url), 'utf8');
const loginSource = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8');
const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'));
const userRules = rules.rules.users.$uid;
const statusRule = String(userRules.status['.validate'] || '');
const userCodeRule = String(userRules.user_code['.validate'] || '');

check('자가가입 프로필은 영업자 역할로 고정', /role:\s*'agent'/.test(authSource));
check('자가가입 프로필은 즉시 active', /status:\s*'active'/.test(authSource));
check('자가가입 user_code는 Firebase uid', /const user_code = uid;/.test(authSource));
check('가입 유형을 필수로 막지 않음', !/if \(!su\.type\)/.test(loginSource));
check('가입 화면이 관리자 승인 대기를 안내하지 않음', !/관리자 승인 후 이용/.test(loginSource));

check('Rules는 최초 agent active만 허용',
  statusRule.includes("!data.exists()")
  && statusRule.includes("newData.val() === 'active'")
  && statusRule.includes("newData.parent().child('role').val() === 'agent'"));
check('Rules는 최초 active 계정의 회사·채널 자가주장을 금지',
  statusRule.includes("!newData.parent().child('company_code').exists()")
  && statusRule.includes("!newData.parent().child('agent_channel_code').exists()"));
check('Rules는 최초 user_code를 auth.uid로 고정',
  userCodeRule.includes('$uid === auth.uid')
  && userCodeRule.includes('newData.val() === auth.uid'));
check('Rules는 user_code 사후 자가변경을 허용하지 않음',
  userCodeRule.includes('newData.val() === data.val()'));

const base: Session = {
  uid: 'uid-self-serve', email: 'agent@example.com', role: 'agent', rawRole: 'agent',
  name: '신규영업자', code: 'uid-self-serve', company_code: '', agent_channel_code: 'uid-self-serve',
  user_code: 'uid-self-serve', status: 'active',
};
check('소속 없는 active 영업자는 앱 게이트 통과', !isBlocked(base));
check('관리자가 보류한 pending 계정은 계속 차단', isBlocked({ ...base, status: 'pending' }));
check('비활성 계정은 계속 차단', isBlocked({ ...base, is_active: '아니오' }));

if (failed) process.exitCode = 1;
else console.log('자가가입 즉시 이용 게이트 정합성 PASS');
