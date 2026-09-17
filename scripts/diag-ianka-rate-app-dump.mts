/**
 * 진단 전용 — 이안카(EANCAR)는 Next.js RSC가 아니라 «Vite SPA»였다(2026-09-17 실측,
 * rolldown-runtime·framework-*.js 번들명으로 확인). 그리고 정확히 rate-app-*.js(138KB)·
 * quote-document-*.js 번들이 있고, quote-document 안에서 "500,000원" 매칭이 이미 나왔다.
 * 이 스크립트는 그 두 번들을 통째로 받아 실제 요금 호출 로직(fetch/axios URL, 상수 문자열,
 * "원"·"개월" 근처 문맥)을 뽑는다 — "/api/" 접두어가 없는 호출(다른 base URL과 조합)까지 잡으려고
 * 정규식을 "/api/" 한정에서 풀어 아무 경로 문자열이나 다 본다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-rate-app-dump.mts
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

const targets = [
  '/assets/rate-app-TlBSMRpG.js',
  '/assets/rate-app-fgBV3Yni.css',
  '/assets/quote-document-CAfLvxZz.js',
  '/assets/reservation-intake-form-DtmMC7TU.js',
];

for (const path of targets) {
  const text = await req(path);
  console.log(`\n========== ${path} (${text.length}자) ==========`);

  // 1) 아무 URL/경로처럼 보이는 문자열 리터럴(접두어 무관)
  const urlLike = [...text.matchAll(/["'`](\/[a-zA-Z0-9][a-zA-Z0-9/_.-]{2,80})["'`]/g)]
    .map((m) => m[1])
    .filter((s) => !s.match(/\.(png|jpg|jpeg|webp|svg|css|woff2?)$/i));
  const uniq = [...new Set(urlLike)];
  console.log(`  경로 비슷한 문자열 ${uniq.length}개:`);
  for (const u of uniq.slice(0, 60)) console.log(`    ${u}`);

  // 2) fetch(...) / axios.*(...) 호출부 주변 문맥
  const calls = [...text.matchAll(/(fetch|axios\.\w+|\.get\(|\.post\()\s*\(\s*([^)]{0,120})/g)];
  console.log(`  fetch/axios 호출부 ${calls.length}건:`);
  for (const c of calls.slice(0, 30)) console.log(`    ${c[1]}(${c[2]})`);

  // 3) "원"·"개월" 앞뒤 문맥(요금표/기간 관련 상수·템플릿일 가능성)
  const wonCtx = [...text.matchAll(/.{40}(?:개월|보증금|대여료|월요금|일요금|단기|장기).{40}/g)];
  console.log(`  "개월/보증금/대여료" 문맥 ${wonCtx.length}건:`);
  for (const c of wonCtx.slice(0, 20)) console.log(`    …${c[0]}…`);

  // 4) 도메인/베이스URL 상수 후보(다른 API 서버를 가리킬 수도 있음)
  const bases = [...new Set([...text.matchAll(/https?:\/\/[a-zA-Z0-9.-]+/g)].map((m) => m[0]))];
  console.log(`  등장하는 절대 URL 도메인 ${bases.length}개: ${bases.join(', ')}`);
}
