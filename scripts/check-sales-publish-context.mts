/** Firestore 판매 원자(products + policy + partner)가 게시 가능한지 읽기 전용으로 검사한다. */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { companyAlias } from '../lib/domain/identity';
import { isPlate } from '../lib/domain/plate-registry';
import { loadSalesRowContext, makeCell } from '../lib/domain/sales-atom-row';

const S = (v: unknown) => String(v ?? '').trim();
const credentialPath = S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(credentialPath, 'utf8'));
initializeApp({ credential: cert({
  projectId: sa.project_id,
  clientEmail: sa.client_email,
  privateKey: S(sa.private_key).replace(/\\n/g, '\n'),
}) });

const db = getFirestore();
const [productSnap, policySnap, partnerSnap] = await Promise.all([
  db.collection('products').get(),
  db.collection('policy').get(),
  db.collection('partner').get(),
]);
const products = productSnap.docs.map((d) => ({ _key: d.id, ...d.data() }));
const policies = policySnap.docs.map((d) => ({ _key: d.id, ...d.data() }));
const partners = partnerSnap.docs.map((d) => ({ _key: d.id, ...d.data() }));
const ctx = await loadSalesRowContext({ policies, partners, companyAlias });
const cell = makeCell(ctx);
const listable = products.filter((v) => v.listable === true);
const invalidPlate = listable.filter((v) => !isPlate(S(v.car_number)));
for (const v of listable) cell('공급사', v);

console.log(`\n■ Firestore 판매 게시 문맥`);
console.log(`  products ${products.length} · listable ${listable.length}`);
console.log(`  policy ${policies.length} · partner ${partners.length}`);
console.log(`  공급사명 ${ctx.nameByProvider.size} · 전용계좌 ${ctx.acctByProvider.size}`);
console.log(`  이름 없는 공급사 코드 ${ctx.unnamedProviders.size} · 유효하지 않은 차번 ${invalidPlate.length}`);

if (ctx.unnamedProviders.size || invalidPlate.length) {
  for (const [code, count] of ctx.unnamedProviders) console.error(`  ⛔ 공급사명 없음 ${code}: ${count}대`);
  for (const v of invalidPlate.slice(0, 10)) console.error(`  ⛔ 차번 아님: ${S(v.car_number) || S(v._key)}`);
  process.exit(1);
}
console.log('  ✓ Firestore 원자만으로 게시 문맥 구성 가능\n');
