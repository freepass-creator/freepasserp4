import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
];
for (const sc of SCOPES) {
  try {
    const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [sc], subject: 'pyh@teamjpk.com' });
    await jwt.getAccessToken();
    console.log('✓ 위임됨 :', sc);
  } catch (e) {
    console.log('✗       :', sc, '—', String((e as Error).message).split(':')[0]);
  }
}
