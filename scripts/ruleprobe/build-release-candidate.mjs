/**
 * DO NOT PUBLISH.
 *
 * database.rules.json을 수정하지 않고 출시 보안 후보를 생성한다.
 * 생성물은 정적 게이트와 Firebase Emulator 적대 테스트를 모두 통과한 뒤에도
 * 운영 실데이터 호환성 확인과 사람/Claude 승인이 있어야 게시할 수 있다.
 *
 * 실행: node scripts/ruleprobe/build-release-candidate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..', '..');
const sourcePath = path.join(rootDir, 'database.rules.json');
const outputPath = path.join(here, 'release-candidate.rules.json');
const document = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const rules = document.rules;

const role = "root.child('users').child(auth.uid).child('role').val()";
const user = "root.child('users').child(auth.uid)";
const active = `auth != null && auth.token.firebase.sign_in_provider !== 'anonymous' && ${user}.child('status').val() !== 'pending' && ${user}.child('is_active').val() !== '아니오' && ${user}.child('is_active').val() !== false && ${user}.child('status').val() !== 'deleted' && ${user}.child('status').val() !== 'rejected'`;
const admin = `${role} === 'admin'`;
const agentRoles = `(${role} === 'agent' || ${role} === 'agent_admin' || ${role} === 'agent_manager')`;
const providerRoles = `(${role} === 'provider' || ${role} === 'provider_admin')`;
const assignedRoles = `(${admin} || ${agentRoles} || ${providerRoles})`;

// 차량 신원 claim은 서버 Admin SDK transaction의 전용 SSOT다. 클라이언트 SDK는 읽기·쓰기 모두 금지하고
// 운영자가 사고 조사할 때만 읽는다. Admin SDK는 Rules를 우회하므로 서버 정상 흐름은 영향받지 않는다.
rules.v4.vehicle_claims = {
  '.read': `${active} && ${admin}`,
  '.write': false,
};

// v3는 운영 원본이다. 쓰기는 폐쇄하고, products 원문은 이관 완료 전 관리자만 읽는다.
// 이 read 전환은 v3/v4 키·필드 대조가 끝난 뒤에만 게시할 수 있다.
rules.products['.write'] = false;
rules.products['.read'] = `${active} && ${admin}`;
rules.partners['.write'] = `${active} && ${admin}`;
rules.policies['.write'] = `${active} && ${admin}`;

// v4 공개 상품도 "Firebase 로그인만 됨"과 "사용 가능한 B2B 계정"을 구분한다.
// 앱 화면 게이트를 우회해 SDK로 직접 읽는 승인대기·비활성·삭제·반려·미배정 역할을 차단한다.
rules.v4.products['.read'] = `${active} && ${assignedRoles}`;

// 수수료율은 서버 Admin SDK가 정산·전자계약 seal을 만들 때만 읽는다. RTDB Rules는
// 부모 grant가 자식 deny를 이기므로, agent 계열이 parent를 읽게 두면 다른 공급사
// 요율까지 모두 노출된다. 관리자 전체·공급사 자기 node만 명시적으로 허용한다.
rules.v4.partners_private = rules.v4.partners_private || {};
rules.v4.partners_private['.read'] = `${active} && ${admin}`;
rules.v4.partners_private['.write'] = `${active} && ${admin}`;
rules.v4.partners_private.$pid = rules.v4.partners_private.$pid || {};
rules.v4.partners_private.$pid['.read'] = `${active} && ${providerRoles} && ${user}.child('company_code').val() !== null && ${user}.child('company_code').val() !== '' && ${user}.child('company_code').val() === $pid`;

// 일반 계약의 서버 정산 기준은 browser SDK에서 읽거나 쓸 수 없다. $other:false에만
// 기대지 않고 이 경계를 후보에도 명시해 향후 wildcard 확장 때 깨지지 않게 한다.
rules.v4.contract_settlement_seals = { '.read': false, '.write': false };

// 공개서명은 제출 전(sent)에만 익명 조회. 제출 후 PII·서명 재조회는 소유 영업조직만 가능하다.
const sign = rules.contract_sign.$token;
sign['.read'] = `(auth == null && data.child('status').val() === 'sent' && data.child('revoked_at').val() === null && (data.child('expires_at').val() === null || data.child('expires_at').val() > now)) || (${active} && (${admin} || data.child('agent_uid').val() === auth.uid || ((${role} === 'agent_admin' || ${role} === 'agent_manager') && data.child('agent_channel_code').val() === ${user}.child('agent_channel_code').val())))`;

// 공급사 기준정보는 자기 회사 레코드만 수정한다. 부모 광역 grant는 제거한다.
const partners = rules.v4.partners;
delete partners['.write'];
partners.$pid['.write'] = `${active} && newData.exists() && (${admin} || (${providerRoles} && ${user}.child('company_code').val() !== null && ${user}.child('company_code').val() !== '' && $pid === ${user}.child('company_code').val() && (!data.exists() || data.child('partner_code').val() === $pid) && newData.child('partner_code').val() === $pid))`;

const policies = rules.v4.policies;
delete policies['.write'];
// 원본 wildcard 이름을 재사용해야 RTDB가 같은 부모에 여러 default rule($pid/$policy_id)을
// 두었다고 거부하지 않는다.
const policyWildcard = Object.keys(policies).find((key) => key.startsWith('$')) || '$policy_id';
policies[policyWildcard] = policies[policyWildcard] || {};
policies[policyWildcard]['.write'] = `${active} && newData.exists() && (${admin} || (${providerRoles} && ${user}.child('company_code').val() !== null && ${user}.child('company_code').val() !== '' && ((data.exists() && data.child('provider_company_code').val() === ${user}.child('company_code').val()) || (!data.exists() && newData.child('provider_company_code').val() === ${user}.child('company_code').val())) && newData.child('provider_company_code').val() === ${user}.child('company_code').val()))`;
policies[policyWildcard].provider_company_code = {
  '.validate': `!data.exists() || newData.val() === data.val() || ${admin}`,
};

// 차량 잠금 리프는 연계 계약의 차량·역할·상태와 일치할 때만 쓴다.
const product = rules.v4.products.$code;
const newLock = "root.child('v4').child('contracts').child(newData.parent().child('locked_by_contract').val())";
const oldLock = "root.child('v4').child('contracts').child(data.parent().child('locked_by_contract').val())";
const newVehicleClaim = `root.child('v4').child('vehicle_claims').child(${newLock}.child('vehicle_identity_hash').val())`;
const participant = (contract) => `(${admin} || (${agentRoles} && (${contract}.child('agent_uid').val() === auth.uid || (${user}.child('agent_channel_code').val() !== null && ${user}.child('agent_channel_code').val() !== '' && ${contract}.child('agent_channel_code').val() === ${user}.child('agent_channel_code').val()))) || (${providerRoles} && ${contract}.child('provider_company_code').val() === ${user}.child('company_code').val()))`;
const lockSet = `newData.parent().child('locked_by_contract').isString() && newData.parent().child('locked_by_contract').val() !== '' && ${newLock}.exists() && ${newLock}.child('product_code').val() === $code && ${participant(newLock)} && ${newVehicleClaim}.child('contract_code').val() === newData.parent().child('locked_by_contract').val() && ${newVehicleClaim}.child('status').val() === 'active' && ((newData.parent().child('vehicle_status').val() === '출고불가' && ${newLock}.child('contract_status').val() === '계약완료') || (newData.parent().child('vehicle_status').val() === '계약중' && (${newLock}.child('agent_balance_paid').val() === 'yes' || ${newLock}.child('provider_balance_confirmed').val() === 'yes')))`;
const lockRelease = `data.parent().child('locked_by_contract').isString() && data.parent().child('locked_by_contract').val() !== '' && newData.parent().child('locked_by_contract').val() === '' && newData.parent().child('vehicle_status').val() === '출고가능' && ${oldLock}.child('contract_status').val() === '계약취소' && ${oldLock}.child('product_code').val() === $code && ${participant(oldLock)}`;
const lockWrite = `${active} && newData.exists() && (${lockSet} || ${lockRelease})`;
for (const field of ['vehicle_status', 'locked_by_contract', '_key', 'updatedAt']) {
  product[field] = product[field] || {};
  product[field]['.write'] = lockWrite;
}
product._key['.validate'] = "newData.val() === $code";

// 계약 생성 스냅샷과 정산 기준일은 생성 뒤 절대 변경하지 않는다.
const contract = rules.v4.contracts.$contract_id;
const contractParentWrite = String(contract['.write'] || '');
const requiredInitialIdentityMarkers = [
  "newData.child('agent_uid').isString()",
  "newData.child('agent_code').val() === root.child('users').child(newData.child('agent_uid').val()).child('user_code').val()",
  "newData.child('agent_channel_code').val() === root.child('users').child(newData.child('agent_uid').val()).child('agent_channel_code').val()",
];
if (!requiredInitialIdentityMarkers.every((marker) => contractParentWrite.includes(marker))) {
  throw new Error('원본 Rules의 신규 계약 영업자 UID·코드·채널 결속 gate를 확인하지 못했습니다. 후보 생성을 중단합니다.');
}

/**
 * 레거시(v3 전용) 계약의 **첫 v4 오버레이 쓰기**를 허용한다.
 *
 * 현행 `.validate` 는 hasChildren 에 `contract_status` 를 요구하고, 생성 조건이
 * `data.exists() || newData.contract_status === '계약요청'` 뿐이다. 레거시 계약은 v4 노드가 없어
 * `data.exists()` 가 false 이고, 단계 진행 patch 는 단일 필드라 `contract_status` 가 없다.
 * rtdb-adapter 의 승계 스탬프에서 `contract_status` 는 **일부러 뺐다** — 넣으면 레거시 계약완료건이
 * 상태 leaf validate(11게이트 전부 'yes')에 걸리는데, v3 게이트는 boolean true 이고
 * `agent_final_paid` 는 아예 없어 통과시키려면 "잔금 완납"을 지어내야 한다. 그래서 규칙에서 열어 준다.
 *
 * 실측(2026-08-04 운영 데이터): 이 절이 없으면 v4 에 없는 v3 계약 **32건이 0/32 전건 차단**되어
 * 단계 진행·취소·서명 발송이 전부 permission_denied 다(그중 계약요청 17건).
 * 에뮬레이터 32/32·계약 26/26 은 통과한다 — 그 테스트들이 실제 v3 레코드로 승격을 시도하지 않기 때문이다.
 * `docs/AI_COLLABORATION.md` 가 경고한 **"로컬 에뮬레이터 통과 ≠ 실데이터 안전"** 의 정확한 사례다.
 *
 * 위조 우려가 없는 근거: v3 `contracts` 노드에는 `.write` 가 **아예 없다**(기본 거부).
 * 아무도 v3 계약을 만들 수 없으므로 이 존재검사는 신뢰할 수 있는 레거시 마커다.
 * 신규 계약이 `계약요청` 이어야 하는 강제도 그대로 남는다.
 */
{
  let cur = String(contract['.validate'] || '');
  const legacyMarker = "root.child('contracts').child($contract_id).exists()";
  // ① 생성 가드에 레거시 마커 추가.
  if (cur.includes('data.exists() ||') && !cur.includes(legacyMarker)) {
    cur = cur.replace('data.exists() ||', `data.exists() || ${legacyMarker} ||`);
  }
  // ② hasChildren 에서 contract_status 를 뺀다. ①만으로는 부족하다 —
  //   레거시 승격 patch 에는 contract_status 가 없어서 hasChildren 이 먼저 걸린다(실측 0/32).
  //   빼도 **신규 계약이 '계약요청' 이어야 하는 강제는 그대로다** — 마지막 절이 그걸 본다.
  //   레거시의 실제 상태는 v3 노드에 그대로 있고, 어댑터의 필드병합으로 화면에도 그대로 보인다.
  cur = cur.replace(/newData\.hasChildren\(\[([^\]]*)\]\)/, (_m, list) => {
    const kept = String(list).split(',').map((s) => s.trim())
      .filter((s) => s && s !== "'contract_status'");
    return `newData.hasChildren([${kept.join(', ')}])`;
  });
  contract['.validate'] = cur;
}

