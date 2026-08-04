import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures: string[] = [];
const warnings: string[] = [];

function envValues(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

const localEnv = envValues(path.join(root, '.env.local'));
const envValue = (key: string) => String(process.env[key] ?? localEnv[key] ?? '').trim();
const hasEnv = (key: string) => envValue(key).length > 0;
const firebaseKeys = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_DATABASE_URL',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
];

const operatorFields = [
  ['NEXT_PUBLIC_OPERATOR_COMPANY', '상호'],
  ['NEXT_PUBLIC_OPERATOR_CEO', '대표자'],
  ['NEXT_PUBLIC_OPERATOR_ADDRESS', '주소'],
  ['NEXT_PUBLIC_OPERATOR_BIZ_NO', '사업자등록번호'],
  ['NEXT_PUBLIC_OPERATOR_EMAIL', '문의 이메일'],
  ['NEXT_PUBLIC_OPERATOR_PRIVACY_OFFICER', '개인정보 보호책임자'],
] as const;
const missingLegal = operatorFields.filter(([key]) => !hasEnv(key)).map(([, label]) => label);
if (missingLegal.length) failures.push(`약관·개인정보 운영자 정보 미기재: ${missingLegal.join(', ')}`);
const operatorBizNo = envValue('NEXT_PUBLIC_OPERATOR_BIZ_NO');
const operatorEmail = envValue('NEXT_PUBLIC_OPERATOR_EMAIL');
if (operatorBizNo && !/^\d{3}-?\d{2}-?\d{5}$/.test(operatorBizNo)) {
  failures.push('약관·개인정보 사업자등록번호 형식 오류: 숫자 10자리 또는 000-00-00000');
}
if (operatorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(operatorEmail)) {
  failures.push('약관·개인정보 문의 이메일 형식 오류');
}

const missingFirebase = firebaseKeys.filter((key) => !hasEnv(key));
if (missingFirebase.length) failures.push(`Firebase 필수 환경변수 누락: ${missingFirebase.join(', ')}`);

for (const file of ['app/error.tsx', 'app/global-error.tsx', 'components/ClientErrorReporter.tsx']) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`오류 관측/복구 파일 누락: ${file}`);
}

const manifest = fs.readFileSync(path.join(root, 'app/manifest.ts'), 'utf8');
if (!manifest.includes("display: 'standalone'")) failures.push('PWA manifest standalone 설정 누락');
if (!/192x192|512x512/.test(manifest)) warnings.push('스토어/PWA용 192x192·512x512 PNG 아이콘 미확인');
if (!fs.existsSync(path.join(root, 'public', 'sw.js'))) warnings.push('서비스 워커가 없어 오프라인/업데이트 복구는 웹앱 범위 밖');

