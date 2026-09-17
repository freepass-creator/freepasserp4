/**
 * 진단 전용 — 이안카(https://xn--le5bt3bwxk.com/login) 로그인 폼이 name/action 없는 SPA 라서
 * 일반 폼 POST 로 안 된다(2026-09-17 diag-ianka-login.mts 실측: input name="" type="password").
 * 헤드리스 브라우저로 실제 제출해서 어떤 요청이 뜨는지 본다. 비밀번호는 로그에 안 찍는다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-login-playwright.mts
 */
import { chromium } from 'playwright';

const HOME = 'https://xn--le5bt3bwxk.com';
const account = JSON.parse(process.env.IANKA_ACCOUNT_JSON || '{}') as { email?: string; password?: string };
if (!account.email || !account.password) throw new Error('IANKA_ACCOUNT_JSON에 email/password가 없다');

const browser = await chromium.launch();
const page = await browser.newPage();

const requests: string[] = [];
page.on('request', (req) => {
  const url = req.url();
  if (url.includes('/login') || url.includes('/api') || url.includes('/auth') || url.includes('/signin')) {
    const body = req.postData();
    const masked = body ? body.replace(new RegExp(account.password!, 'g'), '***') : '';
    requests.push(`${req.method()} ${url}${masked ? ` body=${masked.slice(0, 300)}` : ''}`);
  }
});
const responses: string[] = [];
page.on('response', (res) => {
  const url = res.url();
  if (url.includes('/login') || url.includes('/api') || url.includes('/auth') || url.includes('/signin')) {
    responses.push(`${res.status()} ${url}`);
  }
});

console.log('■ /login 이동');
await page.goto(`${HOME}/login`, { waitUntil: 'networkidle', timeout: 30_000 });

const inputs = await page.$$eval('input', (els) =>
  els.map((el) => ({ type: el.type, id: el.id, cls: el.className, placeholder: el.placeholder }))
);
console.log('■ input 목록:', JSON.stringify(inputs));

const emailInput = page.locator('input[type="text"], input[type="email"]').first();
const passwordInput = page.locator('input[type="password"]').first();
await emailInput.fill(account.email);
await passwordInput.fill(account.password);
console.log('■ 이메일·비밀번호 입력 완료 — 제출 시도');

const submitCandidates = page.locator('button, input[type="submit"]');
const count = await submitCandidates.count();
console.log(`■ 버튼/제출 후보 ${count}개`);
for (let i = 0; i < count; i++) {
  const t = await submitCandidates.nth(i).innerText().catch(() => '');
  console.log(`  [${i}] "${t.trim().slice(0, 40)}"`);
}

try {
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {}),
    passwordInput.press('Enter'),
  ]);
} catch (e) {
  console.log(`■ 제출 중 에러: ${(e as Error).message}`);
}

await page.waitForTimeout(2000);

console.log('\n■ 로그인 관련 요청');
for (const r of requests) console.log(`  ${r}`);
console.log('\n■ 로그인 관련 응답');
for (const r of responses) console.log(`  ${r}`);

console.log(`\n■ 제출 뒤 최종 URL: ${page.url()}`);
const cookies = await page.context().cookies();
console.log(`■ 쿠키 ${cookies.length}개: ${cookies.map((c) => c.name).join(', ')}`);

const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
console.log(`■ 제출 뒤 본문 표본: ${bodyText}`);

await browser.close();
