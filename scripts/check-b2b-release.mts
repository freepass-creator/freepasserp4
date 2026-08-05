/**
 * 영업자·공급사 제한 오픈 전 정적/환경 게이트.
 * 비밀값은 출력하지 않고 이름의 존재 여부만 검사하며 외부 write를 하지 않는다.
 */
import { existsSync, readFileSync } from 'node:fs';

type Rec = Record<string, unknown>;

const envArg = process.argv.find((arg) => arg.startsWith('--env='));
const rulesArg = process.argv.find((arg) => arg.startsWith('--rules='));
const envFile = envArg?.slice('--env='.length) || '.env.local';
const rulesFile = rulesArg?.slice('--rules='.length) || 'scripts/ruleprobe/release-candidate.rules.json';

function readEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const output: Record<string, string> = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    output[match[1]] = value;
  }
  return output;
}

const fileEnv = readEnv(envFile);
const envValue = (name: string) => process.env[name] ?? fileEnv[name];
const present = (name: string) => String(envValue(name) || '').trim().length > 0;
const passes: string[] = [];
const failures: string[] = [];
const pass = (message: string) => passes.push(message);
const fail = (message: string) => failures.push(message);
const check = (condition: boolean, message: string) => condition ? pass(message) : fail(message);

const hasActiveAssignedUserGate = (rule: string): boolean => (
  rule.includes("child('status').val() !== 'pending'")
  && rule.includes("child('status').val() !== 'deleted'")
  && rule.includes("child('status').val() !== 'rejected'")
  && rule.includes("child('is_active').val() !== '아니오'")
  && rule.includes("child('is_active').val() !== false")
  && ['agent', 'agent_admin', 'agent_manager', 'provider', 'provider_admin', 'admin']
    .every((role) => rule.includes(`child('role').val() === '${role}'`))
);

for (const name of [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_DATABASE_URL',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
]) {
  check(present(name), `환경변수 ${name}`);
}
check(String(envValue('NEXT_PUBLIC_DATA_BACKEND') || '').trim() === 'rtdb', '운영 데이터 백엔드 RTDB');

for (const [name, label] of [
  ['NEXT_PUBLIC_OPERATOR_COMPANY', '상호'],
  ['NEXT_PUBLIC_OPERATOR_CEO', '대표자'],
  ['NEXT_PUBLIC_OPERATOR_ADDRESS', '주소'],
  ['NEXT_PUBLIC_OPERATOR_BIZ_NO', '사업자등록번호'],
  ['NEXT_PUBLIC_OPERATOR_EMAIL', '문의 이메일'],
  ['NEXT_PUBLIC_OPERATOR_PRIVACY_OFFICER', '개인정보 보호책임자'],
] as const) {
  check(present(name), `법적 운영자 정보 ${label}`);
}
check(
  String(envValue('NEXT_PUBLIC_REQUIRE_LEGAL_RECONSENT') || '').trim().toLowerCase() === 'true',
  '기존 회원 약관 재동의 게이트 ON',
);

for (const name of [
  'GOOGLE_DRIVE_CLIENT_ID',
  'GOOGLE_DRIVE_CLIENT_SECRET',
  'GOOGLE_DRIVE_REFRESH_TOKEN',
  'GOOGLE_DRIVE_BACKUP_FOLDER_ID',
]) {
  check(present(name), `Drive 백업 환경변수 ${name}`);
}
let serviceProject = '';
let serviceAccountValid = false;
try {
  const service = JSON.parse(String(envValue('FIREBASE_SERVICE_ACCOUNT_JSON') || '')) as {
    project_id?: string;
    client_email?: string;
    private_key?: string;
  };
  serviceProject = String(service.project_id || '').trim();
  serviceAccountValid = !!(
    serviceProject
    && String(service.client_email || '').trim()
    && /BEGIN PRIVATE KEY/.test(String(service.private_key || ''))
  );
} catch { /* 형식 실패 */ }
check(serviceAccountValid, '서버 전용 FIREBASE_SERVICE_ACCOUNT_JSON 유효 형식');
if (serviceAccountValid) {
  check(serviceProject === String(envValue('NEXT_PUBLIC_FIREBASE_PROJECT_ID') || '').trim(), '클라이언트·서버 Firebase project_id 일치');
}
check(String(envValue('VEHICLE_CLAIM_SERVER_ENABLED') || '').trim().toLowerCase() === 'true', '차량 원자 선점 서버 kill switch ON');
check(String(envValue('NEXT_PUBLIC_ATOMIC_VEHICLE_CLAIMS') || '').trim().toLowerCase() === 'true', '차량 원자 선점 클라이언트 경로 ON');
check(String(envValue('IRONRENTCAR_SYNC_ENABLED') || '').trim().toLowerCase() === 'true', '아이언 홈페이지 재고 연동 ON');

