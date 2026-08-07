/**
 * 「상태 확인」(= vehicle_status 빈값·규격외) 매물 소프트삭제.
 * v4 오버레이 톰스톤만. v3 write 없음.
 *
 *   npx tsx scripts/soft-delete-status-confirm.mts           dry-run
 *   npx tsx scripts/soft-delete-status-confirm.mts --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import nextEnv from '@next/env';
import {
  normalizeVehicleDisplayStatus,
  UNKNOWN_VEHICLE_STATUS,
} from '../lib/domain/product';

nextEnv.loadEnvConfig(process.cwd());
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
type Rec = Record<string, unknown>;

const localEnv = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).flatMap((line) => {
    if (!line.trim() || /^\s*#/.test(line)) return [];
    const i = line.indexOf('=');
    if (i < 1) return [];
    return [[line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, '')]];
  }),
);

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(localEnv.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({
      credential: cert(sa),
      databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app',
    });
  }
  const db = getDatabase();
  const [p3, p4] = await Promise.all([db.ref('products').get(), db.ref('v4/products').get()]);
  const merge = new Map<string, Rec>();
  for (const [k, v] of Object.entries((p3.val() || {}) as Record<string, Rec>)) {
    merge.set(k, { ...v, _key: k });
  }
  for (const [k, v] of Object.entries((p4.val() || {}) as Record<string, Rec>)) {
    merge.set(k, { ...(merge.get(k) || {}), ...v, _key: k });
  }

  const targets: Rec[] = [];
  for (const p of merge.values()) {
    if (p._deleted === true || p.deletedAt || S(p.status) === 'deleted') continue;
    if (normalizeVehicleDisplayStatus(p.vehicle_status) !== UNKNOWN_VEHICLE_STATUS) continue;
    targets.push(p);
  }

  const byProv = new Map<string, number>();
  for (const p of targets) {
    const c = S(p.provider_company_code) || '?';
    byProv.set(c, (byProv.get(c) || 0) + 1);
  }

  console.log(`\n══ 상태 확인 소프트삭제 ══\n`);
  console.log(`  대상 ${targets.length}대`);
  for (const [c, n] of [...byProv.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${c.padEnd(12)} ${n}`);
  }
  for (const p of targets) {
    console.log(`  - ${S(p._key).padEnd(28)} plate=${S(p.car_number) || '(빈)'} status=${JSON.stringify(p.vehicle_status ?? null)}`);
  }

  if (!targets.length) {
    console.log('\n대상 없음.\n');
    return;
  }
  if (!APPLY) {
    console.log('\n※ dry-run. 반영은 --apply\n');
    return;
  }

  const now = new Date().toISOString();
  const reason = '상태 확인(과거 잔여) 정리 — v4는 시트·홈페이지 연동분부터';
  const backup: Record<string, Rec> = {};
  const patch: Record<string, unknown> = {};
  for (const p of targets) {
    const key = S(p._key);
    backup[key] = p;
    patch[`products/${key}/_deleted`] = true;
    patch[`products/${key}/deletedAt`] = now;
    patch[`products/${key}/deletedReason`] = reason;
  }
  mkdirSync('tmp', { recursive: true });
  const backupPath = `tmp/soft-delete-status-confirm-${now.replace(/[:.]/g, '-')}.json`;
  writeFileSync(backupPath, JSON.stringify(backup, null, 1), 'utf8');
  console.log(`\n  백업 → ${backupPath}`);
  await db.ref('v4').update(patch);

  // 사후 확인
  const after = (await db.ref('v4/products').get()).val() || {};
  let still = 0;
  for (const [k, v] of Object.entries(after as Record<string, Rec>)) {
    const row = { ...v, _key: k };
    if (row._deleted === true || row.deletedAt || S(row.status) === 'deleted') continue;
    if (normalizeVehicleDisplayStatus(row.vehicle_status) === UNKNOWN_VEHICLE_STATUS) still += 1;
  }
  console.log(`\n✅ ${targets.length}대 v4 톰스톤. 남은 상태확인(v4만)=${still}\n`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
