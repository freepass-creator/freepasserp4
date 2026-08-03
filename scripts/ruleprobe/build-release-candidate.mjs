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

// v3는 운영 원본이다. 쓰기는 폐쇄하고, products 원문은 이관 완료 전 관리자만 읽는다.
// 이 read 전환은 v3/v4 키·필드 대조가 끝난 뒤에만 게시할 수 있다.
rules.products['.write'] = false;
rules.products['.read'] = `${active} && ${admin}`;
rules.partners['.write'] = `${active} && ${admin}`;
rules.policies['.write'] = `${active} && ${admin}`;

// v4 공개 상품도 "Firebase 로그인만 됨"과 "사용 가능한 B2B 계정"을 구분한다.
// 앱 화면 게이트를 우회해 SDK로 직접 읽는 승인대기·비활성·삭제·반려·미배정 역할을 차단한다.
rules.v4.products['.read'] = `${active} && ${assignedRoles}`;

// 공개서명은 제출 전(sent)에만 익명 조회. 제출 후 PII·서명 재조회는 소유 영업조직만 가능하다.
const sign = rules.contract_sign.$token;
sign['.read'] = `(auth == null && data.child('status').val() === 'sent' && data.child('revoked_at').val() === null && (data.child('expires_at').val() === null || data.child('expires_at').val() > now)) || (${active} && (${admin} || data.child('agent_uid').val() === auth.uid || ((${role} === 'agent_admin' || ${role} === 'agent_manager') && data.child('agent_channel_code').val() === ${user}.child('agent_channel_code').val())))`;

// 공급사 기준정보는 자기 회사 레코드만 수정한다. 부모 광역 grant는 제거한다.
const partners = rules.v4.partners;
delete partners['.write'];
partners.$pid['.write'] = `${active} && newData.exists() && (${admin} || (${providerRoles} && ${user}.child('company_code').val() !== null && ${user}.child('company_code').val() !== '' && $pid === ${user}.child('company_code').val() && (!data.exists() || data.child('partner_code').val() === $pid) && newData.child('partner_code').val() === $pid))`;

const policies = rules.v4.policies;
delete policies['.write'];
policies.$policy_id = policies.$policy_id || {};
policies.$policy_id['.write'] = `${active} && newData.exists() && (${admin} || (${providerRoles} && ${user}.child('company_code').val() !== null && ${user}.child('company_code').val() !== '' && ((data.exists() && data.child('provider_company_code').val() === ${user}.child('company_code').val()) || (!data.exists() && newData.child('provider_company_code').val() === ${user}.child('company_code').val())) && newData.child('provider_company_code').val() === ${user}.child('company_code').val()))`;
policies.$policy_id.provider_company_code = {
  '.validate': `!data.exists() || newData.val() === data.val() || ${admin}`,
};

// 차량 잠금 리프는 연계 계약의 차량·역할·상태와 일치할 때만 쓴다.
const product = rules.v4.products.$code;
const newLock = "root.child('v4').child('contracts').child(newData.parent().child('locked_by_contract').val())";
const oldLock = "root.child('v4').child('contracts').child(data.parent().child('locked_by_contract').val())";
const participant = (contract) => `(${admin} || (${agentRoles} && (${contract}.child('agent_uid').val() === auth.uid || (${user}.child('agent_channel_code').val() !== null && ${user}.child('agent_channel_code').val() !== '' && ${contract}.child('agent_channel_code').val() === ${user}.child('agent_channel_code').val()))) || (${providerRoles} && ${contract}.child('provider_company_code').val() === ${user}.child('company_code').val()))`;
const lockSet = `newData.parent().child('locked_by_contract').isString() && newData.parent().child('locked_by_contract').val() !== '' && ${newLock}.exists() && ${newLock}.child('product_code').val() === $code && ${participant(newLock)} && ((newData.parent().child('vehicle_status').val() === '출고불가' && ${newLock}.child('contract_status').val() === '계약완료') || (newData.parent().child('vehicle_status').val() === '계약중' && (${newLock}.child('agent_balance_paid').val() === 'yes' || ${newLock}.child('provider_balance_confirmed').val() === 'yes')))`;
const lockRelease = `data.parent().child('locked_by_contract').isString() && data.parent().child('locked_by_contract').val() !== '' && newData.parent().child('locked_by_contract').val() === '' && newData.parent().child('vehicle_status').val() === '출고가능' && ${oldLock}.child('contract_status').val() === '계약취소' && ${oldLock}.child('product_code').val() === $code && ${participant(oldLock)}`;
const lockWrite = `${active} && newData.exists() && (${lockSet} || ${lockRelease})`;
for (const field of ['vehicle_status', 'locked_by_contract', '_key', 'updatedAt']) {
  product[field] = product[field] || {};
  product[field]['.write'] = lockWrite;
}
product._key['.validate'] = "newData.val() === $code";

// 계약 생성 스냅샷과 정산 기준일은 생성 뒤 절대 변경하지 않는다.
const contract = rules.v4.contracts.$contract_id;

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

const agentControlled = `!newData.exists() || newData.val() === data.val() || ${admin} || ${role} === 'agent' || ${role} === 'agent_admin' || ${role} === 'agent_manager'`;
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

