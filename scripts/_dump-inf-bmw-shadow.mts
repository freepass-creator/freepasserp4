import { writeFileSync, readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

if (!getApps().length) {
  const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
  initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
}
const db = getDatabase();
const products = ((await db.ref('v4/products').get()).val() || {}) as Record<string, any>;
const keys = [
  'RP023_133라1401', 'RP023_192머7372', 'RP023_321라9324',
  'EXT_3d0a97aa4c1b', 'EXT_65f54cdb71f9', 'EXT_c4408bd1aa34',
];
const out: Record<string, any> = {};
for (const k of keys) {
  const p = products[k];
  if (!p) continue;
  out[k] = {
    merged_into: p._merged_into,
    merged_reason: p._merged_reason,
    catalog_id: p.catalog_id,
    maker: p.maker,
    model: p.model,
    sub: p.sub_model,
    variant: p.variant,
    trim: p.trim_name,
    drive: p.drive_type,
    engine_cc: p.engine_cc,
    seats: p.seats,
    year: p.year,
    fuel: p.fuel_type,
    gen_year_start: p.gen_year_start,
    gen_year_end: p.gen_year_end,
    snap_conf: p._snap_confidence,
    raw: p._raw_vehicle,
  };
}
writeFileSync('tmp/inf-bmw-shadow-meta.json', `${JSON.stringify(out, null, 2)}\n`);
console.log('keys', Object.keys(out).length);
process.exit(0);
