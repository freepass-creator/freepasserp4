/** 지금 실제로 몇 대인가 — 상태별로 가른다. 읽기 전용. npx tsx scripts/count-by-status.mts */
import { readFileSync } from 'node:fs';
import { isOfferableProduct, priceList } from '../lib/domain/product';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const v4 = ((await db.ref('v4/products').get()).val() || {}) as Record<string, Rec>;

  const alive = Object.values(v4).filter((p) => !dead(p));
  const offer = alive.filter((p) => isOfferableProduct(p as any));

  const byStatus = new Map<string, number>();
  for (const p of offer) {
    const s = S(p.vehicle_status) || '(상태없음)';
    byStatus.set(s, (byStatus.get(s) || 0) + 1);
  }

  console.log('\n══ 지금 몇 대인가 ══\n');
  console.log(`  v4/products 전체            ${Object.keys(v4).length}건`);
  console.log(`  살아있음(삭제 아님)          ${alive.length}건`);
  console.log(`  ★ 판매가능 = 화면 숫자       ${offer.length}건\n`);
  console.log('■ 판매가능을 상태별로');
  for (const [s, n] of [...byStatus].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(4)}대  ${s}`);
  }

  // 판매가능에서 빠진 이유
  const notOffer = alive.filter((p) => !isOfferableProduct(p as any));
  const why = new Map<string, number>();
  for (const p of notOffer) {
    const r = S(p.vehicle_status).replace(/\s/g, '') === '출고불가' ? '출고불가'
      : p._needs_master_review === true ? '차종 미확정'
      : priceList(p as any).length === 0 ? '유효 가격 없음' : '기타';
    why.set(r, (why.get(r) || 0) + 1);
  }
  console.log(`\n■ 살아있지만 판매가능이 아닌 ${notOffer.length}건 — 이유`);
  for (const [r, n] of [...why].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}대  ${r}`);
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
