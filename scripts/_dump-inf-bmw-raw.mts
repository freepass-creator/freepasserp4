import { writeFileSync, readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

if (!getApps().length) {
  const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
  initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
}
const db = getDatabase();
const plates = new Set(['133라1401', '192머7372', '321라9324']);
const products = ((await db.ref('v4/products').get()).val() || {}) as Record<string, any>;
const rows: any[] = [];
for (const [k, p] of Object.entries(products)) {
  if (!p || typeof p !== 'object') continue;
  const pl = String(p.car_number || '').replace(/\s/g, '');
  const hit = plates.has(pl) || [...plates].some((x) => k.includes(x));
  if (!hit) continue;
  rows.push({
    key: k,
    plate: pl,
    deleted: p._deleted || p.deletedAt || p.status,
    maker: p.maker,
    model: p.model,
    sub: p.sub_model,
    variant: p.variant,
    trim: p.trim_name,
    extra: p.trim_extra,
    fuel: p.fuel_type,
    year: p.year,
    drive: p.drive_type,
    provider: p.provider_company_code,
    raw: p._raw_vehicle || null,
    keys: Object.keys(p).sort(),
  });
}
writeFileSync('tmp/inf-bmw-raw.json', `${JSON.stringify(rows, null, 2)}\n`);
console.log('rows', rows.length);
process.exit(0);
