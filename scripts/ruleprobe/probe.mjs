import assert from 'node:assert/strict';

const projectId = process.env.GCLOUD_PROJECT || 'demo-freepasserp4';
const dbHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const ns = `${projectId}-default-rtdb`;

async function signUp(label) {
  const r = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${label}@example.test`, password: 'probe-password', returnSecureToken: true }),
  });
  const b = await r.json();
  assert.equal(r.ok, true, `signUp fail ${JSON.stringify(b)}`);
  return { uid: b.localId, token: b.idToken };
}

async function db(path, { method = 'GET', token = 'owner', body, query = '' } = {}) {
  const authQ = token === 'owner' ? '' : `&auth=${encodeURIComponent(token)}`;
  const url = `http://${dbHost}/${path}.json?ns=${encodeURIComponent(ns)}${authQ}${query}`;
  const res = await fetch(url, {
    method,
    headers: {
      ...(token === 'owner' ? { authorization: 'Bearer owner' } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  let parsed = null;
  try { parsed = t ? JSON.parse(t) : null; } catch { parsed = t; }
  return { status: res.status, body: parsed };
}

const results = [];
function check(name, actual, expected, note = '') {
  const ok = actual === expected;
  results.push({ ok, name, actual, expected, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${actual} vs ${expected}]  ${name}${note ? '  — ' + note : ''}`);
}

const admin = await signUp('admin');
const provA = await signUp('prova');
const provB = await signUp('provb');
const agent = await signUp('agent');
const agent2 = await signUp('agent2');
const pending = await signUp('pending');

// ---- seed (owner bypasses rules) ----
await db('users', {
  method: 'PATCH', body: {
    [admin.uid]: { uid: admin.uid, role: 'admin', status: 'active', user_code: 'ADM', company_code: '' },
    [provA.uid]: { uid: provA.uid, role: 'provider', status: 'active', user_code: 'PA', company_code: 'RP014' },
    [provB.uid]: { uid: provB.uid, role: 'provider', status: 'active', user_code: 'PB', company_code: 'RP023' },
    [agent.uid]: { uid: agent.uid, role: 'agent', status: 'active', user_code: 'AG1', agent_channel_code: 'CH1', company_code: 'SP999' },
    [agent2.uid]: { uid: agent2.uid, role: 'agent', status: 'active', user_code: 'AG2', agent_channel_code: 'CH2', company_code: 'SP999' },
    // ★ 구가입/레거시 재현: status 필드 자체가 없음
    [pending.uid]: { uid: pending.uid, role: 'agent', user_code: 'AGOLD', company_code: 'SP999' },
  },
});
await db('usersT', { method: 'PATCH', body: {
  [admin.uid]: { name: 'admin' }, [agent.uid]: { name: 'ag1', phone: '010' }, [agent2.uid]: { name: 'ag2' },
} });
await db('v4/contracts', { method: 'PATCH', body: {
  'CT-1': { contract_code: 'CT-1', agent_uid: agent.uid, provider_company_code: 'RP014' },
  'CT-2': { contract_code: 'CT-2', agent_uid: agent2.uid, provider_company_code: 'RP014' },
} });

async function reseedProducts(node) {
  await db(node, { method: 'PUT', body: {
    OWNED: { _key: 'OWNED', product_code: 'OWNED', provider_company_code: 'RP014', vehicle_status: '출고가능', price: { 12: { rent: 500000 } } },
    OTHER: { _key: 'OTHER', product_code: 'OTHER', provider_company_code: 'RP023', vehicle_status: '출고가능' },
    // ★ 949 고아 오버레이 재현: provider_company_code 없음(부분 패치 잔재)
    ORPHAN: { _key: 'ORPHAN', maker: '기아', _snapped: true, vehicle_status: '출고가능' },
  } });
}
await reseedProducts('v4/products');
await reseedProducts('v4/productsV');
await db('v4/products_private', { method: 'PUT', body: {
  OWNED: { _key: 'OWNED', product_code: 'OWNED', provider_company_code: 'RP014', vehicle_price: 30000000 },
} });

console.log('\n=== A. 영업자 락-write (자식 .write 4개) ===');
// T1 정확히 4리프 원자 멀티패스 (settlement-engine.ts:175 실제 페이로드)
check('T1 agent 4리프(vehicle_status,locked_by_contract,_key,updatedAt) 멀티패스 @v4',
  (await db('v4', { method: 'PATCH', token: agent.token, body: {
    'products/OTHER/vehicle_status': '계약중',
    'products/OTHER/locked_by_contract': 'CT-1',
    'products/OTHER/_key': 'OTHER',
    'products/OTHER/updatedAt': '2026-07-30T00:00:00.000Z',
  } })).status, 200, '남의 공급사 매물이라도 통과해야 딜이 진행됨');

// T2 provider_company_code가 섞이면? (rtdb-adapter.ts:521-524 주석의 사고)
check('T2 agent 4리프 + provider_company_code 섞임',
  (await db('v4', { method: 'PATCH', token: agent.token, body: {
    'products/OTHER/vehicle_status': '계약중',
    'products/OTHER/locked_by_contract': 'CT-1',
    'products/OTHER/_key': 'OTHER',
    'products/OTHER/updatedAt': '2026-07-30T00:00:01.000Z',
    'products/OTHER/provider_company_code': 'RP023',
  } })).status, 401, '한 리프만 막혀도 원자 write 전체가 실패');

// T3 _key/updatedAt 자식 .write가 없다면? → 같은 효과를 price 리프로 확인
check('T3 agent가 화이트리스트 밖 리프(price) 포함',
  (await db('v4', { method: 'PATCH', token: agent.token, body: {
    'products/OWNED/vehicle_status': '계약중',
    'products/OWNED/price/12/rent': 1,
  } })).status, 401, '락 4리프 외 필드는 차단');

// T4 agent 통째 set (하이재킹 시도)
check('T4 agent가 $code 통째 PUT',
  (await db('v4/products/OTHER', { method: 'PUT', token: agent.token, body: { _key: 'OTHER', vehicle_status: '계약중', provider_company_code: 'RP023' } })).status, 401);

// T5 agent가 updatedAt만 (아무 매물에나)
check('T5 agent가 updatedAt 리프만 write',
  (await db('v4/products/OWNED/updatedAt', { method: 'PUT', token: agent.token, body: 'x' })).status, 200, '부작용: 화이트리스트 리프는 전 매물 대상으로 열림');

console.log('\n=== B. provider 소유 판정 / newData 상속 ===');
await reseedProducts('v4/products');
// T6 자기 매물 통째 set (save() 경로)
check('T6 provider(RP014) 자기매물 통째 PUT',
  (await db('v4/products/NEW1', { method: 'PUT', token: provA.token, body: { _key: 'NEW1', product_code: 'NEW1', provider_company_code: 'RP014', vehicle_status: '출고가능' } })).status, 200);
// T7 남의 매물 통째 set
check('T7 provider(RP014)가 남의 코드로 통째 PUT',
  (await db('v4/products/NEW2', { method: 'PUT', token: provA.token, body: { _key: 'NEW2', provider_company_code: 'RP023' } })).status, 401);
// T8 ★ newData 상속: 소유필드 없는 리프 패치, 기존 data엔 소유필드 있음
check('T8 provider 자기매물 리프패치(소유필드 미포함) — newData 상속 여부',
  (await db('v4', { method: 'PATCH', token: provA.token, body: { 'products/OWNED/ext_color': '흰색', 'products/OWNED/updatedAt': 't1' } })).status, 200,
  '200이면 newData가 기존 형제필드를 상속 → 소유필드 승계스탬프 없어도 통과');
// T9 남의 매물 리프 패치
check('T9 provider(RP014)가 남의(RP023) 매물 리프패치',
  (await db('v4', { method: 'PATCH', token: provA.token, body: { 'products/OTHER/vehicle_status': '출고불가' } })).status, 401);
// T10 ★ 고아 오버레이(949건 재현) — 소유필드 미포함 패치
check('T10 provider가 고아 오버레이 리프패치(소유필드 미포함)',
  (await db('v4', { method: 'PATCH', token: provA.token, body: { 'products/ORPHAN/ext_color': '검정' } })).status, 401,
  '★949건 자동보정·시트패치가 여기서 죽는다');
// T11 고아 + 소유필드 스탬프 동반(어댑터 :525-529 승계) → 통과? = 무주공산 선점
check('T11 provider가 고아 오버레이에 자기 소유코드 스탬프 동반 패치',
  (await db('v4', { method: 'PATCH', token: provA.token, body: { 'products/ORPHAN/ext_color': '검정', 'products/ORPHAN/provider_company_code': 'RP014' } })).status, 200,
  '자가치유이자 남의차 선점(land-grab) 경로');
// T12 다른 provider가 같은 고아를 자기 것으로 선점
check('T12 다른 provider(RP023)가 같은 고아를 자기 코드로 선점',
  (await db('v4', { method: 'PATCH', token: provB.token, body: { 'products/ORPHAN/provider_company_code': 'RP023', 'products/ORPHAN/vehicle_status': '출고불가' } })).status, 401,
  'T11이 먼저 실행돼 이미 RP014 소유 → 이후엔 막힘');

console.log('\n=== C. products + products_private 원자 멀티패스(save 경로) ===');
check('T13 provider 자기매물 public+private 동시 PUT(멀티패스)',
  (await db('v4', { method: 'PATCH', token: provA.token, body: {
    'products/NEW3': { _key: 'NEW3', product_code: 'NEW3', provider_company_code: 'RP014' },
    'products_private/NEW3': { _key: 'NEW3', product_code: 'NEW3', provider_company_code: 'RP014', vehicle_price: 1000 },
  } })).status, 200);
check('T14 admin 자기 아닌 회사 public+private 동시 PUT',
  (await db('v4', { method: 'PATCH', token: admin.token, body: {
    'products/NEW4': { _key: 'NEW4', provider_company_code: 'RP023' },
    'products_private/NEW4': { _key: 'NEW4', provider_company_code: 'RP023', vehicle_price: 1000 },
  } })).status, 200);

console.log('\n=== D. status 화이트리스트(active) 영향 ===');
check('T15 status 필드 자체가 없는 구가입 계정의 매물 write',
  (await db('v4', { method: 'PATCH', token: pending.token, body: { 'products/OWNED/vehicle_status': '계약중' } })).status, 401,
  '★블랙리스트(!==pending)에서는 통과하던 계정');

console.log('\n=== E. locked_by_contract 교차검증 .validate (productsV) ===');
check('T16 agent가 자기 계약(CT-1)으로 락',
  (await db('v4', { method: 'PATCH', token: agent.token, body: {
    'productsV/OTHER/vehicle_status': '계약중', 'productsV/OTHER/locked_by_contract': 'CT-1',
    'productsV/OTHER/_key': 'OTHER', 'productsV/OTHER/updatedAt': 't',
  } })).status, 200);
check('T17 agent가 남의 계약(CT-2)으로 락 시도',
  (await db('v4', { method: 'PATCH', token: agent.token, body: {
    'productsV/OWNED/vehicle_status': '계약중', 'productsV/OWNED/locked_by_contract': 'CT-2',
    'productsV/OWNED/_key': 'OWNED', 'productsV/OWNED/updatedAt': 't',
  } })).status, 401, '계약 소유 교차검증이 실제로 작동');
check('T18 agent 락 해제(locked_by_contract="")',
  (await db('v4', { method: 'PATCH', token: agent.token, body: {
    'productsV/OTHER/vehicle_status': '출고가능', 'productsV/OTHER/locked_by_contract': '',
    'productsV/OTHER/_key': 'OTHER', 'productsV/OTHER/updatedAt': 't2',
  } })).status, 200);
check('T19 admin이 락 해제/재시도(2필드만)',
  (await db('v4', { method: 'PATCH', token: admin.token, body: {
    'productsV/OTHER/vehicle_status': '출고불가', 'productsV/OTHER/locked_by_contract': 'CT-2',
  } })).status, 200, 'admin 재시도 경로 보존');
check('T20 vehicle_status 허용값 밖',
  (await db('v4/productsV/OTHER/vehicle_status', { method: 'PUT', token: agent.token, body: '아무거나' })).status, 401);

console.log('\n=== F. users 노드 .read 제거 → $uid 자식 read ===');
check('T21 usersT 노드 통째 GET(비관리자)', (await db('usersT', { token: agent.token })).status, 401, '전량 덤프 차단');
check('T22 usersT 본인 단건 GET', (await db(`usersT/${agent.uid}`, { token: agent.token })).status, 200, 'auth.ts:75 로그인 경로 생존');
check('T23 usersT 타인 단건 GET(agent→agent2)', (await db(`usersT/${agent2.uid}`, { token: agent.token })).status, 401, '★/q 귀속·resolveRates가 여기서 죽음');
check('T24 usersT 노드 통째 GET(admin)', (await db('usersT', { token: admin.token })).status, 200, '/members 생존');
check('T25 usersT 무인증 단건 GET', (await db(`usersT/${agent.uid}`, { token: 'anon-none' })).status, 401, '손님 /q 는 어차피 못 읽음');
check('T26 usersT 노드 read 없이 자식 read만으로 orderBy 쿼리',
  (await db('usersT', { token: agent.token, query: '&orderBy=%22user_code%22&equalTo=%22AG2%22' })).status, 401,
  '인덱스/쿼리로도 우회 불가');

console.log('\n=== G. 롤백 안전성: 노드 .write 복구 시 ===');
// 규칙만 되돌린 상태를 흉내: products 노드에 .write 없음 → 여기선 검증 불가. 대신 자식 .write 잔존 확인
check('T27 agent가 락 4리프 재실행(규칙 유지)',
  (await db('v4', { method: 'PATCH', token: agent.token, body: {
    'products/OWNED/vehicle_status': '출고가능', 'products/OWNED/locked_by_contract': '',
    'products/OWNED/_key': 'OWNED', 'products/OWNED/updatedAt': 't9',
  } })).status, 200);

const fails = results.filter((r) => !r.ok);
console.log(`\n총 ${results.length} · 예상과 다름 ${fails.length}`);
for (const f of fails) console.log(`  ! ${f.name}: 실제 ${f.actual}, 예상 ${f.expected}`);
