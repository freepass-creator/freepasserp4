/**
 * 진단 전용 — /api/inventory 전체 응답(44143자)이 plain fetch와 실 브라우저 세션에서
 * «완전히 동일»함을 확인했다(요금 필드 0건). 그런데 화면엔 요금이 뜨고, 캡처된 API 호출은
 * /api/inventory 하나뿐이었다. 즉 요금은 네트워크로 오는 게 아니라 JS 번들 자체에
 * «빌드 타임에 박혀있는» 정적 데이터일 가능성이 매우 크다(이안카가 /api/rates PATCH로
 * 수정할 때마다 재배포되는 구조로 보인다 — 우리 진단 중에도 파일 해시가 여러 번 바뀌었다).
 * 실제 화면에 뜬 차종명("더 뉴기아 레이 2인승 밴 프레스티지 스페셜")과 요금(400,000)을
 * 단서로 JS 번들 안에서 그 문자열 근처에 숫자 테이블이 있는지 직접 찾는다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-embedded-rate-table.mts
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
    headers: { 'User-Agent': 'Mozilla/5.0 FreepassERP diag', Cookie: cookies.join('; ') },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  mergeCookies(res);
  const text = await res.text();
  console.log(`GET ${path} → ${res.status} (길이 ${text.length}자)`);
  return text;
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

// 홈에서 지금 링크를 새로 받는다(파일 해시가 자주 바뀐다)
const home = await req('/');
const jsPaths = new Set<string>();
for (const m of home.matchAll(/(?:href|src)="([^"]+\.(?:js|mjs))"/gi)) jsPaths.add(m[1]);
console.log(`■ JS 파일 ${jsPaths.size}개: ${[...jsPaths].join(', ')}`);

const needle = '더 뉴기아 레이 2인승 밴 프레스티지 스페셜';
for (const path of jsPaths) {
  const text = await req(path);
  let idx = text.indexOf(needle);
  if (idx < 0) continue;
  console.log(`\n★★ "${needle}" 발견 in ${path} (총 길이 ${text.length}자)`);
  let count = 0;
  while (idx >= 0 && count < 5) {
    console.log(`  [위치 ${idx}] 앞뒤 400자:`);
    console.log(`    ${text.slice(Math.max(0, idx - 200), idx + 200)}`);
    idx = text.indexOf(needle, idx + 1);
    count++;
  }
  // 400000 이나 400,000 같은 숫자가 이 파일에 있는지도 확인
  const priceIdx = text.indexOf('400000');
  const priceIdx2 = text.indexOf('400,000');
  console.log(`  "400000" 위치: ${priceIdx} · "400,000" 위치: ${priceIdx2}`);
  if (priceIdx >= 0) console.log(`    문맥: ${text.slice(Math.max(0, priceIdx - 200), priceIdx + 200)}`);
}
