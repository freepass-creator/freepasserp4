/** Firestore 판매 원자(products + policy + partner)가 게시 가능한지 읽기 전용으로 검사한다. */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { companyAlias } from '../lib/domain/identity';
import { isPlate } from '../lib/domain/plate-registry';
import { loadSalesRowContext, makeCell } from '../lib/domain/sales-atom-row';
import { hasInventoryPublicationViolations, inventoryCountSnapshot, isOpenInventoryAtom } from '../lib/domain/inventory-contract';
import { captureSalesPublishSnapshot } from '../lib/server/sales-publish-snapshot';

const S = (v: unknown) => String(v ?? '').trim();
const credentialPath = S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(credentialPath, 'utf8'));
initializeApp({ credential: cert({
  projectId: sa.project_id,
  clientEmail: sa.client_email,
  privateKey: S(sa.private_key).replace(/\\n/g, '\n'),
}) });

const db = getFirestore();
const snapshot = await captureSalesPublishSnapshot(db);
const { products, policies, partners } = snapshot;
const ctx = await loadSalesRowContext({ policies, partners, companyAlias });
const cell = makeCell(ctx);
const inventory = inventoryCountSnapshot(products);
const listable = products.filter(isOpenInventoryAtom);
const invalidPlate = listable.filter((v) => !isPlate(S(v.car_number)));
for (const v of listable) cell('공급사', v);

console.log(`\n■ Firestore 판매 게시 문맥`);
console.log(`  등록 원자 ${inventory.registered} · 출고불가 ${inventory.unavailable} · 현재 재고 ${inventory.open}`);
console.log(`  파생값 드리프트 listable ${inventory.listableDrift} · status_kind ${inventory.statusKindDrift} · 원천 식별자 누락 ${inventory.sourceIdentityViolations} · 삭제표식 ${inventory.deletedMarkerViolations} · 빈 차량번호 ${inventory.blankPlateViolations} · 잘못된 차량번호 ${inventory.invalidPlateViolations} · 중복 차량번호 ${inventory.duplicatePlateViolations}`);
console.log(`  policy ${policies.length} · partner ${partners.length}`);
console.log(`  공급사명 ${ctx.nameByProvider.size} · 전용계좌 ${ctx.acctByProvider.size}`);
console.log(`  이름 없는 공급사 코드 ${ctx.unnamedProviders.size} · 유효하지 않은 차번 ${invalidPlate.length}`);

if (hasInventoryPublicationViolations(inventory) || ctx.unnamedProviders.size || invalidPlate.length) {
  for (const [code, count] of ctx.unnamedProviders) console.error(`  ⛔ 공급사명 없음 ${code}: ${count}대`);
  for (const v of invalidPlate.slice(0, 10)) console.error(`  ⛔ 차번 아님: ${S(v.car_number) || S(v._key)}`);
  process.exit(1);
}
console.log('  ✓ Firestore 원자만으로 게시 문맥 구성 가능\n');
