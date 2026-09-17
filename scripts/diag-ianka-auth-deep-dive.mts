/**
 * 진단 전용 — 사장님이 실제 브라우저로 pyh@teamjpk.com 로그인해서 요금이 «보인다»고
 * 확인했다. 그런데 우리 스크립트는 /api/rates에서 403 "관리자 권한이 필요합니다"를
 * 받는다 — 즉 계정 권한 문제가 아니라 우리 fetch 흐름이 실제 브라우저 세션과 다르다는
 * 뜻이다. 로그인 응답 전체(바디+쿠키 전부)와 /api/rates 403 응답 헤더, 그리고
 * /api/admin?scope=permissions 응답을 다 까본다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-auth-deep-dive.mts
 */
const HOME = 'https://xn--le5bt3bwxk.com';
const account = JSON.parse(process.env.IANKA_ACCOUNT_JSON || '{}') as { email?: string; password?: string };
if (!account.email || !account.password) throw new Error('IANKA_ACCOUNT_JSON에 email/password가 없다');

let cookies: string[] = [];
function mergeCookies(res: Response) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    console.log(`  Set-Cookie: ${c}`);
    const pair = c.split(';')[0];
    const name = pair.split('=')[0];
    cookies = cookies.filter((existing) => !existing.startsWith(`${name}=`));
    cookies.push(pair);
  }
}

function dumpHeaders(res: Response) {
  for (const [k, v] of res.headers.entries()) console.log(`  ${k}: ${v}`);
}

// 1) 홈 방문(초기 쿠키 확보)
const home0 = await fetch(`${HOME}/login`, { headers: { 'User-Agent': 'Mozilla/5.0 FreepassERP diag' } });
mergeCookies(home0);
console.log(`GET /login → ${home0.status}`);

// 2) 로그인 — 브라우저처럼 Referer/Origin/Accept 헤더 다 붙여서
console.log('\n■ 로그인 요청');
const loginRes = await fetch(`${HOME}/api/auth/login`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    Origin: HOME,
    Referer: `${HOME}/login`,
    'User-Agent': 'Mozilla/5.0 FreepassERP diag',
    Cookie: cookies.join('; '),
  },
  body: JSON.stringify({ login: account.email, password: account.password }),
});
console.log(`POST /api/auth/login → ${loginRes.status}`);
console.log('■ 응답 헤더:');
dumpHeaders(loginRes);
mergeCookies(loginRes);
const loginBody = await loginRes.text();
console.log(`■ 응답 바디: ${loginBody}`);
console.log(`■ 지금까지 모은 쿠키(${cookies.length}개): ${cookies.map((c) => c.split('=')[0]).join(', ')}`);
if (!loginRes.ok) process.exit(1);

// 3) /api/admin?scope=permissions — 우리 role/권한이 뭔지 직접 물어본다
console.log('\n■ GET /api/admin?scope=permissions');
const permRes = await fetch(`${HOME}/api/admin?scope=permissions`, {
  headers: { 'User-Agent': 'Mozilla/5.0 FreepassERP diag', Accept: 'application/json, text/plain, */*', Referer: `${HOME}/`, Cookie: cookies.join('; ') },
  cache: 'no-store',
});
mergeCookies(permRes);
console.log(`→ ${permRes.status}`);
console.log(await permRes.text());

// 4) /api/members — 내 회원 정보(role 포함 가능성)
console.log('\n■ GET /api/members');
const memRes = await fetch(`${HOME}/api/members`, {
  headers: { 'User-Agent': 'Mozilla/5.0 FreepassERP diag', Accept: 'application/json, text/plain, */*', Referer: `${HOME}/`, Cookie: cookies.join('; ') },
  cache: 'no-store',
});
mergeCookies(memRes);
console.log(`→ ${memRes.status}`);
console.log((await memRes.text()).slice(0, 2000));

// 5) /api/rates — 이번엔 Referer/Accept/Origin까지 브라우저처럼 다 붙여서
console.log('\n■ GET /api/rates (브라우저 헤더 흉내)');
const ratesRes = await fetch(`${HOME}/api/rates`, {
  headers: {
    'User-Agent': 'Mozilla/5.0 FreepassERP diag',
    Accept: 'application/json, text/plain, */*',
    Referer: `${HOME}/`,
    Origin: HOME,
    Cookie: cookies.join('; '),
  },
  cache: 'no-store',
});
console.log(`→ ${ratesRes.status}`);
console.log('■ 응답 헤더:');
dumpHeaders(ratesRes);
console.log('■ 바디:', (await ratesRes.text()).slice(0, 1000));
