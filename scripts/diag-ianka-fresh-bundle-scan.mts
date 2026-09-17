/**
 * 진단 전용 — 이전 스캔에서 딴 자산 파일명(index-C5VsXIGz.js 등)이 404 났다. 사이트가
 * 재배포되면서 Vite 해시가 바뀐 것으로 보인다. 이번엔 홈에서 «지금» 링크를 새로 받아
 * 전체 JS 번들을 다 훑는다 — fetch/axios 호출부·"/api/" 아닌 경로 문자열·".terms" 문맥·
 * "원"/"개월" 근처 텍스트까지 전부.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-fresh-bundle-scan.mts
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

async function req(path: string): Promise<{ res: Response; text: string }> {
  const res = await fetch(path.startsWith('http') ? path : `${HOME}${path}`, {
    headers: { 'User-Agent': 'FreepassERP/4 diag (readonly)', Cookie: cookies.join('; ') },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  mergeCookies(res);
  const text = await res.text();
  console.log(`GET ${path} → ${res.status} (길이 ${text.length}자)`);
  return { res, text };
}

await req('/login');
const loginRes = await fetch(`${HOME}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookies.join('; ') },
  body: JSON.stringify({ login: account.email, password: account.password }),
});
mergeCookies(loginRes);
console.log(`로그인 → ${loginRes.status}`);
if (!loginRes.ok) process.exit(1);

// 홈에서 «지금» 링크를 새로 받는다
const home = await req('/');
const jsPaths = new Set<string>();
for (const m of home.text.matchAll(/(?:href|src)="([^"]+\.(?:js|mjs))"/gi)) jsPaths.add(m[1]);
console.log(`\n■ 지금 홈에서 찾은 JS 파일 ${jsPaths.size}개: ${[...jsPaths].join(', ')}`);

for (const path of jsPaths) {
  const { res, text } = await req(path);
  if (!res.ok) continue;
  console.log(`\n========== ${path} (${text.length}자) ==========`);

  const calls = [...text.matchAll(/(fetch|axios\.\w+)\s*\(\s*([^)]{0,150})/g)];
  console.log(`  fetch/axios 호출부 ${calls.length}건:`);
  for (const c of calls.slice(0, 40)) console.log(`    ${c[1]}(${c[2]})`);

  const termsIdx: number[] = [];
  let idx = text.indexOf('.terms');
  while (idx >= 0 && termsIdx.length < 15) {
    termsIdx.push(idx);
    idx = text.indexOf('.terms', idx + 1);
  }
  console.log(`  ".terms" 등장 ${termsIdx.length}건:`);
  for (const i of termsIdx) console.log(`    …${text.slice(Math.max(0, i - 150), i + 50)}…`);

  const wonCtx = [...text.matchAll(/.{40}(?:개월|보증금|대여료|월요금|일요금|단기|장기|rental).{40}/g)];
  console.log(`  "개월/보증금/대여료/rental" 문맥 ${wonCtx.length}건:`);
  for (const c of wonCtx.slice(0, 15)) console.log(`    …${c[0]}…`);

  const urlLike = [...new Set([...text.matchAll(/["'`](\/[a-zA-Z0-9][a-zA-Z0-9/_.-]{2,60})["'`]/g)].map((m) => m[1]))]
    .filter((s) => !s.match(/\.(png|jpg|jpeg|webp|svg|css|woff2?|js|mjs)$/i));
  console.log(`  경로 비슷한 문자열 ${urlLike.length}개: ${urlLike.slice(0, 40).join(', ')}`);
}
