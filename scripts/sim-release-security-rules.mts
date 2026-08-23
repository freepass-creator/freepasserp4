import fs from 'node:fs';
import path from 'node:path';

type Rule = Record<string, any>;
type Case = { name: string; ok: boolean; detail?: string };

const rulesArg = process.argv.find((arg) => arg.startsWith('--rules='));
const rulesFile = rulesArg ? rulesArg.slice('--rules='.length) : 'database.rules.json';
const rulesPath = path.resolve(process.cwd(), rulesFile);
const rules = (JSON.parse(fs.readFileSync(rulesPath, 'utf8')) as { rules: Rule }).rules;
if (rulesFile !== 'database.rules.json') console.log(`INFO Rules 후보 점검: ${rulesFile}`);
const cases: Case[] = [];
const check = (name: string, ok: boolean, detail?: string) => cases.push({ name, ok, detail });
const text = (value: unknown) => String(value || '');
const clip = (value: string) => value.length > 180 ? `${value.slice(0, 177)}…` : value;

const v3ProductWrite = text(rules.products?.['.write']);
const v3PartnerWrite = text(rules.partners?.['.write']);
const v3PolicyWrite = text(rules.policies?.['.write']);
check('SEC-R1 v3 products 운영 원본 write는 폐쇄', !v3ProductWrite || v3ProductWrite === 'false', v3ProductWrite);
check('SEC-R2 v3 partners provider 광역 write 없음',
  !v3PartnerWrite.includes("role').val() === 'provider'") && !v3PartnerWrite.includes("role').val() === 'provider_admin'"),
  v3PartnerWrite);
check('SEC-R3 v3 policies provider 광역 write 없음',
  !v3PolicyWrite.includes("role').val() === 'provider'") && !v3PolicyWrite.includes("role').val() === 'provider_admin'"),
  v3PolicyWrite);

const v3ProductRead = text(rules.products?.['.read']);
check('SEC-R4 v3 products 원가·VIN 포함 원문은 모든 인증 사용자에게 열리지 않음',
  !v3ProductRead.includes('auth != null')
    || v3ProductRead.includes("role').val()")
    || v3ProductRead.includes('provider_company_code'),
  v3ProductRead);

const v4Products = rules.v4?.products as Rule | undefined;
const v4ProductRead = text(v4Products?.['.read']);
const activeAssignedProductRead = (
  v4ProductRead.includes("child('status').val() !== 'pending'")
  && v4ProductRead.includes("child('status').val() !== 'deleted'")
  && v4ProductRead.includes("child('status').val() !== 'rejected'")
  && v4ProductRead.includes("child('is_active').val() !== '아니오'")
  && v4ProductRead.includes("child('is_active').val() !== false")
  && ['agent', 'agent_admin', 'agent_manager', 'provider', 'provider_admin', 'admin']
    .every((role) => v4ProductRead.includes(`child('role').val() === '${role}'`))
);
check('SEC-R4b v4 공개 products도 활성·배정 사용자만 read',
  activeAssignedProductRead, v4ProductRead);
const productGuardSurface = JSON.stringify(v4Products?.$code || {});
const broadProductFields = ['vehicle_status', 'locked_by_contract'].filter((field) => {
  const write = text(v4Products?.$code?.[field]?.['.write']);
  return write.includes("role').val() === 'agent'")
    && !productGuardSurface.includes("root.child('v4').child('contracts')")
    && !productGuardSurface.includes("root.child('contracts')");
});
const productKeyWrite = text(v4Products?.$code?._key?.['.write']);
const productKeyValidate = text(v4Products?.$code?._key?.['.validate']);
if (productKeyWrite.includes("role').val() === 'agent'")
  && !productKeyValidate.includes('newData.val() === data.val()')
  && !productKeyValidate.includes('newData.val() === $code')) broadProductFields.push('_key');
check('SEC-R5 v4 products agent leaf write는 계약 레코드에 결속',
  broadProductFields.length === 0, broadProductFields.join(', '));
const unscopedV4MasterNodes = ['partners', 'policies'].filter((node) => {
  const write = text(rules.v4?.[node]?.['.write']);
  const ownershipSurface = JSON.stringify(rules.v4?.[node] || {});
  const recordOwned = ownershipSurface.includes("data.child('provider_company_code')")
    && ownershipSurface.includes("newData.child('provider_company_code')");
  const partnerKeyOwned = node === 'partners'
    && (ownershipSurface.includes("company_code').val() === $pid")
      || ownershipSurface.includes("$pid === root.child('users')"));
  return write.includes("role').val() === 'provider'")
    && !recordOwned
    && !partnerKeyOwned;
});
check('SEC-R6 v4 partners/policies provider write는 소유 공급사에 결속',
  unscopedV4MasterNodes.length === 0, unscopedV4MasterNodes.join(', '));

const settlement = rules.v4?.settlements?.$sid as Rule | undefined;
const settlementWrite = text(settlement?.['.write']);
const settlementClientWriteClosed = ![
  "role').val() === 'agent'", "role').val() === 'agent_admin'", "role').val() === 'agent_manager'",
  "role').val() === 'provider'", "role').val() === 'provider_admin'",
].some((role) => settlementWrite.includes(role))
  && settlementWrite.includes("role').val() === 'admin'");
check('SEC-R7 정산 원장은 non-admin 클라이언트 write를 닫음',
  settlementClientWriteClosed, settlementWrite);

