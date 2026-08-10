import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
console.log('서비스계정:', sa.client_email);
const jwt = new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive'] });
const token = (await jwt.getAccessToken()).token;
// 서비스계정 드라이브 용량 — 파일을 만들 수 있는지 가른다
const about = await (await fetch(`https://www.googleapis.com/drive/v3/about?fields=storageQuota,user&access_token=${token}`)).json();
console.log('about:', JSON.stringify(about).slice(0, 300));
