/**
 * ERP5 SSOT가 ERP4와 같은 Firebase를 쓴다는 사용자 확정 경계.
 * 별도 프로젝트·별도 서비스계정 전제가 다시 들어오면 CI에서 중단한다.
 */
import { existsSync, readFileSync } from 'node:fs';

const FILES = [
  'scripts/publish-products-to-erp5-firestore.mts',
  'scripts/publish-vehicle-master-to-erp5-firestore.mts',
  '.github/workflows/publish-erp5-ssot.yml',
  '.github/workflows/erp5-vehicle-master-once.yml',
  'docs/ERP5-FIRESTORE-SSOT.md',
];
const FORBIDDEN = [
  'ERP5_FIREBASE_SERVICE_ACCOUNT_JSON',
  'ERP5_GOOGLE_APPLICATION_CREDENTIALS',
  'ERP5_FIREBASE_PROJECT_ID',
  'erp5-3e2fc',
  'firebase.erp5.json',
  'firestore.erp5.rules',
];

const failures: string[] = [];
for (const path of FILES) {
  const source = readFileSync(path, 'utf8');
  for (const token of FORBIDDEN) {
    if (source.includes(token)) failures.push(`${path}: 별도 Firebase 전제 「${token}」`);
  }
}

for (const obsolete of ['firebase.erp5.json', 'firestore.erp5.rules']) {
  if (existsSync(obsolete)) failures.push(`${obsolete}: 별도 Firebase 설정 파일이 남아 있음`);
}

const productPublisher = readFileSync(FILES[0], 'utf8');
const vehiclePublisher = readFileSync(FILES[1], 'utf8');
const oneTimeWorkflow = readFileSync(FILES[3], 'utf8');
const rules = readFileSync('firestore.rules', 'utf8');

if (!productPublisher.includes('const PROJECT_ID = sourceAccount.project_id!')) {
  failures.push('상품 발행기가 공용 자격증명의 project_id를 단일 대상으로 쓰지 않음');
}
if (!vehiclePublisher.includes('const PROJECT_ID = googleAccount.project_id!')) {
  failures.push('차종 발행기가 공용 자격증명의 project_id를 단일 대상으로 쓰지 않음');
}
if (!oneTimeWorkflow.includes('secrets.GOOGLE_SA_JSON')) {
  failures.push('1회 발행 워크플로가 기존 GOOGLE_SA_JSON을 쓰지 않음');
}
for (const path of ['match /ssotState/{name}', 'match /productMasterVersions/{versionId}', 'match /vehicleMasterVersions/{versionId}']) {
  if (!rules.includes(path)) failures.push(`공용 firestore.rules에 ${path} 경계가 없음`);
}

if (failures.length) {
  console.error('ERP5 공용 Firebase 경계 실패:\n' + failures.map((failure) => `  - ${failure}`).join('\n'));
  process.exit(1);
}

console.log('PASS ERP4·ERP5는 같은 Firebase를 쓰고 ERP5는 버전 컬렉션만 분리한다.');