for (const [node, label] of [
  ['settlements_provider_private', 'R1'],
  ['settlements_agent_private', 'R2'],
] as const) {
  const rule = rules.v4?.[node]?.$sid as Rule | undefined;
  const write = text(rule?.['.write']);
  const privateClientWriteClosed = ![
    "role').val() === 'agent'", "role').val() === 'agent_admin'", "role').val() === 'agent_manager'",
    "role').val() === 'provider'", "role').val() === 'provider_admin'",
  ].some((role) => write.includes(role))
    && write.includes("role').val() === 'admin'");
  check(`SEC-R8 ${label} private 금액 direct write를 닫음`, privateClientWriteClosed, write);
}

const contract = rules.v4?.contracts?.$contract_id as Rule | undefined;
const contractParentValidate = text(contract?.['.validate']);
check('SEC-R9 contract_date는 생성 후 불변',
  text(contract?.contract_date?.['.validate']).includes('newData.val() === data.val()')
    || contractParentValidate.includes("newData.child('contract_date').val() === data.child('contract_date').val()"),
  text(contract?.contract_date?.['.validate']));

const roles = ['admin', 'agent', 'agent_admin', 'agent_manager'];
const agentOnly = (field: string): boolean => {
  const leaf = text(contract?.[field]?.['.validate']);
  const validate = leaf || contractParentValidate;
  const unchanged = validate.includes('newData.val() === data.val()')
    || validate.includes(`newData.child('${field}').val() === data.child('${field}').val()`);
  return unchanged && roles.every((role) => validate.includes(`.val() === '${role}'`));
};
const unguardedPii = [
  'customer_name', 'customer_phone', 'customer_id', 'customer_address',
  'driver_license_no', 'emergency_name', 'emergency_phone',
].filter((field) => !agentOnly(field));
check('SEC-R10 contract 고객 PII 공급사 변경 차단', unguardedPii.length === 0, unguardedPii.join(', '));
const unguardedSign = [
  'sign_token', 'sign_status', 'sign_sent_at', 'sign_expires_at', 'sign_revoked_at',
  'sign_signature', 'sign_consents', 'sign_consent_version', 'sign_signed_at',
  'sign_reject_reason', 'sign_rejected_at', 'signed_pdf_url',
].filter((field) => !agentOnly(field));
check('SEC-R11 contract 전자서명 제어필드 공급사 변경 차단', unguardedSign.length === 0, unguardedSign.join(', '));

const statusValidate = text(contract?.contract_status?.['.validate']);
const cancelRoles = roles.every((role) => statusValidate.includes(`.val() === '${role}'`));
const providerCanCancel = statusValidate.includes(".val() === 'provider'")
  || statusValidate.includes(".val() === 'provider_admin'");
check('SEC-R12 계약취소는 영업자/관리자 또는 공급사 거부사유에만 허용',
  cancelRoles && (!providerCanCancel || (statusValidate.includes('출고 불가') && statusValidate.includes('부결'))),
  statusValidate);

const firstCreateRoleFields = [
  'agent_delivery_inquiry', 'agent_docs_submitted', 'agent_final_paid', 'provider_agreement_done', 'agent_handover_confirmed',
  'provider_delivery_response', 'provider_docs_review', 'provider_agreement_sent', 'provider_release_completed',
].filter((field) => text(contract?.[field]?.['.validate']).includes('!data.parent().exists()'));
check('SEC-R13 신규 계약도 역할별 진행단계 검증을 우회하지 않음', firstCreateRoleFields.length === 0, firstCreateRoleFields.join(', '));

const rateLeaves = ['fee_rate_snapshot', 'payout_rate_snapshot'].map((field) => text(contract?.[field]?.['.validate']));
check('SEC-R14 계약 요율은 관리자 서버 동결 외 최초 주입·삭제를 막음',
  rateLeaves.every((rule) => !rule.includes('!data.parent().exists()') && rule.includes("role').val() === 'admin'"))
    && contractParentValidate.includes("!data.child('fee_rate_snapshot').exists()")
    && contractParentValidate.includes("!data.child('payout_rate_snapshot').exists()"),
  rateLeaves.join(' | '));

const signStatusRule = text(contract?.sign_status?.['.validate']);
const agreementSentRule = text(contract?.provider_agreement_sent?.['.validate']);
check('SEC-R15 신규 계약 서명완료·약정발송은 증적 없이 선주입할 수 없음',
  !signStatusRule.includes('!data.parent().exists()')
    && !agreementSentRule.includes('!data.parent().exists()'),
  `${signStatusRule} | ${agreementSentRule}`);

const legacySignStatus = text(rules.contract_sign?.$token?.status?.['.validate']);
check('SEC-R16 legacy 공개서명은 최초 sent·익명 제출·관리자 승인 순서만 허용',
  legacySignStatus.includes("!data.exists() && auth != null && newData.val() === 'sent'")
    && legacySignStatus.includes("auth == null && data.val() === 'sent' && newData.val() === 'pending_review'")
    && !legacySignStatus.includes("auth != null && (newData.val() === 'sent' || newData.val() === 'pending_review'"),
  legacySignStatus);

const publicSignUrlRule = text(contract?.esign_sign_url?.['.validate']);
check('SEC-R17 계약 공개 FPS 링크는 클라이언트가 새로 넣거나 바꿀 수 없음',
  publicSignUrlRule.includes('!newData.exists()')
    && publicSignUrlRule.includes('data.exists()')
    && publicSignUrlRule.includes('newData.val() === data.val()'),
  publicSignUrlRule);

const failed = cases.filter((item) => !item.ok);
for (const item of cases) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.ok || !item.detail ? '' : ` :: ${clip(item.detail)}`}`);
}
console.log(`\nrelease security rules simulation: ${cases.length - failed.length}/${cases.length} PASS`);
if (failed.length) process.exit(1);
