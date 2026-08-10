/**
 * **전기·수소차에 붙은 배기량을 지운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★전기차에 cc 는 없다. 시트에 「998」처럼 내연 형제의 배기량이 적혀 오거나
 *   옛 유입이 남긴 값이 그대로 붙어 있다(실측 2026-08-10 · 11대. 레이 EV 에 998cc,
 *   테슬라 모델3 에 239cc).
 *   숫자가 있으면 영업자·손님이 그걸 사실로 읽는다 — 없는 값은 비워야 한다.
 *
 * ⚠ 연료가 전기·수소로 «확실한» 차만 건드린다. 연료가 비었거나 모르는 말이면 손대지 않는다.
 *
 *   npx tsx scripts/fix-ev-engine-cc.mts
 *   npx tsx scripts/fix-ev-engine-cc.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const t = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;

const isEv = (v: unknown) => {
  const s = S(v).replace(/\s|\d|\./g, '').toLowerCase();
  return /전기|ev|electric|수소|fcev/.test(s);
};
const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${t}`)).text()) || {};
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const targets = Object.entries<Rec>(prods)
  .filter(([, p]) => p && typeof p === 'object' && !dead(p))
  .filter(([, p]) => isEv(p.fuel_type) && Number(S(p.engine_cc).replace(/[^\d]/g, '')) > 0)
  .map(([k, p]) => ({ key: k, plate: S(p.car_number), car: `${S(p.maker)} ${S(p.sub_model) || S(p.model)}`, cc: S(p.engine_cc) }));

console.log(`■ 전기·수소차 배기량 지우기 ${APPLY ? '(반영)' : '(dry-run)'} — ${targets.length}대\n`);
for (const x of targets) console.log(`   ${x.plate.padEnd(11)} ${x.car.slice(0, 24).padEnd(26)} ${x.cc}cc → 비움`);
if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply\n'); process.exit(0); }

const at = new Date().toISOString();
let n = 0;
for (const x of targets) {
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(x.key)}.json?access_token=${t}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine_cc: null, updatedAt: at }),
  });
  if (res.ok) n++;
}
console.log(`\n  지움 ${n}대\n`);