const immutable = "!data.parent().exists() || newData.val() === data.val()";
for (const field of [
  'car_number_snapshot', 'maker_snapshot', 'model_snapshot', 'sub_model_snapshot',
  'variant_snapshot', 'trim_name_snapshot', 'trim_extra_snapshot', 'vehicle_name_snapshot',
  'year_snapshot', 'fuel_type_snapshot', 'contract_date',
]) contract[field] = { '.validate': immutable };

// 차량 신원 해시와 두 선점 필드는 서버 원자 claim API의 단일 writer다.
// `!data.parent().exists()`를 허용하면 레거시 첫 overlay write에서 직접 선점할 수 있으므로 동일값만 허용한다.
const serverClaimOnly = "newData.val() === data.val()";
contract.vehicle_identity_hash = { '.validate': serverClaimOnly };
contract.agent_balance_paid = { '.validate': serverClaimOnly };
contract.provider_balance_confirmed = { '.validate': serverClaimOnly };

// 고객/서명 필드는 자기 영업조직만 수정할 수 있고, 삭제는 서버/Admin 경로가 아닌 이상
// 허용하지 않는다. `!newData.exists()`를 앞에 두면 부모 write가 열린 공급사도 PII를
// null로 지울 수 있으므로 반드시 역할 조건 안에서만 새 값을 허용한다.
const agentControlled = `newData.val() === data.val() || (newData.exists() && (${admin} || ${role} === 'agent' || ${role} === 'agent_admin' || ${role} === 'agent_manager'))`;
const originalContractSignStatus = contract.sign_status['.validate'];
for (const field of [
  'customer_name', 'customer_phone', 'customer_id', 'customer_address',
  'driver_license_no', 'emergency_name', 'emergency_phone',
  'sign_token', 'sign_sent_at', 'sign_expires_at', 'sign_revoked_at',
  'sign_signature', 'sign_consents', 'sign_consent_version', 'sign_signed_at',
  'sign_reject_reason', 'sign_rejected_at', 'signed_pdf_url',
]) contract[field] = { '.validate': agentControlled };
contract.sign_status = {
  '.validate': `newData.val() === data.val() || ((${admin} || ${role} === 'agent' || ${role} === 'agent_admin' || ${role} === 'agent_manager') && (${originalContractSignStatus}))`,
};