contract.memo_agent = { '.validate': `!newData.exists() || newData.val() === data.val() || ${admin} || ${role} === 'agent' || ${role} === 'agent_admin' || ${role} === 'agent_manager'` };
contract.memo_provider = { '.validate': `!newData.exists() || newData.val() === data.val() || ${admin} || ${role} === 'provider' || ${role} === 'provider_admin'` };
contract.memo_admin = { '.validate': `!newData.exists() || newData.val() === data.val() || ${admin}` };

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
contract.contract_status['.validate'] = `newData.val() === data.val() || (!data.parent().exists() && newData.val() === '계약요청') || (newData.val() === '계약취소' && (${admin} || ${role} === 'agent' || ${role} === 'agent_admin' || ${role} === 'agent_manager' || ((${role} === 'provider' || ${role} === 'provider_admin') && (newData.parent().child('provider_delivery_response').val() === '출고 불가' || newData.parent().child('provider_docs_review').val() === '부결')))) || (newData.val() === '계약완료' && (${doneContract}))`;

// 정산 생성은 ST_{계약코드}, 계약 당사자·귀속·완료 게이트에 결속한다.
// 앱은 정산을 먼저 만들고 계약완료를 뒤에 기록하므로, 모든 체크 완료 상태도 허용한다.
const settlements = rules.v4.settlements.$sid;
const contractRef = "root.child('v4').child('contracts').child(newData.child('contract_code').val())";
const contractDoneAtRoot = [
  `${contractRef}.child('agent_delivery_inquiry').val() === 'yes'`,
  `(${contractRef}.child('provider_delivery_response').val() === '출고 가능' || ${contractRef}.child('provider_delivery_response').val() === '출고 협의')`,
  `${contractRef}.child('agent_docs_submitted').val() === 'yes'`, `${contractRef}.child('provider_docs_review').val() === '승인'`,
  `${contractRef}.child('agent_balance_paid').val() === 'yes'`, `${contractRef}.child('agent_final_paid').val() === 'yes'`,
  `${contractRef}.child('provider_balance_confirmed').val() === 'yes'`, `${contractRef}.child('provider_agreement_done').val() === 'yes'`,
  `${contractRef}.child('provider_agreement_sent').val() === 'yes'`, `${contractRef}.child('agent_handover_confirmed').val() === 'yes'`,
  `${contractRef}.child('provider_release_completed').val() === 'yes'`,
].join(' && ');
const settlementParticipant = participant(contractRef);
settlements['.write'] = `${active} && newData.exists() && (${admin} || (!data.exists() && $sid === 'ST_' + newData.child('contract_code').val() && ${contractRef}.exists() && (${contractRef}.child('contract_status').val() === '계약완료' || (${contractRef}.child('contract_status').val() === '계약요청' && ${contractDoneAtRoot})) && ${settlementParticipant} && newData.child('provider_company_code').val() === ${contractRef}.child('provider_company_code').val() && newData.child('agent_code').val() === ${contractRef}.child('agent_code').val() && newData.child('agent_channel_code').val() === ${contractRef}.child('agent_channel_code').val() && newData.child('settlement_status').val() === '정산대기'))`;

// private 금액은 같은 계약의 동결 월대여료·율과 수학적으로 일치해야 최초 생성된다.
const privateGuard = (kind) => {
  const c = "root.child('v4').child('contracts').child(newData.child('contract_code').val())";
  const ownership = `newData.child('provider_company_code').val() === ${c}.child('provider_company_code').val() && newData.child('agent_code').val() === ${c}.child('agent_code').val() && newData.child('agent_channel_code').val() === ${c}.child('agent_channel_code').val()`;
  const amount = kind === 'provider'
    ? `newData.child('fee_rate').isNumber() && newData.child('fee_amount').isNumber() && newData.child('fee_rate').val() === (${c}.child('fee_rate_snapshot').exists() ? ${c}.child('fee_rate_snapshot').val() : 0.1) && newData.child('fee_amount').val() >= (${c}.child('rent_amount_snapshot').val() * newData.child('fee_rate').val()) - 0.5 && newData.child('fee_amount').val() < (${c}.child('rent_amount_snapshot').val() * newData.child('fee_rate').val()) + 0.5`
    : `newData.child('agent_payout').isNumber() && newData.child('agent_payout').val() >= (${c}.child('rent_amount_snapshot').val() * ${c}.child('payout_rate_snapshot').val()) - 0.5 && newData.child('agent_payout').val() < (${c}.child('rent_amount_snapshot').val() * ${c}.child('payout_rate_snapshot').val()) + 0.5`;
  return `${active} && newData.exists() && (${admin} || (!data.exists() && newData.child('settlement_code').val() === $sid && newData.child('contract_code').isString() && $sid === 'ST_' + newData.child('contract_code').val() && ${c}.exists() && (${c}.child('contract_status').val() === '계약완료' || ${c}.child('provider_release_completed').val() === 'yes') && ${participant(c)} && ${ownership} && ${amount}))`;
};
rules.v4.settlements_provider_private.$sid['.write'] = privateGuard('provider');
rules.v4.settlements_agent_private.$sid['.write'] = privateGuard('agent');

fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(path.relative(rootDir, outputPath).replaceAll('\\', '/'));
