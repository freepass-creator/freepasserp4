/**
 * 영업자·공급사 제한 오픈 전 정적/환경 게이트.
 * 비밀값은 출력하지 않고 이름의 존재 여부만 검사하며 외부 write를 하지 않는다.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';

/** 런타임 트리(app·lib·components)의 소스 파일 목록. 외부 write 없이 읽기만 한다. */
function runtimeSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        walk(full);
      } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  for (const dir of ['app', 'lib', 'components']) walk(dir);
  return out;
}

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

// ★NEXT_PUBLIC_FIREBASE_DATABASE_URL 은 이 목록에서 «뺐다». 되살리지 마라.
//   · RTDB 는 2026-09-14 대표 직접 결정으로 영구 폐기됐다.
//   · 운영(Vercel)에서는 이미 2026-09-10 에 이 환경변수가 지워져 있었다
//     (scripts/check-deployed.mts 의 기록).
//   · app·lib·components 런타임 참조 0 — 마지막 사용처였던 app/api/drive-backup/route.ts 는
//     이 브랜치(fix/drive-backup-failopen)가 제거했다.
//   폐기한 변수를 «필수»로 요구하면 출시가 폐기물을 다시 채워 넣어야만 통과한다 — 그래서 뺀다.
//   아래 나머지 키는 살아 있다(Auth·Storage·Analytics 가 쓴다).
for (const name of [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
]) {
  check(present(name), `환경변수 ${name}`);
}
// ★예전엔 «NEXT_PUBLIC_DATA_BACKEND === 'rtdb'» 를 «필수 PASS 조건»으로 요구했다. 그 검사는 뒤집었다.
//   · RTDB 는 2026-09-14 대표 직접 결정으로 영구 폐기됐고, 2026-09-15 컷오버(381ea02e)가
//     rtdb-adapter·migrate-* 를 실제로 지웠다. 정본은 Firestore 단독이다.
//   · 그대로 두면 «폐기한 백엔드를 다시 켜야만 출시가 통과»한다 — 게이트가 폐기물을 강제하는 꼴이다.
//   지우지 않고 반대를 본다: rtdb 로 «되돌아가 있으면» 출시를 막는다.
//   (같은 파일의 'product v3 브리지 미설정(폐기 상태 유지)' 검사와 같은 방식)
check(String(envValue('NEXT_PUBLIC_DATA_BACKEND') || '').trim().toLowerCase() !== 'rtdb', '폐기된 RTDB 백엔드 미복귀(NEXT_PUBLIC_DATA_BACKEND)');

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

