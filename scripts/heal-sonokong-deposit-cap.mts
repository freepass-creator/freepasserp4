/**
 * 손오공 보증금 «최대 3개월» 캡을 이미 저장된 Firestore 원자에 적용한다(사장님 「손오공 규칙」 2026-08-28·2026-09-09 재확인).
 *
 * 규칙: 보증금 = 대여료 × 연수, «최대 3개월». 5년도 3개월치만 받는다.
 *   수집기(ingest-supplier sonokong 분기)는 2026-09-09 부터 캡을 건다. 이 스크립트는 그 전에 박힌
 *   48·60개월 rent×4·×5 를 rent×3 으로 «눕힌다».
 * ⚠ **우리가 계산해 넣은 것만** 고친다 — deposit === round((개월/12)×rent) [옛 무캡 산식]과 정확히 맞는 줄만.
 *   공급사가 따로 적었거나 사람이 손댄 값은 산식과 안 맞으므로 안 건드린다.
 * ⚠ 손오공(source=sonokong 또는 RP012)만.
 *
 *   npx tsx scripts/heal-sonokong-deposit-cap.mts            드라이런
 *   npx tsx scripts/heal-sonokong-deposit-cap.mts --apply    반영
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();

// ★기간 키에서 «개월»을 뽑는다 — 「60」·「60_인수형」 둘 다. Number('60_인수형')=NaN 이라 인수형이 캡을 못 받던 버그(2026-09-09).
const months = (p: string) => Number(String(p).replace(/[^0-9]/g, ''));
const uncapped = (p: string, r: number) => Math.round((months(p) / 12) * r);           // 옛 무캡 산식
const capped = (p: string, r: number) => Math.round(Math.min(months(p) / 12, 3) * r);   // 손오공 규칙(최대 3개월)

const docs = (await fs.collection('products').get()).docs;
type Fix = { id: string; car: string; price: Record<string, { rent: number; deposit: number }> };
const fixes: Fix[] = [];
let 기간고침 = 0, 산식안맞음 = 0;
for (const d of docs) {
  const v = d.data() as Record<string, unknown>;
  if (S(v.source) !== 'sonokong' && S(v.provider_company_code) !== 'RP012') continue;
  const price = (v.price && typeof v.price === 'object') ? { ...(v.price as Record<string, { rent: number; deposit: number }>) } : null;
  if (!price) continue;
  let changed = false;
  for (const [p, t] of Object.entries(price)) {
    const r = Number(t?.rent), cur = Number(t?.deposit);
    if (!(r > 0) || !Number.isFinite(cur)) continue;
    const want = capped(p, r);
    if (cur === want) continue;                       // 이미 맞음
    if (cur !== uncapped(p, r)) { 산식안맞음++; continue; }   // 우리 산식이 아니다 — 안 건드린다
    price[p] = { ...t, deposit: want }; changed = true; 기간고침++;
  }
  if (changed) fixes.push({ id: d.id, car: S(v.car_number), price });
}

console.log(`손오공 보증금 캡 — 고칠 차 ${fixes.length}대 · 기간 ${기간고침}개 · (산식 안 맞아 안 건드림 ${산식안맞음})`);
for (const f of fixes.slice(0, 8)) console.log(`  ${f.car}`);
if (!fixes.length) { console.log('✓ 이미 다 캡됨.'); process.exit(0); }
if (!APPLY) { console.log('\n미리보기 — 반영하려면 --apply'); process.exit(0); }
let w = 0;
for (let i = 0; i < fixes.length; i += 400) {
  const batch = fs.batch();
  for (const f of fixes.slice(i, i + 400)) { batch.set(fs.collection('products').doc(f.id), { price: f.price, _deposit_capped_at: Date.now() }, { merge: true }); w++; }
  await batch.commit();
}
console.log(`\n반영 완료 — ${w}대 손오공 보증금을 3개월 캡으로 눕혔다(산식 맞는 것만).`);
process.exit(0);