contract.memo_agent = { '.validate': `newData.val() === data.val() || (newData.exists() && (${admin} || ${role} === 'agent' || ${role} === 'agent_admin' || ${role} === 'agent_manager'))` };
contract.memo_provider = { '.validate': `newData.val() === data.val() || (newData.exists() && (${admin} || ${role} === 'provider' || ${role} === 'provider_admin'))` };
contract.memo_admin = { '.validate': `newData.val() === data.val() || (newData.exists() && ${admin})` };

const doneContract = [
  "newData.parent().child('agent_delivery_inquiry').val() === 'yes'",
  "(newData.parent().child('provider_delivery_response').val() === '출고 가능' || newData.parent().child('provider_delivery_response').val() === '출고 협의')",
  "newData.parent().child('agent_docs_submitted').val() === 'yes'",
  "newData.parent().child('provider_docs_review').val() === '승인'",
  "newData.parent().child('agent_balance_paid').val() === 'yes'",
  "newData.parent().child('agent_final_paid').val() === 'yes'",
  "newData.parent().child('provider_balance_confirmed').val() === 'yes'",
  "newData.parent().child('provider_agreement_done').val() === 'yes'",
  "newData.parent().child('provider_agreement_sent').val() === 'yes'",
  "newData.parent().child('agent_handover_confirmed').val() === 'yes'",
  "newData.parent().child('provider_release_completed').val() === 'yes'",
].join(' && ');
// Candidate는 legacy 완료 경로를 조정하지만, 현재 운영 Rules의 직접 전자계약
// seal·서명·승인·인도 증빙 gate를 빼면 안 된다. 원본 마지막 suffix를 보존해
// 완료 전이에만 결합한다. marker가 사라지면 후보 생성 자체를 실패시킨다.
const currentStatusValidate = String(contract.contract_status?.['.validate'] || '');
const directCompletionMarker = " && ((newData.parent().child('contract_source').val() !== 'direct'";
const directCompletionStart = currentStatusValidate.lastIndexOf(directCompletionMarker);
const directCompletionGate = directCompletionStart >= 0
  ? currentStatusValidate.slice(directCompletionStart)
  : '';
