/**
 * ERP v4 매물 차번 크로스체크 (read-only).
 * 실차번 / 임시번호(100신·is_pending_plate) / 기타 를 공급사별로 센다.
 */
import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import nextEnv from '@next/env';
import { isExactRealPlate, TEMP_PLATE_RE } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

nextEnv.loadEnvConfig(process.cwd());

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const localEnv = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).flatMap((line) => {
    if (!line.trim() || /^\s*#/.test(line)) return [];
    const index = line.indexOf('=');
    if (index < 1) return [];
    return [[line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, '')]];
  }),
);
const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(
    localEnv.GOOGLE_APPLICATION_CREDENTIALS
      || process.env.GOOGLE_APPLICATION_CREDENTIALS
      || 'tmp/firebase-auth/sa.json',
    'utf8',
  ));
if (!getApps().length) {
  initializeApp({ credential: cert(sa), databaseURL: DB });
}
const db = getDatabase();

const snap = await db.ref('v4/products').get();
const rows = Object.entries((snap.val() || {}) as Record<string, EntityRecord>)
  .map(([key, row]) => ({ ...row, _key: key }))
  .filter((row) => row && typeof row === 'object'
    && row._deleted !== true
    && !row.deletedAt
    && String(row.status || '') !== 'deleted');

type Bucket = { n: number; real: number; temp: number; other: number; samples: string[] };
const empty = (): Bucket => ({ n: 0, real: 0, temp: 0, other: 0, samples: [] });
const total = empty();
const per = new Map<string, Bucket>();

for (const row of rows) {
  const provider = String(row.provider_company_code || row.partner_code || '?');
  const plate = String(row.car_number || '').replace(/\s/g, '');
  const bucket = per.get(provider) || empty();
  bucket.n += 1;
  total.n += 1;
  const isTemp = row.is_pending_plate === true || TEMP_PLATE_RE.test(plate);
  if (isTemp) {
    bucket.temp += 1;
    total.temp += 1;
    if (bucket.samples.length < 3) bucket.samples.push(plate || '(공란+flag)');
  } else if (isExactRealPlate(plate)) {
    bucket.real += 1;
    total.real += 1;
  } else {
    bucket.other += 1;
    total.other += 1;
    if (bucket.samples.length < 3) bucket.samples.push(plate || '(공란)');
  }
  per.set(provider, bucket);
}

console.log('ERP v4 활성 매물 차번 크로스체크 (쓰기 없음)\n');
console.log('  공급사          전체  실차번  임시번호  기타');
for (const [code, b] of [...per.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (!b.temp && !b.other && b.real === b.n) continue; // 전부 실차번이면 요약만
  const note = b.samples.length ? ` · 예: ${b.samples.join(', ')}` : '';
  console.log(
    `  ${code.padEnd(14)} ${String(b.n).padStart(4)} ${String(b.real).padStart(6)}`
    + ` ${String(b.temp).padStart(8)} ${String(b.other).padStart(4)}${note}`,
  );
}
const allRealProviders = [...per.entries()].filter(([, b]) => b.temp === 0 && b.other === 0).length;
console.log(`\n  (전부 실차번인 공급사 ${allRealProviders}곳 — 행 생략)`);
console.log(
  `\n합계  활성 ${total.n} · 실차번 ${total.real} · 임시번호 ${total.temp} · 기타 ${total.other}`,
);
console.log('※ 임시번호 = is_pending_plate 또는 100신NNNN');
