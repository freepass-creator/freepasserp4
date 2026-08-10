import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
console.log('서비스계정:', sa.client_email, '\nclient_id:', sa.client_id);
try {
  const jwt = new JWT({
    email: sa.client_email, key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
    subject: 'pyh@teamjpk.com',          // ← 도메인 위임(대행) 시도
  });
  const token = (await jwt.getAccessToken()).token;
  const q = await (await fetch(`https://www.googleapis.com/drive/v3/about?fields=user,storageQuota&access_token=${token}`)).json();
  console.log('대행 결과:', JSON.stringify(q).slice(0, 260));
} catch (e) {
  console.log('✗ 대행 불가:', String((e as Error).message).slice(0, 260));
}
