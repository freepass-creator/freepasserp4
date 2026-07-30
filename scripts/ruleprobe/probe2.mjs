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
  const b = await r.json(); assert.equal(r.ok, true, JSON.stringify(b));
  return { uid: b.localId, token: b.idToken };
}
async function db(path, { method = 'GET', token = 'owner', body, query = '' } = {}) {
  const authQ = token === 'owner' ? '' : `&auth=${encodeURIComponent(token)}`;
  const res = await fetch(`http://${dbHost}/${path}.json?ns=${encodeURIComponent(ns)}${authQ}${query}`, {
    method,
    headers: { ...(token === 'owner' ? { authorization: 'Bearer owner' } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text(); let p = null; try { p = t ? JSON.parse(t) : null; } catch { p = t; }
  return { status: res.status, body: p };
}
const results = [];
function check(name, actual, expected, note = '') {
  const ok = actual === expected; results.push({ ok, name, actual, expected });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${actual} vs ${expected}]  ${name}${note ? '  — ' + note : ''}`);
}

const admin = await signUp('admin'), provA = await signUp('prova'), provB = await signUp('provb');
const agent = await signUp('agent'), agent2 = await signUp('agent2'), old = await signUp('old');

await db('users', { method: 'PATCH', body: {
  [admin.uid]: { uid: admin.uid, role: 'admin', status: 'active', user_code: 'ADM' },
  [provA.uid]: { uid: provA.uid, role: 'provider', status: 'active', user_code: 'PA', company_code: 'RP014' },
  [provB.uid]: { uid: provB.uid, role: 'provider', status: 'active', user_code: 'PB', company_code: 'RP023' },
  [agent.uid]: { uid: agent.uid, role: 'agent', status: 'active', user_code: 'AG1' },
  [agent2.uid]: { uid: agent2.uid, role: 'agent', status: 'active', user_code: 'AG2' },
  [old.uid]: { uid: old.uid, role: 'agent', user_code: 'AGOLD' },
} });
await db('usersT2', { method: 'PATCH', body: {
  [admin.uid]: { name: 'admin' }, [agent.uid]: { name: 'ag1', phone: '010-1' }, [agent2.uid]: { name: 'ag2' },
} });
const seed = async () => db('v4/products', { method: 'PUT', body: {
  OWNED: { _key: 'OWNED', provider_company_code: 'RP014', vehicle_status: '출고가능', price: { 12: { rent: 1 } } },
  OTHER: { _key: 'OTHER', provider_company_code: 'RP023', vehicle_status: '출고가능' },
  ORPHAN: { _key: 'ORPHAN', maker: '기아', _snapped: true, vehicle_status: '출고가능' },
} });
await seed();

console.log('\n=== H. data 기준 소유판정(적대적 탈취 차단) ===');
check('P1 provA가 남의(RP023) 매물에 자기코드 스탬프 동반 패치 = 탈취시도',
  (await db('v4', { method: 'PATCH', token: provA.token, body: { 'products/OTHER/vehicle_status': '출고불가', 'products/OTHER/provider_company_code': 'RP014' } })).status, 401,
  'newData 기준 규칙이었으면 200이었음(probe1 T12)');
check('P2 provA 자기매물 리프패치(소유필드 미포함)',
  (await db('v4', { method: 'PATCH', token: provA.token, body: { 'products/OWNED/ext_color': '흰색', 'products/OWNED/updatedAt': 't' } })).status, 200);
check('P3 provA 신규 매물 통째 PUT',
  (await db('v4/products/NEW1', { method: 'PUT', token: provA.token, body: { _key: 'NEW1', provider_company_code: 'RP014' } })).status, 200);
check('P4 provA가 고아(소유필드 없음) 매물에 자기코드 스탬프 = 선점',
  (await db('v4', { method: 'PATCH', token: provA.token, body: { 'products/ORPHAN/ext_color': '검정', 'products/ORPHAN/provider_company_code': 'RP014' } })).status, 200,
  '★무주공산 500대 선점 가능 — 정책 판단 필요');
check('P5 provB가 이미 선점된 고아를 재탈취',
  (await db('v4', { method: 'PATCH', token: provB.token, body: { 'products/ORPHAN/provider_company_code': 'RP023' } })).status, 401);
await seed();
check('P6 provA가 고아 매물 리프패치(스탬프 없음) = 자동 색보정 경로',
  (await db('v4', { method: 'PATCH', token: provA.token, body: { 'products/ORPHAN/ext_color': '검정' } })).status, 401,
  '★949건: 어댑터가 소유코드를 못 붙이면 죽는다');
check('P7 admin이 고아 매물 리프패치(스탬프 없음) = /dev 일괄변환',
  (await db('v4', { method: 'PATCH', token: admin.token, body: { 'products/ORPHAN/maker': '현대', 'products/ORPHAN/_key': 'ORPHAN', 'products/ORPHAN/updatedAt': 't' } })).status, 200);
check('P8 provA가 자기매물 통째 PUT으로 소유코드 변경 시도',
  (await db('v4/products/OWNED', { method: 'PUT', token: provA.token, body: { _key: 'OWNED', provider_company_code: 'RP014' } })).status, 200, '자기코드 유지는 통과');
check('P9 agent 락 4리프(data기준 규칙 아래서도 유지)',
  (await db('v4', { method: 'PATCH', token: agent.token, body: {
    'products/OTHER/vehicle_status': '계약중', 'products/OTHER/locked_by_contract': 'CT-1',
    'products/OTHER/_key': 'OTHER', 'products/OTHER/updatedAt': 't' } })).status, 200);
check('P10 admin이 소유코드 변경(공급사 재배정)',
  (await db('v4', { method: 'PATCH', token: admin.token, body: { 'products/OTHER/provider_company_code': 'RP014' } })).status, 200);

console.log('\n=== I. users: 노드 admin read + $uid self read ===');
check('P11 admin 노드 통째 GET', (await db('usersT2', { token: admin.token })).status, 200, '/members 생존 — 노드 .read를 admin으로 남겨야 함');
check('P12 agent 노드 통째 GET', (await db('usersT2', { token: agent.token })).status, 401);
check('P13 agent 본인 단건 GET', (await db(`usersT2/${agent.uid}`, { token: agent.token })).status, 200);
check('P14 agent 타인 단건 GET', (await db(`usersT2/${agent2.uid}`, { token: agent.token })).status, 401);
check('P15 본인 노드 DELETE(newData.exists() 가드)', (await db(`usersT2/${agent.uid}`, { method: 'DELETE', token: agent.token })).status, 401);
check('P16 본인 프로필 PATCH', (await db(`usersT2/${agent.uid}`, { method: 'PATCH', token: agent.token, body: { phone: '010-9' } })).status, 200);
check('P17 admin이 타인 노드 DELETE', (await db(`usersT2/${agent2.uid}`, { method: 'DELETE', token: admin.token })).status, 401, 'admin도 하드삭제 불가(소프트삭제만)');

console.log('\n=== J. agent_public 대체노드 ===');
await db('agent_public', { method: 'PUT', body: { AG1: { name: '김영업', phone: '010-1111-2222', active: true } } });
check('P18 무인증 단건 read(손님 /q)', (await db('agent_public/AG1', { token: 'none' })).status, 200);
check('P19 무인증 노드 통째 덤프', (await db('agent_public', { token: 'none' })).status, 401);
check('P20 로그인 사용자 노드 통째 덤프', (await db('agent_public', { token: agent.token })).status, 401);
check('P21 본인 코드 write', (await db('agent_public/AG1', { method: 'PATCH', token: agent.token, body: { name: '김영업', phone: '010-3' } })).status, 200);
check('P22 남의 코드 write', (await db('agent_public/AG2', { method: 'PATCH', token: agent.token, body: { name: '해킹' } })).status, 401);
check('P23 금지필드(email) 포함 write', (await db('agent_public/AG1', { method: 'PATCH', token: agent.token, body: { name: 'x', email: 'a@b.c' } })).status, 401);
check('P24 admin이 임의 코드 발행(백필)', (await db('agent_public/AG2', { method: 'PUT', token: admin.token, body: { name: '박영업', active: true } })).status, 200);

const fails = results.filter((r) => !r.ok);
console.log(`\n총 ${results.length} · 예상과 다름 ${fails.length}`);
for (const f of fails) console.log(`  ! ${f.name}: 실제 ${f.actual}, 예상 ${f.expected}`);
