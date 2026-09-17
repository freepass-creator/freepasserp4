/**
 * 진단 전용 — 이안카(EANCAR) 요금 조회 API를 JS 번들 안에서 찾는다.
 * /api/rates 는 관리자 전용 «쓰기»(기준요금표 교체) API였다(2026-09-17 diag-ianka-period-filter.mts 실측,
 * GET·POST 다 403 "관리자 권한/최고관리자만"). 조회용 별도 경로가 있을 가능성이 높다 —
 * 홈 HTML의 <link rel="modulepreload">·<script> 경로를 다 모아 실제 JS 파일을 받아서
 * "/api/" 로 시작하는 문자열 리터럴을 전부 뽑는다(fetch("/api/xxx") 호출부를 찾는 방식).
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-js-bundle-scan.mts
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

async function req(path: string): Promise<string> {
  const res = await fetch(path.startsWith('http') ? path : `${HOME}${path}`, {
    headers: { 'User-Agent': 'FreepassERP/4 diag (readonly)', Cookie: cookies.join('; ') },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  mergeCookies(res);
  const text = await res.text();
  console.log(`GET ${path} → ${res.status} (길이 ${text.length}자)`);
  return text;
}

// 1) 로그인
await req('/login');
const loginRes = await fetch(`${HOME}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookies.join('; ') },
  body: JSON.stringify({ login: account.email, password: account.password }),
});
mergeCookies(loginRes);
console.log(`로그인 → ${loginRes.status}`);
if (!loginRes.ok) process.exit(1);

// 2) 인증된 홈 HTML — script/modulepreload/link 경로를 모조리 모은다
const home = await req('/');
const jsPaths = new Set<string>();
for (const m of home.matchAll(/(?:href|src)="([^"]+\.(?:js|mjs))"/gi)) jsPaths.add(m[1]);
console.log(`\n■ 홈 HTML에서 찾은 JS 경로 ${jsPaths.size}개`);
for (const p of jsPaths) console.log(`  ${p}`);

// 3) 각 JS 파일을 받아서 "/api/..." 문자열 리터럴을 전부 뽑는다
const allApiPaths = new Map<string, Set<string>>();
for (const jsPath of jsPaths) {
  let text = '';
  try {
    text = await req(jsPath);
  } catch (e) {
    console.log(`  ↳ ${jsPath} 못 받음: ${(e as Error).message}`);
    continue;
  }
  const found = new Set<string>();
  for (const m of text.matchAll(/["'`](\/api\/[a-zA-Z0-9/_-]+)["'`]/g)) found.add(m[1]);
  if (found.size) allApiPaths.set(jsPath, found);
}

console.log(`\n■ JS 파일에서 발견된 /api/ 경로들`);
const allPaths = new Set<string>();
for (const [file, paths] of allApiPaths) {
  console.log(`  [${file}]`);
  for (const p of paths) {
    console.log(`    ${p}`);
    allPaths.add(p);
  }
}

// 4) rate/price/quote/fare/fee 비슷한 이름만 따로 추려서 실제로 두들겨본다(GET)
const rateLike = [...allPaths].filter((p) => /rate|price|quote|fare|fee|요금/i.test(p));
console.log(`\n■ 요금 비슷한 경로 후보 ${rateLike.length}개 — 직접 두들겨본다`);
for (const p of rateLike) {
  try {
    const text = await req(p);
    console.log(`    표본: ${text.slice(0, 300)}`);
  } catch (e) {
    console.log(`    에러: ${(e as Error).message}`);
  }
}
