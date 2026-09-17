/**
 * 진단 전용 — 이 사이트는 vite-rsc(Vite RSC 프레임워크)로 지어졌다(2026-09-17 실측,
 * data-precedence="vite-rsc/client-reference" 마커). 홈 HTML 원본엔 요금이 전혀 없고
 * (요금 패턴 0건), 우리가 스캔한 fetch() 호출 중 요금 관련은 /api/rates(403, b2b 계정
 * 진짜 권한 없음) 뿐이었다 — 그런데 사장님이 같은 계정으로 브라우저에서 요금을 봤다.
 * 즉 요금은 REST fetch가 아니라 RSC 서버 액션(우리 정규식 스캔으로 못 잡는 방식)으로
 * 올 가능성이 크다. 헤드리스 브라우저로 실제 렌더링을 재현하되, 로그인은 plain fetch로
 * 먼저 끝내 쿠키를 얻고(Cloudflare 챌린지가 로그인 폼 상호작용에서 걸렸었다) 그 쿠키를
 * 브라우저 컨텍스트에 주입해 홈에 접속, 모든 네트워크 요청/응답을 가로챈다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-browser-network-capture.mts
 */
import { chromium } from 'playwright';

const HOME = 'https://xn--le5bt3bwxk.com';
const HOST = 'xn--le5bt3bwxk.com';
const account = JSON.parse(process.env.IANKA_ACCOUNT_JSON || '{}') as { email?: string; password?: string };
if (!account.email || !account.password) throw new Error('IANKA_ACCOUNT_JSON에 email/password가 없다');

let rawCookies: string[] = [];
function mergeCookies(res: Response) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) rawCookies.push(c);
}

// 1) plain fetch로 로그인해서 쿠키를 얻는다(브라우저 상호작용 없이 — Cloudflare 챌린지 회피)
let cookieHeader = '';
async function login() {
  const r0 = await fetch(`${HOME}/login`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  mergeCookies(r0);
  cookieHeader = rawCookies.map((c) => c.split(';')[0]).join('; ');
  const r1 = await fetch(`${HOME}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader, 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ login: account.email, password: account.password }),
  });
  mergeCookies(r1);
  console.log(`로그인(fetch) → ${r1.status}`);
  if (!r1.ok) throw new Error('로그인 실패');
}
await login();

// 2) 쿠키 파싱 — Playwright의 addCookies 형식으로 변환
type PwCookie = { name: string; value: string; domain: string; path: string; httpOnly?: boolean; secure?: boolean; sameSite?: 'Strict' | 'Lax' | 'None' };
const pwCookies: PwCookie[] = [];
for (const raw of rawCookies) {
  const [pair] = raw.split(';');
  const [name, ...rest] = pair.split('=');
  const value = rest.join('=');
  pwCookies.push({ name: name.trim(), value, domain: HOST, path: '/', secure: true });
}
console.log(`■ 브라우저에 주입할 쿠키 ${pwCookies.length}개: ${pwCookies.map((c) => c.name).join(', ')}`);

// 3) 헤드리스 브라우저를 띄우고 쿠키 주입 후 홈 방문, 네트워크 전부 가로채기
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
await context.addCookies(pwCookies);
const page = await context.newPage();

const captured: { url: string; method: string; status?: number; bodySnippet?: string; fullBody?: string }[] = [];
page.on('response', async (res) => {
  const req = res.request();
  const url = req.url();
  if (url.includes(HOST)) {
    let bodySnippet = '';
    let fullBody: string | undefined;
    try {
      const ct = res.headers()['content-type'] || '';
      if (ct.includes('json') || ct.includes('text') || url.includes('/api/') || req.postData()) {
        const text = await res.text();
        bodySnippet = text.slice(0, 500);
        if (url.includes('/api/inventory')) fullBody = text;
      }
    } catch {}
    captured.push({ url, method: req.method(), status: res.status(), bodySnippet, fullBody });
  }
});

console.log('\n■ 홈 접속 중...');
await page.goto(`${HOME}/`, { waitUntil: 'networkidle', timeout: 30_000 }).catch((e) => console.log('goto 에러(계속 진행):', e.message));
await page.waitForTimeout(3000);

console.log(`\n■ 캡처된 요청 ${captured.length}건`);
for (const c of captured) {
  console.log(`  ${c.method} ${c.url} → ${c.status}`);
}

console.log('\n■ "원"/"개월"/"rate"/"term" 관련 응답 본문만 추려서 출력');
for (const c of captured) {
  if (c.bodySnippet && /(원|개월|rate|term|rental|요금|대여료)/i.test(c.bodySnippet)) {
    console.log(`  [${c.method} ${c.url} → ${c.status}]`);
    console.log(`    ${c.bodySnippet}`);
  }
}

console.log('\n■ /api/inventory 전체 응답 바디(실 브라우저 세션)');
for (const c of captured) {
  if (c.fullBody) {
    console.log(`  [${c.method} ${c.url} → ${c.status}] 전체길이 ${c.fullBody.length}자`);
    const termsLike = [...c.fullBody.matchAll(/"[\wㄱ-힣]*(?:term|rate|price|fare|fee|rental|요금|대여료|보증금)[\wㄱ-힣]*"\s*:/gi)];
    console.log(`    "term/rate/rental/요금" 키 매칭 ${termsLike.length}건: ${[...new Set(termsLike.map((m) => m[0]))].join(', ')}`);
    const wonNumbers = [...c.fullBody.matchAll(/(\d{1,3}(?:,\d{3})+)\s*원/g)];
    console.log(`    "N,NNN원" 패턴 ${wonNumbers.length}건`);
    try {
      const parsed = JSON.parse(c.fullBody);
      const firstUnit = parsed.models?.[0]?.units?.[0];
      console.log(`    첫 유닛 키: ${firstUnit ? Object.keys(firstUnit).join(', ') : '(없음)'}`);
      console.log(`    첫 유닛 전체: ${JSON.stringify(firstUnit)}`);
    } catch (e) {
      console.log(`    JSON 파싱 실패: ${(e as Error).message}`);
    }
  }
}

// 4) 렌더링된 페이지의 텍스트 콘텐츠에서 요금 패턴 직접 스캔
const bodyText = await page.evaluate(() => document.body.innerText);
console.log(`\n■ 렌더링된 페이지 텍스트 길이: ${bodyText.length}자`);
const wonMatches = [...bodyText.matchAll(/(\d{1,3}(?:,\d{3})+)\s*원/g)];
console.log(`■ 렌더링된 텍스트의 "N,NNN원" 패턴 ${wonMatches.length}건:`);
for (const m of wonMatches.slice(0, 20)) console.log(`  ${m[0]}`);
console.log('\n■ 렌더링된 텍스트 앞부분 3000자:');
console.log(bodyText.slice(0, 3000));

await browser.close();
