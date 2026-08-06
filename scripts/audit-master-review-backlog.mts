/**
 * 「공급사가 올린 상품이 ERP 에서 제대로 안 보인다」의 정체 — 차종마스터 매칭 실패 적체. 읽기 전용.
 *
 * 시트에서 들어온 매물 중 차종 마스터에 못 붙은 것은 `_needs_master_review: true` 로 남는다.
 * 이때 maker·model·car_number 가 «정규 필드로 승격되지 못하고» `_raw_vehicle` 안에만 있다.
 * 그래서 목록에 뜨긴 뜨는데 제조사·차명·차번이 빈칸으로 보인다 — 「안 보인다」의 실체.
 *
 * 게다가 이들이 판매가능으로 집계되므로 대수도 실제와 어긋난다.
 *
 * npx tsx scripts/audit-master-review-backlog.mts
 */
import { readFileSync } from 'node:fs';
import { isOfferableProduct } from '../lib/domain/product';

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
  const [prodSnap, pl, po] = await Promise.all([
    db.ref('v4/products').get(), db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const products = (prodSnap.val() || {}) as Record<string, Rec>;
  const parts = [...Object.values((pl.val() || {}) as Rec), ...Object.values((po.val() || {}) as Rec)];
  const nameOf = (c: string) => S(parts.find((x) => S(x.partner_code) === c)?.partner_name
    || parts.find((x) => S(x.partner_code) === c)?.company_name);

  const offerable = Object.values(products).filter((p) => !dead(p) && isOfferableProduct(p as any));
  const needReview = offerable.filter((p) => p._needs_master_review === true);
  const noIdentity = offerable.filter((p) => !S(p.maker) && !S(p.model));
  const noPlate = offerable.filter((p) => !S(p.car_number));

  console.log('\n══ 시트 매물이 «빈칸»으로 보이는 이유 ══\n');
  console.log(`  판매가능                       ${offerable.length}대`);
  console.log(`  ├ 차종마스터 검토 대기          ${needReview.length}대  (_needs_master_review)`);
  console.log(`  ├ 제조사·차명이 둘 다 빈 것      ${noIdentity.length}대  ← 목록에서 빈칸으로 보인다`);
  console.log(`  └ 차번이 빈 것                 ${noPlate.length}대\n`);

  const by = new Map<string, { total: number; review: number; blank: number }>();
  for (const p of offerable) {
    const c = S(p.provider_company_code) || '(없음)';
    const e = by.get(c) || { total: 0, review: 0, blank: 0 };
    e.total++;
    if (p._needs_master_review === true) e.review++;
    if (!S(p.maker) && !S(p.model)) e.blank++;
    by.set(c, e);
  }
  console.log('■ 공급사별 — 판매가능 / 마스터검토대기 / 빈칸표시');
  for (const [c, e] of [...by].sort((a, b) => b[1].blank - a[1].blank)) {
    const flag = e.blank === e.total && e.total ? '  ❌ 전량 빈칸' : e.blank ? '  ⚠' : '  ✓';
    console.log(`   ${c.padEnd(8)} ${nameOf(c).padEnd(18)} ${String(e.total).padStart(4)} / ${String(e.review).padStart(4)} / ${String(e.blank).padStart(4)}${flag}`);
  }

  const srcs = new Map<string, number>();
  for (const p of noIdentity) srcs.set(S(p.source) || '(없음)', (srcs.get(S(p.source) || '(없음)') || 0) + 1);
  console.log(`\n■ 빈칸 매물의 유입 경로: ${[...srcs].map(([s, n]) => `${s} ${n}`).join(' · ')}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
