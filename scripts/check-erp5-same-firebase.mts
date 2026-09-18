/**
 * ERP5 canonical SSOT 경계 검사.
 *
 * 확정 원칙:
 * - freepasserp5 = 유일한 canonical 원자 DB
 * - freepasserp4 = UI/운영 소비자
 * - ERP4 Firestore/로컬 JSON/수동 워크플로가 ERP5 canonical pointer를 바꾸면 안 된다.
 *
 * 파일명은 기존 CI 호환을 위해 유지한다.
 */
import { existsSync, readFileSync } from 'node:fs';

const CANONICAL_PROJECT_ID = 'freepasserp5';
const REFRESH_WORKFLOW = '.github/workflows/erp5-ssot-refresh.yml';
const LEGACY_WRITE_WORKFLOWS = [
  '.github/workflows/publish-erp5-ssot.yml',
  '.github/workflows/erp5-products-once.yml',
  '.github/workflows/erp5-vehicle-master-once.yml',
];
const LEGACY_REVERSE_WRITERS = [
  'publish-products-to-erp5-firestore.mts',
  'publish-vehicle-master-to-erp5-firestore.mts',
];

const failures: string[] = [];
const refresh = readFileSync(REFRESH_WORKFLOW, 'utf8');

const firebaseRcPath = '.firebaserc';
if (existsSync(firebaseRcPath)) {
  try {
    const firebaseRc = JSON.parse(readFileSync(firebaseRcPath, 'utf8')) as { projects?: { default?: string } };
    if (firebaseRc.projects?.default === CANONICAL_PROJECT_ID) {
      failures.push(`${firebaseRcPath}: 루트 기본 Firebase 프로젝트가 ${CANONICAL_PROJECT_ID}이면 안 됨. firebase.json은 RTDB·Firestore·Storage 규칙을 함께 담으므로 generic firebase deploy가 canonical ERP5를 덮을 수 있다. ERP5 writer는 workflow/OIDC 경계로만 지정한다.`);
    }
  } catch {
    failures.push(`${firebaseRcPath}: JSON을 읽을 수 없음 — Firebase 기본 프로젝트 경계를 검증할 수 없다.`);
  }
}

for (const required of [
  `GOOGLE_CLOUD_PROJECT: ${CANONICAL_PROJECT_ID}`,
  'github-inventory-writer@freepasserp5.iam.gserviceaccount.com',
  'scripts/ingest-all-suppliers.mts',
  'scripts/capture-sales-publish-snapshot.mts',
  'scripts/verify-whitelabel-publication.mts',
]) {
  if (!refresh.includes(required)) {
    failures.push(`${REFRESH_WORKFLOW}: canonical ERP5 경계 누락 「${required}」`);
  }
}

if (refresh.includes('ERP4_FIREBASE_PROJECT_ID') || refresh.includes('ERP4_FIREBASE_SERVICE_ACCOUNT_JSON')) {
  failures.push(`${REFRESH_WORKFLOW}: ERP4 Firebase 자격증명/프로젝트를 canonical writer로 사용하면 안 됨`);
}

for (const path of LEGACY_WRITE_WORKFLOWS) {
  if (!existsSync(path)) continue;
  const source = readFileSync(path, 'utf8');
  for (const writer of LEGACY_REVERSE_WRITERS) {
    if (source.includes(writer)) {
      failures.push(`${path}: ERP4/레거시 원천에서 ERP5로 쓰는 역방향 writer가 workflow에 남아 있음 「${writer}」`);
    }
  }
  if (source.includes('same-firebase') || source.includes('공용 Firebase')) {
    failures.push(`${path}: ERP4·ERP5 동일 Firebase 레거시 전제가 남아 있음`);
  }
}

const finderStorePath = 'features/finder/finder-data-store.ts';
const productApiPath = 'app/api/products/route.ts';
if (existsSync(finderStorePath) && existsSync(productApiPath)) {
  const finderStore = readFileSync(finderStorePath, 'utf8');
  const productApi = readFileSync(productApiPath, 'utf8');

  if (finderStore.includes('subscribeFirestoreProducts(') || finderStore.includes('startFirestore(')) {
    failures.push(`${finderStorePath}: Finder가 ERP4 기본 Firestore products를 직접 구독하면 안 됨. 로그인은 ERP4여도 상품 값은 canonical ERP5 서버 피드만 소비한다.`);
  }
  if (!finderStore.includes("fetch('/api/products'") || !finderStore.includes('loadErp5Products')) {
    failures.push(`${finderStorePath}: canonical ERP5 /api/products 소비 경로가 없음`);
  }
  if (!productApi.includes('readCanonicalCatalogFromErp5')) {
    failures.push(`${productApiPath}: 로그인 ERP 상품 피드가 canonical ERP5 reader를 사용하지 않음`);
  }
  if (productApi.includes("firebaseAdminStore().ref('v4/products')")) {
    failures.push(`${productApiPath}: ERP4 products를 상품 정본으로 읽는 레거시 경로가 되살아남`);
  }
}

for (const path of ['firebase.erp5.json', 'firestore.erp5.rules']) {
  if (existsSync(path)) {
    failures.push(`${path}: 별도 legacy Firebase 설정 파일이 repo root에 남아 있음. canonical 프로젝트는 workflow/OIDC로 고정한다.`);
  }
}

const docPath = 'docs/ERP5-FIRESTORE-SSOT.md';
if (existsSync(docPath)) {
  const doc = readFileSync(docPath, 'utf8');
  if (!doc.includes('freepasserp5') || !doc.includes('유일한 canonical')) {
    failures.push(`${docPath}: freepasserp5 canonical 원칙이 명시되지 않음`);
  }
  if (doc.includes('같은 Firebase 프로젝트') || doc.includes('별도 Firebase 프로젝트가 아니라')) {
    failures.push(`${docPath}: 동일 Firebase 레거시 설명이 남아 있음`);
  }
}

if (failures.length) {
  console.error('ERP5 canonical SSOT 경계 실패:\n' + failures.map((failure) => `  - ${failure}`).join('\n'));
  process.exit(1);
}

console.log(`PASS ${CANONICAL_PROJECT_ID}=유일한 canonical 원자 DB, freepasserp4=UI/운영 소비자.`);
