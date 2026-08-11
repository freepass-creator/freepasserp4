import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isHiddenFromCatalog, priceList } from '../lib/domain/product';
const S = (v: unknown) => String(v ?? '').trim();
const raw = JSON.parse(readFileSync('public/data/vehicle-master.json','utf8')) as any;
const entries = (Array.isArray(raw)?raw:raw.entries)||[];
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const t = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database','https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const prods = JSON.parse(await (await fetch(`https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app/v4/products.json?access_token=${t}`)).text())||{};
const dead=(p:any)=>p?._deleted===true||!!p?.deletedAt||S(p?.status)==='deleted';
const bad = Object.entries<any>(prods).filter(([,p])=>p&&typeof p==='object'&&!dead(p)).map(([k,p])=>({...p,_key:k}))
  .filter((p)=>!isHiddenFromCatalog(p as any)&&priceList(p as any).length>0&&!S(p.trim_name));
console.log(`세부트림 빈 차 ${bad.length}대\n`);
let ok=0, no=0; const rows: string[] = [];
for (const p of bad) {
  const e = entries.find((x:any)=>S(x.sub_model)===S(p.sub_model));
  const v = (e?.variants||[]).find((x:any)=>S(x.label)===S(p.variant));
  const trims: string[] = (v?.trims||[]).map(S).filter(Boolean);
  const pick = trims[0] || '';
  if (pick) { ok++; if (rows.length<14) rows.push(`  ${S(p.car_number).padEnd(11)} ${S(p.provider_company_code).padEnd(9)} ${(S(p.sub_model)).slice(0,20).padEnd(22)} ${S(p.variant).padEnd(16)} → 「${pick}」  (후보 ${trims.join('·')})`); }
  else no++;
}
for (const r of rows) console.log(r);
console.log(`\n채울 수 있는 차 ${ok}대 · 마스터에 트림 후보가 없는 차 ${no}대`);
