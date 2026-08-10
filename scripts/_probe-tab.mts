import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
const S = (v: unknown) => String(v ?? '').trim();
const ID = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const token = (await jwt.getAccessToken()).token;
const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ID}?fields=sheets.properties&access_token=${token}`)).json();
for (const s of meta.sheets || []) {
  const t = S(s.properties.title);
  if (/공급사연동|상품리스트|종합표/.test(t)) {
    console.log(`${t.padEnd(30)} https://docs.google.com/spreadsheets/d/${ID}/edit#gid=${s.properties.sheetId}`);
  }
}
