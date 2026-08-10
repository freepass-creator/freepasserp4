import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { canonProductType } from '../lib/domain/product';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] });
const token = (await jwt.getAccessToken()).token;
const p = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${token}`)).text());
const dead = (v: Rec) => v?._deleted === true || !!v?.deletedAt || S(v?.status) === 'deleted';
const raw = new Map<string, number>(); const canon = new Map<string, number>();
for (const v of Object.values(p as Record<string, Rec>)) {
  if (!v || typeof v !== 'object' || dead(v)) continue;
  const r = S(v.product_type) || '(빈)';
  raw.set(r, (raw.get(r) || 0) + 1);
  const c = canonProductType(v.product_type) || '(빈)';
  canon.set(c, (canon.get(c) || 0) + 1);
}
console.log('■ ERP 저장값(product_type) 원본');
for (const [k, n] of [...raw.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}  ${k}`);
console.log('\n■ 캐논 적용 후');
for (const [k, n] of [...canon.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}  ${k}`);
