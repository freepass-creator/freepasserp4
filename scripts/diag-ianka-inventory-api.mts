/**
 * 진단 전용 — 이안카(https://xn--le5bt3bwxk.com/) 로그인 뒤 GET /api/inventory 응답 구조를 본다.
 * 2026-09-17 diag-ianka-login-playwright.mts 실측: 로그인은 POST /api/auth/login
 * (body {login,password}) → 200, eancar_session 쿠키 발급. 이후 /api/inventory 를 부른다.
 * 비밀번호는 로그에 안 찍는다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-inventory-api.mts
 */
const HOME = 'https://xn--le5bt3bwxk.com';
const account = JSON.parse(process.env.IANKA_ACCOUNT_JSON || '{}') as { email?: string; password?: string };
if (!account.email || !account.password) throw new Error('IANKA_ACCOUNT_JSON에 email/password가 없다');

let cookies: string[] = [];
function mergeCookies(res: Response) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const pair = c.split(';')[0];
    const name = pair.split('=')[0];
    cookies = cookies.filter((existing) => !existing.startsWith(`${name}=`));
    cookies.push(pair);
  }
}

async function req(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${HOME}${path}`, {
    method,
    headers: {
      'User-Agent': 'FreepassERP/4 diag (readonly)',
      Cookie: cookies.join('; '),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  mergeCookies(res);
  console.log(`${method} ${path} → ${res.status}`);
  return res;
}

// 1) 홈에서 첫 쿠키(Cloudflare 등) 확보
await req('GET', '/login');

// 2) 로그인
const loginRes = await req('POST', '/api/auth/login', { login: account.email, password: account.password });
console.log(`■ 로그인 응답 헤더 content-type: ${loginRes.headers.get('content-type')}`);
const loginBody = await loginRes.text();
console.log(`■ 로그인 응답 본문(앞 500자): ${loginBody.slice(0, 500)}`);
console.log(`■ 쿠키: ${cookies.map((c) => c.split('=')[0]).join(', ')}`);

if (!loginRes.ok) {
  console.log('■ 로그인 실패 — 중단');
  process.exit(1);
}

// 3) 재고 API
const invRes = await req('GET', '/api/inventory');
const invText = await invRes.text();
console.log(`■ /api/inventory 응답 길이: ${invText.length}자`);
console.log(`■ /api/inventory 응답(앞 3000자):\n${invText.slice(0, 3000)}`);

try {
  const parsed = JSON.parse(invText);
  if (Array.isArray(parsed)) {
    console.log(`■ 최상위: 배열, 길이=${parsed.length}`);
    console.log(`■ 첫 항목 키: ${Object.keys(parsed[0] || {}).join(', ')}`);
  } else if (parsed && typeof parsed === 'object') {
    console.log(`■ 최상위 키: ${Object.keys(parsed).join(', ')}`);
    for (const k of Object.keys(parsed)) {
      const v = (parsed as Record<string, unknown>)[k];
      if (Array.isArray(v)) {
        console.log(`  ${k}: 배열 길이=${v.length}, 첫 항목 키=${Object.keys(v[0] || {}).join(', ')}`);
      }
    }
  }
} catch (e) {
  console.log(`■ JSON 파싱 실패: ${(e as Error).message}`);
}
