/**
 * 전기차 오염 힐 (Firestore 원자) — 샘이 «오염 안 된」 데이터이려면 전기차가 배기량·가솔린을 달면 안 된다.
 *   사장님 2026-09-05 「101호7613 제네시스가 배기량 3500cc 가솔린인데 이름은 일렉트리파이드면 어떡하냐.」
 *
 * ★«원천 연료»가 전기·수소(확실)면 → 배기량을 비운다(전기차엔 cc 가 없다. 998·1580·111 은 내연 형제 값이 샌 것).
 *   ⚠ 세부모델 «이름»(일렉트리파이드 등)으로는 «판단하지 않는다» — 이름이 오매핑될 수 있다.
 *     실측 2026-09-05: 원문 「가솔린 2.5 G80」이 세부모델 「일렉트리파이드 G80」으로 잘못 붙어, 이름을 믿고
 *     연료를 전기로 바꿨더니 가솔린차 7대가 가짜 전기차가 됐다. 원천 연료만 믿는다(그건 오매핑 안 된다).
 * 정체(제조사·모델·세부모델)는 안 건드린다 — 배기량만.
 *
 * 기본 dry-run · --apply 로만 씀.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();

const FUEL_EV = /^(전기|수소)$|\bev\b|electric|fcev/i;
const hasCc = (v: unknown) => Number(S(v).replace(/[^\d]/g, '')) > 0;

const snap = await fs.collection('products').get();
type Fix = { id: string; car: string; sub: string; blankCc: string };
const fixes: Fix[] = [];
for (const d of snap.docs) {
  const x = d.data() as Record<string, unknown>;
  // ★원천 연료가 전기·수소일 때만. 이름(일렉트리파이드)으로는 판단 안 한다(오매핑 위험).
  if (FUEL_EV.test(S(x.fuel_type)) && hasCc(x.engine_cc)) fixes.push({ id: d.id, car: S(x.car_number), sub: S(x.sub_model), blankCc: S(x.engine_cc) });
}

console.log(`■ 전기차 배기량 비우기 — ${fixes.length}대 (원천 연료=전기/수소인데 배기량 있음)`);
for (const f of fixes.slice(0, 20)) console.log(`  ${f.car.padEnd(9)} ${f.sub.padEnd(20)} 배기량[${f.blankCc}→비움]`);

if (!APPLY) { console.log('\n미리보기 — 안 씀. --apply 로 반영.'); process.exit(0); }
let w = 0;
for (let i = 0; i < fixes.length; i += 400) {
  const batch = fs.batch();
  for (const f of fixes.slice(i, i + 400)) {
    batch.set(fs.collection('products').doc(f.id), { engine_cc: '', _ev_healed_at: Date.now() }, { merge: true });
    w++;
  }
  await batch.commit();
}
console.log(`\n반영 완료 — 전기차 ${w}대 배기량 비움. 연료·정체는 안 건드림.`);
process.exit(0);
