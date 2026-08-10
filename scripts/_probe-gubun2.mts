import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { canonProductType, isListableProduct } from '../lib/domain/product';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] });
const token = (await jwt.getAccessToken()).token;
const [p, t3, t4] = await Promise.all(['v4/products','partners','v4/partners'].map(async n =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${token}`)).text()) || {}));
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k]||{}), ...v, _key: k };
const nameOf = (c: string) => { if (!c) return '(코드없음)'; const h = Object.values(partners).find(x => S(x.partner_code) === c || S(x._key) === c); return S(h?.partner_name || h?.name) || c; };
const dead = (v: Rec) => v?._deleted === true || !!v?.deletedAt || S(v?.status) === 'deleted';
const empty = new Map<string, number>(); let listableEmpty = 0;
for (const [k, v] of Object.entries(p as Record<string, Rec>)) {
  if (!v || typeof v !== 'object' || dead(v)) continue;
  if (canonProductType(v.product_type)) continue;
  const who = nameOf(S(v.provider_company_code));
  empty.set(who, (empty.get(who) || 0) + 1);
  if (isListableProduct({ ...v, _key: k } as never)) listableEmpty++;
}
console.log(`■ 구분이 빈 매물 — 공급사별 (목록에 서는 것 ${listableEmpty}대 포함)`);
for (const [k, n] of [...empty.entries()].sort((a,b)=>b[1]-a[1])) console.log(`   ${String(n).padStart(4)}  ${k}`);
