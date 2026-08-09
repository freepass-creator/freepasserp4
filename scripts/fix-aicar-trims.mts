/**
 * 아이카(RP004) 트림 재스냅 — B형 `트림` 문장에서 등급을 다시 뽑는다.
 *
 *   npx tsx scripts/fix-aicar-trims.mts
 *   npx tsx scripts/fix-aicar-trims.mts --apply
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { snapToMaster, applySnap, unpackVehicleSignals, type MasterEntry } from '../lib/domain/vehicle-master-match';
import { isListableProduct } from '../lib/domain/product';
import { composeVehicleName } from '../lib/domain/vehicle-defaults';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || !!r?.deletedAt || S(r?.status) === 'deleted';

const IDENTITY = ['maker', 'model', 'sub_model', 'trim_name', 'variant'] as const;
function resnapInput(p: Rec): EntityRecord {
  const raw = (p._raw_vehicle && typeof p._raw_vehicle === 'object' ? p._raw_vehicle : {}) as Rec;
  const input: Rec = { ...p, ...raw };
  for (const f of IDENTITY) {
    if (!(f in raw) || S(raw[f]) === '') delete input[f];
  }
  delete input.catalog_id;
  // 아이카: 원문 트림 문장이 trim_extra 에만 남은 경우 trim_name 으로 되살려 추출한다.
  if (!S(input.trim_name) && S(raw.trim_extra)) input.trim_name = raw.trim_extra;
  if (!S(input.trim_name) && S(p.trim_extra)) input.trim_name = p.trim_extra;
  return input as EntityRecord;
}

const SNAP_FIELDS = [
  'maker', 'model', 'sub_model', 'catalog_id', 'gen_year_start', 'gen_year_end',
  'variant', 'trim_name', 'trim_extra', 'fuel_type', 'engine_cc', 'seats', 'drive_type',
  'year', 'vehicle_class',
  '_raw_vehicle', '_snapped', '_snap_confidence', '_snap_history', '_snap_at', '_needs_master_review',
  '_snap_defaults',
] as const;

async function main() {
  const apply = process.argv.includes('--apply');
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const entries = (JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')).entries || []) as MasterEntry[];
  const products = ((await db.ref('v4/products').get()).val() || {}) as Record<string, Rec>;

  const targets = Object.entries(products).filter(([, p]) =>
    !dead(p) && S(p.provider_company_code) === 'RP004' && isListableProduct(p as never));

  console.log(`\n══ 아이카 트림 재스냅 ${apply ? '반영' : 'dry-run'} · ${targets.length}대 ══\n`);

  let gained = 0, kept = 0, stillEmpty = 0, written = 0;
  const samples: string[] = [];
  const backup: Rec = {};

  for (const [key, p] of targets) {
    const before = S(p.trim_name);
    const input = unpackVehicleSignals(resnapInput(p), entries);
    const res = snapToMaster(input, entries);
    if (!res || (res.confidence !== 'high' && res.confidence !== 'medium')) {
      if (!before) stillEmpty++;
      else kept++;
      continue;
    }
    const after = applySnap(input, res, { source: 'fix-aicar-trims' });
    const nextTrim = S(after.trim_name);
    const name = composeVehicleName(after as never, entries);
    if (nextTrim && !before) {
      gained++;
      if (samples.length < 15) samples.push(`+ ${S(p.car_number)} «${nextTrim}»  ${name}`);
    } else if (nextTrim && before && nextTrim !== before) {
      gained++;
      if (samples.length < 15) samples.push(`~ ${S(p.car_number)} «${before}»→«${nextTrim}»  ${name}`);
    } else if (nextTrim) kept++;
    else stillEmpty++;

    if (!apply) continue;
    if (nextTrim === before && S(after.trim_extra) === S(p.trim_extra) && S(after.sub_model) === S(p.sub_model)) continue;
    const patch: Rec = {};
    for (const f of SNAP_FIELDS) {
      if (after[f] !== undefined) patch[f] = after[f];
      else if (f === '_snap_defaults') patch[f] = null;
    }
    backup[key] = {};
    for (const f of SNAP_FIELDS) backup[key][f] = p[f] ?? null;
    await db.ref(`v4/products/${key}`).update(patch);
    written++;
  }

  console.log(`  트림 확보/갱신 ${gained} · 유지 ${kept} · 여전히 빈칸 ${stillEmpty}`);
  for (const s of samples) console.log('  ' + s);

  if (apply) {
    mkdirSync('tmp/migration-backups', { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    writeFileSync(`tmp/migration-backups/${stamp}-aicar-trims-before.json`, JSON.stringify(backup, null, 2));
    console.log(`\n  반영 ${written}대 · 백업 tmp/migration-backups/${stamp}-aicar-trims-before.json`);
  } else {
    console.log(`\n※ dry-run. 반영: npx tsx scripts/fix-aicar-trims.mts --apply\n`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