const requiredDirectGateMarkers = [
  'contract_source', 'esign_contract_seals', 'esign_sessions', 'esign_private',
  'esign_verifications', 'esign_handover_verifications', 'freepass-consent-v2',
  'paymentMethod', 'requiresExternalPaymentAuthorization',
];
if (!directCompletionGate || !requiredDirectGateMarkers.every((marker) => directCompletionGate.includes(marker))) {
  throw new Error('직접 전자계약 완료 증빙 gate를 원본 Rules에서 찾지 못했습니다. 후보 생성을 중단합니다.');
}
// v3 원장은 운영 정본이므로, 후보의 간략한 단계 흐름도 원본이 가진 취소·완료 원장
// 보호를 반드시 유지한다. 이를 빼면 취소된 v3 계약에 최초 v4 overlay를 만들며
// 계약요청/완료로 되살릴 수 있다.
const legacyContractStatus = `root.child('contracts').child($contract_id).child('contract_status').val()`;
const canStartCandidateRequest = `!data.parent().exists() && newData.val() === '계약요청' && ${legacyContractStatus} !== '계약취소' && ${legacyContractStatus} !== '계약완료' && (${admin} || ${role} === 'agent' || ${role} === 'agent_admin' || ${role} === 'agent_manager')`;
const canCancelCandidateContract = `newData.val() === '계약취소' && data.val() !== '계약완료' && (${admin} || ${role} === 'agent' || ${role} === 'agent_admin' || ${role} === 'agent_manager' || ((${role} === 'provider' || ${role} === 'provider_admin') && (newData.parent().child('provider_delivery_response').val() === '출고 불가' || newData.parent().child('provider_delivery_response').val() === '불가' || newData.parent().child('provider_docs_review').val() === '부결')))`;
const canCompleteCandidateContract = `newData.val() === '계약완료' && data.val() !== '계약취소' && ${legacyContractStatus} !== '계약취소' && (${doneContract})${directCompletionGate}`;
contract.contract_status['.validate'] = `newData.val() === data.val() || (${canStartCandidateRequest}) || (${canCancelCandidateContract}) || (${canCompleteCandidateContract})`;
const candidateStatusValidate = String(contract.contract_status['.validate']);
if (!requiredDirectGateMarkers.every((marker) => candidateStatusValidate.includes(marker))
  || !candidateStatusValidate.includes("root.child('contracts').child($contract_id).child('contract_status').val() !== '계약취소'")
  || !candidateStatusValidate.includes("root.child('contracts').child($contract_id).child('contract_status').val() !== '계약완료'")) {
  throw new Error('후보 Rules에 직접 전자계약 완료 증빙 gate가 보존되지 않았습니다.');
}

