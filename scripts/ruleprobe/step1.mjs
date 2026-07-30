/**
 * 1단계 봉합 규칙 검증 — 실제 에뮬레이터 REST로 200/401 확인.
 *
 * 실행:
 *   cd scripts/ruleprobe
 *   cp ../../database.rules.STEP1.json ./step1.rules.json
 *   npx firebase-tools@13 emulators:exec --project demo-freepasserp4 --only auth,database "node step1.mjs"
 *
 * 막아야 할 것 = 구멍. 통과해야 할 것 = 정당 경로(빠뜨리면 배포 후 조용히 기능이 죽는다).
 */
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
  assert.equal(r.ok, true, JSON.stringify(b));
  return { uid: b.localId, token: b.idToken };
}

async function db(path, { method = 'GET', token = 'owner', body, query = '' } = {}) {
  const authQ = token === 'owner' ? '' : `&auth=${encodeURIComponent(token)}`;
  const res = await fetch(`http://${dbHost}/${path}.json?ns=${encodeURIComponent(ns)}${authQ}${query}`, {
    method,
    headers: {
      ...(token === 'owner' ? { authorization: 'Bearer owner' } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  let p = null; try { p = t ? JSON.parse(t) : null; } catch { p = t; }
  return { status: res.status, body: p };
}

const results = [];
function check(name, actual, expect, note = '') {
  const ok = actual === expect;
  results.push({ ok, name, actual, expect, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (기대 ${expect} / 실제 ${actual})${note ? ' — ' + note : ''}`);
}

const admin = await signUp('s1-admin');
const provA = await signUp('s1-prova');
const provB = await signUp('s1-provb');
const agent = await signUp('s1-agent');
const pend = await signUp('s1-pending');

// 시드 — owner 권한으로 규칙 우회
await db('users', {
  method: 'PATCH', body: {
    [admin.uid]: { uid: admin.uid, role: 'admin', status: 'active' },
    [provA.uid]: { uid: provA.uid, role: 'provider', status: 'active', company_code: 'RP-001' },
    [provB.uid]: { uid: provB.uid, role: 'provider', status: 'active', company_code: 'RP-002' },
    [agent.uid]: { uid: agent.uid, role: 'agent', status: 'active', company_code: 'SP-001' },
    [pend.uid]: { uid: pend.uid, role: 'agent', status: 'pending' },
  },
});
await db('v4/products', {
  method: 'PATCH', body: {
    'M-000001': { product_code: 'M-000001', provider_company_code: 'RP-001', vehicle_status: '출고가능' },
    'M-000002': { product_code: 'M-000002', provider_company_code: 'RP-002', vehicle_status: '출고가능' },
    'M-ORPHAN': { product_code: 'M-ORPHAN', vehicle_status: '출고가능' },
  },
});

console.log('\n── 막아야 할 것 (구멍) ──');

// H1: 노드 전체 삭제·변조
check('H1-1 영업자가 v4/products 노드 통째 삭제',
  (await db('v4/products', { method: 'DELETE', token: agent.token })).status, 401);
check('H1-2 공급사가 v4/products 노드 통째 PUT',
  (await db('v4/products', { method: 'PUT', token: provA.token, body: { hacked: true } })).status, 401);
check('H1-3 공급사B가 남의 매물(RP-001) 가격 변조',
  (await db('v4/products/M-000001/price', { method: 'PUT', token: provB.token, body: { 12: { rent: 1 } } })).status, 401);
check('H1-4 공급사B가 자기코드 스탬프 동반 탈취 시도',
  (await db('v4/products/M-000001', {
    method: 'PATCH', token: provB.token,
    body: { provider_company_code: 'RP-002', vehicle_status: '출고불가' },
  })).status, 401, 'newData 기준이면 200(탈취) — data 기준이라 401');
check('H1-5 공급사가 자기 매물 소유코드 변경(이전 시도)',
  (await db('v4/products/M-000001/provider_company_code', { method: 'PUT', token: provA.token, body: 'RP-002' })).status, 401);
check('H1-6 영업자가 매물 삭제',
  (await db('v4/products/M-000001', { method: 'DELETE', token: agent.token })).status, 401);
check('H1-7 승인대기 계정이 매물 쓰기',
  (await db('v4/products/M-000001/vehicle_status', { method: 'PUT', token: pend.token, body: '출고불가' })).status, 401);

// H2: 자가삭제로 승인게이트 우회
check('H2-1 본인 users 노드 자가삭제',
  (await db(`users/${pend.uid}`, { method: 'DELETE', token: pend.token })).status, 401,
  'status 소멸 → 모든 pending 게이트 우회');
check('H2-2 status 삭제 후 매물 쓰기(우회 시도)', await (async()=>{ await db(`users/${agent.uid}/status`,{method:'DELETE',token:agent.token}); const r=await db('v4/products/M-000001/vehicle_status',{method:'PUT',token:agent.token,body:'출고불가'}); await db(`users/${agent.uid}/status`,{method:'PUT',token:'owner',body:'active'}); return r.status; })(), 401, 'status를 지워도 화이트리스트라 통과 못함');
check('H2-3 본인 role을 admin으로 승격',
  (await db(`users/${agent.uid}/role`, { method: 'PUT', token: agent.token, body: 'admin' })).status, 401);

console.log('\n── 통과해야 할 것 (정당 경로) ──');

check('L1 admin 매물 리프패치(타사 포함)',
  (await db('v4/products/M-000002/vehicle_status', { method: 'PUT', token: admin.token, body: '상품화중' })).status, 200);
check('L2 admin 고아매물 리프패치(/dev 일괄변환)',
  (await db('v4/products/M-ORPHAN/maker', { method: 'PUT', token: admin.token, body: '기아' })).status, 200);
check('L3 공급사 자기매물 리프패치(소유필드 미포함)',
  (await db('v4/products/M-000001/mileage', { method: 'PUT', token: provA.token, body: 1000 })).status, 200);
check('L4 공급사 신규매물 통째 PUT',
  (await db('v4/products/M-000009', {
    method: 'PUT', token: provA.token,
    body: { product_code: 'M-000009', provider_company_code: 'RP-001', vehicle_status: '상품화중' },
  })).status, 200);
check('L5 공급사 자기매물 소프트삭제',
  (await db('v4/products/M-000009', {
    method: 'PATCH', token: provA.token, body: { _deleted: true, deletedAt: '2026-07-30' },
  })).status, 200);
check('L6 영업자 락 4리프 원자 멀티패스(계약 진행)',
  (await db('v4/products/M-000001', {
    method: 'PATCH', token: agent.token,
    body: { vehicle_status: '출고불가', locked_by_contract: 'C-260730-01', _key: 'M-000001', updatedAt: '2026-07-30T00:00:00Z' },
  })).status, 200, '이게 막히면 딜 진행 전부 정지');
check('L7 영업자 락 해제',
  (await db('v4/products/M-000001', {
    method: 'PATCH', token: agent.token,
    body: { vehicle_status: '출고가능', locked_by_contract: '', _key: 'M-000001', updatedAt: '2026-07-30T00:01:00Z' },
  })).status, 200);
check('L8 본인 프로필 수정(이름·전화)',
  (await db(`users/${agent.uid}`, { method: 'PATCH', token: agent.token, body: { name: '홍길동', phone: '010-0000-0000' } })).status, 200);
check('L9 admin이 타인 승인(status 변경)',
  (await db(`users/${pend.uid}/status`, { method: 'PUT', token: admin.token, body: 'active' })).status, 200);
check('L10 admin이 회원 노드 삭제',
  (await db(`users/${pend.uid}`, { method: 'DELETE', token: admin.token })).status, 200);
check('L11 매물 목록 읽기(영업자)',
  (await db('v4/products', { token: agent.token })).status, 200);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.log('\n실패:');
  for (const f of failed) console.log(`  - ${f.name} (기대 ${f.expect} / 실제 ${f.actual})`);
  process.exit(1);
}
console.log('전 케이스 통과 — 게시 가능');
