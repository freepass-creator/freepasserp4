import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { canonProductType, isListableProduct, TEMP_PLATE_RE } from '../lib/domain/product';
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
const by = new Map<string, number>();
for (const v of sheet) by.set(canonProductType((v as Rec).product_type) || '(빈)', (by.get(canonProductType((v as Rec).product_type) || '(빈)') || 0) + 1);
console.log(`■ 시트 ${sheet.length}대 구분 분포`);
for (const [k, n] of [...by.entries()].sort((a,b)=>b[1]-a[1])) console.log(`   ${String(n).padStart(4)}  ${k}`);

// 사장님 규칙 검증 — 주행 300km · 임시번호
console.log('\n■ 규칙 대조 (구분이 이미 있는 차로 확인)');
let mismatch = 0, checked = 0;
for (const v of sheet) {
  const t = canonProductType((v as Rec).product_type); if (!t) continue;
  const km = Number(String((v as Rec).mileage ?? '').replace(/[^\d]/g, '')) || 0;
  const plate = S((v as Rec).car_number);
  const isNewByRule = km <= 300 || !plate || TEMP_PLATE_RE.test(plate);
  const isNewByData = t.startsWith('신차');
  checked++;
  if (isNewByRule !== isNewByData) { mismatch++; if (mismatch <= 8) console.log(`   ✗ ${plate || '(무번호)'} ${t} · 주행 ${km}km`); }
}
console.log(`   대조 ${checked}대 · 어긋남 ${mismatch}대`);
