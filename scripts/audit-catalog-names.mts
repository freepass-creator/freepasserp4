/**
 * 손님에게 나가는 **차명 전수 점검** — 카탈로그에 실제로 실리는 것만.
 *
 * 시트·재고가 아무리 맞아도 손님 화면에 이름이 비거나 겹치면 소용이 없다.
 * 여기서 세는 것은 «출고불가를 뺀» 실제 노출분이다.
 *
 *   npx tsx scripts/audit-catalog-names.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isListableProduct } from '../lib/domain/product';
import { composeVehicleName } from '../lib/domain/vehicle-defaults';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [
  'https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email',
]});
const token = (await jwt.getAccessToken()).token;
const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${token}`)).text()) || {};
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

let n = 0;
const empty: string[] = [], noModel: string[] = [], dup: string[] = [], noTrim: string[] = [], review: string[] = [];
const byMaker = new Map<string, { n: number; bad: number }>();
for (const p of Object.values(prods) as Rec[]) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  // 손님에게 실제로 나가는 것만 — 카탈로그와 «같은 기준»을 써야 감사가 의미가 있다.
  if (!isListableProduct(p as never)) continue;
  n++;
  const name = composeVehicleName(p as never, entries);
  const plate = S(p.car_number) || '(무번호)';
  const mk = S(p.maker) || '(제조사없음)';
  if (!byMaker.has(mk)) byMaker.set(mk, { n: 0, bad: 0 });
  const e = byMaker.get(mk)!; e.n++;

  const toks = name.split(/\s+/).filter(Boolean);
  if (!name) { empty.push(plate); e.bad++; }
  else if (!S(p.sub_model) && !S(p.model)) { noModel.push(`${plate}  ${name}`); e.bad++; }
  else if (new Set(toks).size !== toks.length) { dup.push(`${plate}  ${name}`); e.bad++; }
  if (!S(p.trim_name)) noTrim.push(plate);
  if (p._needs_master_review === true) review.push(`${plate}  ${name}`);
}

console.log(`\n══ 손님에게 나가는 차명 ${n}대 ══\n`);
const pct = (x: number) => `${((x / n) * 100).toFixed(1)}%`;
console.log(`  ✗ 이름이 빈 매물        ${empty.length}  ${pct(empty.length)}`);
console.log(`  ✗ 모델명이 없는 매물     ${noModel.length}  ${pct(noModel.length)}`);
console.log(`  ✗ 겹말                 ${dup.length}  ${pct(dup.length)}`);
console.log(`  · 트림 없음(대개 원본에 없음) ${noTrim.length}  ${pct(noTrim.length)}`);
console.log(`  · 차종 검수 필요         ${review.length}  ${pct(review.length)}`);
const show = (t: string, a: string[]) => { if (!a.length) return; console.log(`\n  ${t}`); for (const x of a.slice(0, 12)) console.log('    ▼ ' + x); if (a.length > 12) console.log(`    … 그 밖 ${a.length - 12}`); };
show('이름이 빈 매물', empty);
show('모델명이 없는 매물', noModel);
show('겹말', dup);
show('차종 검수 필요', review);
console.log('\n  제조사별 문제율');
for (const [mk, e] of [...byMaker].sort((a, b) => b[1].bad - a[1].bad).slice(0, 8)) {
  if (!e.bad) continue;
  console.log(`    ${mk.padEnd(10)} ${e.bad}/${e.n}`);
}
process.exit(empty.length + noModel.length + dup.length ? 1 : 0);
