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
  const [agentA, agentB, provider, outsider] = await Promise.all([
    signUp('claim-agent-a'), signUp('claim-agent-b'), signUp('claim-provider'), signUp('claim-outsider'),
  ]);
  await db('users', { method: 'PUT', body: {
    [agentA.uid]: { role: 'agent', status: 'active', user_code: 'AG-A', agent_channel_code: 'CH-A' },
    [agentB.uid]: { role: 'agent', status: 'active', user_code: 'AG-B', agent_channel_code: 'CH-B' },
    [provider.uid]: { role: 'provider', status: 'active', user_code: 'PV-A', company_code: 'SUP-A' },
    [outsider.uid]: { role: 'agent', status: 'active', user_code: 'AG-X', agent_channel_code: 'CH-X' },
  } });
  const contract = (code, productCode, agent) => ({
    contract_code: code, contract_status: '계약요청', contract_date: '2026-08-04',
    product_code: productCode, car_number_snapshot: '33다3333', maker_snapshot: '현대', model_snapshot: '쏘나타',
    customer_name: '테스트', customer_phone: '010-0000-0000',
    agent_uid: agent.uid, agent_code: agent === agentA ? 'AG-A' : 'AG-B',
    agent_channel_code: agent === agentA ? 'CH-A' : 'CH-B', provider_company_code: 'SUP-A',
  });
  await db('v4', { method: 'PUT', body: {
    products: {
      'P-A': { product_code: 'P-A', car_number: '33다3333', provider_company_code: 'SUP-A', vehicle_status: '출고가능', locked_by_contract: '' },
      'P-B': { product_code: 'P-B', car_number: '33다3333', provider_company_code: 'SUP-A', vehicle_status: '출고가능', locked_by_contract: '' },
    },
    contracts: { 'C-A': contract('C-A', 'P-A', agentA), 'C-B': contract('C-B', 'P-B', agentB) },
  } });

  const unauth = await api({ contractCode: 'C-A', key: 'agent_balance_paid', value: 'yes' });
  check('무인증 API 차단', unauth.status === 401, unauth);
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

  console.log(`\nvehicle claim API integration: ${pass}/${pass} PASS`);
} finally {
  await Promise.all([stopNext(next), stopNext(offNext)]);
}
