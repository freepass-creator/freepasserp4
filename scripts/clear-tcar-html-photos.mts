// v4/products에서 photo_link가 tcar 상세페이지(HTML)인 RP012 잔재를 정리. --apply 없으면 조회만.
import { readFileSync } from 'node:fs';
process.env.NEXT_PUBLIC_DATA_BACKEND = 'rtdb';
for (const f of ['.env.local']) { try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l); if (!m) continue; const v = m[2].replace(/^["']|["']$/g, ''); if (v && !process.env[m[1]]) process.env[m[1]] = v; } } catch { /* */ } }
const apply = process.argv.includes('--apply');
const { firebaseAdminDatabase } = await import('../lib/server/firebase-admin');
const db = firebaseAdminDatabase();
const snap = await db.ref('v4/products').get();
const products: Record<string, any> = snap.val() || {};
const S = (v: unknown) => String(v ?? '').trim();
const HTML_RE = /tcar\.lotterentacar\.net\/cr\//;
const hits: { id: string; 차: string; 상태: string; url: string }[] = [];
for (const [id, p] of Object.entries(products)) {
  if (!HTML_RE.test(S(p.photo_link))) continue;
  hits.push({ id, 차: S(p.plate_number || p.car_number || p.code), 상태: S(p.vehicle_status), url: S(p.photo_link).slice(0, 70) });
}
console.log(`tcar 상세페이지(HTML) photo_link ${hits.length}건`);
for (const h of hits) console.log(`  ${h.차} · ${h.상태} · ${h.url}`);
if (!apply) { console.log('\n조회만 — 지우려면 --apply'); process.exit(0); }
const updates: Record<string, null> = {};
for (const h of hits) updates[`v4/products/${h.id}/photo_link`] = null;
await db.ref().update(updates);
console.log(`\n✅ ${hits.length}건 photo_link 제거(HTML은 깨진 이미지로 뜨므로 비움)`);
process.exit(0);
