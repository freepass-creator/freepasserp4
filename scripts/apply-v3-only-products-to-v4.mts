/**
 * v4 에만 없는 살아 있는 v3 상품을 v4 오버레이로 올린다 — v4 독립의 선결 조건.
 *
 *   tsx scripts/apply-v3-only-products-to-v4.mts          미리보기 (쓰지 않음)
 *   tsx scripts/apply-v3-only-products-to-v4.mts --apply  실제 반영
 *
 * ★ 왜 필요한가
 *   erp4 가 v3 products 읽기를 끊으면 v4 에 없는 상품은 목록에서 사라진다.
 *   실측(2026-08-09) 39건이 그렇고, 38건이 이름·차번·가격표를 갖춘 «파는 차»다.
 *   먼저 올리고 나서 끊는다 — 순서를 바꾸면 그날 재고가 39대 증발한다.
 *
 * ★ 지우지 않는다
 *   v3 원본은 그대로 둔다. erp3 가 아직 그 값을 쓴다(엑셀·검색·시트 임포터).
 *   이 스크립트는 **복사만** 한다. 되돌리기 = v4 에서 방금 만든 키를 지우면 원상복구다.
 *
 * ★ 원가·계좌는 공개 노드에 올리지 않는다
 *   splitProductPrivate 로 갈라 v4/products_private 으로 보낸다. 앱이 쓰는 그 함수를
 *   그대로 쓴다 — 여기서 목록을 새로 적으면 «둘 중 하나만 고쳐지는» 날이 온다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { splitProductPrivate } from '@/lib/firebase/rtdb-products';
import type { EntityRecord } from '@/lib/intake/entities';

const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: any) => r?._deleted === true || r?.deletedAt || S(r?.status) === 'deleted';
const APPLY = process.argv.includes('--apply');

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const v3 = ((await db.ref('products').get()).val() || {}) as Record<string, any>;
  const v4 = ((await db.ref('v4/products').get()).val() || {}) as Record<string, any>;
  const v4Keys = new Set(Object.keys(v4));

  const targets = Object.entries(v3).filter(([key, row]) => !dead(row) && !v4Keys.has(key));
  if (!targets.length) {
    console.log('\n  올릴 것이 없다 — v4 가 이미 살아 있는 v3 상품을 모두 덮는다.\n');
    process.exit(0);
  }

  const multi: Record<string, unknown> = {};
  let withPrivate = 0;
  const stamp = new Date().toISOString();
  for (const [key, row] of targets) {
    const { publicRecord, privateRecord } = splitProductPrivate({ ...(row as EntityRecord), _key: key });
    // 어디서 온 레코드인지 남긴다 — 나중에 「이건 왜 v4 에 있지」를 다시 추적하지 않으려고.
    multi[`v4/products/${key}`] = { ...publicRecord, _key: key, _v4_from: 'v3-standalone-migration', updatedAt: stamp };
    if (privateRecord) {
      multi[`v4/products_private/${key}`] = { ...privateRecord, _key: key };
      withPrivate++;
    }
  }

  console.log(`\n  올릴 상품 ${targets.length}건 · 그중 원가·계좌 격리 대상 ${withPrivate}건`);
  const byProvider = new Map<string, number>();
  for (const [, row] of targets) {
    const p = S(row.provider_company_code || row.partner_code) || '(미확정)';
    byProvider.set(p, (byProvider.get(p) || 0) + 1);
  }
  for (const [p, n] of [...byProvider].sort((a, b) => b[1] - a[1])) console.log(`    ${p.padEnd(14)} ${n}건`);

  if (!APPLY) {
    console.log('\n  미리보기만 했다. 실제 반영은 --apply 를 붙인다.\n');
    process.exit(0);
  }

  // 되돌릴 수 있게 «무엇을 만들었는지» 목록을 남긴다. v3 원본은 건드리지 않으니
  // 복구 = 여기 적힌 키를 v4 에서 지우는 것으로 끝난다.
  mkdirSync('tmp/deploy/migrations', { recursive: true });
  const log = `tmp/deploy/migrations/${stamp.replace(/[:.]/g, '-').slice(0, 19)}-v3-only-products.json`;
  writeFileSync(log, JSON.stringify({ created: Object.keys(multi), at: stamp }, null, 2), 'utf8');

  await db.ref().update(multi);
  console.log(`\n  ✔ 반영 완료 · 생성 목록 → ${log}`);
  console.log('    되돌리려면 이 파일의 경로들을 v4 에서 제거한다(v3 원본은 그대로다).\n');
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