// 후보 Rules 는 .gitignore(39행) 된 «생성물»이다 — 저장소에 없는 게 정상이고,
// scripts/ruleprobe/build-release-candidate.mjs 가 database.rules.json 에서 만든다.
// 없으면 아래 Rules 검사 4건이 «안 돈다» — 그러니 FAIL 은 유지하되 무엇을 해야 하는지 적는다.
if (!existsSync(rulesFile)) {
  fail(`후보 Rules 파일 존재: ${rulesFile} (생성물 — \`node scripts/ruleprobe/build-release-candidate.mjs\` 실행 후 다시 돌려라. 이 파일이 없으면 아래 Rules 검사 4건은 실행되지 않는다)`);
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

// ★'lib/firebase/rtdb-adapter.ts' 는 이 목록에서 «뺐다». 되살리지 마라.
//   2026-09-15 RTDB 컷오버(381ea02e)가 그 어댑터를 «일부러 지웠다»(RTDB 영구 폐기, Firestore 단독 정본).
//   목록에 남겨 둔 탓에 이 게이트는 «상시 FAIL 1건»이었고, 더 나쁘게는 아래 `every(existsSync)`
//   블록 전체가 열리지 않아 «내용 검사 11건이 한 번도 실행되지 않았다» — 존재하지도 않는 파일
//   하나가 살아 있는 검사 11건을 인질로 잡고 있었다.
//   어댑터에 걸려 있던 검사 2건의 처리는 아래 각 자리에 적어 뒀다.
//   ※인덱스(requiredFiles[3])로 읽던 것도 «경로 이름»으로 바꿨다 — 목록이 한 줄 바뀔 때마다
//     엉뚱한 파일을 검사하게 되는 구조였다.
const requiredFiles = [
  'app/api/products/bridge/route.ts',
  'lib/domain/product-bridge.ts',
  'lib/server/firebase-admin.ts',
  'app/api/contracts/vehicle-claim/route.ts',
  'lib/server/vehicle-claim.ts',
  'lib/firebase/vehicle-claim-client.ts',
  'scripts/ruleprobe/vehicle-claim-api-probe.mjs',
  'app/api/auth/session/route.ts',
  'scripts/smoke-b2b-role-matrix.mts',
];
for (const path of requiredFiles) check(existsSync(path), `브리지 구성 파일 ${path}`);

// ★파일 하나가 없으면 아래 «내용 검사 11건이 통째로 조용히 건너뛰어진다». 그게 rtdb-adapter 하나
//   때문에 실제로 벌어진 일이다(실측: 파일 1개 빠짐 → PASS 27 → 12). 건너뛴 것을 «조용히» 두지
//   않고 한 줄로 명시 FAIL 한다 — 검사가 안 돈 것을 「통과」로 읽으면 안 된다.
const missingRequired = requiredFiles.filter((file) => !existsSync(file));
if (missingRequired.length) {
  fail(`구성 파일 누락으로 내용 검사 11건 미실행: ${missingRequired.join(', ')}`);
}
if (!missingRequired.length) {
  const source = (file: string) => readFileSync(file, 'utf8');
  const route = source('app/api/products/bridge/route.ts');
  const projection = source('lib/domain/product-bridge.ts');
  const auth = source('lib/server/firebase-admin.ts');
  const claimRoute = source('app/api/contracts/vehicle-claim/route.ts');
  const claimServer = source('lib/server/vehicle-claim.ts');
  const claimClient = source('lib/firebase/vehicle-claim-client.ts');
  const claimProbe = source('scripts/ruleprobe/vehicle-claim-api-probe.mjs');
  const sessionRoute = source('app/api/auth/session/route.ts');
  const roleSmoke = source('scripts/smoke-b2b-role-matrix.mts');
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
  // 예전엔 이 검사가 lib/firebase/rtdb-adapter.ts «한 파일»만 봤다. 그 파일이 RTDB 컷오버로
  // 사라지자 검사가 통째로 멈췄다. 지키려던 것은 «어댑터»가 아니라 «클라이언트 코드 전체가
  // 폐기된 브리지를 부르지 않는 것»이므로, 대상을 파일 하나에서 런타임 트리 전체로 넓혔다.
  // (좁히지 않고 넓혔다 — 예전보다 잡는 범위가 크다.)
  const bridgeCallers = runtimeSources().filter((file) => /\/api\/products\/bridge/.test(readFileSync(file, 'utf8')));
  check(bridgeCallers.length === 0, `런타임 코드가 폐기된 브리지를 부르지 않음${bridgeCallers.length ? ` (호출: ${bridgeCallers.join(', ')})` : ''}`);
  // ★'product 브리지 환경변수로도 재개방 불가'(BRIDGE_FROM_V3 정규식) 검사는 «지웠다». 되살리지 마라.
  //   그 검사는 rtdb-adapter 안의 환경변수 분기가 product 를 거부하는지 보던 것인데,
  //   ① 어댑터가 없어졌고 ② BRIDGE_FROM_V3·NEXT_PUBLIC_BRIDGE_V3 를 읽는 런타임 코드가 0 이며
  //   ③ 브리지 라우트 자체가 위에서 «무조건 410» 임을 검사한다 — 재개방 경로가 코드에 없다.
  //   환경변수로 되살리려는 시도는 'product v3 브리지 미설정(폐기 상태 유지)' 검사가 그대로 잡는다.
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
