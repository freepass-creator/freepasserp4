/**
 * 있는 매물 기준 — 인승·구동 축 빈칸을 마스터 기본 규칙으로 채운다.
 *   · dry-run(기본): 쓰기 없음
 *   · --apply: high·medium 만 · 신원(제조사·모델·세부) 동일 · 빈 seats/drive만 채움
 *   · 이미 값이 있는 칸을 바꾸거나 신원을 깎는 건 스킵
 *
 *   npx tsx scripts/audit-snap-defaults.mts
 *   BACKUP_STAMP=… npx tsx scripts/backup-products.mts && npx tsx scripts/audit-snap-defaults.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { snapToMaster, applySnap, type MasterEntry } from '../lib/domain/vehicle-master-match';
import { choicesOf } from '../lib/domain/vehicle-defaults';
import { isListableProduct } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || !!r?.deletedAt || S(r?.status) === 'deleted';

function isFour(raw: string): boolean {
  return /4WD|AWD|4MATIC|XDRIVE|콰트로|QUATTRO|FOUR|4륜|사륜/.test(raw.toUpperCase());
}

/** 빈칸 채움용 — 가격·상태 손대지 않음. */
const FILL_FIELDS = [
  'seats', 'drive_type', 'variant', 'fuel_type', 'engine_cc',
  '_snap_defaults', '_snapped', '_snap_confidence', '_snap_history', '_snap_at',
] as const;

