/**
 * 구글 권한이 «실제로» 열려 있는지 본다 — pyh@teamjpk.com 대행.
 *
 * ★설정 화면에 적혀 있는 것과 실제로 토큰이 나오는 것은 다르다. 받아 봐야 안다.
 *   2026-08-27 확인 — drive 는 열려 있고 gmail 은 막혀 있다.
 *
 * gmail 을 열려면 사장님이 하셔야 한다:
 *   워크스페이스 관리 콘솔 › 보안 › API 제어 › 도메인 전체 위임
 *   → 서비스 계정에 https://www.googleapis.com/auth/gmail.send 추가
 *
 *   node scripts/check-google-scopes.mjs
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
const test = async (scope, label) => {
  const c = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [scope], subject: 'pyh@teamjpk.com' });
  try { await c.authorize(); console.log('  ○ ' + label.padEnd(22) + '열려 있습니다'); return true; }
  catch (e) { console.log('  ⛔ ' + label.padEnd(22) + String(e.message || e).split('\n')[0].slice(0, 70)); return false; }
};
console.log('\n■ 위임된 권한 확인 — pyh@teamjpk.com 대행\n');
await test('https://www.googleapis.com/auth/drive', 'drive');
await test('https://www.googleapis.com/auth/gmail.send', 'gmail.send');
await test('https://www.googleapis.com/auth/gmail.compose', 'gmail.compose');
console.log('');
