/**
 * 비활성·삭제·반려 계정이 **서버에서** 막히는지 (QA AUTH-6).
 *
 * 앱 게이트(lib/auth-session.ts isBlocked)만으로는 부족하다 — API 를 직접 때리면 그대로 뚫린다.
 * 이 프로브는 실제 에뮬레이터에 계정을 만들고 REST 로 요청해 200/401 을 직접 본다.
 *
 * 핵심: **필드가 없는 기존 회원(157명)은 계속 통과해야 한다.** 그들을 잠그면 전원 로그아웃이다.
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

// 같은 회사(RP014) 공급사 6명 — is_active/status 만 다르게 두고 결과를 비교한다.
const okStr = await signUp('act-yes');     // is_active: '예'
const okBool = await signUp('act-true');   // is_active: true
const legacy = await signUp('act-none');   // 필드 없음 ← 기존 157명
const offStr = await signUp('act-no');     // is_active: '아니오'  ← 회원관리 UI 가 쓰는 값
const offBool = await signUp('act-false'); // is_active: false     ← 정리 스크립트가 쓴 값
const del = await signUp('st-deleted');    // status: 'deleted'
const rej = await signUp('st-rejected');   // status: 'rejected'

const base = { role: 'provider', company_code: 'RP014' };
await db('users', { method: 'PATCH', body: {
  [okStr.uid]:  { uid: okStr.uid,  ...base, status: 'active', is_active: '예' },
  [okBool.uid]: { uid: okBool.uid, ...base, status: 'active', is_active: true },
  [legacy.uid]: { uid: legacy.uid, ...base, status: 'active' },
  [offStr.uid]: { uid: offStr.uid, ...base, status: 'active', is_active: '아니오' },
  [offBool.uid]:{ uid: offBool.uid,...base, status: 'active', is_active: false },
  [del.uid]:    { uid: del.uid,    ...base, status: 'deleted' },
  [rej.uid]:    { uid: rej.uid,    ...base, status: 'rejected' },
} });

await db('v4/rooms', { method: 'PUT', body: {
  R1: { _key: 'R1', provider_company_code: 'RP014', agent_uid: 'someone', agent_channel_code: 'CH1' },
} });

const readRooms = (t) => db('v4/rooms', { token: t, query: '&orderBy=%22provider_company_code%22&equalTo=%22RP014%22' });

console.log('=== 통과해야 하는 것 ===');
check('A1 is_active "예"',        (await readRooms(okStr.token)).status, 200);
check('A2 is_active true',        (await readRooms(okBool.token)).status, 200);
check('A3 필드 없음(기존 회원)',  (await readRooms(legacy.token)).status, 200, '157명 — 잠그면 전원 로그아웃');

console.log('\n=== 막혀야 하는 것 ===');
check('B1 is_active "아니오"',    (await readRooms(offStr.token)).status, 401, '회원관리 UI 값');
check('B2 is_active false',       (await readRooms(offBool.token)).status, 401, '정리 스크립트 값');
check('B3 status deleted',        (await readRooms(del.token)).status, 401);
check('B4 status rejected',       (await readRooms(rej.token)).status, 401);

console.log('\n=== 쓰기도 막히는가 ===');
const w = (t) => db('v4/rooms/R1', { method: 'PATCH', token: t, body: { last_message: 'x' } });
check('C1 활성 공급사 쓰기',      (await w(okStr.token)).status, 200);
check('C2 비활성 공급사 쓰기',    (await w(offStr.token)).status, 401);
check('C3 삭제 공급사 쓰기',      (await w(del.token)).status, 401);

const bad = results.filter((r) => !r.ok);
console.log(`\n총 ${results.length} · 실패 ${bad.length}`);
for (const b of bad) console.log(`  ! ${b.name}: 실제 ${b.actual}, 예상 ${b.expected}`);
process.exitCode = bad.length ? 1 : 0;