async function main() {
  const apply = process.argv.includes('--apply');
  const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
  if (!getApps().length) {
    initializeApp({
      credential: cert(sa),
      databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app',
    });
  }
  const db = getDatabase();
  const master = (JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')).entries || []) as MasterEntry[];
  const [p3, p4] = await Promise.all([db.ref('products').get(), db.ref('v4/products').get()]);
  const merged: Record<string, Rec> = {};
  for (const [k, v] of Object.entries((p3.val() || {}) as Record<string, Rec>)) merged[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((p4.val() || {}) as Record<string, Rec>)) {
    merged[k] = { ...(merged[k] || {}), ...v, _key: k };
  }
  const rows = Object.entries(merged).filter(([, r]) => !dead(r) && !r._merged_into && isListableProduct(r as EntityRecord));

  let seatAxis = 0;
  let driveAxis = 0;
  let seatWouldFill = 0;
  let driveWouldFill = 0;
  let seatConflict = 0;
  let driveConflict = 0;
  let worsen = 0;
  let highMed = 0;
  let low = 0;
  let nulls = 0;
  let written = 0;
  let skippedUnsafe = 0;
  const samples: string[] = [];
  const targets: { key: string; patch: Rec; note: string }[] = [];

  for (const [key, r] of rows) {
    const raw = (r._raw_vehicle && typeof r._raw_vehicle === 'object' ? r._raw_vehicle : {}) as Rec;
    const input = { ...r, ...raw } as EntityRecord;
    const res = snapToMaster(input, master);
    if (!res) {
      nulls++;
      continue;
    }
    const auto = res.confidence === 'high' || res.confidence === 'medium';
    if (auto) highMed++;
    else low++;
    const after = applySnap(input, res, { source: 'snap-defaults-fill' });
    const ch = choicesOf(res.sub_model, master);
    const seatMatters = ch.seats.length >= 2;
    const driveMatters = ch.drives.length >= 2;

    let fillSeat = false;
    let fillDrive = false;

    if (seatMatters) {
      seatAxis++;
      if (!S(r.seats) && S(after.seats)) {
        seatWouldFill++;
        fillSeat = true;
        if (samples.length < 10) {
          samples.push(`SEAT+ ${S(r.provider_company_code)} ${S(r.car_number)} ${S(res.sub_model)} ''→${S(after.seats)} (${res.confidence})`);
        }
      }
      if (S(r.seats) && S(after.seats) && S(r.seats) !== S(after.seats)) {
        seatConflict++;
        if (samples.length < 16) {
          samples.push(`SEAT≠ ${S(r.car_number)} ${S(res.sub_model)} ${S(r.seats)}→${S(after.seats)}`);
        }
      }
    }

    if (driveMatters) {
      driveAxis++;
      if (!S(r.drive_type) && S(after.drive_type)) {
        driveWouldFill++;
        fillDrive = true;
        if (samples.length < 22) {
          samples.push(`DRV+ ${S(r.provider_company_code)} ${S(r.car_number)} ${S(res.sub_model)} ''→${S(after.drive_type)} (${res.confidence})`);
        }
      }
      if (S(r.drive_type) && S(after.drive_type) && isFour(S(r.drive_type)) !== isFour(S(after.drive_type))) {
        driveConflict++;
        if (samples.length < 28) {
          samples.push(`DRV≠ ${S(r.car_number)} ${S(res.sub_model)} ${S(r.drive_type)}→${S(after.drive_type)}`);
        }
      }
    }

    const beforeOk = !!S(r.maker) && !!S(r.model) && !!S(r.sub_model);
    const afterOk = !!S(after.maker) && !!S(after.model) && !!S(after.sub_model);
    const sameId =
      S(r.maker) === S(after.maker)
      && S(r.model) === S(after.model)
      && S(r.sub_model) === S(after.sub_model);
    if (beforeOk && !afterOk) worsen++;

    if (!auto || !(fillSeat || fillDrive)) continue;
    if (!sameId || (beforeOk && !afterOk)) {
      skippedUnsafe++;
      continue;
    }
    // 이미 있는 값을 뒤집는 건 패치 대상에서 제외
    if (S(r.seats) && S(after.seats) && S(r.seats) !== S(after.seats)) {
      skippedUnsafe++;
      continue;
    }
    if (S(r.drive_type) && S(after.drive_type) && isFour(S(r.drive_type)) !== isFour(S(after.drive_type))) {
      skippedUnsafe++;
      continue;
    }

    const patch: Rec = {};
    for (const f of FILL_FIELDS) {
      if (after[f] !== undefined) patch[f] = after[f];
    }
    // 빈칸만 채움 — 이미 값이 있으면 그 필드는 패치에서 뺌
    if (S(r.seats)) delete patch.seats;
    if (S(r.drive_type)) delete patch.drive_type;
    if (!S(patch.seats) && !S(patch.drive_type)) continue;

    targets.push({
      key,
      patch,
      note: `${S(r.car_number)} ${S(res.sub_model)} seat:${fillSeat ? S(after.seats) : '-'} drive:${fillDrive ? S(after.drive_type) : '-'}`,
    });
  }

  const out = {
    listable: rows.length,
    highMed,
    low,
    nulls,
    seatAxis,
    seatWouldFill,
    seatConflict,
    driveAxis,
    driveWouldFill,
    driveConflict,
    worsen,
    applyCandidates: targets.length,
    skippedUnsafe,
    samples,
    targetNotes: targets.slice(0, 40).map((t) => t.note),
  };

  console.log(`\n══ 있는 매물 · 인승/구동 빈칸 채움 ${apply ? '반영' : 'dry-run'} ══\n`);
  console.log(`  목록 ${out.listable} · 자동확정급 ${out.highMed} · 저신뢰 ${out.low} · 미매칭 ${out.nulls}`);
  console.log(`  인승축 착지 ${out.seatAxis} · 빈칸→채움 ${out.seatWouldFill} · 값변경 ${out.seatConflict}`);
  console.log(`  구동축 착지 ${out.driveAxis} · 빈칸→채움 ${out.driveWouldFill} · 2/4 뒤집힘 ${out.driveConflict}`);
  console.log(`  신원 악화 ${out.worsen} · 안전패치 후보 ${out.applyCandidates} · 스킵(불안) ${out.skippedUnsafe}`);
  if (samples.length) {
    console.log('\n  표본');
    for (const s of samples) console.log(`   ${s}`);
  }

  if (apply) {
    if (out.seatConflict || out.driveConflict || out.worsen) {
      console.log('\n  ❌ 충돌/악화 감지 — 반영 중단\n');
      process.exit(1);
    }
    for (const t of targets) {
      await db.ref(`v4/products/${t.key}`).update(t.patch);
      written++;
    }
    console.log(`\n  반영 ${written}대 (v4/products)`);
  }

  writeFileSync('tmp/audit-snap-defaults.json', JSON.stringify(out, null, 2));
  console.log('\n  → tmp/audit-snap-defaults.json');
  console.log(apply ? '\n끝.\n' : '\n※ dry-run. 반영: 백업 후 --apply\n');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
