/**
 * 재스냅 전 백업 — v4/products 전체를 tmp/migration-backups 로 덤프. 읽기 전용.
 *
 * RTDB 는 롤백이 없다. 이 덤프가 유일한 복구수단이다.
 *   BACKUP_STAMP=20260806-pre-resnap npx tsx scripts/backup-products.mts
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const dir = `tmp/migration-backups/${process.env.BACKUP_STAMP || 'manual'}`;
  mkdirSync(dir, { recursive: true });

  for (const node of ['v4/products']) {
    const val = (await db.ref(node).get()).val();
    const file = `${dir}/${node.replace(/\//g, '_')}.json`;
    writeFileSync(file, JSON.stringify(val ?? null, null, 2), 'utf8');
    const n = val && typeof val === 'object' ? Object.keys(val).length : 0;
    console.log(`  ${String(n).padStart(5)}건  ${file}`);
  }
  console.log(`\n백업 위치: ${dir}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
