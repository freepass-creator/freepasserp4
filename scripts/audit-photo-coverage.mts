/**
 * 사진이 시트에서 ERP 로 들어오나 — 채움률과 유입 경로. 읽기 전용.
 *
 * 엑셀 보기에는 사진 열이 없다. 사진은 간단·상세 보기와 상세 페이지에서만 보인다.
 * 그래서 「사진이 꽂혔는지」는 화면으로 확인이 어렵다 — 데이터로 센다.
 *
 * npx tsx scripts/audit-photo-coverage.mts
 */
import { readFileSync } from 'node:fs';
import { isListableProduct } from '../lib/domain/product';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';
const PHOTO_FIELDS = ['photo_link', 'photo_url', 'photos', 'image_url', 'images', 'thumbnail'] as const;
const photoOf = (p: Rec) => {
  for (const f of PHOTO_FIELDS) {
    const v = p?.[f];
    if (Array.isArray(v) && v.length) return String(v[0]);
    if (S(v)) return S(v);
  }
  return '';
};

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const [v4s, v3s, pl, po] = await Promise.all([
    db.ref('v4/products').get(), db.ref('products').get(),
    db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  const v3 = (v3s.val() || {}) as Record<string, Rec>;
  const parts = [...Object.values((pl.val() || {}) as Rec), ...Object.values((po.val() || {}) as Rec)];
  const nameOf = (c: string) => S(parts.find((x: Rec) => S(x.partner_code) === c)?.partner_name
    || parts.find((x: Rec) => S(x.partner_code) === c)?.company_name) || c;

  const rows = Object.values(v4).filter((p) => !dead(p) && isListableProduct(p as any));
  const withPhoto = rows.filter((p) => photoOf(p));

  console.log('\n══ 사진이 들어와 있나 ══\n');
  console.log(`  목록 노출 ${rows.length}대 · 사진 있음 ${withPhoto.length}대 (${rows.length ? Math.round(withPhoto.length / rows.length * 100) : 0}%)\n`);

  const by = new Map<string, { t: number; p: number }>();
  for (const r of rows) {
    const c = S(r.provider_company_code) || '(없음)';
    const e = by.get(c) || { t: 0, p: 0 };
    e.t++; if (photoOf(r)) e.p++;
    by.set(c, e);
  }
  console.log('■ 공급사별 — 전체 / 사진 있음');
  for (const [c, e] of [...by].sort((a, b) => b[1].t - a[1].t)) {
    const mark = e.p === e.t ? '✅' : e.p ? '⚠' : '❌';
    console.log(`   ${mark} ${c.padEnd(9)} ${String(e.t).padStart(4)} / ${String(e.p).padStart(4)}   ${nameOf(c)}`);
  }

  // v3 대비
  const PLATE = /\d{2,3}[가-힣]\d{4}/;
  const plate = (p: Rec, k = '') => {
    for (const s of [p?.car_number, k, p?.product_code]) { const m = S(s).replace(/\s/g, '').match(PLATE); if (m) return m[0]; }
    return '';
  };
  const p3 = new Map<string, string>();
  for (const [k, r] of Object.entries(v3)) { if (dead(r)) continue; const pn = plate(r, k); const ph = photoOf(r); if (pn && ph) p3.set(pn, ph); }
  let onlyV3 = 0;
  for (const r of rows) { const pn = plate(r); if (pn && !photoOf(r) && p3.get(pn)) onlyV3++; }
  console.log(`\n■ erp3 대비 — v3 엔 사진이 있는데 v4 엔 없는 것 ${onlyV3}대`);

  console.log('\n■ 사진 값 표본');
  for (const r of withPhoto.slice(0, 5)) console.log(`   ${S(r.car_number) || '(차번없음)'} ${photoOf(r).slice(0, 80)}`);
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
