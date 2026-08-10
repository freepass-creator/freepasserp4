import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
const S = (v: unknown) => String(v ?? '').trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] });
const token = (await jwt.getAccessToken()).token;
const p = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${token}`)).text());
for (const [k, v] of Object.entries(p as Record<string, any>)) {
  if (!v || typeof v !== 'object') continue;
  const blob = `${S(v.variant)} ${S(v.trim_name)} ${S(v.trim_extra)}`;
  if (S(v.car_number) === '13수0234' || (S(v.sub_model) === 'GV80 JX1' && /터보/.test(blob))) {
    console.log(`${S(v.car_number) || '(무번호)'}  key=${k}`);
    console.log(`   sub=${S(v.sub_model)} variant=${S(v.variant)} trim=${S(v.trim_name)}`);
    console.log(`   trim_extra=${S(v.trim_extra)}`);
  }
}