const daily = String(envValue('SHEET_DAILY_SYNC_ENABLED') || '').trim().toLowerCase();
check(daily !== 'true', '미결 Sheet 충돌 동안 일일 자동동기화 OFF');

try {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
    packages?: Record<string, { version?: string }>;
  };
  const packages = lock.packages || {};
  const adminVersion = String(packages['node_modules/firebase-admin']?.version || '');
  const jwksVersion = String(packages['node_modules/jwks-rsa']?.version || '');
  const joseVersion = String(packages['node_modules/jose']?.version || '');
  const major = (version: string) => Number(version.match(/^(\d+)/)?.[1] || 0);
  check(
    !!adminVersion && !(major(jwksVersion) >= 4 && major(joseVersion) >= 6),
    `Vercel Node 함수 호환 Firebase Admin 의존성 (${adminVersion || '미확인'} / jwks-rsa ${jwksVersion || '미확인'} / jose ${joseVersion || '미확인'})`,
  );
} catch {
  fail('Firebase Admin 런타임 의존성 판독: package-lock.json');
}

// 2026-08-05 product 브리지 폐기 후 뒤집은 검사.
//  예전엔 «product 브리지가 유지되는가»를 봤고, env 미설정이면 ['product'] 로 «가정»했다.
//  그 가정 때문에 브리지를 없앤 뒤에도 계속 PASS 가 떴다 — 실패보다 나쁜 «거짓 통과»다.
//  이제는 반대를 본다: 환경변수에 product 를 적어도 브리지가 열리지 않아야 한다.
const bridgeSetting = envValue('NEXT_PUBLIC_BRIDGE_V3');
const bridged = (bridgeSetting || '').split(',').map((value) => value.trim()).filter(Boolean);
check(!bridged.includes('product'), 'product v3 브리지 미설정(폐기 상태 유지)');

if (!existsSync(rulesFile)) {
  fail(`후보 Rules 파일 존재: ${rulesFile}`);
} else {
  try {
    const rules = (JSON.parse(readFileSync(rulesFile, 'utf8')) as { rules?: Rec }).rules || {};
    const legacyProducts = (rules.products || {}) as Rec;
    const v4 = (rules.v4 || {}) as Rec;
    const v4Products = (v4.products || {}) as Rec;
    const v4Claims = (v4.vehicle_claims || {}) as Rec;
    const v4Contracts = (v4.contracts || {}) as Rec;
    const contractLeaf = (v4Contracts.$contract_id || {}) as Rec;
    const legacyRead = String(legacyProducts['.read'] || '');
    const v4Read = String(v4Products['.read'] || '');
    check(legacyProducts['.write'] === false, '후보 Rules v3 products write 폐쇄');
    check(/role.*admin/.test(legacyRead) && /anonymous/.test(legacyRead), '후보 Rules v3 products 원문 read 관리자 한정');
    check(
      /auth != null/.test(v4Read)
        && /anonymous/.test(v4Read)
        && hasActiveAssignedUserGate(v4Read),
      '후보 Rules v4 공개 products read 활성·배정 사용자 한정',
    );
    check(v4Claims['.write'] === false, '후보 Rules vehicle_claims client write 폐쇄');
    check(
      ['vehicle_identity_hash', 'agent_balance_paid', 'provider_balance_confirmed'].every((field) => (
        String(((contractLeaf[field] || {}) as Rec)['.validate'] || '') === 'newData.val() === data.val()'
      )),
      '후보 Rules 차량 선점 필드 서버 단일 writer',
    );
  } catch {
    fail(`후보 Rules JSON 판독: ${rulesFile}`);
  }
}

const requiredFiles = [
  'app/api/products/bridge/route.ts',
  'lib/domain/product-bridge.ts',
  'lib/server/firebase-admin.ts',
  'lib/firebase/rtdb-adapter.ts',
  'app/api/contracts/vehicle-claim/route.ts',
  'lib/server/vehicle-claim.ts',
  'lib/firebase/vehicle-claim-client.ts',
  'scripts/ruleprobe/vehicle-claim-api-probe.mjs',
  'app/api/auth/session/route.ts',
  'scripts/smoke-b2b-role-matrix.mts',
];
for (const path of requiredFiles) check(existsSync(path), `브리지 구성 파일 ${path}`);

