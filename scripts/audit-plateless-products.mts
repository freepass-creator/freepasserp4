/**
 * 차번 없는 판매가능 상품 — 정체 규명. 읽기 전용.
 *
 * 재고 대사에서 «시트에도 없고 차번도 못 읽는» 상품이 공급사별로 남았다.
 * 신차(출고 전이라 번호판 미부여)면 정상이고, 그 밖이면 유령이다.
 * 오픈 전에 «판매가능»이 정확해야 하므로 이 둘을 갈라야 한다.
 *
 * npx tsx scripts/audit-plateless-products.mts
 */
import { readFileSync } from 'node:fs';
import { isOfferableProduct } from '../lib/domain/product';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';
const PLATE = /\d{2,3}[가-힣]\d{4}/;

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
  const live = (pl.val() || {}) as Record<string, Rec>;
  const over = (po.val() || {}) as Record<string, Rec>;
  const nameOf = (code: string) => {
    const p = [...Object.values(live), ...Object.values(over)].find((x) => S(x.partner_code) === code);
    return S(p?.partner_name || p?.company_name || p?.name);
  };

  // 차번은 필드에만 있는 게 아니다 — v3 이관분·카탈로그 스냅샷은 «키 자체»가 번호판이다
  // (`34호9160` 같은 영업용 번호판). product_code 에 `RP006_02하9002` 꼴로 박힌 것도 있다.
  // 셋 중 어디서든 번호판이 나오면 «차번 있음»으로 본다.
  const plateOf = (p: Rec) => {
    for (const src of [p.car_number, p._key, p.product_code]) {
      const m = S(src).replace(/\s/g, '').match(PLATE);
      if (m) return m[0];
    }
    return '';
  };
  const offerable = Object.values(products).filter((p) => !dead(p) && isOfferableProduct(p as any));
  const plateless = offerable.filter((p) => !plateOf(p));

  console.log(`\n══ 차번 없는 판매가능 상품 ══\n`);
  console.log(`  판매가능 ${offerable.length}대 중 차번 없는 것 ${plateless.length}대\n`);

  const byCo = new Map<string, Rec[]>();
  for (const p of plateless) {
    const c = S(p.provider_company_code) || '(없음)';
    byCo.set(c, [...(byCo.get(c) || []), p]);
  }
  for (const [c, list] of [...byCo].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`■ ${String(list.length).padStart(3)}대  ${c.padEnd(8)} ${nameOf(c)}`);
    const types = new Map<string, number>();
    for (const p of list) {
      const t = S(p.product_type) || '(구분없음)';
      types.set(t, (types.get(t) || 0) + 1);
    }
    console.log(`        구분: ${[...types].map(([t, n]) => `${t} ${n}`).join(' · ')}`);
    console.log(`        차번칸 값: ${[...new Set(list.map((p) => S(p.car_number) || '(빈칸)'))].slice(0, 5).join(' / ')}`);
    for (const p of list.slice(0, 4)) {
      console.log(`          ${S(p.product_code).padEnd(26)} ${S(p.maker)} ${S(p.model)} ${S(p.sub_model)} · ${S(p.vehicle_status) || '상태없음'}`);
    }
    if (list.length > 4) console.log(`          … 그 외 ${list.length - 4}대`);
    console.log('');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
