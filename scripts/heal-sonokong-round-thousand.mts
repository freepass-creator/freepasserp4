/**
 * 손오공(RP012) «노출」 차의 대여료를 천원단위로 눕힌다 — 사장님 「손오공 구독 원단위 절사」(2026-09-10).
 *   인제스터는 이제 라운드천을 걸지만, 원천이 지금 요금을 «안 주는»(저신용월납 null) 노출 차는
 *   옛 원문 요금(…479)이 남는다. 그런 «노출·비계약·비천원» 요금만 천원으로 눕히고 보증금도 재계산한다.
 * ⚠ 계약중(locked)은 «안» 건드린다 — 계약이 가격을 고정했다(계약우선).
 * ⚠ 숨김(출고불가) 스테일은 화면에 안 나오니 그대로 둔다.
 *
 *   npx tsx scripts/heal-sonokong-round-thousand.mts            드라이런
 *   npx tsx scripts/heal-sonokong-round-thousand.mts --apply    반영
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();

const 라운드천 = (v: number) => Math.round(v / 1000) * 1000;
const months = (p: string) => Number(String(p).replace(/[^0-9]/g, ''));
const dep3 = (p: string, r: number) => Math.round(Math.min(months(p) / 12, 3) * r);

const docs = (await fs.collection('products').where('provider_company_code', '==', 'RP012').get()).docs;
type Fix = { id: string; car: string; price: Record<string, { rent: number; deposit: number }> };
const fixes: Fix[] = [];
let 계약보존 = 0;
for (const d of docs) {
  const v = d.data() as Record<string, unknown>;
  if (v.listable !== true) continue;                        // 숨김 스테일은 그대로
  const 계약 = S(v.vehicle_status) === '계약중' || !!S(v.locked_by_contract);
  const price = (v.price && typeof v.price === 'object') ? { ...(v.price as Record<string, { rent: number; deposit: number }>) } : null;
  if (!price) continue;
  let changed = false;
  for (const [p, t] of Object.entries(price)) {
    const r = Number(t?.rent);
    if (!(r > 0) || r % 1000 === 0) continue;               // 이미 천원단위
    if (계약) { 계약보존++; continue; }                      // 계약중은 안 건드림
    const rr = 라운드천(r);
    price[p] = { ...t, rent: rr, deposit: dep3(p, rr) }; changed = true;
  }
  if (changed) fixes.push({ id: d.id, car: S(v.car_number), price });
}

console.log(`손오공 노출 요금 천원단위 — 고칠 차 ${fixes.length}대 · (계약중이라 보존한 칸 ${계약보존})`);
for (const f of fixes) console.log(`  ${f.car}`);
if (!fixes.length) { console.log('✓ 노출 요금은 이미 다 천원단위(계약중 제외).'); process.exit(0); }
if (!APPLY) { console.log('\n미리보기 — 반영하려면 --apply'); process.exit(0); }
let w = 0;
for (let i = 0; i < fixes.length; i += 400) {
  const batch = fs.batch();
  for (const f of fixes.slice(i, i + 400)) { batch.update(fs.collection('products').doc(f.id), { price: f.price, _price_rounded_at: Date.now() }); w++; }
  await batch.commit();
}
console.log(`\n반영 완료 — ${w}대 손오공 노출 요금을 천원단위로 눕혔다(보증금 재계산).`);
process.exit(0);