// 정산은 서버 전용 writer가 현재 private 요율·계약 seal·차량 선점을 함께 검증한다.
// 후보 Rules가 과거의 client-side 계산식으로 되돌아가면 금액 위조와 runtime drift가 재발하므로,
// 원본의 admin-only client 경계를 보존한다. Admin SDK의 정상 서버 발행은 Rules를 우회한다.
const nonAdminSettlementRoles = ["role').val() === 'agent'", "role').val() === 'agent_admin'", "role').val() === 'agent_manager'", "role').val() === 'provider'", "role').val() === 'provider_admin'"];
const isAdminOnlyClientWrite = (rule) => {
  const source = String(rule || '');
  return source.includes("role').val() === 'admin'")
    && !nonAdminSettlementRoles.some((marker) => source.includes(marker));
};
const settlementWriters = [
  rules.v4.settlements?.$sid?.['.write'],
  rules.v4.settlements_provider_private?.$sid?.['.write'],
  rules.v4.settlements_agent_private?.$sid?.['.write'],
];
if (!settlementWriters.every(isAdminOnlyClientWrite)) {
  throw new Error('원본 Rules의 서버 전용 정산 write 경계를 확인하지 못했습니다. 후보 생성을 중단합니다.');
}

fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(path.relative(rootDir, outputPath).replaceAll('\\', '/'));
