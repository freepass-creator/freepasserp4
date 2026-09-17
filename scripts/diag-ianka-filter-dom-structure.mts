/**
 * 진단 전용 — 화면 요금은 API/JS 번들 어디에도 없고, 렌더링된 DOM에만 있다(2026-09-17
 * 실측, audit 38 교차확인). 사장님 확인: 계약기간 필터가 «전역»이라 하나 바꾸면
 * 전체 차량이 그 기간으로 다시 그려진다(오토플러스·손오공처럼 차 하나에 60개월 다 있는
 * 게 아니라). 그러면 8개 기간(1·3·5·12·24·36·48·60개월)만 순서대로 클릭해서 렌더링된
 * 텍스트를 매번 긁으면 전체 차량의 60개월 요금표를 만들 수 있다.
 * 이 스크립트는 실제 클릭 대상을 찾기 위해 계약기간 필터 영역의 DOM 구조(버튼/셀렉트
 * 태그·클래스·aria-label)를 덤프한다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-filter-dom-structure.mts
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

type PwCookie = { name: string; value: string; domain: string; path: string; secure?: boolean };
const pwCookies: PwCookie[] = [];
for (const raw of rawCookies) {
  const [pair] = raw.split(';');
  const [name, ...rest] = pair.split('=');
  pwCookies.push({ name: name.trim(), value: rest.join('='), domain: HOST, path: '/', secure: true });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
await context.addCookies(pwCookies);
const page = await context.newPage();

await page.goto(`${HOME}/`, { waitUntil: 'load', timeout: 30_000 });
await page.waitForTimeout(3000);

// "계약(약정)기간" 텍스트를 포함하는 영역을 찾아 그 주변 HTML을 덤프
const found = await page.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.textContent?.includes('계약(약정)기간')) {
      let el = node.parentElement;
      for (let i = 0; i < 4 && el?.parentElement; i++) el = el.parentElement;
      return el ? el.outerHTML.slice(0, 6000) : null;
    }
  }
  return null;
});
console.log('■ 계약(약정)기간 영역 HTML:');
console.log(found ?? '(못 찾음)');

// 모든 버튼/옵션 요소 중 "개월"을 포함하는 것들의 태그·클래스·텍스트를 나열
const buttons = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('button, [role="button"], option, li, span, label'));
  return els
    .filter((e) => /^\d+개월$/.test(e.textContent?.trim() ?? ''))
    .map((e) => ({
      tag: e.tagName,
      cls: e.className,
      text: e.textContent?.trim(),
      role: e.getAttribute('role'),
      ariaSelected: e.getAttribute('aria-selected'),
      dataState: e.getAttribute('data-state'),
    }));
});
console.log('\n■ "N개월" 텍스트를 가진 요소들:');
console.log(JSON.stringify(buttons, null, 1));

await browser.close();
