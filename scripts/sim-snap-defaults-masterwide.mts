/**
 * 마스터 전 세부모델 — 인승축/구동축 빈칸 기본값 스모크 (로컬 JSON만, 쓰기 없음).
 *   npx tsx scripts/sim-snap-defaults-masterwide.mts
 */
import { readFileSync } from 'node:fs';
import { snapToMaster, applySnap, type MasterEntry } from '../lib/domain/vehicle-master-match';
import { canonDrive, choicesOf, representativeSeat } from '../lib/domain/vehicle-defaults';

const S = (v: unknown) => String(v ?? '').trim();
const master = (JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')).entries || []) as MasterEntry[];

const seatAxis = master.filter((e) => choicesOf(e.sub_model, master).seats.length >= 2);
const driveAxis = master.filter((e) => choicesOf(e.sub_model, master).drives.length >= 2);

console.log(`\n══ 마스터 축 스모크 · 인승축 ${seatAxis.length} · 구동축 ${driveAxis.length} ══\n`);

const byModel = new Map<string, number>();
for (const e of seatAxis) byModel.set(e.model, (byModel.get(e.model) || 0) + 1);
console.log('인승축 모델(상위):');
for (const [m, n] of [...byModel].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${m} ${n}`);
}

let seatOk = 0;
let seatFail = 0;
let driveOk = 0;
let driveFail = 0;
const fails: string[] = [];

for (const e of seatAxis) {
  const raw: Record<string, unknown> = {
    maker: e.maker,
    model: e.model,
    sub_model: e.sub_model,
    year: String(e.year_start || 2024),
  };
  const v0 = (e.variants || [])[0];
  if (v0?.fuel) raw.fuel_type = v0.fuel;
  if (v0?.displacement_l) raw.engine_cc = String(Math.round(v0.displacement_l * 1000));
  const snap = snapToMaster(raw as never, master);
  const applied = snap ? applySnap(raw as never, snap, { source: 'sim' }) : null;
  if (!snap) {
    seatFail++;
    fails.push(`null ${e.sub_model}`);
    continue;
  }
  const ch = choicesOf(snap.sub_model, master);
  if (ch.seats.length < 2) {
    seatOk++;
    continue;
  }
  // 인승축이 여러 개인 차량은 입력에 인승 증거가 없으면 비워 두는 것이 안전하다.
  // 값이 채워졌다면 반드시 마스터 선택지 안이어야 한다.
  const got = S(applied?.seats);
  if (!got || ch.seats.includes(got)) seatOk++;
  else {
    seatFail++;
    const mode = representativeSeat(snap.sub_model, master);
    fails.push(`SEAT ${e.sub_model}→${S(snap.sub_model)} got=${got || '(빈)'} choices=${ch.seats.join('/')} mode=${mode}`);
  }
}

for (const e of driveAxis) {
  const raw: Record<string, unknown> = {
    maker: e.maker,
    model: e.model,
    sub_model: e.sub_model,
    year: String(e.year_start || 2024),
  };
  const v0 = (e.variants || []).find((v) => S(v.drivetrain)) || (e.variants || [])[0];
  if (v0?.fuel) raw.fuel_type = v0.fuel;
  if (v0?.displacement_l) raw.engine_cc = String(Math.round(v0.displacement_l * 1000));
  const snap = snapToMaster(raw as never, master);
  const applied = snap ? applySnap(raw as never, snap, { source: 'sim' }) : null;
  if (!snap) {
    driveFail++;
    fails.push(`nullD ${e.sub_model}`);
    continue;
  }
  const ch = choicesOf(snap.sub_model, master);
  if (ch.drives.length < 2) {
    driveOk++;
    continue;
  }
  const got = canonDrive(applied?.drive_type);
  if (!got || ch.drives.includes(got)) driveOk++;
  else {
    driveFail++;
    fails.push(`DRV ${e.sub_model}→${S(snap.sub_model)} got=${S(applied?.drive_type)}`);
  }
}

console.log(`\n인승축 빈칸 보존/선택지 검증  OK ${seatOk} · FAIL ${seatFail}`);
console.log(`구동축 빈칸 보존/선택지 검증  OK ${driveOk} · FAIL ${driveFail}`);
if (fails.length) {
  console.log('\n실패 표본:');
  for (const f of fails.slice(0, 20)) console.log(`  ${f}`);
}
console.log('');
process.exit(seatFail || driveFail ? 1 : 0);
