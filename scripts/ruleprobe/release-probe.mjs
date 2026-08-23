import assert from 'node:assert/strict';

const projectId = process.env.GCLOUD_PROJECT || 'demo-freepasserp4';
const dbHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const ns = `${projectId}-default-rtdb`;

async function signUp(label) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${label}@example.test`, password: 'probe-password', returnSecureToken: true }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return { uid: body.localId, token: body.idToken };
}

async function db(nodePath, { method = 'GET', token = 'owner', body } = {}) {
  const authQuery = token === 'owner' ? '' : `&auth=${encodeURIComponent(token)}`;
  const response = await fetch(`http://${dbHost}/${nodePath}.json?ns=${encodeURIComponent(ns)}${authQuery}`, {
    method,
    headers: {
      ...(token === 'owner' ? { authorization: 'Bearer owner' } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: response.status, body: parsed };
}

const results = [];
function check(name, actual, expected) {
  const ok = actual === expected;
  results.push({ ok, name, actual, expected });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${actual} vs ${expected}] ${name}`);
}

const admin = await signUp('release-admin');
const providerA = await signUp('release-provider-a');
const providerB = await signUp('release-provider-b');
const agent = await signUp('release-agent');
const agentOther = await signUp('release-agent-other');
const agentManager = await signUp('release-agent-manager');
const pendingAgent = await signUp('release-pending-agent');
const inactiveAgent = await signUp('release-inactive-agent');
const deletedAgent = await signUp('release-deleted-agent');
const rejectedAgent = await signUp('release-rejected-agent');
const unassignedUser = await signUp('release-unassigned');

await db('users', { method: 'PUT', body: {
  [admin.uid]: { uid: admin.uid, role: 'admin', status: 'active', user_code: 'ADM' },
  [providerA.uid]: { uid: providerA.uid, role: 'provider', status: 'active', user_code: 'PA', company_code: 'SUP-A' },
  [providerB.uid]: { uid: providerB.uid, role: 'provider', status: 'active', user_code: 'PB', company_code: 'SUP-B' },
  [agent.uid]: { uid: agent.uid, role: 'agent', status: 'active', user_code: 'AG-A', agent_channel_code: 'CH-A' },
  [agentOther.uid]: { uid: agentOther.uid, role: 'agent', status: 'active', user_code: 'AG-B', agent_channel_code: 'CH-B' },
  [agentManager.uid]: { uid: agentManager.uid, role: 'agent_manager', status: 'active', user_code: 'AG-M', agent_channel_code: 'CH-A' },
  [pendingAgent.uid]: { uid: pendingAgent.uid, role: 'agent', status: 'pending', user_code: 'AG-PENDING' },
  [inactiveAgent.uid]: { uid: inactiveAgent.uid, role: 'agent', status: 'active', is_active: '아니오', user_code: 'AG-INACTIVE' },
  [deletedAgent.uid]: { uid: deletedAgent.uid, role: 'agent', status: 'deleted', user_code: 'AG-DELETED' },
  [rejectedAgent.uid]: { uid: rejectedAgent.uid, role: 'agent', status: 'rejected', user_code: 'AG-REJECTED' },
  [unassignedUser.uid]: { uid: unassignedUser.uid, role: '', status: 'active', user_code: 'UNASSIGNED' },
} });

const doneContract = {
  contract_code: 'C-OK', contract_status: '계약완료', contract_date: '2026-08-03',
  product_code: 'CAR-1', agent_uid: agent.uid, agent_code: 'AG-A', agent_channel_code: 'CH-A',
  provider_company_code: 'SUP-A', rent_month_snapshot: 36, rent_amount_snapshot: 500000,
  product_type_snapshot: '중고 렌트',
  deposit_amount_snapshot: 1000000, payment_timing_snapshot: '선불', driver_age_snapshot: '만 26세 이상',
  annual_mileage_snapshot: '연 3만km', price_variant_snapshot: '', mileage_surcharge_snapshot: 0,
  age_surcharge_snapshot: 0, pricing_snapshot_version: 'v1', special_terms_choice_snapshot: '없음',
  special_terms_snapshot: '없음', fee_rate_snapshot: 0.1,
  payout_rate_snapshot: 0.04, customer_name: '고객', customer_phone: '010-0000-0000',
  car_number_snapshot: '11가1111', maker_snapshot: '현대', model_snapshot: '아반떼',
  agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능',
  agent_docs_submitted: 'yes', provider_docs_review: '승인',
  agent_balance_paid: 'yes', agent_final_paid: 'yes', provider_balance_confirmed: 'yes',
  provider_agreement_done: 'yes', provider_agreement_sent: 'yes',
  agent_handover_confirmed: 'yes', provider_release_completed: 'yes',
  vehicle_identity_hash: 'HASH-CAR-1',
};
  await db('products', { method: 'PUT', body: { LEGACY: { product_code: 'LEGACY', vin: 'SECRET', vehicle_price: 1 } } });
  await db('contracts', { method: 'PUT', body: {
    'C-LEGACY': { ...doneContract, contract_code: 'C-LEGACY' },
    'C-LEGACY-AGENT': { ...doneContract, contract_code: 'C-LEGACY-AGENT' },
    'C-LEGACY-PROVIDER': { ...doneContract, contract_code: 'C-LEGACY-PROVIDER' },
    'C-LEGACY-CANCEL': { ...doneContract, contract_code: 'C-LEGACY-CANCEL', contract_status: '계약취소' },
    'C-LEGACY-CANCEL-MIN': { ...doneContract, contract_code: 'C-LEGACY-CANCEL-MIN', contract_status: '계약취소' },
  } });
await db('partners', { method: 'PUT', body: { 'SUP-A': { partner_code: 'SUP-A' } } });
await db('policies', { method: 'PUT', body: { OLD: { policy_code: 'OLD', provider_company_code: 'SUP-A' } } });
await db('v4', { method: 'PUT', body: {
  products: { 'CAR-1': { _key: 'CAR-1', product_code: 'CAR-1', provider_company_code: 'SUP-A', vehicle_status: '출고가능', locked_by_contract: '' } },
  partners: { 'SUP-A': { partner_code: 'SUP-A', name: 'A' }, 'SUP-B': { partner_code: 'SUP-B', name: 'B' } },
  partners_private: { 'SUP-A': { fee_rate: 0.12 }, 'SUP-B': { fee_rate: 0.18 } },
  policies: { PA: { policy_code: 'PA', provider_company_code: 'SUP-A' }, PB: { policy_code: 'PB', provider_company_code: 'SUP-B' } },
  contracts: {
    'C-OK': doneContract,
    'C-PROGRESS': { ...doneContract, contract_code: 'C-PROGRESS', contract_status: '계약요청', product_code: 'CAR-1', provider_docs_review: '' },
    'C-OTHER-CAR': { ...doneContract, contract_code: 'C-OTHER-CAR', product_code: 'CAR-2' },
    'C-CLAIM': { ...doneContract, contract_code: 'C-CLAIM', contract_status: '계약요청', product_code: 'CAR-2', agent_balance_paid: null, provider_balance_confirmed: null, vehicle_identity_hash: null },
    'C-ISSUING': { ...doneContract, contract_code: 'C-ISSUING', contract_status: '계약요청', product_code: 'CAR-2' },
  },
  vehicle_claims: {
    'HASH-CAR-1': { contract_code: 'C-OK', product_code: 'CAR-1', identity_hash: 'HASH-CAR-1', status: 'active', updated_at: Date.now(), actor_uid: admin.uid },
  },
} });

// 직접 전자계약의 완료 상태는 공개 계약에 적힌 문자열만으로 열리면 안 된다.
// 아래 두 건은 owner seed라 rules를 우회하지만, 실제 영업자 전이는 rules가 검증한다.
const directSessionHash = 'a'.repeat(64);
const directSealHash = 'b'.repeat(64);
const directDocumentHash = 'c'.repeat(64);
const directNoHandoverSessionHash = 'd'.repeat(64);
const directNoHandoverSealHash = 'e'.repeat(64);
const directNoHandoverDocumentHash = 'f'.repeat(64);
const directOldConsentSessionHash = '1'.repeat(64);
const directOldConsentSealHash = '2'.repeat(64);
const directOldConsentDocumentHash = '3'.repeat(64);
const currentConsentProfile = {
  version: 'freepass-consent-v2',
  requiredKeys: ['rental_terms', 'privacy'],
  atoms: [{ key: 'privacy' }],
  screeningCriteria: '무심사',
  gpsInstalled: '미장착',
  paymentMethod: '계좌이체',
  requiresExternalPaymentAuthorization: false,
  cmsRequiredBeforeHandover: false,
};
const directPublicOnly = {
  ...doneContract,
  contract_code: 'C-DIRECT-PUBLIC-ONLY',
  contract_status: '계약요청',
  contract_source: 'direct',
  contract_origin: '계약서직접등록',
  esign_provider: 'freepass',
  sign_status: '서명완료',
  sign_signed_at: Date.now(),
  esign_session_hash: directSessionHash,
  esign_seal_hash: directSealHash,
  esign_document_sha256: directDocumentHash,
  contract_draft: JSON.stringify({ deposit_installment: '일시납', special_terms: '없음', special_terms_choice: '없음' }),
  customer_name: '직접계약 합성고객', customer_phone: '010-2222-3333',
};
const directVerified = { ...directPublicOnly, contract_code: 'C-DIRECT-VERIFIED' };
const directNoHandover = {
  ...directPublicOnly,
  contract_code: 'C-DIRECT-NO-HANDOVER',
  esign_session_hash: directNoHandoverSessionHash,
  esign_seal_hash: directNoHandoverSealHash,
  esign_document_sha256: directNoHandoverDocumentHash,
};
const directOldConsent = {
  ...directPublicOnly,
  contract_code: 'C-DIRECT-OLD-CONSENT',
  esign_session_hash: directOldConsentSessionHash,
  esign_seal_hash: directOldConsentSealHash,
  esign_document_sha256: directOldConsentDocumentHash,
};
await db('v4', { method: 'PATCH', body: {
  'contracts/C-DIRECT-PUBLIC-ONLY': directPublicOnly,
  'contracts/C-DIRECT-VERIFIED': directVerified,
  'contracts/C-DIRECT-NO-HANDOVER': directNoHandover,
  'contracts/C-DIRECT-OLD-CONSENT': directOldConsent,
  'esign_contract_seals/C-DIRECT-PUBLIC-ONLY': { version: 'v1' },
  'esign_contract_seals/C-DIRECT-VERIFIED': { version: 'v1' },
  'esign_contract_seals/C-DIRECT-NO-HANDOVER': { version: 'v1' },
  'esign_contract_seals/C-DIRECT-OLD-CONSENT': { version: 'v1' },
  [`esign_sessions/${directSessionHash}`]: {
    provider: 'freepass', contractCode: 'C-DIRECT-VERIFIED', status: 'signed', sealHash: directSealHash,
    snapshot: { consentProfile: currentConsentProfile },
  },
  [`esign_private/C-DIRECT-VERIFIED/${directSessionHash}`]: { status: 'approved', sealHash: directSealHash },
  [`esign_verifications/${directSealHash}`]: {
    provider: 'freepass', contractCode: 'C-DIRECT-VERIFIED', sealHash: directSealHash, documentSha256: directDocumentHash,
  },
  [`esign_sessions/${directNoHandoverSessionHash}`]: {
    provider: 'freepass', contractCode: 'C-DIRECT-NO-HANDOVER', status: 'signed', sealHash: directNoHandoverSealHash,
    snapshot: { consentProfile: currentConsentProfile },
  },
  [`esign_private/C-DIRECT-NO-HANDOVER/${directNoHandoverSessionHash}`]: { status: 'approved', sealHash: directNoHandoverSealHash },
  [`esign_verifications/${directNoHandoverSealHash}`]: {
    provider: 'freepass', contractCode: 'C-DIRECT-NO-HANDOVER', sealHash: directNoHandoverSealHash, documentSha256: directNoHandoverDocumentHash,
  },
  [`esign_sessions/${directOldConsentSessionHash}`]: {
    provider: 'freepass', contractCode: 'C-DIRECT-OLD-CONSENT', status: 'signed', sealHash: directOldConsentSealHash,
    snapshot: { consentProfile: { ...currentConsentProfile, version: 'freepass-consent-v1' } },
  },
  [`esign_private/C-DIRECT-OLD-CONSENT/${directOldConsentSessionHash}`]: { status: 'approved', sealHash: directOldConsentSealHash },
  [`esign_verifications/${directOldConsentSealHash}`]: {
    provider: 'freepass', contractCode: 'C-DIRECT-OLD-CONSENT', sealHash: directOldConsentSealHash, documentSha256: directOldConsentDocumentHash,
  },
  'esign_handover_verifications/C-DIRECT-VERIFIED': {
    provider: 'freepass',
    contractCode: 'C-DIRECT-VERIFIED',
    sessionHash: directSessionHash,
    sealHash: directSealHash,
    documentSha256: directDocumentHash,
    handover_datetime: '2026-08-21',
    contract_start: '2026-08-21',
    contract_end: '2029-08-20',
    confirmedAt: Date.now(),
    confirmedBy: admin.uid,
  },
  'esign_handover_verifications/C-DIRECT-OLD-CONSENT': {
    provider: 'freepass',
    contractCode: 'C-DIRECT-OLD-CONSENT',
    sessionHash: directOldConsentSessionHash,
    sealHash: directOldConsentSealHash,
    documentSha256: directOldConsentDocumentHash,
    handover_datetime: '2026-08-21',
    contract_start: '2026-08-21',
    contract_end: '2029-08-20',
    confirmedAt: Date.now(),
    confirmedBy: admin.uid,
  },
} });

console.log('\n=== v3 폐쇄·원문 격리 ===');
check('agent v3 products raw read 차단', (await db('products', { token: agent.token })).status, 401);
check('admin v3 products 이관 점검 read 허용', (await db('products', { token: admin.token })).status, 200);
check('agent v3 products write 차단', (await db('products/LEGACY', { method: 'PATCH', token: agent.token, body: { vehicle_status: '출고불가' } })).status, 401);
check('provider v3 partners 광역 write 차단', (await db('partners/SUP-A', { method: 'PATCH', token: providerA.token, body: { name: '탈취' } })).status, 401);
check('provider v3 policies 광역 write 차단', (await db('policies/OLD', { method: 'PATCH', token: providerA.token, body: { name: '탈취' } })).status, 401);

console.log('\n=== v4 공개 재고 계정상태 게이트 ===');
check('활성 배정 영업자 v4 products read 허용', (await db('v4/products', { token: agent.token })).status, 200);
check('승인대기 영업자 v4 products read 차단', (await db('v4/products', { token: pendingAgent.token })).status, 401);
check('비활성 영업자 v4 products read 차단', (await db('v4/products', { token: inactiveAgent.token })).status, 401);
check('삭제 영업자 v4 products read 차단', (await db('v4/products', { token: deletedAgent.token })).status, 401);
check('반려 영업자 v4 products read 차단', (await db('v4/products', { token: rejectedAgent.token })).status, 401);
check('미배정 역할 v4 products read 차단', (await db('v4/products', { token: unassignedUser.token })).status, 401);

console.log('\n=== 본인 약관 재동의 증적 ===');
check('활성 회원 본인 동의 증적 갱신 허용', (await db(`users/${agent.uid}`, { method: 'PATCH', token: agent.token, body: {
  terms_agreed_at: Date.now(), privacy_agreed_at: Date.now(), legal_version: '2026-08-01',
} })).status, 200);
check('동의 갱신에 역할 탈취 혼합 차단', (await db(`users/${agent.uid}`, { method: 'PATCH', token: agent.token, body: {
  terms_agreed_at: Date.now(), privacy_agreed_at: Date.now(), legal_version: '2026-08-01', role: 'admin',
} })).status, 401);
check('타 회원 동의 증적 대리 갱신 차단', (await db(`users/${agentOther.uid}`, { method: 'PATCH', token: agent.token, body: {
  terms_agreed_at: Date.now(), privacy_agreed_at: Date.now(), legal_version: '2026-08-01',
} })).status, 401);

console.log('\n=== v4 기준정보 소유권 ===');
check('provider 자기 partner 수정 허용', (await db('v4/partners/SUP-A', { method: 'PATCH', token: providerA.token, body: { name: 'A2' } })).status, 200);
check('provider 타 partner 수정 차단', (await db('v4/partners/SUP-B', { method: 'PATCH', token: providerA.token, body: { name: '탈취' } })).status, 401);
check('provider 자기 policy 수정 허용', (await db('v4/policies/PA', { method: 'PATCH', token: providerA.token, body: { policy_name: 'A 정책' } })).status, 200);
check('provider 타 policy 수정 차단', (await db('v4/policies/PB', { method: 'PATCH', token: providerA.token, body: { policy_name: '탈취' } })).status, 401);

console.log('\n=== 공개서명 read 수명 ===');
await db('contract_sign/T-SENT', { method: 'PUT', body: { sign_token: 'T-SENT', status: 'sent', contract_code: 'C-OK', expires_at: Date.now() + 600000, revoked_at: null } });
await db('contract_sign/T-PENDING', { method: 'PUT', body: { sign_token: 'T-PENDING', status: 'sent', sign_status: '발송', contract_code: 'C-OK', expires_at: Date.now() + 600000, revoked_at: null, agent_uid: admin.uid } });
await db('contract_sign/T-PENDING', { method: 'PATCH', token: 'none', body: {
  status: 'pending_review', sign_status: '검토대기', customer_name: '고객', customer_phone: '010-0000-0000', customer_id: 'SECRET',
  sign_signature: 'data:image/png;base64,cHJvYmU=', sign_consents: 'rental_terms,privacy,credit,gps,cms', sign_consent_version: 'v1',
} });
check('sent 링크 익명 read 허용', (await db('contract_sign/T-SENT', { token: 'none' })).status, 200);
check('pending_review 익명 재조회 차단', (await db('contract_sign/T-PENDING', { token: 'none' })).status, 401);
check('로그인 영업자의 contract_sign 검토대기 최초 위조 차단', (await db('contract_sign/T-FORGE', { method: 'PUT', token: agent.token, body: {
  sign_token: 'T-FORGE', status: 'pending_review', contract_code: 'C-OK', expires_at: Date.now() + 600000,
  agent_uid: agent.uid, agent_channel_code: 'CH-A', provider_company_code: 'SUP-A', sign_signature: 'data:image/png;base64,Zm9yZ2U=', sign_consents: 'rental_terms,privacy,credit,gps,cms', sign_consent_version: 'v1',
} })).status, 401);

console.log('\n=== 계약 불변·역할 격리 ===');
const newContract = {
  contract_code: 'C-NEW', contract_status: '계약요청', contract_date: '2026-08-04',
  product_code: 'CAR-2', agent_uid: agent.uid, agent_code: 'AG-A', agent_channel_code: 'CH-A',
  provider_company_code: 'SUP-A', rent_amount_snapshot: 500000,
  product_type_snapshot: '중고 렌트',
  customer_name: '신규고객', customer_phone: '010-1234-5678',
  car_number_snapshot: '22나2222', maker_snapshot: '기아', model_snapshot: 'K5',
};
   check('선점 필드 없는 정상 신규 계약 생성 허용', (await db('v4/contracts/C-NEW', { method: 'PUT', token: agent.token, body: newContract })).status, 200);
   check('영업자 신규 계약의 자기 코드·채널 위조 차단', (await db('v4/contracts/C-AGENT-CODE-FORGE', { method: 'PUT', token: agent.token, body: {
     ...newContract, contract_code: 'C-AGENT-CODE-FORGE', agent_code: 'AG-FORGE',
   } })).status, 401);
   check('채널 관리자의 타 채널 영업자 귀속 위조 생성 차단', (await db('v4/contracts/C-MANAGER-FOREIGN-FORGE', { method: 'PUT', token: agentManager.token, body: {
     ...newContract, contract_code: 'C-MANAGER-FOREIGN-FORGE', agent_uid: agentOther.uid, agent_code: 'AG-B', agent_channel_code: 'CH-A',
   } })).status, 401);
   check('채널 관리자의 같은 정본 채널 계약 생성 허용', (await db('v4/contracts/C-MANAGER-SAME-CHANNEL', { method: 'PUT', token: agentManager.token, body: {
     ...newContract, contract_code: 'C-MANAGER-SAME-CHANNEL', agent_uid: agent.uid, agent_code: 'AG-A', agent_channel_code: 'CH-A',
   } })).status, 200);
   check('영업자 raw 직접계약 생성 차단', (await db('v4/contracts/C-DIRECT-FORGE', { method: 'PUT', token: agent.token, body: {
     ...newContract, contract_code: 'C-DIRECT-FORGE', contract_source: 'direct', contract_origin: '계약서직접등록',
   } })).status, 401);
   check('영업자 공백 우회 직접계약 생성 차단', (await db('v4/contracts/C-DIRECT-SPACE-FORGE', { method: 'PUT', token: agent.token, body: {
     ...newContract, contract_code: 'C-DIRECT-SPACE-FORGE', contract_source: 'direct ',
   } })).status, 401);
   check('영업자 raw 직접계약 origin 생성 차단', (await db('v4/contracts/C-DIRECT-ORIGIN-FORGE', { method: 'PUT', token: agent.token, body: {
     ...newContract, contract_code: 'C-DIRECT-ORIGIN-FORGE', contract_origin: '전자계약직접',
   } })).status, 401);
   check('영업자 private direct seal read 차단', (await db('v4/esign_contract_seals/C-DIRECT-FORGE', { token: agent.token })).status, 401);
   check('영업자 private direct seal write 차단', (await db('v4/esign_contract_seals/C-DIRECT-FORGE', { method: 'PUT', token: agent.token, body: { version: 'v1' } })).status, 401);
   check('영업자 private create request read 차단', (await db(`v4/esign_create_requests/${agent.uid}/request-123456`, { token: agent.token })).status, 401);
   check('영업자 generic 정산 seal read 차단', (await db('v4/contract_settlement_seals/C-NEW', { token: agent.token })).status, 401);
   check('영업자 generic 정산 seal write 차단', (await db('v4/contract_settlement_seals/C-NEW', { method: 'PUT', token: agent.token, body: { version: 'contract-settlement-v2' } })).status, 401);
   check('관리자 브라우저 generic 정산 seal write 차단', (await db('v4/contract_settlement_seals/C-NEW', { method: 'PUT', token: admin.token, body: { version: 'contract-settlement-v2' } })).status, 401);
   check('영업자 공급사 private 요율 전체 read 차단', (await db('v4/partners_private', { token: agent.token })).status, 401);
   check('영업자 타 공급사 private 요율 read 차단', (await db('v4/partners_private/SUP-B', { token: agent.token })).status, 401);
   check('대기 영업자 공급사 private 요율 read 차단', (await db('v4/partners_private/SUP-A', { token: pendingAgent.token })).status, 401);
   check('공급사 자기 private 요율 read 허용', (await db('v4/partners_private/SUP-A', { token: providerA.token })).status, 200);
   check('공급사 타사 private 요율 read 차단', (await db('v4/partners_private/SUP-B', { token: providerA.token })).status, 401);
   check('관리자 공급사 private 요율 read 허용', (await db('v4/partners_private', { token: admin.token })).status, 200);
   check('provider 신규 계약 대리 생성 차단', (await db('v4/contracts/C-PROVIDER-FORGE', { method: 'PUT', token: providerA.token, body: {
     ...newContract, contract_code: 'C-PROVIDER-FORGE', agent_uid: agent.uid, agent_code: 'AG-A', agent_channel_code: 'CH-A',
   } })).status, 401);
  check('신규 계약에 provider 단계 선주입 차단', (await db('v4/contracts/C-INIT-PROVIDER-FORGE', { method: 'PUT', token: agent.token, body: {
    ...newContract, contract_code: 'C-INIT-PROVIDER-FORGE', provider_delivery_response: '출고 가능',
  } })).status, 401);
  check('신규 계약에 요율 스냅샷 위조 주입 차단', (await db('v4/contracts/C-INIT-RATE-FORGE', { method: 'PUT', token: agent.token, body: {
    ...newContract, contract_code: 'C-INIT-RATE-FORGE', fee_rate_snapshot: 0, payout_rate_snapshot: 1,
  } })).status, 401);
  check('신규 계약에 서명완료 선주입 차단', (await db('v4/contracts/C-INIT-SIGN-FORGE', { method: 'PUT', token: agent.token, body: {
    ...newContract, contract_code: 'C-INIT-SIGN-FORGE', sign_status: '서명완료', sign_token: 'T-FORGE',
  } })).status, 401);
  check('신규 계약에 약정발송 선주입 차단', (await db('v4/contracts/C-INIT-AGREEMENT-FORGE', { method: 'PUT', token: agent.token, body: {
    ...newContract, contract_code: 'C-INIT-AGREEMENT-FORGE', provider_agreement_sent: 'yes',
  } })).status, 401);
  const sealedRateContract = {
    ...newContract, contract_code: 'C-RATE-SEALED', fee_rate_snapshot: 0.1, payout_rate_snapshot: 0.04,
  };
  check('관리자 서버 동결요율 계약 생성 허용', (await db('v4/contracts/C-RATE-SEALED', { method: 'PUT', token: admin.token, body: sealedRateContract })).status, 200);
  check('영업자 동결 요율 삭제 차단', (await db('v4/contracts/C-RATE-SEALED/fee_rate_snapshot', { method: 'PUT', token: agent.token, body: null })).status, 401);
   check('v3 원장 위 가격 위조 overlay 생성 차단', (await db('v4/contracts/C-LEGACY', { method: 'PUT', token: agent.token, body: {
     ...doneContract, contract_code: 'C-LEGACY', contract_status: '계약요청', rent_amount_snapshot: 9999999,
   } })).status, 401);
   check('v3 취소 원장을 overlay로 되살리기 차단', (await db('v4/contracts/C-LEGACY-CANCEL', { method: 'PUT', token: agent.token, body: {
     ...doneContract, contract_code: 'C-LEGACY-CANCEL', contract_status: '계약요청',
   } })).status, 401);
  check('v4 계약 경로와 contract_code 불일치 생성 차단', (await db('v4/contracts/C-MISMATCH', { method: 'PUT', token: agent.token, body: {
    ...newContract, contract_code: 'C-OTHER',
  } })).status, 401);
  const legacyOverlayBase = {
    // RtdbAdapter가 v3 계약의 첫 overlay에는 contract_status를 의도적으로 넣지 않는다.
    product_code: 'CAR-1', agent_uid: agent.uid, agent_code: 'AG-A',
    agent_channel_code: 'CH-A', provider_company_code: 'SUP-A',
  };
  // 가격/요율 등 별도 immutable field가 아닌, 실제 어댑터의 최소 first overlay로도
  // 취소 v3 원장을 계약요청으로 되살릴 수 없어야 한다.
  check('v3 취소 원장 최소 overlay 상태 되살리기 차단', (await db('v4/contracts/C-LEGACY-CANCEL-MIN', { method: 'PUT', token: agent.token, body: {
    ...legacyOverlayBase, contract_code: 'C-LEGACY-CANCEL-MIN', contract_status: '계약요청',
  } })).status, 401);
  check('v3 원장 최초 overlay에 타 역할 단계 주입 차단', (await db('v4/contracts/C-LEGACY-AGENT', { method: 'PUT', token: agent.token, body: {
    ...legacyOverlayBase, contract_code: 'C-LEGACY-AGENT',
    agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능',
  } })).status, 401);
  check('v3 원장 최초 agent 단계 overlay 허용', (await db('v4/contracts/C-LEGACY-AGENT', { method: 'PUT', token: agent.token, body: {
    ...legacyOverlayBase, contract_code: 'C-LEGACY-AGENT', agent_delivery_inquiry: 'yes',
  } })).status, 200);
  check('v3 원장 최초 provider 단계 overlay 허용', (await db('v4/contracts/C-LEGACY-PROVIDER', { method: 'PUT', token: providerA.token, body: {
    ...legacyOverlayBase, contract_code: 'C-LEGACY-PROVIDER', provider_delivery_response: '출고 가능',
  } })).status, 200);
check('agent 자기 계약 고객 연락처 수정 허용', (await db('v4/contracts/C-PROGRESS/customer_phone', { method: 'PUT', token: agent.token, body: '010-1111-2222' })).status, 200);
check('provider 고객 연락처 수정 차단', (await db('v4/contracts/C-PROGRESS/customer_phone', { method: 'PUT', token: providerA.token, body: '010-9999-9999' })).status, 401);
check('provider 일반 계약 고객명 삭제 차단', (await db('v4/contracts/C-NEW/customer_name', { method: 'PUT', token: providerA.token, body: null })).status, 401);
check('provider 직접계약 고객명 삭제 차단', (await db('v4/contracts/C-DIRECT-VERIFIED/customer_name', { method: 'PUT', token: providerA.token, body: null })).status, 401);
check('agent 계약 차량 스냅샷 수정 차단', (await db('v4/contracts/C-PROGRESS/maker_snapshot', { method: 'PUT', token: agent.token, body: '기아' })).status, 401);
check('agent contract_date 수정 차단', (await db('v4/contracts/C-PROGRESS/contract_date', { method: 'PUT', token: agent.token, body: '2020-01-01' })).status, 401);
check('agent v1 가격 스냅샷 수정 차단', (await db('v4/contracts/C-PROGRESS/rent_amount_snapshot', { method: 'PUT', token: agent.token, body: 1 })).status, 401);
check('agent v1 가격근거 삭제 차단', (await db('v4/contracts/C-PROGRESS/annual_mileage_snapshot', { method: 'PUT', token: agent.token, body: null })).status, 401);
check('agent v1 특약 스냅샷 삭제 차단', (await db('v4/contracts/C-PROGRESS/special_terms_snapshot', { method: 'PUT', token: agent.token, body: null })).status, 401);
check('agent 상품구분 동결값 수정 차단', (await db('v4/contracts/C-PROGRESS/product_type_snapshot', { method: 'PUT', token: agent.token, body: '신차렌트' })).status, 401);
   check('agent 상품구분 동결값 삭제 차단', (await db('v4/contracts/C-PROGRESS/product_type_snapshot', { method: 'PUT', token: agent.token, body: null })).status, 401);
check('영업자 계약 공개 서명 링크 재삽입 차단', (await db('v4/contracts/C-PROGRESS/esign_sign_url', { method: 'PUT', token: agent.token, body: 'https://example.test/sign/fps_probe' })).status, 401);
check('관리자 브라우저도 계약 공개 서명 링크 재삽입 차단', (await db('v4/contracts/C-PROGRESS/esign_sign_url', { method: 'PUT', token: admin.token, body: 'https://example.test/sign/fps_probe' })).status, 401);
check('직접 전자계약 공개 서명표시만으로 완료 전이 차단', (await db('v4/contracts/C-DIRECT-PUBLIC-ONLY/contract_status', { method: 'PUT', token: agent.token, body: '계약완료' })).status, 401);
check('직접 전자계약의 인도 증빙 누락 완료 전이 차단', (await db('v4/contracts/C-DIRECT-NO-HANDOVER/contract_status', { method: 'PUT', token: agent.token, body: '계약완료' })).status, 401);
check('구 동의 프로필 직접계약은 완료 전이를 차단', (await db('v4/contracts/C-DIRECT-OLD-CONSENT/contract_status', { method: 'PUT', token: agent.token, body: '계약완료' })).status, 401);
check('서명된 직접계약의 contract_draft 변조와 완료 전이를 한 번에 차단', (await db('v4', { method: 'PATCH', token: agent.token, body: {
  'contracts/C-DIRECT-VERIFIED/contract_draft': JSON.stringify({ deposit_installment: '분납 2회', special_terms: '위조', special_terms_choice: '있음' }),
  'contracts/C-DIRECT-VERIFIED/contract_status': '계약완료',
} })).status, 401);
const directAfterRejectedMutation = (await db('v4/contracts/C-DIRECT-VERIFIED')).body;
check('직접계약 변조 실패 후 초안·상태가 원값 유지', directAfterRejectedMutation?.contract_draft === directVerified.contract_draft
  && directAfterRejectedMutation?.contract_status === '계약요청', true);
check('직접 전자계약 private 서명·승인·검증·인도 증거가 맞으면 완료 전이 허용', (await db('v4/contracts/C-DIRECT-VERIFIED/contract_status', { method: 'PUT', token: agent.token, body: '계약완료' })).status, 200);
   check('agent soft-delete 계약 허용', (await db('v4/contracts/C-TOMBSTONE', { method: 'PUT', token: agent.token, body: {
     ...newContract, contract_code: 'C-TOMBSTONE', _deleted: true, deletedAt: '2026-08-21T00:00:00.000Z',
   } })).status, 200);
   check('agent tombstone 복구 차단', (await db('v4/contracts/C-TOMBSTONE', { method: 'PATCH', token: agent.token, body: { _deleted: false, deletedAt: null } })).status, 401);
check('provider 영업 메모 수정 차단', (await db('v4/contracts/C-PROGRESS/memo_agent', { method: 'PUT', token: providerA.token, body: '침범' })).status, 401);
check('provider 공급 메모 수정 허용', (await db('v4/contracts/C-PROGRESS/memo_provider', { method: 'PUT', token: providerA.token, body: '공급 메모' })).status, 200);
check('provider 임의 계약취소 차단', (await db('v4/contracts/C-PROGRESS/contract_status', { method: 'PUT', token: providerA.token, body: '계약취소' })).status, 401);
check('provider 출고불가 기록 허용', (await db('v4/contracts/C-PROGRESS/provider_delivery_response', { method: 'PUT', token: providerA.token, body: '출고 불가' })).status, 200);
check('provider 출고불가에 결속된 취소 허용', (await db('v4/contracts/C-PROGRESS/contract_status', { method: 'PUT', token: providerA.token, body: '계약취소' })).status, 200);
check('agent 선점 필드 직접 write 차단', (await db('v4/contracts/C-CLAIM/agent_balance_paid', { method: 'PUT', token: agent.token, body: 'yes' })).status, 401);
check('provider 선점 필드 직접 write 차단', (await db('v4/contracts/C-CLAIM/provider_balance_confirmed', { method: 'PUT', token: providerA.token, body: 'yes' })).status, 401);
check('agent 차량 claim 원장 read 차단', (await db('v4/vehicle_claims', { token: agent.token })).status, 401);
   check('admin 외 client claim write 차단', (await db('v4/vehicle_claims/FAKE', { method: 'PUT', token: admin.token, body: { contract_code: 'FAKE' } })).status, 401);
   await db('v4/settlement_issuance/ST_C-ISSUING', { method: 'PUT', body: { status: 'issuing', claimedAt: Date.now() } });
   check('정산 발행 잠금 중 agent 계약취소 차단', (await db('v4/contracts/C-ISSUING/contract_status', { method: 'PUT', token: agent.token, body: '계약취소' })).status, 401);
   check('정산 발행 잠금 중 agent tombstone 차단', (await db('v4/contracts/C-ISSUING/_deleted', { method: 'PUT', token: agent.token, body: true })).status, 401);

console.log('\n=== 차량 잠금 계약 결속 ===');
check('계약 없는 agent raw lock 차단', (await db('v4', { method: 'PATCH', token: agent.token, body: {
  'products/CAR-1/vehicle_status': '계약중', 'products/CAR-1/locked_by_contract': 'NO-CONTRACT',
  'products/CAR-1/_key': 'CAR-1', 'products/CAR-1/updatedAt': 't',
} })).status, 401);
check('다른 차량 계약으로 lock 차단', (await db('v4', { method: 'PATCH', token: agent.token, body: {
  'products/CAR-1/vehicle_status': '출고불가', 'products/CAR-1/locked_by_contract': 'C-OTHER-CAR',
  'products/CAR-1/_key': 'CAR-1', 'products/CAR-1/updatedAt': 't',
} })).status, 401);
check('완료된 자기 계약 lock 허용', (await db('v4', { method: 'PATCH', token: agent.token, body: {
  'products/CAR-1/vehicle_status': '출고불가', 'products/CAR-1/locked_by_contract': 'C-OK',
  'products/CAR-1/_key': 'CAR-1', 'products/CAR-1/updatedAt': 't',
} })).status, 200);

console.log('\n=== 정산 생성·금액 결속 ===');
const settlementPublic = {
  _key: 'ST_C-OK', settlement_code: 'ST_C-OK', contract_code: 'C-OK', settlement_status: '정산대기',
  provider_company_code: 'SUP-A', agent_code: 'AG-A', agent_channel_code: 'CH-A', rent_amount: 500000,
};
const providerPrivate = {
  _key: 'ST_C-OK', settlement_code: 'ST_C-OK', contract_code: 'C-OK', provider_company_code: 'SUP-A',
  agent_code: 'AG-A', agent_channel_code: 'CH-A', fee_rate: 0.1, fee_amount: 50000,
};
const agentPrivate = {
  _key: 'ST_C-OK', settlement_code: 'ST_C-OK', contract_code: 'C-OK', provider_company_code: 'SUP-A',
  agent_code: 'AG-A', agent_channel_code: 'CH-A', agent_payout: 20000,
};
check('연계 없는 임의 settlement 생성 차단', (await db('v4/settlements/ST_FAKE', { method: 'PUT', token: agent.token, body: { ...settlementPublic, _key: 'ST_FAKE', settlement_code: 'ST_FAKE', contract_code: 'FAKE' } })).status, 401);
check('agent private 금액 위조 차단', (await db('v4', { method: 'PATCH', token: agent.token, body: {
  'settlements/ST_C-AGENT-FORGE': { ...settlementPublic, _key: 'ST_C-AGENT-FORGE', settlement_code: 'ST_C-AGENT-FORGE' },
  'settlements_provider_private/ST_C-AGENT-FORGE': { ...providerPrivate, _key: 'ST_C-AGENT-FORGE', settlement_code: 'ST_C-AGENT-FORGE', fee_amount: 999999 },
  'settlements_agent_private/ST_C-AGENT-FORGE': { ...agentPrivate, _key: 'ST_C-AGENT-FORGE', settlement_code: 'ST_C-AGENT-FORGE' },
} })).status, 401);
check('provider direct settlement 생성 차단', (await db('v4', { method: 'PATCH', token: providerA.token, body: {
  'settlements/ST_C-PROVIDER-FORGE': { ...settlementPublic, _key: 'ST_C-PROVIDER-FORGE', settlement_code: 'ST_C-PROVIDER-FORGE' },
  'settlements_provider_private/ST_C-PROVIDER-FORGE': { ...providerPrivate, _key: 'ST_C-PROVIDER-FORGE', settlement_code: 'ST_C-PROVIDER-FORGE' },
  'settlements_agent_private/ST_C-PROVIDER-FORGE': { ...agentPrivate, _key: 'ST_C-PROVIDER-FORGE', settlement_code: 'ST_C-PROVIDER-FORGE' },
} })).status, 401);
check('admin 정산 원자 생성 허용', (await db('v4', { method: 'PATCH', token: admin.token, body: {
  'settlements/ST_C-ADMIN': { ...settlementPublic, _key: 'ST_C-ADMIN', settlement_code: 'ST_C-ADMIN' },
  'settlements_provider_private/ST_C-ADMIN': { ...providerPrivate, _key: 'ST_C-ADMIN', settlement_code: 'ST_C-ADMIN' },
  'settlements_agent_private/ST_C-ADMIN': { ...agentPrivate, _key: 'ST_C-ADMIN', settlement_code: 'ST_C-ADMIN' },
} })).status, 200);
check('agent 생성 후 private 금액 수정 차단', (await db('v4/settlements_provider_private/ST_C-ADMIN/fee_amount', { method: 'PUT', token: agent.token, body: 1 })).status, 401);

const failures = results.filter((result) => !result.ok);
console.log(`\nrelease rules emulator: ${results.length - failures.length}/${results.length} PASS`);
for (const failure of failures) console.log(`  ! ${failure.name}: 실제 ${failure.actual}, 기대 ${failure.expected}`);
if (failures.length) process.exit(1);
