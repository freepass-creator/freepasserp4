import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const projectId = process.env.GCLOUD_PROJECT || 'demo-freepasserp4';
const dbHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9100';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9199';
const namespace = `${projectId}-default-rtdb`;
const apiPort = Number(process.env.VEHICLE_CLAIM_API_PORT || 4014);
const apiBase = `http://127.0.0.1:${apiPort}`;

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

async function db(path, { method = 'GET', body } = {}) {
  const response = await fetch(`http://${dbHost}/${path}.json?ns=${encodeURIComponent(namespace)}`, {
    method,
    headers: { authorization: 'Bearer owner', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let value = null;
  try { value = raw ? JSON.parse(raw) : null; } catch { value = raw; }
  assert.equal(response.ok, true, `${method} ${path}: ${response.status} ${raw}`);
  return value;
}

async function api(body, token = '', base = apiBase) {
  const response = await fetch(`${base}/api/contracts/vehicle-claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function agreementApi(contractCode, body, token = '', base = apiBase) {
  const response = await fetch(`${base}/api/contracts/${encodeURIComponent(contractCode)}/term-freeze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function sessionApi(token = '', base = apiBase) {
  const response = await fetch(`${base}/api/auth/session`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

let pass = 0;
function check(name, condition, detail) {
  if (!condition) throw new Error(`${name}: ${JSON.stringify(detail)}`);
  pass++;
  console.log(`PASS ${name}`);
}

function startNext(port, enabled, suffix) {
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_DIST_DIR: `.next-codex-vehicle-claim-api-${suffix}`,
      NEXT_PUBLIC_FIREBASE_DATABASE_URL: `https://${namespace}.firebaseio.com`,
      VEHICLE_CLAIM_SERVER_ENABLED: enabled ? 'true' : 'false',
      NEXT_PUBLIC_ATOMIC_VEHICLE_CLAIMS: enabled ? 'true' : 'false',
      GCLOUD_PROJECT: projectId,
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk) => { log = (log + chunk).slice(-8000); });
  return { child, base: `http://127.0.0.1:${port}`, log: () => log };
}

async function waitForNext(server) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode != null) throw new Error(`Next server exited ${server.child.exitCode}\n${server.log()}`);
    try {
      const response = await fetch(`${server.base}/api/contracts/vehicle-claim`);
      if (response.status > 0) return;
    } catch { /* 시작 대기 */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next server readiness timeout\n${server.log()}`);
}

async function stopNext(server) {
  server.child.kill('SIGTERM');
  await new Promise((resolve) => {
    if (server.child.exitCode != null) return resolve();
    server.child.once('exit', resolve);
    setTimeout(resolve, 5000);
  });
}

const next = startNext(apiPort, true, 'on');
const offNext = startNext(apiPort - 1, false, 'off');
try {
  await Promise.all([waitForNext(next), waitForNext(offNext)]);
  const disabled = await api({ contractCode: 'C-A', key: 'agent_balance_paid', value: 'yes' }, '', offNext.base);
  check('서버 kill switch OFF API 503', disabled.status === 503, disabled);
  const [agentA, agentB, provider, outsider, agentAdmin, providerAdmin, admin] = await Promise.all([
    signUp('claim-agent-a'), signUp('claim-agent-b'), signUp('claim-provider'), signUp('claim-outsider'),
    signUp('claim-agent-admin'), signUp('claim-provider-admin'), signUp('claim-platform-admin'),
  ]);
  await db('users', { method: 'PUT', body: {
    [agentA.uid]: { role: 'agent', status: 'active', user_code: 'AG-A', agent_channel_code: 'CH-A' },
    [agentB.uid]: { role: 'agent', status: 'active', user_code: 'AG-B', agent_channel_code: 'CH-B' },
    [provider.uid]: { role: 'provider', status: 'active', user_code: 'PV-A', company_code: 'SUP-A' },
    [outsider.uid]: { role: 'agent', status: 'active', user_code: 'AG-X', agent_channel_code: 'CH-X' },
    [agentAdmin.uid]: { role: 'agent_admin', status: 'active', user_code: 'AG-M', agent_channel_code: 'CH-A' },
    [providerAdmin.uid]: { role: 'provider_admin', status: 'active', user_code: 'PV-M', company_code: 'SUP-A' },
    [admin.uid]: { role: 'admin', status: 'active', user_code: 'ADM' },
  } });
  const contract = (code, productCode, agent) => ({
    contract_code: code, contract_status: '계약요청', contract_date: '2026-08-04',
    product_code: productCode, car_number_snapshot: '33다3333', maker_snapshot: '현대', model_snapshot: '쏘나타',
    customer_name: '테스트', customer_phone: '010-0000-0000',
    agent_uid: agent.uid, agent_code: agent === agentA ? 'AG-A' : 'AG-B',
    agent_channel_code: agent === agentA ? 'CH-A' : 'CH-B', provider_company_code: 'SUP-A',
    product_type_snapshot: '중고렌트',
  });
  await db('v4', { method: 'PUT', body: {
    products: {
      'P-A': { product_code: 'P-A', car_number: '33다3333', product_type: '중고렌트', provider_company_code: 'SUP-A', vehicle_status: '출고가능', locked_by_contract: '', price: { 36: { rent: 500000, deposit: 0 } } },
      'P-B': { product_code: 'P-B', car_number: '33다3333', product_type: '중고렌트', provider_company_code: 'SUP-A', vehicle_status: '출고가능', locked_by_contract: '', price: { 36: { rent: 500000, deposit: 0 } } },
      'P-COMPLETE-NO-SEAL': { product_code: 'P-COMPLETE-NO-SEAL', car_number: '35다3333', product_type: '중고렌트', provider_company_code: 'SUP-A', vehicle_status: '출고가능', locked_by_contract: '', price: { 36: { rent: 500000, deposit: 0 } } },
      'P-LEGACY-AGREEMENT': { product_code: 'P-LEGACY-AGREEMENT', car_number: '36다3333', product_type: '중고렌트', provider_company_code: 'SUP-A', vehicle_status: '출고가능', locked_by_contract: '', price: { 36: { rent: 500000, deposit: 0 } } },
      'P-PRE-AGREEMENT': { product_code: 'P-PRE-AGREEMENT', car_number: '37다3333', product_type: '중고렌트', provider_company_code: 'SUP-A', vehicle_status: '출고가능', locked_by_contract: '', price: { 36: { rent: 500000, deposit: 0 } } },
      'P-MANAGED-AGREEMENT': { product_code: 'P-MANAGED-AGREEMENT', car_number: '38다3333', product_type: '중고렌트', provider_company_code: 'SUP-A', vehicle_status: '출고가능', locked_by_contract: '', price: { 36: { rent: 500000, deposit: 0 } } },
      'P-IDENTITY-FORGE': { product_code: 'P-IDENTITY-FORGE', car_number: '39다3333', product_type: '중고렌트', provider_company_code: 'SUP-A', vehicle_status: '출고가능', locked_by_contract: '', price: { 36: { rent: 500000, deposit: 0 } } },
      'P-PREPARING-RECOVERY': { product_code: 'P-PREPARING-RECOVERY', car_number: '40다3333', product_type: '중고렌트', provider_company_code: 'SUP-A', vehicle_status: '출고가능', locked_by_contract: '', price: { 36: { rent: 500000, deposit: 0 } } },
    },
    contracts: {
      'C-A': { ...contract('C-A', 'P-A', agentA), agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능', agent_docs_submitted: 'yes', provider_docs_review: '승인' },
      'C-B': { ...contract('C-B', 'P-B', agentB), agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능', agent_docs_submitted: 'yes', provider_docs_review: '승인' },
      'C-COMPLETE-NO-SEAL': { ...contract('C-COMPLETE-NO-SEAL', 'P-COMPLETE-NO-SEAL', agentA), car_number_snapshot: '35다3333', contract_status: '계약완료' },
      // v3 원장 위 partial v4 overlay는 자동 rate seal 대상이 아니다.
      'C-LEGACY-AGREEMENT': { ...contract('C-LEGACY-AGREEMENT', 'P-LEGACY-AGREEMENT', agentA), car_number_snapshot: '36다3333' },
      'C-PRE-AGREEMENT': { ...contract('C-PRE-AGREEMENT', 'P-PRE-AGREEMENT', agentA), car_number_snapshot: '37다3333' },
      'C-MANAGED-AGREEMENT': { ...contract('C-MANAGED-AGREEMENT', 'P-MANAGED-AGREEMENT', agentA), car_number_snapshot: '38다3333', agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능', agent_docs_submitted: 'yes', provider_docs_review: '승인' },
      // 채널 관리자가 타 채널 UID에 자기 채널/코드를 붙여 private 지급율을 읽게 만드는
      // raw projection 위조. 서버는 users/{uid} 정본(AG-B/CH-B)과 불일치를 발견해야 한다.
      'C-IDENTITY-FORGE': {
        ...contract('C-IDENTITY-FORGE', 'P-IDENTITY-FORGE', agentB),
        car_number_snapshot: '39다3333', agent_code: 'AG-A', agent_channel_code: 'CH-A',
        agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능', agent_docs_submitted: 'yes', provider_docs_review: '승인',
      },
      // public 약정 write 뒤 서버가 종료된 상황을 표현한다. preparing seal은 절대 선점에
      // 쓰지 못하지만 동일 약정 완료 재시도로 sealed까지 안전하게 회복할 수 있어야 한다.
      'C-PREPARING-RECOVERY': {
        ...contract('C-PREPARING-RECOVERY', 'P-PREPARING-RECOVERY', agentA),
        car_number_snapshot: '40다3333',
        agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능', agent_docs_submitted: 'yes', provider_docs_review: '승인',
        provider_agreement_done: 'yes', rent_month_snapshot: 36, rent_amount_snapshot: 500000, deposit_amount_snapshot: 0,
      },
    },
    partners_private: { 'SUP-A': { fee_rate: 0.12 } },
    users_private: { [agentA.uid]: { agent_payout_rate: 0.05 }, [agentB.uid]: { agent_payout_rate: 0.05 } },
    contract_settlement_seals: {
      'C-PREPARING-RECOVERY': {
        version: 'contract-settlement-v2', status: 'preparing', contractCode: 'C-PREPARING-RECOVERY', productCode: 'P-PREPARING-RECOVERY',
        agentUid: agentA.uid, agentCode: 'AG-A', agentChannelCode: 'CH-A', providerCompanyCode: 'SUP-A',
        rentMonth: 36, rentAmount: 500000, depositAmount: 0, productType: '중고렌트', feeRate: 0.12, payoutRate: 0.05,
        preparedAt: 1786000000000, sealedAt: null, sealedByUid: agentA.uid,
      },
    },
  } });
  await db('contracts/C-LEGACY-AGREEMENT', { method: 'PUT', body: {
    ...contract('C-LEGACY-AGREEMENT', 'P-LEGACY-AGREEMENT', agentA), contract_status: '계약요청',
  } });
  const seededContracts = await db('v4/contracts');
  check('일반 계약 agreement fixture 저장 확인', seededContracts?.['C-A']?.contract_code === 'C-A' && seededContracts?.['C-B']?.contract_code === 'C-B', seededContracts);

  const unauthSession = await sessionApi();
  check('무인증 역할 확인 API 차단', unauthSession.status === 403, unauthSession);
  const sessionMatrix = await Promise.all([
    [agentA, 'agent', 'agent', 'CH-A'],
    [agentAdmin, 'agent', 'agent_admin', 'CH-A'],
    [provider, 'provider', 'provider', 'SUP-A'],
    [providerAdmin, 'provider', 'provider_admin', 'SUP-A'],
    [admin, 'admin', 'admin', ''],
  ].map(async ([account, role, rawRole, organizationCode]) => ({
    expected: { role, rawRole, organizationCode },
    actual: await sessionApi(account.token),
  })));
  check('5역할 확인 API 정규 역할·조직 범위', sessionMatrix.every(({ expected, actual }) => (
    actual.status === 200
      && actual.payload.role === expected.role
      && actual.payload.rawRole === expected.rawRole
      && actual.payload.organizationCode === expected.organizationCode
  )), sessionMatrix);

  const unauth = await api({ contractCode: 'C-A', key: 'agent_balance_paid', value: 'yes' });
  check('무인증 API 차단', unauth.status === 401, unauth);
  const unsealedClaim = await api({ contractCode: 'C-A', key: 'agent_balance_paid', value: 'yes' }, agentA.token);
  check('서버는 일반 계약을 읽되 agreement seal 전 차량 선점 차단', unsealedClaim.status === 409 && /약정/.test(String(unsealedClaim.payload?.error || '')), unsealedClaim);
  const termOnly = await agreementApi('C-A', { rentMonth: 36 }, agentA.token);
  const partialSeal = await db('v4/contract_settlement_seals/C-A');
  check('손님정보 없는 기간 단독 동결·generic seal 생성 차단', termOnly.status === 400 && partialSeal == null, { termOnly, partialSeal });
  const completedLateSeal = await agreementApi('C-COMPLETE-NO-SEAL', { rentMonth: 36, customerName: '테스트', customerPhone: '010-0000-0000', completeAgreement: true }, agentA.token);
  const completedLateSealRecord = await db('v4/contract_settlement_seals/C-COMPLETE-NO-SEAL');
  check('완료 후 사후 generic seal 생성 차단', completedLateSeal.status === 409 && completedLateSealRecord == null, { completedLateSeal, completedLateSealRecord });
  const preAgreement = await agreementApi('C-PRE-AGREEMENT', { rentMonth: 36, customerName: '테스트', customerPhone: '010-0000-0000', completeAgreement: true }, agentA.token);
  const preAgreementSeal = await db('v4/contract_settlement_seals/C-PRE-AGREEMENT');
  check('출고·서류 승인 전 API 약정완료·generic seal 차단', preAgreement.status === 409 && preAgreementSeal == null, { preAgreement, preAgreementSeal });
  const legacyAgreement = await agreementApi('C-LEGACY-AGREEMENT', { rentMonth: 36, customerName: '테스트', customerPhone: '010-0000-0000', completeAgreement: true }, agentA.token);
  const legacyAgreementSeal = await db('v4/contract_settlement_seals/C-LEGACY-AGREEMENT');
  check('v3 원장·v4 partial overlay 자동 generic seal 차단', legacyAgreement.status === 409 && legacyAgreementSeal == null, { legacyAgreement, legacyAgreementSeal });
  const agreementProvider = await agreementApi('C-A', { rentMonth: 36, customerName: '테스트', customerPhone: '010-0000-0000', completeAgreement: true }, provider.token);
  check('공급사의 영업 약정완료 API 차단', agreementProvider.status === 409, agreementProvider);
  const preparingClaim = await api({ contractCode: 'C-PREPARING-RECOVERY', key: 'agent_balance_paid', value: 'yes' }, agentA.token);
  check('public 약정만 끝난 preparing seal은 차량 선점 차단', preparingClaim.status === 409, preparingClaim);
  const preparingRecovery = await agreementApi('C-PREPARING-RECOVERY', { rentMonth: 36, customerName: '복구 고객', customerPhone: '010-0000-0000', completeAgreement: true }, agentA.token);
  const recoveredSeal = await db('v4/contract_settlement_seals/C-PREPARING-RECOVERY');
  check('preparing seal은 같은 약정완료 재시도로 sealed 회복', preparingRecovery.status === 200 && recoveredSeal?.status === 'sealed' && Number.isFinite(recoveredSeal?.sealedAt), { preparingRecovery, recoveredSeal });
  const forgedIdentity = await agreementApi('C-IDENTITY-FORGE', { rentMonth: 36, customerName: '위조', customerPhone: '010-0000-0000', completeAgreement: true }, agentAdmin.token);
  const forgedIdentityContract = await db('v4/contracts/C-IDENTITY-FORGE');
  const forgedIdentitySeal = await db('v4/contract_settlement_seals/C-IDENTITY-FORGE');
  check('채널 관리자의 타 영업자 UID·코드·채널 위조 약정은 서버 정본 대조로 차단', forgedIdentity.status === 409
    && forgedIdentitySeal == null && forgedIdentityContract?.customer_name === '테스트'
    && forgedIdentityContract?.provider_agreement_done == null, { forgedIdentity, forgedIdentityContract, forgedIdentitySeal });
  const managedAgreement = await agreementApi('C-MANAGED-AGREEMENT', { rentMonth: 36, customerName: '관리 채널 고객', customerPhone: '010-0000-0000', completeAgreement: true }, agentAdmin.token);
  const managedSeal = await db('v4/contract_settlement_seals/C-MANAGED-AGREEMENT');
  check('같은 정본 채널의 영업관리자 약정완료는 허용하고 귀속을 봉인', managedAgreement.status === 200
    && managedSeal?.agentUid === agentA.uid && managedSeal?.agentCode === 'AG-A' && managedSeal?.agentChannelCode === 'CH-A', { managedAgreement, managedSeal });
  const agreementA = await agreementApi('C-A', { rentMonth: 36, customerName: '테스트', customerPhone: '010-0000-0000', completeAgreement: true }, agentA.token);
  const agreementB = await agreementApi('C-B', { rentMonth: 36, customerName: '테스트', customerPhone: '010-0000-0000', completeAgreement: true }, agentB.token);
  check('일반 계약 약정완료 서버 전이 성공', agreementA.status === 200 && agreementB.status === 200, { agreementA, agreementB });
  const agreedA = await db('v4/contracts/C-A');
  const agreementSeal = await db('v4/contract_settlement_seals/C-A');
  check('일반 계약은 공개 요율 없이 서버 seal로만 기준 동결', agreedA.rent_month_snapshot === 36
    && agreedA.rent_amount_snapshot === 500000 && agreedA.provider_agreement_done === 'yes'
    && !Object.hasOwn(agreedA, 'fee_rate_snapshot') && agreementSeal.feeRate === 0.12 && agreementSeal.payoutRate === 0.05
    && !Object.hasOwn(agreementA.payload?.contractPatch || {}, 'fee_rate_snapshot')
    && !Object.hasOwn(agreementA.payload?.contractPatch || {}, 'payout_rate_snapshot')
    && !/feeRate|payoutRate|fee_rate_snapshot|payout_rate_snapshot/.test(JSON.stringify(agreementA.payload || {})), { agreedA, agreementSeal, agreementA });
  const denied = await api({ contractCode: 'C-A', key: 'agent_balance_paid', value: 'yes' }, outsider.token);
  check('타 영업자 계약 선점 차단', denied.status === 409, denied);

  const raced = await Promise.all([
    api({ contractCode: 'C-A', key: 'agent_balance_paid', value: 'yes' }, agentA.token),
    api({ contractCode: 'C-B', key: 'agent_balance_paid', value: 'yes' }, agentB.token),
  ]);
  check('동시 API 선점 정확히 1건 성공', raced.filter((result) => result.status === 200).length === 1, raced);
  check('동시 API 패자 409 충돌', raced.filter((result) => result.status === 409).length === 1, raced);

  const contracts = await db('v4/contracts');
  const winners = ['C-A', 'C-B'].filter((code) => contracts[code]?.agent_balance_paid === 'yes');
  check('계약금 단계 원장 정확히 1건', winners.length === 1, contracts);
  const winner = winners[0];
  const loser = winner === 'C-A' ? 'C-B' : 'C-A';
  const winnerAgent = winner === 'C-A' ? agentA : agentB;
  const winnerProduct = winner === 'C-A' ? 'P-A' : 'P-B';
  const claims = await db('v4/vehicle_claims');
  const claimRows = Object.values(claims || {});
  check('claim 원장 active 1건', claimRows.length === 1 && claimRows[0]?.status === 'active' && claimRows[0]?.contract_code === winner, claims);
  const products = await db('v4/products');
  check('승자 상품 락 결속', products[winnerProduct]?.locked_by_contract === winner && products[winnerProduct]?.vehicle_status === '계약중', products);
  check('패자 계약 단계 미변경', !contracts[loser]?.agent_balance_paid, contracts[loser]);

  const providerConfirm = await api({ contractCode: winner, key: 'provider_balance_confirmed', value: 'yes' }, provider.token);
  check('해당 공급사 동일 claim 후속 확인 허용', providerConfirm.status === 200, providerConfirm);
  const wrongProviderStep = await api({ contractCode: winner, key: 'provider_balance_confirmed', value: '' }, outsider.token);
  check('영업자의 공급사 단계 변경 차단', wrongProviderStep.status === 409, wrongProviderStep);

  await db(`v4/contracts/${winner}/contract_status`, { method: 'PUT', body: '계약취소' });
  const released = await api({ action: 'release_cancelled', contractCode: winner }, winnerAgent.token);
  check('취소 계약 claim 해제 API 성공', released.status === 200, released);
  const releasedClaims = await db('v4/vehicle_claims');
  check('claim 원장 제거', releasedClaims == null, releasedClaims);
  const releasedProduct = await db(`v4/products/${winnerProduct}`);
  check('취소 뒤 승자 상품 출고가능 복원', releasedProduct.vehicle_status === '출고가능' && !releasedProduct.locked_by_contract, releasedProduct);

  // 약정 동결 전에는 어떤 계약도 차량을 선점할 수 없고, 직접 전자계약은 그보다
  // 앞서 server seal·고객 서명·관리자 승인까지 갖춰야 한다.
  const unsignedCode = 'C-DIRECT-UNSIGNED';
  const directCode = 'C-DIRECT-SIGNED';
  const sessionHash = 'd'.repeat(64);
  const sealHash = 'e'.repeat(64);
  const documentHash = 'f'.repeat(64);
  const manualTerms = { deposit_installment: '일시납', special_terms: '없음', special_terms_choice: '없음' };
  const directProduct = {
    product_code: 'P-DIRECT-SIGNED', car_number: '55라5555', product_type: '중고 렌트',
    provider_company_code: 'SUP-A', vehicle_status: '출고가능', locked_by_contract: '',
  };
  const directContract = {
    ...contract(directCode, 'P-DIRECT-SIGNED', agentA),
    car_number_snapshot: '55라5555',
    contract_source: 'direct', contract_origin: '계약서직접등록', contract_number: `직접-${directCode}`,
    policy_code: `POL-${directCode}`, product_type_snapshot: '중고 렌트',
    standard_template_id: 'freepass-rent-standard', contract_kind: 'rent_return',
    esign_contract_kind: 'rent_return', esign_maturity: '반납형', esign_insurance_side: '회사포함',
    rent_month_snapshot: 36, rent_amount_snapshot: 500000,
    deposit_amount_snapshot: 800000, deposit_payment_type: '일시납', payment_timing_snapshot: '선불',
    driver_age_snapshot: '만 26세 이상', annual_mileage_snapshot: '연 3만km', price_variant_snapshot: 'annual-30k',
    mileage_surcharge_snapshot: 0, age_surcharge_snapshot: 0, pricing_snapshot_version: 'v1',
    special_terms_choice_snapshot: '없음', special_terms_snapshot: '없음', contract_draft: JSON.stringify(manualTerms),
    esign_provider: 'freepass', sign_status: '서명완료', sign_signed_at: 1786000000000,
    esign_session_hash: sessionHash, esign_seal_hash: sealHash, esign_document_sha256: documentHash,
  };
  await db('v4', { method: 'PATCH', body: {
    'products/P-NO-TERMS': { product_code: 'P-NO-TERMS', car_number: '44라4444', provider_company_code: 'SUP-A', vehicle_status: '출고가능', locked_by_contract: '' },
    'contracts/C-NO-TERMS': { ...contract('C-NO-TERMS', 'P-NO-TERMS', agentA), rent_month_snapshot: '', rent_amount_snapshot: '' },
    'products/P-DIRECT-UNSIGNED': { product_code: 'P-DIRECT-UNSIGNED', car_number: '54라5554', provider_company_code: 'SUP-A', vehicle_status: '출고가능', locked_by_contract: '' },
    'contracts/C-DIRECT-UNSIGNED': {
      ...contract(unsignedCode, 'P-DIRECT-UNSIGNED', agentA), car_number_snapshot: '54라5554',
      contract_source: 'direct', contract_origin: '계약서직접등록',
    },
    'products/P-DIRECT-SIGNED': directProduct,
    [`contracts/${directCode}`]: directContract,
    [`esign_contract_seals/${directCode}`]: {
      version: 'v1', contractCode: directCode, createdAt: 1786000000000, createdByUid: agentA.uid,
      requestHash: 'vehicle-claim-direct-probe', contract: directContract, product: directProduct,
      policy: { policy_code: `POL-${directCode}`, insurance_included: '포함' }, partner: { partner_code: 'SUP-A' },
      templateId: 'freepass-rent-standard', contractKind: 'rent_return', manualTerms,
      settlementRateBasis: { productType: '중고 렌트', feeRate: 0.12, payoutRate: 0.05, status: 'sealed' },
    },
    [`esign_sessions/${sessionHash}`]: {
      provider: 'freepass', contractCode: directCode, status: 'signed', sealHash, approvedAt: 1786000000100,
      snapshot: {
        templateState: { co: 'auto', pd: '렌트선택형', ins: '포함', ct: '개인', car: '등록완료', tax: '개인' },
        consentProfile: { version: 'freepass-consent-v2', requiredKeys: ['rental_terms', 'privacy'], atoms: [{ key: 'privacy' }], screeningCriteria: '무심사', gpsInstalled: '미장착', paymentMethod: '계좌이체', requiresExternalPaymentAuthorization: false, cmsRequiredBeforeHandover: false },
      },
    },
    [`esign_private/${directCode}/${sessionHash}`]: {
      status: 'approved', sealHash, approvedAt: 1786000000200, customer_name: '승인 고객',
      signatureSha256: '1'.repeat(64), idCardSha256: '2'.repeat(64), selfieSha256: '3'.repeat(64), pdfSha256: documentHash,
      signature: 'data:image/png;base64,c2ln', idCardPath: 'private/id-card', selfiePath: 'private/selfie', pdfPath: 'private/completed.pdf',
    },
    [`esign_verifications/${sealHash}`]: { provider: 'freepass', contractCode: directCode, sealHash, documentSha256: documentHash, signedAt: 1786000000300 },
  } });
  const noTerms = await api({ contractCode: 'C-NO-TERMS', key: 'agent_balance_paid', value: 'yes' }, agentA.token);
  check('약정 기간·금액 없는 계약 차량 선점 차단', noTerms.status === 409, noTerms);
  const unsigned = await api({ contractCode: unsignedCode, key: 'agent_balance_paid', value: 'yes' }, agentA.token);
  check('직접계약 공개값만으로 차량 선점 차단', unsigned.status === 409, unsigned);
  const signed = await api({ contractCode: directCode, key: 'agent_balance_paid', value: 'yes' }, agentA.token);
  check('seal·서명·승인 증빙이 맞는 직접계약 차량 선점 허용', signed.status === 200, signed);
  const signedProduct = await db('v4/products/P-DIRECT-SIGNED');
  check('서명 완료 직접계약의 차량 lock은 자기 계약에 결속', signedProduct.locked_by_contract === directCode && signedProduct.vehicle_status === '계약중', signedProduct);

  console.log(`\nvehicle claim API integration: ${pass}/${pass} PASS`);
} finally {
  await Promise.all([stopNext(next), stopNext(offNext)]);
}
