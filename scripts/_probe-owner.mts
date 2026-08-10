import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/drive'] });
const token = (await jwt.getAccessToken()).token;
const ID = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';   // 영업자용 프리패스 상품리스트
const f = await (await fetch(`https://www.googleapis.com/drive/v3/files/${ID}?fields=name,owners(emailAddress),createdTime,capabilities(canShare,canEdit)&access_token=${token}`)).json();
console.log('영업자시트:', JSON.stringify(f));
