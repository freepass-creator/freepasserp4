/**
 * 차명이 화면마다 어떻게 조립되는지 — 실데이터로 재 본다.
 *
 * 사장님 2026-08-28 「차명을 어떻게 갖고 와서 어떤 위치에 어떻게 놓는지 ·
 * 어디는 모델명만 · 어디는 세부모델로 · 어디는 세부트림까지 조합해서 · 이걸 학습해서 제안해 보라고」.
 *
 * 읽기만 한다.
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { vehicleNameOf, vehicleNameParts } from '../lib/domain/vehicle-name';
import { isHiddenFromCatalog, priceList } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const t = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${t}`)).text()) || {};
const dead = (p: any) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const live = Object.entries<any>(prods)
  .filter(([, p]) => p && typeof p === 'object' && !dead(p))
  .map(([k, p]) => ({ ...p, _key: k }))
  .filter((p) => !isHiddenFromCatalog(p as any) && priceList(p as any).length > 0);

console.log(`매물 ${live.length}대\n`);

console.log('── 이름을 이루는 원자가 얼마나 차 있나 ──');
const FIELDS = ['maker', 'model', 'sub_model', 'variant', 'trim_name', 'trim_extra', 'vehicle_name', 'supplier_vehicle_name'];
for (const f of FIELDS) {
  const n = live.filter((p) => S(p[f])).length;
  const pct = Math.round((n / live.length) * 100);
  const bar = pct >= 95 ? '████ 거의 다' : pct >= 60 ? '███  대부분' : pct >= 25 ? '██   일부' : '█    드묾';
  console.log(`  ${String(pct).padStart(3)}%  ${f.padEnd(24)} ${bar}  (${n}/${live.length})`);
}

console.log('\n── 등급별로 실제 어떤 글자가 나오나 (무작위 8대) ──');
const step = Math.max(1, Math.floor(live.length / 8));
for (let i = 0; i < live.length && i < step * 8; i += step) {
  const p = live[i] as EntityRecord;
  const t1 = vehicleNameOf({ kind: 'product', product: p }, { tier: 'short' });
  const t2 = vehicleNameOf({ kind: 'product', product: p }, { tier: 'full' });
  const t2NoMaker = vehicleNameOf({ kind: 'product', product: p }, { tier: 'full', omitMaker: true });
  const parts = vehicleNameParts({ kind: 'product', product: p }, { tier: 'full' });
  console.log(`\n  ${S(p.car_number) || '(차번없음)'}  ${S(p.provider_company_code)}`);
  console.log(`     원문   ${S(p.supplier_vehicle_name).slice(0, 60) || '(없음)'}`);
  console.log(`     조각   제조사=${parts.maker || '-'} · main=${parts.main || '-'} · ext=${parts.ext || '-'}`);
  console.log(`     T1     ${t1}`);
  console.log(`     T2     ${t2}`);
  console.log(`     T2-제조사빼기  ${t2NoMaker}`);
}

console.log('\n── T1 과 T2 가 실제로 다른 차는 몇 대인가 ──');
let same = 0, diff = 0;
const samples: string[] = [];
for (const p of live) {
  const a = vehicleNameOf({ kind: 'product', product: p as EntityRecord }, { tier: 'short' });
  const b = vehicleNameOf({ kind: 'product', product: p as EntityRecord }, { tier: 'full' });
  if (a === b) same++;
  else { diff++; if (samples.length < 5) samples.push(`     T1「${a}」 → T2「${b}」`); }
}
console.log(`  같다 ${same}대 · 다르다 ${diff}대 (${Math.round(diff / live.length * 100)}%)`);
for (const s of samples) console.log(s);

console.log('\n── 이름 길이 (T2, 제조사 포함) ──');
const lens = live.map((p) => vehicleNameOf({ kind: 'product', product: p as EntityRecord }, { tier: 'full' }).length).sort((a, b) => a - b);
const q = (r: number) => lens[Math.floor(lens.length * r)];
console.log(`  최소 ${lens[0]} · 25% ${q(0.25)} · 중앙 ${q(0.5)} · 75% ${q(0.75)} · 95% ${q(0.95)} · 최대 ${lens[lens.length - 1]} 글자`);

console.log('\n── 이름에 섞여 들어온 «이름 아닌 것» ──');
const COLORS = /^(블랙|화이트|실버|그레이|블루|레드|그린|베이지|브라운|네이비|퍼플|골드|옐로|아이보리|크림|모카|카키)$/;
const SPECY = /(\d+(\.\d+)?\s*(t|터보|디젤|가솔린|하이브리드|ev)|2wd|4wd|awd|rwd|\d+인승|자가용|영업용)/i;
let colorTrim = 0, specTrim = 0;
const colorEx: string[] = [], specEx: string[] = [];
for (const p of live) {
  const trim = S(p.trim_name);
  if (!trim) continue;
  if (COLORS.test(trim)) { colorTrim++; if (colorEx.length < 4) colorEx.push(`     ${S(p.car_number)} 트림=「${trim}」  원문=${S(p.supplier_vehicle_name).slice(0, 40)}`); }
  else if (SPECY.test(trim)) { specTrim++; if (specEx.length < 4) specEx.push(`     ${S(p.car_number)} 트림=「${trim}」`); }
}
console.log(`  색이 트림 칸에 들어온 차 ${colorTrim}대`);
for (const e of colorEx) console.log(e);
console.log(`  제원(배기량·구동·인승)이 트림 칸에 들어온 차 ${specTrim}대`);
for (const e of specEx) console.log(e);

console.log('\n── main 이 세부모델인가 모델인가 ──');
let bySub = 0, byModel = 0, neither = 0;
for (const p of live) {
  const parts = vehicleNameParts({ kind: 'product', product: p as EntityRecord }, { tier: 'full' });
  const sub = S(p.sub_model), model = S(p.model);
  if (sub && parts.main.includes(sub.replace(S(p.maker), '').trim())) bySub++;
  else if (model && parts.main.includes(model.replace(S(p.maker), '').trim())) byModel++;
  else neither++;
}
console.log(`  세부모델로 선 차 ${bySub}대 · 모델명으로 선 차 ${byModel}대 · 둘 다 아님 ${neither}대`);
