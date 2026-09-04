/**
 * 전기차 오염 힐 (Firestore 원자) — 샘이 «오염 안 된」 데이터이려면 전기차가 배기량·가솔린을 달면 안 된다.
 *   사장님 2026-09-05 「101호7613 제네시스가 배기량 3500cc 가솔린인데 이름은 일렉트리파이드면 어떡하냐.」
 *
 * 둘을 고친다(원문·이름이 근거 — 추측 아님):
 *   ① 이름/세부모델/원문이 «일렉트리파이드·일렉트릭·electric»인데 연료가 전기/수소가 아니면 → 연료=전기.
 *   ② 연료가 전기·수소(확실)면 → 배기량을 비운다(전기차엔 cc 가 없다. 998·1580·111 은 내연 형제 값이 샌 것).
 * 정체(제조사·모델·세부모델)는 안 건드린다 — 연료·배기량만.
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

const NAME_EV = /일렉트리파이드|일렉트릭|electric/i;
const FUEL_EV = /^(전기|수소)$|\bev\b|electric|fcev/i;
const hasCc = (v: unknown) => Number(S(v).replace(/[^\d]/g, '')) > 0;

const snap = await fs.collection('products').get();
type Fix = { id: string; car: string; sub: string; setFuel?: string; blankCc?: string };
const fixes: Fix[] = [];
for (const d of snap.docs) {
  const x = d.data() as Record<string, unknown>;
  const name = `${S(x.sub_model)} ${S(x.model)} ${S(x.trim_name)} ${S((x.원문 as { 차명?: string })?.차명)}`;
  const fuel = S(x.fuel_type);
  const nameEv = NAME_EV.test(name);
  const fuelEv = FUEL_EV.test(fuel);
  const f: Fix = { id: d.id, car: S(x.car_number), sub: S(x.sub_model) };
  let touch = false;
  if (nameEv && !FUEL_EV.test(fuel)) { f.setFuel = fuel || '(빈)'; touch = true; }        // ① 이름=전기차인데 연료 틀림
  if ((fuelEv || nameEv) && hasCc(x.engine_cc)) { f.blankCc = S(x.engine_cc); touch = true; } // ② 전기차인데 배기량 있음
  if (touch) fixes.push(f);
}

console.log(`■ 전기차 힐 — ${fixes.length}대`);
console.log(`  연료→전기 ${fixes.filter((f) => f.setFuel).length} · 배기량 비움 ${fixes.filter((f) => f.blankCc).length}`);
for (const f of fixes.slice(0, 20)) console.log(`  ${f.car.padEnd(9)} ${f.sub.padEnd(20)}${f.setFuel ? ` 연료[${f.setFuel}→전기]` : ''}${f.blankCc ? ` 배기량[${f.blankCc}→비움]` : ''}`);

if (!APPLY) { console.log('\n미리보기 — 안 씀. --apply 로 반영.'); process.exit(0); }
let w = 0;
for (let i = 0; i < fixes.length; i += 400) {
  const batch = fs.batch();
  for (const f of fixes.slice(i, i + 400)) {
    const upd: Record<string, unknown> = { _ev_healed_at: Date.now() };
    if (f.setFuel) upd.fuel_type = '전기';
    if (f.blankCc) upd.engine_cc = '';
    batch.set(fs.collection('products').doc(f.id), upd, { merge: true });
    w++;
  }
  await batch.commit();
}
console.log(`\n반영 완료 — 전기차 ${w}대 힐(연료·배기량). 정체는 안 건드림.`);
process.exit(0);
