/**
 * 지금 판매가능 몇 대이고, 그중 몇 대가 «차번으로 검색되나» — 읽기 전용.
 *
 * 검색은 productHaystack 에 car_number 를 넣어 부분일치로 찾는다(lib/domain/search.ts).
 * 그러니 car_number 가 빈 매물은 차번으로 영원히 안 잡힌다.
 *
 * npx tsx scripts/audit-plate-coverage.mts
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
  const [v4s, pl, po] = await Promise.all([
    db.ref('v4/products').get(), db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  const parts = [...Object.values((pl.val() || {}) as Rec), ...Object.values((po.val() || {}) as Rec)];
  const nameOf = (c: string) => S(parts.find((x) => S(x.partner_code) === c)?.partner_name
    || parts.find((x) => S(x.partner_code) === c)?.company_name);

  const offer = Object.values(v4).filter((p) => !dead(p) && isOfferableProduct(p as any));
  const withPlate = offer.filter((p) => S(p.car_number));
  const without = offer.filter((p) => !S(p.car_number));

  console.log('\n══ 판매가능 · 차번 검색 가능 여부 ══\n');
  console.log(`  ★ 판매가능(화면 숫자)      ${offer.length}대`);
  console.log(`  ├ ✅ 차번으로 검색됨        ${withPlate.length}대`);
  console.log(`  └ ❌ 차번 없어 검색 안 됨   ${without.length}대\n`);

  const by = new Map<string, { t: number; n: number }>();
  const types = new Map<string, number>();
  for (const p of without) {
    const c = S(p.provider_company_code) || '(없음)';
    const e = by.get(c) || { t: 0, n: 0 }; e.n++; by.set(c, e);
    types.set(S(p.product_type) || '(구분없음)', (types.get(S(p.product_type) || '(구분없음)') || 0) + 1);
  }
  for (const p of offer) {
    const c = S(p.provider_company_code) || '(없음)';
    const e = by.get(c) || { t: 0, n: 0 }; e.t++; by.set(c, e);
  }

  if (without.length) {
    console.log('■ 차번 없는 매물 — 공급사별 (판매가능 중 몇 대)');
    for (const [c, e] of [...by].filter(([, e]) => e.n).sort((a, b) => b[1].n - a[1].n)) {
      console.log(`   ${String(e.n).padStart(4)}/${String(e.t).padEnd(4)}  ${c.padEnd(9)} ${nameOf(c)}`);
    }
    console.log('\n■ 차번 없는 매물의 구분');
    for (const [t, n] of [...types].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}대  ${t}`);
    console.log('\n   ※ 재렌트·재구독은 시트에 번호판이 없는 경우가 많다(공급사가 안 적음).');
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
