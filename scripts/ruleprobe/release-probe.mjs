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
  [pendingAgent.uid]: { uid: pendingAgent.uid, role: 'agent', status: 'pending', user_code: 'AG-PENDING' },
  [inactiveAgent.uid]: { uid: inactiveAgent.uid, role: 'agent', status: 'active', is_active: '아니오', user_code: 'AG-INACTIVE' },
  [deletedAgent.uid]: { uid: deletedAgent.uid, role: 'agent', status: 'deleted', user_code: 'AG-DELETED' },
  [rejectedAgent.uid]: { uid: rejectedAgent.uid, role: 'agent', status: 'rejected', user_code: 'AG-REJECTED' },
  [unassignedUser.uid]: { uid: unassignedUser.uid, role: '', status: 'active', user_code: 'UNASSIGNED' },
} });

const doneContract = {
  contract_code: 'C-OK', contract_status: '계약완료', contract_date: '2026-08-03',
  product_code: 'CAR-1', agent_uid: agent.uid, agent_code: 'AG-A', agent_channel_code: 'CH-A',
  provider_company_code: 'SUP-A', rent_amount_snapshot: 500000, fee_rate_snapshot: 0.1,
  payout_rate_snapshot: 0.04, customer_name: '고객', customer_phone: '010-0000-0000',
  car_number_snapshot: '11가1111', maker_snapshot: '현대', model_snapshot: '아반떼',
  agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능',
  agent_docs_submitted: 'yes', provider_docs_review: '승인',
  agent_balance_paid: 'yes', agent_final_paid: 'yes', provider_balance_confirmed: 'yes',
  provider_agreement_done: 'yes', provider_agreement_sent: 'yes',
  agent_handover_confirmed: 'yes', provider_release_completed: 'yes',
};
await db('products', { method: 'PUT', body: { LEGACY: { product_code: 'LEGACY', vin: 'SECRET', vehicle_price: 1 } } });
await db('partners', { method: 'PUT', body: { 'SUP-A': { partner_code: 'SUP-A' } } });
await db('policies', { method: 'PUT', body: { OLD: { policy_code: 'OLD', provider_company_code: 'SUP-A' } } });
await db('v4', { method: 'PUT', body: {
  products: { 'CAR-1': { _key: 'CAR-1', product_code: 'CAR-1', provider_company_code: 'SUP-A', vehicle_status: '출고가능', locked_by_contract: '' } },
  partners: { 'SUP-A': { partner_code: 'SUP-A', name: 'A' }, 'SUP-B': { partner_code: 'SUP-B', name: 'B' } },
  policies: { PA: { policy_code: 'PA', provider_company_code: 'SUP-A' }, PB: { policy_code: 'PB', provider_company_code: 'SUP-B' } },
  contracts: {
    'C-OK': doneContract,
    'C-PROGRESS': { ...doneContract, contract_code: 'C-PROGRESS', contract_status: '계약요청', product_code: 'CAR-1', provider_docs_review: '' },
    'C-OTHER-CAR': { ...doneContract, contract_code: 'C-OTHER-CAR', product_code: 'CAR-2' },
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

console.log('\n=== v4 기준정보 소유권 ===');
check('provider 자기 partner 수정 허용', (await db('v4/partners/SUP-A', { method: 'PATCH', token: providerA.token, body: { name: 'A2' } })).status, 200);
check('provider 타 partner 수정 차단', (await db('v4/partners/SUP-B', { method: 'PATCH', token: providerA.token, body: { name: '탈취' } })).status, 401);
check('provider 자기 policy 수정 허용', (await db('v4/policies/PA', { method: 'PATCH', token: providerA.token, body: { policy_name: 'A 정책' } })).status, 200);
check('provider 타 policy 수정 차단', (await db('v4/policies/PB', { method: 'PATCH', token: providerA.token, body: { policy_name: '탈취' } })).status, 401);

console.log('\n=== 공개서명 read 수명 ===');
await db('contract_sign/T-SENT', { method: 'PUT', body: { sign_token: 'T-SENT', status: 'sent', contract_code: 'C-OK', expires_at: Date.now() + 600000, revoked_at: null } });
await db('contract_sign/T-PENDING', { method: 'PUT', body: { sign_token: 'T-PENDING', status: 'pending_review', contract_code: 'C-OK', expires_at: Date.now() + 600000, revoked_at: null, customer_id: 'SECRET' } });
check('sent 링크 익명 read 허용', (await db('contract_sign/T-SENT', { token: 'none' })).status, 200);
check('pending_review 익명 재조회 차단', (await db('contract_sign/T-PENDING', { token: 'none' })).status, 401);

console.log('\n=== 계약 불변·역할 격리 ===');
check('agent 자기 계약 고객 연락처 수정 허용', (await db('v4/contracts/C-PROGRESS/customer_phone', { method: 'PUT', token: agent.token, body: '010-1111-2222' })).status, 200);
check('provider 고객 연락처 수정 차단', (await db('v4/contracts/C-PROGRESS/customer_phone', { method: 'PUT', token: providerA.token, body: '010-9999-9999' })).status, 401);
check('agent 계약 차량 스냅샷 수정 차단', (await db('v4/contracts/C-PROGRESS/maker_snapshot', { method: 'PUT', token: agent.token, body: '기아' })).status, 401);
check('agent contract_date 수정 차단', (await db('v4/contracts/C-PROGRESS/contract_date', { method: 'PUT', token: agent.token, body: '2020-01-01' })).status, 401);
check('provider 영업 메모 수정 차단', (await db('v4/contracts/C-PROGRESS/memo_agent', { method: 'PUT', token: providerA.token, body: '침범' })).status, 401);
check('provider 공급 메모 수정 허용', (await db('v4/contracts/C-PROGRESS/memo_provider', { method: 'PUT', token: providerA.token, body: '공급 메모' })).status, 200);
check('provider 임의 계약취소 차단', (await db('v4/contracts/C-PROGRESS/contract_status', { method: 'PUT', token: providerA.token, body: '계약취소' })).status, 401);
check('provider 출고불가 기록 허용', (await db('v4/contracts/C-PROGRESS/provider_delivery_response', { method: 'PUT', token: providerA.token, body: '출고 불가' })).status, 200);
check('provider 출고불가에 결속된 취소 허용', (await db('v4/contracts/C-PROGRESS/contract_status', { method: 'PUT', token: providerA.token, body: '계약취소' })).status, 200);

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
check('private 금액 위조 차단', (await db('v4', { method: 'PATCH', token: agent.token, body: {
  'settlements/ST_C-OK': settlementPublic,
  'settlements_provider_private/ST_C-OK': { ...providerPrivate, fee_amount: 999999 },
  'settlements_agent_private/ST_C-OK': agentPrivate,
} })).status, 401);
check('완료 계약 정산 원자 생성 허용', (await db('v4', { method: 'PATCH', token: agent.token, body: {
  'settlements/ST_C-OK': settlementPublic,
  'settlements_provider_private/ST_C-OK': providerPrivate,
  'settlements_agent_private/ST_C-OK': agentPrivate,
} })).status, 200);

const failures = results.filter((result) => !result.ok);
console.log(`\nrelease rules emulator: ${results.length - failures.length}/${results.length} PASS`);
for (const failure of failures) console.log(`  ! ${failure.name}: 실제 ${failure.actual}, 기대 ${failure.expected}`);
if (failures.length) process.exit(1);
