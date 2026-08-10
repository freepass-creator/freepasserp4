import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/drive'] });
const token = (await jwt.getAccessToken()).token;
const q = await (await fetch(`https://www.googleapis.com/drive/v3/about?fields=storageQuota&access_token=${token}`)).json();
console.log('저장용량:', JSON.stringify(q.storageQuota || q.error?.message));
const d = await (await fetch(`https://www.googleapis.com/drive/v3/drives?pageSize=10&access_token=${token}`)).json();
console.log('공유 드라이브:', d.error ? `✗ ${d.error.message}` : `${(d.drives||[]).length}개 ${(d.drives||[]).map((x:any)=>x.name).join(', ')}`);
