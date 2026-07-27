import assert from 'node:assert/strict';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-freepasserp4';
const databaseHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const namespace = `${projectId}-default-rtdb`;

async function signUp(label) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `${label}@example.test`,
      password: 'rules-test-password',
      returnSecureToken: true,
    }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, `Auth Emulator signup failed: ${JSON.stringify(body)}`);
  return { uid: body.localId, token: body.idToken };
}

async function databaseRequest(path, { method = 'GET', token = 'owner', body } = {}) {
  const authQuery = token === 'owner' ? '' : `&auth=${encodeURIComponent(token)}`;
  const response = await fetch(`http://${databaseHost}/${path}.json?ns=${encodeURIComponent(namespace)}${authQuery}`, {
    method,
    headers: {
      ...(token === 'owner' ? { authorization: 'Bearer owner' } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function settlementPatch(code, { agentCode = 'AG-1', channelCode = 'CH-1', providerCode = 'RP014', admin = false } = {}) {
  const common = {
    _key: code,
    settlement_code: code,
    contract_code: `CT_${code}`,
    settlement_status: '정산대기',
    provider_company_code: providerCode,
    agent_code: agentCode,
    agent_channel_code: channelCode,
  };
  const patch = {
    [`settlements/${code}`]: { ...common, rent_amount: 890000 },
    [`settlements_provider_private/${code}`]: { ...common, fee_rate: 0.1, fee_amount: 89000 },
    [`settlements_agent_private/${code}`]: { ...common, agent_payout: 35600 },
  };
  if (admin) {
    patch[`settlements_admin_private/${code}`] = {
      _key: code,
      settlement_code: code,
      net_amount: 53400,
    };
  }
  return patch;
}

const admin = await signUp('admin');
const provider = await signUp('provider');
const outsider = await signUp('outsider');

const seed = await databaseRequest('users', {
  method: 'PUT',
  body: {
    [admin.uid]: { role: 'admin', status: 'active', user_code: 'ADMIN' },
    [provider.uid]: { role: 'provider', status: 'active', user_code: 'PV-1', company_code: 'RP014' },
    [outsider.uid]: { role: 'agent', status: 'active', user_code: 'AG-OUT', agent_channel_code: 'CH-OUT' },
  },
});
assert.equal(seed.status, 200, `seed failed: ${JSON.stringify(seed.body)}`);

const adminWrite = await databaseRequest('v4', {
  method: 'PATCH',
  token: admin.token,
  body: settlementPatch('ST_ADMIN', { admin: true }),
});
assert.equal(adminWrite.status, 200, `admin settlement write should pass: ${JSON.stringify(adminWrite.body)}`);

const providerWrite = await databaseRequest('v4', {
  method: 'PATCH',
  token: provider.token,
  body: settlementPatch('ST_PROVIDER'),
});
assert.equal(providerWrite.status, 200, `own provider settlement write should pass: ${JSON.stringify(providerWrite.body)}`);

const outsiderWrite = await databaseRequest('v4', {
  method: 'PATCH',
  token: outsider.token,
  body: settlementPatch('ST_OUTSIDER', { agentCode: 'AG-OTHER', channelCode: 'CH-OTHER' }),
});
assert.equal(outsiderWrite.status, 401, `unrelated agent settlement write should be denied: ${JSON.stringify(outsiderWrite.body)}`);

const incompleteWrite = await databaseRequest('v4', {
  method: 'PATCH',
  token: admin.token,
  body: {
    'settlements/ST_INCOMPLETE': {
      settlement_code: 'ST_INCOMPLETE',
      contract_code: 'CT_INCOMPLETE',
      settlement_status: '정산대기',
      provider_company_code: 'RP014',
    },
  },
});
assert.equal(incompleteWrite.status, 401, `settlement missing ownership fields should be denied: ${JSON.stringify(incompleteWrite.body)}`);

console.log('settlement Rules Emulator: 4/4 PASS');
