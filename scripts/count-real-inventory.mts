/**
 * 프리패스 재고 대수 — Firestore products 정본을 한 번 읽어 계산한다. 읽기 전용.
 *
 * 계약: 등록 원자 전체 - vehicle_status=출고불가 = 현재 재고.
 * 가격·계약중·검수상태·저장된 listable 값으로 대수를 다시 거르지 않는다.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { hasInventoryPublicationViolations, inventoryCountSnapshot, isOpenInventoryAtom } from '../lib/domain/inventory-contract';

type Rec = Record<string, unknown>;
const S = (v: unknown) => String(v ?? '').trim();
const K = (v: unknown) => S(v).replace(/\s+/g, '').toUpperCase();
const BY_PROVIDER = process.argv.includes('--by-provider');

const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({
  projectId: sa.project_id,
  clientEmail: sa.client_email,
  privateKey: S(sa.private_key).replace(/\\n/g, '\n'),
}) });

async function main() {
  const db = getFirestore();
  const [productSnap, partnerSnap] = await Promise.all([
    db.collection('products').get(),
    db.collection('partner').get(),
  ]);
  const atoms = productSnap.docs.map((doc) => ({ _key: doc.id, ...doc.data() } as Rec));
  const snapshot = inventoryCountSnapshot(atoms);
  const open = atoms.filter(isOpenInventoryAtom);

  const byPlate = new Map<string, Rec[]>();
  for (const atom of atoms) {
    const plate = K(atom.car_number);
    if (!plate) continue;
    byPlate.set(plate, [...(byPlate.get(plate) || []), atom]);
  }
  const duplicatePlates = [...byPlate.entries()].filter(([, rows]) => rows.length > 1);

  console.log('\n══ 프리패스 재고 SSOT ══\n');
  console.log(`기준시각       ${new Date().toISOString()}`);
  console.log(`등록 원자       ${snapshot.registered}대`);
  console.log(`출고불가       -${snapshot.unavailable}대`);
  console.log(`현재 재고       ${snapshot.open}대`);
  console.log(`listable 드리프트 ${snapshot.listableDrift}대`);
  console.log(`status_kind 드리프트 ${snapshot.statusKindDrift}대`);
  console.log(`원천 식별자 누락   ${snapshot.sourceIdentityViolations}대`);
  console.log(`삭제표식 위반     ${snapshot.deletedMarkerViolations}대`);
  console.log(`빈 차량번호       ${snapshot.blankPlateViolations}개`);
  console.log(`형식 오류 차량번호 ${snapshot.invalidPlateViolations}개`);
  console.log(`중복 차량번호     ${snapshot.duplicatePlateViolations}개`);
  console.log('\n상태별');
  for (const [status, count] of Object.entries(snapshot.byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(12)} ${String(count).padStart(5)}대`);
  }

  if (duplicatePlates.length) {
    console.error(`\n⛔ 같은 차량번호가 여러 원자를 가리킨다: ${duplicatePlates.slice(0, 10).map(([plate, rows]) => `${plate}(${rows.length})`).join(' · ')}`);
  }
  if (hasInventoryPublicationViolations(snapshot)) process.exitCode = 1;

  if (!BY_PROVIDER) return;
  const names = new Map<string, string>();
  for (const doc of partnerSnap.docs) {
    const row = doc.data() as Rec;
    const code = S(row.partner_code) || S(row.provider_company_code) || doc.id;
    const name = S(row.partner_name) || S(row.name) || code;
    if (code) names.set(code, name);
  }
  const byProvider = new Map<string, number>();
  for (const atom of open) {
    const code = S(atom.provider_company_code) || S(atom.partner_code) || '(공급사 없음)';
    byProvider.set(code, (byProvider.get(code) || 0) + 1);
  }
  console.log('\n공급사별 현재 재고');
  for (const [code, count] of [...byProvider.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${code.padEnd(12)} ${String(count).padStart(5)}대  ${names.get(code) || code}`);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
