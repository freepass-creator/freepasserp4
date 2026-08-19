/**
 * 운영 RTDB의 ERP5 코드 현황을 읽기 전용으로 분류한다.
 * write/update/transaction 호출이 없으며 레코드 값이나 개인정보는 출력하지 않는다.
 */
import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { canonicalEntityCode, codePrefixForEntity } from '../lib/domain/code-identity';
import type { EntityRecord } from '../lib/intake/entities';

const TARGETS = [
  ['policy', 'v3-bridge', 'policies'],
  ['partner', 'v3-bridge', 'partners'],
  ['user', 'v3-bridge', 'users'],
  ['product', 'v4', 'v4/products'],
  ['policy', 'v4-overlay', 'v4/policies'],
  ['partner', 'v4-overlay', 'v4/partners'],
  ['user', 'v4-overlay', 'v4/users'],
  ['room', 'v4', 'v4/rooms'],
  ['message', 'v4', 'v4/messages'],
  ['customer', 'v4', 'v4/customers'],
  ['quote', 'v4', 'v4/quotes'],
  ['contract', 'v4', 'v4/contracts'],
  ['settlement', 'v4', 'v4/settlements'],
  ['report', 'v4', 'v4/reports'],
  ['audit_log', 'v4', 'v4/audit_logs'],
] as const;

if (!getApps().length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
      || 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app',
  });
}
const db = getDatabase();
const output: Record<string, unknown>[] = [];
const snapshots = await Promise.all(TARGETS.map(async ([entity, source, path]) => (
  { entity, source, path, raw: (await db.ref(path).get()).val() as Record<string, unknown> | null }
)));

for (const { entity, source, path, raw } of snapshots) {
  const rows = Object.entries(raw || {}).map(([key, value]) => ({
    ...((value && typeof value === 'object') ? value as EntityRecord : {}),
    _key: key,
  }));
  let canonical = 0;
  let legacy = 0;
  let missing = 0;
  for (const row of rows) {
    if (canonicalEntityCode(entity, row)) canonical += 1;
    else if (String(row._key || '').trim()) legacy += 1;
    else missing += 1;
  }
  output.push({ entity, source, path, prefix: codePrefixForEntity(entity), total: rows.length, canonical, legacy, missing });
}

console.table(output);
console.log('READ ONLY — RTDB writes: 0');
