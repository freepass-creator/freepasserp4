/**
 * v3 `products` 원문 노출 실측 — 규칙만 조이면 되는가, 데이터를 옮겨야 하는가.
 *
 * 출시 게이트가 「v3 products 원문 광역 read」를 차단으로 잡는다. 부모 .read 가
 * 로그인한 모두에게 열려 있어서, 앱의 stripProductCost 를 우회한 raw SDK 조회를 못 막는다.
 *
 * 고치는 방법이 둘인데 비용이 완전히 다르다.
 *   · 남은 민감필드가 0건 → 규칙만 조이면 끝난다
 *   · 남아 있다 → v4 private 으로 옮기고 나서 조여야 한다(순서를 바꾸면 화면이 빈다)
 * 그래서 세어 보고 정한다. 값은 출력하지 않는다.
 */
import { readFileSync } from 'node:fs';

const PRIVATE_FIELDS = ['vehicle_price', 'vin', 'account_number'] as const;

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();

  for (const node of ['products', 'v4/products'] as const) {
    const rows = ((await db.ref(node).get()).val() || {}) as Record<string, any>;
    const counts = new Map<string, number>();
    let priceFee = 0;
    let alive = 0;
    for (const row of Object.values(rows)) {
      if (!row || typeof row !== 'object') continue;
      const dead = row._deleted === true || row.deletedAt || String(row.status || '') === 'deleted';
      if (!dead) alive++;
      for (const field of PRIVATE_FIELDS) {
        const value = row[field];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          counts.set(field, (counts.get(field) || 0) + 1);
        }
      }
      const price = row.price;
      if (price && typeof price === 'object') {
        for (const entry of Object.values(price as Record<string, any>)) {
          if (entry && typeof entry === 'object' && entry.fee !== undefined && entry.fee !== null && entry.fee !== '') { priceFee++; break; }
        }
      }
    }
    console.log(`\n${node} — 전체 ${Object.keys(rows).length} · 살아있음 ${alive}`);
    for (const field of PRIVATE_FIELDS) console.log(`   ${field.padEnd(16)} ${counts.get(field) || 0}건`);
    console.log(`   ${'price.*.fee'.padEnd(16)} ${priceFee}건`);
  }
  // v4 private 으로 이미 옮겨진 것이 얼마나 되는지 — 이관이 어디까지 진행됐는지 본다.
  const priv = ((await db.ref('v4/products_private').get()).val() || {}) as Record<string, any>;
  console.log(`\nv4/products_private — ${Object.keys(priv).length}건 (이미 격리된 것)`);
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