const nextConfig = fs.readFileSync(path.join(root, 'next.config.mjs'), 'utf8');
for (const header of ['Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
  if (!nextConfig.includes(header)) warnings.push(`보안 응답 헤더 미설정: ${header}`);
}

// 완료 계약 취소는 환수액이 R1(private fee_amount)에 의존한다. 영업자에게 R1을 노출하지 않는
// 현재 분리 구조에서 클라이언트 cancelContract를 그대로 허용하면 0원 환수 또는 계약/차량만
// 먼저 바뀐 부분완료가 생긴다. 서버 원자처리 또는 엔진의 관리자 전용 가드가 있어야 한다.
const settlementEngine = fs.readFileSync(path.join(root, 'lib/domain/settlement-engine.ts'), 'utf8');
const completedCancelAdminGuard = /contract_status\s*===\s*['"]계약완료['"][\s\S]{0,240}currentActor\(\)\.role\s*!==\s*['"]admin['"]/.test(settlementEngine);
const completedCancelServerAtomic = /completed[-_ ]contract[-_ ]cancel|cancelCompletedContractAtomic|serverAtomicCancel/.test(settlementEngine);
if (!completedCancelAdminGuard && !completedCancelServerAtomic) {
  failures.push('완료 계약 취소·환수 원자성 미확정 — 영업자 취소 시 private R1을 못 읽어 0원 환수 또는 계약/차량만 변경될 수 있음(관리자 전용 또는 서버 원자처리 결정 필요)');
}

// 운영 실측에서 v3/v4 child key 공통은 1개뿐이며 차량번호 중복과 계약·채팅 참조가 있다.
// 예전 child-key 기준 직접 복사를 다시 노출하면 기존 v4 차량까지 대량 중복 생성할 수 있다.
const productMigration = fs.readFileSync(path.join(root, 'lib/firebase/migrate-products.ts'), 'utf8');
const devPage = fs.readFileSync(path.join(root, 'app/dev/page.tsx'), 'utf8');
const directProductCopyLocked = /if\s*\(!dryRun\)\s*\{[\s\S]{0,320}직접 복사는 잠겨 있습니다/.test(productMigration);
if (!directProductCopyLocked || /runMigrate\(false\)/.test(devPage)) {
  failures.push('v3→v4 재고 직접 복사 실행 노출 — 자연키·계약·채팅 참조 이관계획 승인 전 write를 잠가야 함');
}

const rulesArg = process.argv.find((arg) => arg.startsWith('--rules='));
const rulesFile = rulesArg ? rulesArg.slice('--rules='.length) : 'database.rules.json';
const rulesPath = path.isAbsolute(rulesFile) ? rulesFile : path.join(root, rulesFile);
if (!fs.existsSync(rulesPath)) failures.push(`Rules 후보 파일 없음: ${rulesFile}`);
const databaseRules = JSON.parse(fs.readFileSync(rulesPath, 'utf8')) as {
  rules?: Record<string, unknown>;
};
const rulesRoot = databaseRules.rules as Record<string, any> | undefined;

// 앱 어댑터가 v4로만 쓰는 것은 보안 경계가 아니다. 인증 사용자는 SDK/REST로 Rules가
// 허용한 v3 운영 노드를 직접 쓸 수 있으므로, 전체 노드 write는 출시 전에 닫혀 있어야 한다.
const legacyProductWrite = String(rulesRoot?.products?.['.write'] || '').trim();
const legacyPartnerWrite = String(rulesRoot?.partners?.['.write'] || '').trim();
const legacyPolicyWrite = String(rulesRoot?.policies?.['.write'] || '').trim();
const unsafeLegacyWrites: string[] = [];
if (legacyProductWrite && legacyProductWrite !== 'false') {
  unsafeLegacyWrites.push('products(활성 인증 사용자 전체)');
}
if (legacyPartnerWrite.includes("role').val() === 'provider'")
  || legacyPartnerWrite.includes("role').val() === 'provider_admin'")) {
  unsafeLegacyWrites.push('partners(provider/provider_admin 전체 노드)');
}
if (legacyPolicyWrite.includes("role').val() === 'provider'")
  || legacyPolicyWrite.includes("role').val() === 'provider_admin'")) {
  unsafeLegacyWrites.push('policies(provider/provider_admin 전체 노드)');
}
if (unsafeLegacyWrites.length) {
  failures.push(`v3 운영 노드 raw write 차단 누락: ${unsafeLegacyWrites.join(', ')}`);
}

// v3 products에는 이관 전 vehicle_price·VIN·price.fee가 섞여 있다. 부모 read를 모든
// 인증 사용자에게 열면 앱의 stripProductCost를 우회한 REST/SDK 원문 조회를 막을 수 없다.
const legacyProductRead = String(rulesRoot?.products?.['.read'] || '').trim();
const legacyProductReadIsBroad = legacyProductRead.includes('auth != null')
  && !legacyProductRead.includes("role').val()")
  && !legacyProductRead.includes('provider_company_code');
if (legacyProductReadIsBroad) {
  failures.push('v3 products 원문 광역 read — 영업자/타 공급사가 raw SDK로 원가·VIN을 열람 가능(공개 projection 또는 데이터 이관 필요)');
}

const v4ProductRule = rulesRoot?.v4?.products as Record<string, any> | undefined;
const v4ProductGuardSurface = JSON.stringify(v4ProductRule?.$code || {});
const actuallyBroadProductLeafWrites = ['vehicle_status', 'locked_by_contract'].filter((field) => {
  const write = String(v4ProductRule?.$code?.[field]?.['.write'] || '');
  return write.includes("role').val() === 'agent'")
    && !v4ProductGuardSurface.includes("root.child('v4').child('contracts')")
    && !v4ProductGuardSurface.includes("root.child('contracts')");
});
const productKeyWrite = String(v4ProductRule?.$code?._key?.['.write'] || '');
const productKeyValidate = String(v4ProductRule?.$code?._key?.['.validate'] || '');
if (productKeyWrite.includes("role').val() === 'agent'")
  && !productKeyValidate.includes('newData.val() === data.val()')
  && !productKeyValidate.includes('newData.val() === $code')) {
  actuallyBroadProductLeafWrites.push('_key');
}
const v4WideWrites: string[] = [];
if (actuallyBroadProductLeafWrites.length) {
  v4WideWrites.push(`products agent leaf(${actuallyBroadProductLeafWrites.join(', ')})`);
}
for (const node of ['partners', 'policies'] as const) {
  const write = String(rulesRoot?.v4?.[node]?.['.write'] || '');
  const ownershipSurface = JSON.stringify(rulesRoot?.v4?.[node] || {});
  const recordOwned = ownershipSurface.includes("data.child('provider_company_code')")
    && ownershipSurface.includes("newData.child('provider_company_code')");
  const partnerKeyOwned = node === 'partners'
    && (ownershipSurface.includes("company_code').val() === $pid")
      || ownershipSurface.includes("$pid === root.child('users')"));
  if ((write.includes("role').val() === 'provider'") || write.includes("role').val() === 'provider_admin'"))
    && !recordOwned
    && !partnerKeyOwned) {
    v4WideWrites.push(`${node} provider/provider_admin 전체 노드`);
  }
}
if (v4WideWrites.length) failures.push(`v4 업무 노드 raw write 소유권 검증 누락: ${v4WideWrites.join(', ')}`);

const legacySignRead = String(rulesRoot?.contract_sign?.$token?.['.read'] || '').trim();
const legacySignReadIsAuthOnly = /^\(?auth\s*!=\s*null/.test(legacySignRead)
  && !legacySignRead.includes("data.child('revoked_at')");
const legacySignAnonIsSentOnly = legacySignRead.includes("child('status').val() === 'sent'")
  || legacySignRead.includes('child("status").val() === "sent"');
if (legacySignRead && !legacySignReadIsAuthOnly && !legacySignAnonIsSentOnly) {
  failures.push('공개서명 pending_review 노드 익명 읽기 허용 — 주민번호·주소·면허·서명 이미지 노출 위험');
}

const contractRule = rulesRoot?.v4?.contracts?.$contract_id as Record<string, any> | undefined;
const vehicleClaimsRule = rulesRoot?.v4?.vehicle_claims as Record<string, any> | undefined;
const claimWrite = vehicleClaimsRule?.['.write'];
const claimRead = String(vehicleClaimsRule?.['.read'] || '');
const serverClaimFields = ['vehicle_identity_hash', 'agent_balance_paid', 'provider_balance_confirmed'];
const mutableServerClaimFields = serverClaimFields.filter((field) => {
  const validate = String(contractRule?.[field]?.['.validate'] || '');
  return validate.trim() !== 'newData.val() === data.val()';
});
const productClaimBound = v4ProductGuardSurface.includes("child('vehicle_claims')")
  && v4ProductGuardSurface.includes("child('vehicle_identity_hash')")
  && v4ProductGuardSurface.includes("child('status').val() === 'active'");
if (claimWrite !== false || !claimRead.includes("role').val() === 'admin'") || mutableServerClaimFields.length || !productClaimBound) {
  failures.push(`차량 원자 claim Rules 결속 누락: ${[
    claimWrite !== false && 'claim client write 폐쇄',
    !claimRead.includes("role').val() === 'admin'") && 'claim read 관리자 한정',
    mutableServerClaimFields.length && `서버 단일 writer(${mutableServerClaimFields.join(', ')})`,
    !productClaimBound && '상품 lock-claim 결속',
  ].filter(Boolean).join(', ')}`);
}
const vehicleSnapshotFields = [
  'car_number_snapshot', 'maker_snapshot', 'model_snapshot', 'sub_model_snapshot',
  'variant_snapshot', 'trim_name_snapshot', 'trim_extra_snapshot', 'vehicle_name_snapshot',
  'year_snapshot', 'fuel_type_snapshot',
];
const mutableVehicleSnapshots = vehicleSnapshotFields.filter((field) => {
  const validate = String(contractRule?.[field]?.['.validate'] || '');
  return !validate.includes('newData.val() === data.val()');
});
if (mutableVehicleSnapshots.length) {
  failures.push(`계약 차량 스냅샷 불변 Rules 누락: ${mutableVehicleSnapshots.join(', ')}`);
}

const contractParentValidate = String(contractRule?.['.validate'] || '');
const contractDateValidate = String(contractRule?.contract_date?.['.validate'] || '');
const contractDateIsImmutable = contractDateValidate.includes('newData.val() === data.val()')
  || contractParentValidate.includes("newData.child('contract_date').val() === data.child('contract_date').val()");
if (!contractDateIsImmutable) {
  failures.push('계약 contract_date 불변 Rules 누락 — 정산 환수 경과기간 기준일 조작 가능');
}

const unchangedInRule = (field: string, validate: string): boolean => (
  validate.includes('newData.val() === data.val()')
  || validate.includes(`newData.child('${field}').val() === data.child('${field}').val()`)
);
const agentContractRoles = ['admin', 'agent', 'agent_admin', 'agent_manager'];
const agentOwnedFieldGuarded = (field: string): boolean => {
  const leafValidate = String(contractRule?.[field]?.['.validate'] || '');
  const validate = leafValidate || contractParentValidate;
  return unchangedInRule(field, validate)
    && agentContractRoles.every((role) => validate.includes(`.val() === '${role}'`));
};

// 고객 개인정보는 공개 서명 슬롯에서 영업자 승인 시 계약으로 복사된다. 공급사는 조회 당사자지만
// 수정 주체가 아니며, UI도 영업자/관리자에게만 입력·승인 액션을 노출한다.
const customerControlledFields = [
  'customer_name', 'customer_phone', 'customer_id', 'customer_address',
  'driver_license_no', 'emergency_name', 'emergency_phone',
];
const unguardedCustomerFields = customerControlledFields.filter((field) => !agentOwnedFieldGuarded(field));
if (unguardedCustomerFields.length) {
  failures.push(`계약 고객 PII 영업자 전용 Rules 누락: ${unguardedCustomerFields.join(', ')}`);
}

const signControlledFields = [
  'sign_token', 'sign_status', 'sign_sent_at', 'sign_expires_at', 'sign_revoked_at',
  'sign_signature', 'sign_consents', 'sign_consent_version', 'sign_signed_at',
  'sign_reject_reason', 'sign_rejected_at', 'signed_pdf_url',
];
const unguardedSignFields = signControlledFields.filter((field) => !agentOwnedFieldGuarded(field));
if (unguardedSignFields.length) {
  failures.push(`계약 전자서명 제어필드 영업자 전용 Rules 누락: ${unguardedSignFields.join(', ')}`);
}

const contractStatusValidate = String(contractRule?.contract_status?.['.validate'] || '');
const cancelHasAgentRoles = agentContractRoles.every((role) => contractStatusValidate.includes(`.val() === '${role}'`));
const cancelAllowsProvider = contractStatusValidate.includes(".val() === 'provider'")
  || contractStatusValidate.includes(".val() === 'provider_admin'");
const providerCancelIsRejectionBound = contractStatusValidate.includes('출고 불가')
  && contractStatusValidate.includes('부결');
if (!cancelHasAgentRoles || (cancelAllowsProvider && !providerCancelIsRejectionBound)) {
  failures.push('계약취소 Rules 역할/사유 검증 누락 — 공급사가 UI를 우회해 수동 취소 가능');
}

// UI 정책은 역할별 메모 슬롯 격리다. 부모 contract .write가 역할 공통이므로 child .write로는
// 권한을 좁힐 수 없고, 반드시 leaf .validate에서 비소유 역할의 변경을 거부해야 한다.
const memoRoleRequirements: Record<string, string[]> = {
  memo_agent: ['admin', 'agent', 'agent_admin', 'agent_manager'],
  memo_provider: ['admin', 'provider', 'provider_admin'],
  memo_admin: ['admin'],
};
const unguardedMemoFields = Object.entries(memoRoleRequirements).filter(([field, roles]) => {
  const validate = String(contractRule?.[field]?.['.validate'] || '');
  return !validate.includes('newData.val() === data.val()')
    || roles.some((role) => !validate.includes(`.val() === '${role}'`));
}).map(([field]) => field);
if (unguardedMemoFields.length) {
  failures.push(`계약 역할별 메모 Rules 격리 누락: ${unguardedMemoFields.join(', ')}`);
}

const settlementRule = rulesRoot?.v4?.settlements?.$sid as Record<string, any> | undefined;
const settlementWrite = String(settlementRule?.['.write'] || '');
const settlementValidationSurface = JSON.stringify(settlementRule || {});
const settlementClientCanCreate = settlementWrite.includes("role').val() === 'agent'")
  || settlementWrite.includes("role').val() === 'provider'");
const settlementCreationBoundToCompletedContract = settlementValidationSurface.includes("child('contracts')")
  && settlementValidationSurface.includes('계약완료');
if (settlementClientCanCreate && !settlementCreationBoundToCompletedContract) {
  failures.push('v4 settlement 임의 생성 차단 누락 — agent/provider가 완료 계약 연계 없이 상태·귀속·금액 레코드 생성 가능');
}

const unsafePrivateSettlementCreates: string[] = [];
for (const [node, label] of [
  ['settlements_provider_private', 'R1(fee_rate/fee_amount)'],
  ['settlements_agent_private', 'R2(agent_payout/payout_rate)'],
] as const) {
  const privateRule = rulesRoot?.v4?.[node]?.$sid as Record<string, any> | undefined;
  const write = String(privateRule?.['.write'] || '');
  const validationSurface = JSON.stringify(privateRule || {});
  const clientCreate = write.includes('!data.exists()')
    && (write.includes("role').val() === 'agent'") || write.includes("role').val() === 'provider'"));
  const amountServerBound = validationSurface.includes("child('contracts')") || validationSurface.includes("child('settlements')");
  if (clientCreate && !amountServerBound) unsafePrivateSettlementCreates.push(label);
}
if (unsafePrivateSettlementCreates.length) {
  failures.push(`v4 settlement private 최초 금액 위조 차단 누락: ${unsafePrivateSettlementCreates.join(', ')}`);
}

const storageRules = fs.readFileSync(path.join(root, 'storage.rules'), 'utf8');
if (/match \/contract-files[\s\S]*?allow create, update:[\s\S]*?request\.resource\.size < 20/.test(storageRules)
  && !/match \/contract-files[\s\S]*?request\.resource\.contentType/.test(storageRules)) {
  warnings.push('레거시 contract-files 업로드 규칙에 MIME 형식 제한 없음');
}

for (const warning of warnings) console.warn(`WARN  ${warning}`);
for (const failure of failures) console.error(`FAIL  ${failure}`);

if (rulesFile !== 'database.rules.json') console.log(`INFO  Rules 후보 점검: ${rulesFile}`);

if (failures.length) {
  console.error(`\n출시 게이트 FAIL — ${failures.length}개 차단 항목, ${warnings.length}개 경고`);
  process.exit(1);
}

console.log(`출시 게이트 PASS — 차단 항목 0개, 경고 ${warnings.length}개`);