if (requiredFiles.every(existsSync)) {
  const route = readFileSync(requiredFiles[0], 'utf8');
  const projection = readFileSync(requiredFiles[1], 'utf8');
  const auth = readFileSync(requiredFiles[2], 'utf8');
  const adapter = readFileSync(requiredFiles[3], 'utf8');
  const claimRoute = readFileSync(requiredFiles[4], 'utf8');
  const claimServer = readFileSync(requiredFiles[5], 'utf8');
  const claimClient = readFileSync(requiredFiles[6], 'utf8');
  const claimProbe = readFileSync(requiredFiles[7], 'utf8');
  const sessionRoute = readFileSync(requiredFiles[8], 'utf8');
  const roleSmoke = readFileSync(requiredFiles[9], 'utf8');
  // 2026-08-05 레거시 상품 브리지 «폐기». ERP4 상품은 v4/products 단독 정본이다.
  //  예전 검사는 브리지가 살아 있다는 전제로 그 안전장치(활성 사용자 재검증·응답 상한)를 찾았다.
  //  브리지 자체가 없어졌으니 그 검사는 통과할 수 없고, 그대로 두면 게이트가 «영구 빨간불»이 된다.
  //  상시 빨간 게이트는 아무도 안 본다 — 오탐이 쌓이면 목록이 죽는다.
  //  그래서 검사를 뒤집는다: «브리지가 정말 닫혀 있는가»를 본다. 닫힌 문이 지켜진 문보다 안전하다.
  check(/status:\s*410/.test(route), '레거시 상품 브리지 폐기(410)');
  check(!/firebase|Database|getDatabase|ref\(/i.test(route), '폐기된 브리지에 DB 접근 없음');
  check(!/\b(set|update|remove|push|runTransaction)\s*\(/.test(route), '브리지 API read-only');
  check(projection.includes('stripProductCost(product)'), '역할별 상품 private 원자 제거');
  check(auth.includes("sign_in_provider === 'anonymous'") && auth.includes('ACTIVE_ROLES'), '익명·미배정 역할 fail-closed');
  // 어댑터도 브리지를 부르지 않아야 한다 — 부르면 전량 410 을 받아 재고가 빈다.
  check(!adapter.includes("fetch('/api/products/bridge'"), '클라이언트가 폐기된 브리지를 부르지 않음');
  check(/BRIDGE_FROM_V3[\s\S]{0,400}!==\s*'product'/.test(adapter), 'product 브리지 환경변수로도 재개방 불가');
  check(claimRoute.includes('vehicleClaimServerEnabled()') && claimRoute.includes('verifyActiveBearer') && claimRoute.includes('transitionVehicleClaim'), '차량 claim API kill switch·활성 사용자·서버 transaction 연결');
  check(claimServer.includes("transaction((raw)") && claimServer.includes("v4/vehicle_claims/"), '차량 claim RTDB transaction SSOT');
  check(claimServer.includes('lockedProductRival') && claimServer.includes('vehicleIdentity(product)'), '차량 claim 트윈 상품 소유 락 재검증');
  check(claimClient.includes("fetch('/api/contracts/vehicle-claim'") && claimClient.includes('getIdToken()'), '차량 claim 클라이언트 인증 호출');
  check(auth.includes('demoEmulatorProjectId') && auth.includes("startsWith('demo-')"), '서버 무자격증명 초기화 demo 격리 한정');
  check(claimProbe.includes('동시 API 선점 정확히 1건 성공') && claimProbe.includes('claim 원장 제거'), '차량 claim 실제 Next API 통합 적대 probe');
  check(sessionRoute.includes('verifyActiveBearer(request)') && !sessionRoute.includes('actor.uid'), '역할 smoke API 활성 사용자·비식별 응답');
  check(
    ['B2B_PLATFORM_ADMIN_ID_TOKEN', 'B2B_AGENT_ADMIN_ID_TOKEN', 'B2B_AGENT_ID_TOKEN', 'B2B_PROVIDER_ADMIN_ID_TOKEN', 'B2B_PROVIDER_ID_TOKEN']
      .every((name) => roleSmoke.includes(name))
      && roleSmoke.includes("get<SessionPayload>('/api/auth/session'")
      && roleSmoke.includes("get<BridgePayload>('/api/products/bridge'"),
    '5역할 Preview 읽기 smoke 구성',
  );
}

console.log(`B2B 출시 게이트 · env=${envFile} · rules=${rulesFile}`);
for (const message of passes) console.log(`PASS ${message}`);
for (const message of failures) console.log(`FAIL ${message}`);
console.log(`\n결과: ${failures.length ? 'NO-GO' : 'GO-CANDIDATE'} · PASS ${passes.length} · FAIL ${failures.length}`);
if (failures.length) process.exitCode = 1;
