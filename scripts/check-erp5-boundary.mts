/** ERP5가 독립 Firebase이고 ERP3 상품을 생성 원천으로 다시 읽지 않는지 정적 검사한다. */
import { existsSync, readFileSync } from 'node:fs';

const failures: string[] = [];
const source = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : '';
const requireFile = (path: string) => {
  if (!existsSync(path)) failures.push(`${path}: 파일 없음`);
};
const requireText = (path: string, text: string, why: string) => {
  if (!source(path).includes(text)) failures.push(`${path}: ${why} (${text})`);
};
const forbidText = (path: string, text: string, why: string) => {
  if (source(path).includes(text)) failures.push(`${path}: ${why} (${text})`);
};

for (const path of [
  'firebase.erp5.json',
  'firestore.erp5.rules',
  'scripts/publish-products-to-erp5-firestore.mts',
  'scripts/publish-vehicle-master-to-erp5-firestore.mts',
  'scripts/promote-erp5-release.mts',
  '.github/workflows/promote-erp5-release.yml',
  'lib/server/erp5-admin.ts',
  'app/api/products/route.ts',
  'docs/ERP5-FIRESTORE-SSOT.md',
]) requireFile(path);

const publishers = [
  'scripts/publish-products-to-erp5-firestore.mts',
  'scripts/publish-vehicle-master-to-erp5-firestore.mts',
];
for (const path of publishers) {
  requireText(path, "process.env.ERP5_FIREBASE_PROJECT_ID || 'freepasserp5'", 'ERP5 대상 프로젝트 기본값 없음');
  requireText(path, 'ERP5_FIREBASE_WRITER_SERVICE_ACCOUNT_JSON', 'ERP5 전용 writer 자격증명 없음');
  requireText(path, 'targetAccount.project_id !== TARGET_PROJECT_ID', 'ERP5 credential/project 일치 검사 없음');
  requireText(path, 'targetAccount.project_id === googleAccount.project_id', 'Google 조회/ERP5 대상 동일 프로젝트 차단 없음');
  requireText(path, 'contentHash', '전체 문서 내용 해시 없음');
  requireText(path, '직접 활성화는 금지합니다', '검토하지 않은 새 원천의 직접 활성화 차단 없음');
}

const productPublisher = 'scripts/publish-products-to-erp5-firestore.mts';
for (const token of ['freepasserp4.firestore.products', 'SOURCE_COLLECTION', 'ERP4_PRODUCT_COLLECTION', "ref('v4/products')"]) {
  forbidText(productPublisher, token, 'ERP3/ERP4 상품 컬렉션을 ERP5 생성 원천으로 읽음');
}
for (const token of ['SUPPLIER_SOURCES', 'loadSupplierSourceItems', 'loadProductMaster', 'composeProductForErp5', 'erp3ProductReads: 0']) {
  requireText(productPublisher, token, '공급사 원천+Google 상품마스터 조합 계약 누락');
}

const rules = source('firestore.erp5.rules');
for (const path of ['match /ssotState/{name}', 'match /productMasterVersions/{versionId}', 'match /vehicleMasterVersions/{versionId}', 'allow write: if false']) {
  if (!rules.includes(path)) failures.push(`firestore.erp5.rules: ${path} 경계 없음`);
}
requireText('firebase.erp5.json', 'firestore.erp5.rules', 'ERP5 규칙 config가 독립 규칙을 가리키지 않음');
for (const token of ['--config firebase.erp5.json', '--project freepasserp5', '--only firestore:rules']) {
  requireText('docs/ERP5-FIRESTORE-SSOT.md', token, 'ERP3 기본 프로젝트를 피하는 ERP5 Rules 명시 배포 절차 없음');
}

for (const workflow of [
  '.github/workflows/publish-erp5-ssot.yml',
  '.github/workflows/erp5-products-once.yml',
  '.github/workflows/erp5-vehicle-master-once.yml',
]) {
  requireText(workflow, 'secrets.GOOGLE_SA_JSON', 'Google 원천 조회 secret 없음');
  requireText(workflow, 'secrets.ERP5_FIREBASE_WRITER_SERVICE_ACCOUNT_JSON', 'ERP5 writer secret 없음');
}

requireText('lib/server/erp5-admin.ts', 'ERP5_FIREBASE_READER_SERVICE_ACCOUNT_JSON', 'ERP4 서버의 ERP5 reader 자격증명 없음');
requireText('lib/server/erp5-admin.ts', "collection('productMasterVersions')", '활성 ERP5 상품 버전 읽기 없음');
requireText('lib/server/erp5-admin.ts', "ERP5_CUTOVER_STATE", '검증 후 명시 절체 상태 없음');
requireText('lib/server/erp5-admin.ts', "rollback-approved", 'ERP3 롤백 승인 상태 없음');
requireText('app/api/products/route.ts', 'readActiveErp5Products', 'ERP4 상품 API가 ERP5 활성 버전을 읽지 않음');
requireText('app/api/products/route.ts', 'if (!erp5ProductReadEnabled())', 'ERP5 절체 전 유지 경계가 명시적이지 않음');
forbidText('lib/firebase/firestore-products-client.ts', "collection(db, 'products')", '브라우저가 ERP3 products를 직접 구독함');
for (const token of ['runTransaction', "collection('ssotReleases')", 'productContentHash', 'vehicleContentHash']) {
  requireText('scripts/promote-erp5-release.mts', token, '검증된 상품·차종의 원자적 release 승격 계약 누락');
}
requireText('.github/workflows/promote-erp5-release.yml', 'environment: erp5-production', 'ERP5 활성화 승인 환경 없음');
forbidText('scripts/promote-erp5-release.mts', 'ERP5_FIREBASE_SERVICE_ACCOUNT_JSON', '구 공용 credential fallback이 남아 있음');

if (failures.length) {
  console.error('ERP5 독립 Firebase 경계 실패:\n' + failures.map((failure) => `  - ${failure}`).join('\n'));
  process.exit(1);
}

console.log('PASS ERP5는 독립 Firebase이며 상품 원천은 공급사 Sheets + Google 상품마스터뿐이다.');
