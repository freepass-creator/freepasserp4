/** Firestore 원자를 바꾸지 않고 판매 표시의 값/미입력/없음/해당없음 분포를 센다. */
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { atomDisplayResult, type AtomDisplayState } from '../lib/domain/missing-value-display';
import { isOpenInventoryAtom } from '../lib/domain/inventory-contract';

const S = (value: unknown) => String(value ?? '').trim();
const credentialPath = S(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  || 'C:/dev/freepasserp4-rtdb-current/tmp/firebase-auth/freepasserp5-sa.json';
const serviceAccount = JSON.parse(readFileSync(credentialPath, 'utf8'));
const app = initializeApp({ credential: cert({
  projectId: serviceAccount.project_id,
  clientEmail: serviceAccount.client_email,
  privateKey: S(serviceAccount.private_key).replace(/\\n/g, '\n'),
}) });
const snap = await getFirestore(app).collection('products').get();
const products = snap.docs.map((doc) => ({ _key: doc.id, ...doc.data() })).filter(isOpenInventoryAtom);

const fields = [
  ['maker', '제조사'], ['model', '모델'], ['sub_model', '세부모델'], ['trim_name', '세부트림'],
  ['ext_color', '외장'], ['int_color', '내장'], ['year', '연식'], ['mileage', 'Km'],
  ['fuel_type', '연료'], ['engine_cc', '배기량'], ['vehicle_class', '차종구분'],
  ['origin', '원산지'], ['drive_type', '구동'], ['seats', '인승'],
  ['battery_capacity', '배터리용량'], ['options', '옵션(원문)'], ['policy_code', '정책UID'],
] as const;
const zero = (): Record<AtomDisplayState, number> => ({ value: 0, missing: 0, none: 0, not_applicable: 0 });

console.log(`■ 표시 공백 SSOT 감사 · Firestore 현재 재고 ${products.length}대`);
for (const [field, column] of fields) {
  const counts = zero();
  for (const product of products) counts[atomDisplayResult(column, product[field], product).state]++;
  console.log(`  ${column.padEnd(8)} 값 ${counts.value} · 미입력 ${counts.missing} · 없음 ${counts.none} · 해당없음 ${counts.not_applicable}`);
}

const sonokong = products.filter((product) => S(product.provider_company_code) === 'RP012');
const optionCounts = zero();
for (const product of sonokong) optionCounts[atomDisplayResult('옵션(원문)', product.options, product).state]++;
console.log(`\n손오공 RP012 ${sonokong.length}대 옵션 · 값 ${optionCounts.value} · 미입력 ${optionCounts.missing} · 없음 ${optionCounts.none}`);
