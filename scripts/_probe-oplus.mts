import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { priceList, priceVariants, autoplusMileageUpchargeLabel } from '../lib/domain/product';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] });
const token = (await jwt.getAccessToken()).token;
const p = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${token}`)).text());
let n = 0;
for (const [k, v] of Object.entries(p as Record<string, Rec>)) {
  if (S(v?.provider_company_code) !== 'RP023' || v?._deleted) continue;
  if (!Object.keys(v.price || {}).some(x => x.includes('_'))) continue;
  if (n++ >= 2) break;
  console.log(`■ ${S(v.car_number)}  ${S(v.model)} ${S(v.sub_model)}`);
  console.log('  원본 price 키:', Object.keys(v.price).join(' , '));
  console.log('  priceVariants(전부):');
  for (const e of priceVariants(v as never)) console.log(`     ${e.key.padEnd(10)} ${e.m}개월 ${e.mileage||'(기본)'} rent=${e.rent.toLocaleString()} dep=${e.deposit.toLocaleString()}`);
  console.log('  priceList(표준칸에 나가는 값):');
  for (const e of priceList(v as never)) console.log(`     ${e.m}개월 rent=${e.rent.toLocaleString()} dep=${e.deposit.toLocaleString()}`);
  console.log('  1만km추가 라벨:', autoplusMileageUpchargeLabel(v as never) || '(없음)');
  console.log('');
}
