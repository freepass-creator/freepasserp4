/**
 * 사진 결손 진단(읽기 전용) — 공급사별로 «사진 없는 매물»이 몇 대인가.
 *   GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/audit-photo-coverage.mts
 *
 * 배경(2026-08-08): 영업자 상세에서 「사진없음」이 자주 뜬다는 지적 → 실측했더니 화면이 아니라
 * 재고 문제였다. 사진 판정은 **앱과 같은 함수**를 쓴다(lib/domain/product-photos) —
 * 리포트와 화면이 다른 기준을 쓰면 「여긴 있다는데 화면엔 없다」가 된다.
 *
 * 사진의 출처는 둘이다.
 *   · 직접        = image_urls/images/photos 등 저장된 URL — 화면에 바로 뜬다
 *   · 링크(해석)  = photo_link(드라이브 폴더·모던렌트카·오플) — 서버가 풀어야 뜬다
 * 링크만 있는 차는 «있는데 늦게 뜨는» 차라 결손과 구분해서 센다.
 */
import { readFileSync } from 'node:fs';
import { productPhotos, scrapableSources } from '../lib/domain/product-photos';
import type { EntityRecord } from '../lib/intake/entities';

const SELLABLE = new Set(['즉시출고', '출고가능', '출고협의', '상품화중']);

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const [pSnap, partnerSnap] = await Promise.all([
    db.ref('v4/products').get(),
    db.ref('v4/partners').get(),
  ]);
  const products = Object.values((pSnap.val() || {}) as Record<string, EntityRecord>);
  const partners = Object.values((partnerSnap.val() || {}) as Record<string, Record<string, unknown>>);
  const nameOf = new Map<string, string>();
  for (const p of partners) {
    const code = String(p.partner_code || p.code || p._key || '');
    if (code) nameOf.set(code, String(p.name || code));
  }

  type Row = { total: number; direct: number; link: number; none: number };
  const byProvider = new Map<string, Row>();
  let all: Row = { total: 0, direct: 0, link: 0, none: 0 };

  for (const p of products) {
    if (p._deleted === true) continue;
    const status = String(p.vehicle_status || '').replace(/\s+/g, '');
    if (!SELLABLE.has(status)) continue; // 출고불가·이력은 사진 과제가 아니다
    const code = String(p.provider_company_code || '(미지정)');
    const row = byProvider.get(code) || { total: 0, direct: 0, link: 0, none: 0 };
    const direct = productPhotos(p).length > 0;
    const link = !direct && scrapableSources(p).length > 0;
    row.total += 1;
    all.total += 1;
    if (direct) { row.direct += 1; all.direct += 1; }
    else if (link) { row.link += 1; all.link += 1; }
    else { row.none += 1; all.none += 1; }
    byProvider.set(code, row);
  }

  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '-');
  const rows = [...byProvider.entries()].sort((a, b) => b[1].none - a[1].none);

  console.log(`\n판매 가능한 매물 ${all.total}대 — 직접사진 ${all.direct}(${pct(all.direct, all.total)}) · 링크만 ${all.link}(${pct(all.link, all.total)}) · 없음 ${all.none}(${pct(all.none, all.total)})`);
  console.log('\n공급사              전체   직접   링크   없음   없음비율');
  console.log('─'.repeat(62));
  for (const [code, r] of rows) {
    const label = `${code} ${nameOf.get(code) || ''}`.trim().slice(0, 18).padEnd(18);
    console.log(`${label} ${String(r.total).padStart(5)} ${String(r.direct).padStart(6)} ${String(r.link).padStart(6)} ${String(r.none).padStart(6)}   ${pct(r.none, r.total).padStart(5)}`);
  }
  console.log('─'.repeat(62));
  console.log(`${'합계'.padEnd(17)} ${String(all.total).padStart(5)} ${String(all.direct).padStart(6)} ${String(all.link).padStart(6)} ${String(all.none).padStart(6)}   ${pct(all.none, all.total).padStart(5)}\n`);
  console.log('링크만 = photo_link 는 있는데 저장된 이미지가 없는 차(서버 해석으로 뜬다).');
  console.log('없음   = 사진 경로가 아예 없는 차. 이 숫자가 영업자 화면의 「사진없음」이다.\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
