/**
 * 차번 하나를 끝까지 추적 — v3·v4·시트 어디에 있고 왜 목록에 안 뜨는지. 읽기 전용.
 *
 * 「erp3 엔 나오는데 erp4 엔 안 나온다」를 판정하려면 세 곳을 다 봐야 한다:
 *   v3 products / v4/products / 공급사 시트 원문
 * 그리고 v4 에 있는데 안 뜨면 어느 관문에서 걸리는지(삭제·출고불가·가격·차종검수) 짚는다.
 *
 *   npx tsx scripts/trace-plate.mts 146하4723
 */
import { readFileSync } from 'node:fs';
import { isOfferableProduct, priceList } from '../lib/domain/product';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s/g, '');

async function main() {
  const plate = norm(process.argv[2]);
  if (!plate) { console.log('사용: npx tsx scripts/trace-plate.mts 146하4723'); return; }

  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const [v4s, v3s] = await Promise.all([db.ref('v4/products').get(), db.ref('products').get()]);
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  const v3 = (v3s.val() || {}) as Record<string, Rec>;

  const hit = (rows: Record<string, Rec>) => Object.entries(rows).filter(([k, p]) =>
    norm(p.car_number) === plate || norm(k).includes(plate) || norm(p.product_code).includes(plate));

  console.log(`\n══ ${plate} 추적 ══\n`);

  for (const [label, rows] of [['v3 products', v3], ['v4/products', v4]] as const) {
    const found = hit(rows);
    console.log(`■ ${label} — ${found.length}건`);
    for (const [k, p] of found) {
      console.log(`   key ${k}`);
      console.log(`     공급사 ${S(p.provider_company_code) || '(없음)'} · 차종 ${S(p.maker)} ${S(p.model)} ${S(p.sub_model)}`);
      console.log(`     상태 ${S(p.vehicle_status) || '(없음)'} · 삭제 ${p._deleted === true ? 'Y' : 'N'} · status ${S(p.status) || '-'}`);
      console.log(`     가격 ${priceList(p as any).length}개 · 차종검수 ${p._needs_master_review === true ? '대기 ❌' : '확정'} · source ${S(p.source) || '-'}`);
      if (label === 'v4/products') {
        const why: string[] = [];
        if (p._deleted === true || S(p.status) === 'deleted') why.push('삭제됨');
        if (norm(p.vehicle_status) === '출고불가') why.push('출고불가');
        if (!priceList(p as any).length) why.push('유효 가격 없음');
        if (p._needs_master_review === true) why.push('차종 미확정(검수 대기)');
        console.log(`     ▶ 목록 노출 ${isOfferableProduct(p as any) ? '✅ 뜬다' : `❌ 안 뜬다 — ${why.join(' · ') || '원인 불명'}`}`);
      }
      console.log('');
    }
    if (!found.length) console.log('   (없음)\n');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
