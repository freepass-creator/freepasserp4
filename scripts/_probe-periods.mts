import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isListableProduct, priceList, priceVariants } from '../lib/domain/product';
import { dedupeForSales } from '../lib/domain/inventory-sheet-export';
import type { EntityRecord } from '../lib/intake/entities';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] });
const token = (await jwt.getAccessToken()).token;
const p = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${token}`)).text());
const dead = (v: Rec) => v?._deleted === true || !!v?.deletedAt || S(v?.status) === 'deleted';
const all = Object.entries(p as Record<string, Rec>).filter(([, v]) => v && typeof v === 'object' && !dead(v))
  .map(([k, v]) => ({ ...v, _key: k, product_code: v.product_code || k } as EntityRecord));
const sheet = dedupeForSales(all.filter(isListableProduct));
const months = new Map<number, number>(); const mile = new Map<string, number>();
for (const v of sheet) {
  for (const e of priceList(v)) months.set(e.m, (months.get(e.m) || 0) + 1);
  for (const e of priceVariants(v)) if (e.mileage) mile.set(`${e.m}개월·${e.mileage}`, (mile.get(`${e.m}개월·${e.mileage}`) || 0) + 1);
}
console.log('■ 시트 409대에 실제로 있는 기간(기본가 기준)');
for (const [m, n] of [...months.entries()].sort((a,b)=>a[0]-b[0])) console.log(`   ${String(m).padStart(3)}개월  ${String(n).padStart(4)}대`);
console.log('\n■ 주행거리 변형(같은 개월인데 약정주행이 다름)');
for (const [k, n] of [...mile.entries()].sort((a,b)=>b[1]-a[1]).slice(0,14)) console.log(`   ${k.padEnd(16)} ${String(n).padStart(4)}대`);
