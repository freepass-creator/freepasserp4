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
  'NEXT_PUBLIC_FIREBASE_APP_ID',
]) {
  check(present(name), `환경변수 ${name}`);
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

const bridgeSetting = envValue('NEXT_PUBLIC_BRIDGE_V3');
const bridged = bridgeSetting == null
  ? ['product']
  : bridgeSetting.split(',').map((value) => value.trim()).filter(Boolean);
check(bridged.includes('product'), '후보 Rules 전환 동안 product v3 브리지 유지');

if (!existsSync(rulesFile)) {
  fail(`후보 Rules 파일 존재: ${rulesFile}`);
} else {
  try {
    const rules = (JSON.parse(readFileSync(rulesFile, 'utf8')) as { rules?: Rec }).rules || {};
    const legacyProducts = (rules.products || {}) as Rec;
    const v4 = (rules.v4 || {}) as Rec;
    const v4Products = (v4.products || {}) as Rec;
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
  } catch {
    fail(`후보 Rules JSON 판독: ${rulesFile}`);
  }
}

const requiredFiles = [
  'app/api/products/bridge/route.ts',
  'lib/domain/product-bridge.ts',
  'lib/server/firebase-admin.ts',
  'lib/firebase/rtdb-adapter.ts',
];
for (const path of requiredFiles) check(existsSync(path), `브리지 구성 파일 ${path}`);

if (requiredFiles.every(existsSync)) {
  const route = readFileSync(requiredFiles[0], 'utf8');
  const projection = readFileSync(requiredFiles[1], 'utf8');
  const auth = readFileSync(requiredFiles[2], 'utf8');
  const adapter = readFileSync(requiredFiles[3], 'utf8');
  check(route.includes('verifyActiveBearer(request)'), '브리지 API 활성 사용자 재검증');
  check(route.includes('selectLegacyProductsForBridge') && route.includes('MAX_RESPONSE_PRODUCTS'), '브리지 API 활성·참조 이력 응답 상한');
  check(!/\b(set|update|remove|push|runTransaction)\s*\(/.test(route), '브리지 API read-only');
  check(projection.includes('stripProductCost(product)'), '역할별 상품 private 원자 제거');
  check(auth.includes("sign_in_provider === 'anonymous'") && auth.includes('ACTIVE_ROLES'), '익명·미배정 역할 fail-closed');
  check(adapter.includes("fetch('/api/products/bridge'") && adapter.includes("cache: 'no-store'"), '비관리자 클라이언트 서버 브리지 우선');
}

console.log(`B2B 출시 게이트 · env=${envFile} · rules=${rulesFile}`);
for (const message of passes) console.log(`PASS ${message}`);
for (const message of failures) console.log(`FAIL ${message}`);
console.log(`\n결과: ${failures.length ? 'NO-GO' : 'GO-CANDIDATE'} · PASS ${passes.length} · FAIL ${failures.length}`);
if (failures.length) process.exitCode = 1;
