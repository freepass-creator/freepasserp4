// 손오공(RP012) v4/products 장수 분포 검증. 읽기만.
import { readFileSync } from 'node:fs';
process.env.NEXT_PUBLIC_DATA_BACKEND = 'rtdb';
for (const f of ['.env.local']) { try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l); if (!m) continue; const v = m[2].replace(/^["']|["']$/g, ''); if (v && !process.env[m[1]]) process.env[m[1]] = v; } } catch { /* */ } }
const { firebaseAdminDatabase } = await import('../lib/server/firebase-admin');
const photos = await import('../lib/domain/product-photos');
const snap = await firebaseAdminDatabase().ref('v4/products').get();
const arr: any[] = Object.values(snap.val() || {});
const S = (v: unknown) => String(v ?? '').trim();
const rp012 = arr.filter((p) => (S(p.provider_company_code || p.provider_code)) === 'RP012');
const 구분별: Record<string, { n: number; imgcnt: number[]; tcar: number }> = {};
for (const p of rp012) {
  const g = S(p.product_type) || '(빈)';
  구분별[g] ||= { n: 0, imgcnt: [], tcar: 0 };
  const b = 구분별[g]; b.n++;
  const gallery = photos.productPhotos(p); // 실제 ERP 갤러리가 그리는 장수(프록시 적용)
  b.imgcnt.push(gallery.length);
  if (/tcar\.lotterentacar\.net\/cr\//.test(S(p.photo_link))) b.tcar++;
}
for (const [g, b] of Object.entries(구분별)) {
  const withImg = b.imgcnt.filter((n) => n > 0).length;
  const avg = withImg ? (b.imgcnt.reduce((a, c) => a + c, 0) / withImg).toFixed(1) : '0';
  console.log(`【${g}】 ${b.n}대 · 사진있는차 ${withImg} · 평균 ${avg}장 · 최대 ${Math.max(0, ...b.imgcnt)}장 · tcarHTML ${b.tcar}`);
}
process.exit(0);
