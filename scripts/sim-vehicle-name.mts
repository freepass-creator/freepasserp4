/**
 * 차명 조립 규칙 검사 — **고를 수 있는 것만 적는다.**
 *
 *   세부모델 + 파워트레인(연료·배기량 · 고를 수 있으면 인승·구동) + 세부트림
 *
 * 그랜저 GN7 은 2륜·4륜을 고를 수 있어 구동을 적고, 카니발 KA4 는 9·7·11·4인승을 고를 수 있어
 * 인승을 적는다. 쏘나타 DN8 은 둘 다 선택지가 없어 아무것도 안 적는다.
 * 선택지가 있는데 안 적혀 왔으면 기본값으로 넣는다(구동 2WD · 인승 첫 선택지).
 *
 *   npx tsx scripts/sim-vehicle-name.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { choicesOf, composeVehicleName, driveForName, seatsForName } from '../lib/domain/vehicle-defaults';

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

/** 이관 도구와 **같은 조립**을 쓴다 — 여기서 따로 이으면 검사가 지키는 게 없다. */
const composeName = (p: Rec) => composeVehicleName(p as never, entries);

let n = 0, dupTokens = 0, withSeats = 0, withDrive = 0;
const bad: string[] = [];
const samples = new Map<string, string>();
for (const p of Object.values(prods) as Rec[]) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  n++;
  const name = composeName(p);
  const toks = name.split(/\s+/).filter(Boolean);
  if (new Set(toks).size !== toks.length) {
    dupTokens++;
    if (bad.length < 8) bad.push(`${S(p.car_number) || '(무번호)'}  ${name}`);
  }
  if (seatsForName(p.seats, p.sub_model, entries)) withSeats++;
  if (driveForName(p.drive_type, p.sub_model, entries)) withDrive++;
  const key = S(p.sub_model);
  if (key && !samples.has(key) && samples.size < 10) samples.set(key, name);
}

console.log(`\n══ 차명 조립 — 활성 ${n}대 ══\n`);
console.log(`  인승이 붙는 매물 ${withSeats} · 구동이 붙는 매물 ${withDrive}`);
console.log(`  겹말(같은 낱말 두 번) ${dupTokens}`);
if (bad.length) { console.log('\n  겹말 예'); for (const b of bad) console.log('    ▼ ' + b); }
console.log('\n  표본');
for (const [sub, name] of samples) {
  const c = choicesOf(sub, entries);
  console.log(`    ${name}\n        선택지 — 구동 ${c.drives.join('/') || '없음'} · 인승 ${c.seats.join('/') || '없음'}`);
}
process.exit(dupTokens ? 1 : 0);
