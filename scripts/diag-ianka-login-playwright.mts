/**
 * 진단 전용 — 이안카(https://xn--le5bt3bwxk.com/login) 로그인 폼이 name/action 없는 SPA 라서
 * 일반 폼 POST 로 안 된다(2026-09-17 diag-ianka-login.mts 실측: input name="" type="password").
 * 헤드리스 브라우저로 실제 제출해서 어떤 요청이 뜨는지 본다. 비밀번호는 로그에 안 찍는다.
 * ⚠ 1차 시도(2026-09-17)에서 `input[type="text"]` locator.fill 이 30초 타임아웃 났다
 *   — 안 보이거나(visibility) 다른 요소에 가려졌을 가능성. 이번엔 각 input의 실제 상태를 먼저 찍고
 *   보이는 input만 골라 채운다. 실패해도 스크린샷을 남긴다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-login-playwright.mts
 */
import { chromium } from 'playwright';

const HOME = 'https://xn--le5bt3bwxk.com';
const account = JSON.parse(process.env.IANKA_ACCOUNT_JSON || '{}') as { email?: string; password?: string };
if (!account.email || !account.password) throw new Error('IANKA_ACCOUNT_JSON에 email/password가 없다');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const requests: string[] = [];
page.on('request', (req) => {
  const url = req.url();
  if (url.includes('/login') || url.includes('/api') || url.includes('/auth') || url.includes('/signin')) {
    const body = req.postData();
    const masked = body ? body.split(account.password!).join('***') : '';
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

async function screenshot(name: string) {
  try {
    await page.screenshot({ path: `/tmp/${name}.png`, fullPage: true });
    console.log(`■ 스크린샷 저장: /tmp/${name}.png (${(await page.content()).length}자 HTML)`);
  } catch (e) {
    console.log(`■ 스크린샷 실패: ${(e as Error).message}`);
  }
}

console.log('■ /login 이동');
await page.goto(`${HOME}/login`, { waitUntil: 'networkidle', timeout: 30_000 });
await page.waitForTimeout(1500);

const inputInfo = await page.$$eval('input', (els) =>
  els.map((el, i) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      i,
      type: el.type,
      placeholder: el.placeholder,
      visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
      rect: `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`,
      disabled: el.disabled,
      readonly: el.readOnly,
    };
  })
);
console.log('■ input 상세:', JSON.stringify(inputInfo));
await screenshot('01-login-loaded');

const textIdx = inputInfo.find((i) => i.visible && (i.type === 'text' || i.type === 'email'))?.i;
const passIdx = inputInfo.find((i) => i.visible && i.type === 'password')?.i;
console.log(`■ 선택된 인덱스: text=${textIdx} password=${passIdx}`);

if (textIdx === undefined || passIdx === undefined) {
  console.log('■ 보이는 입력칸을 못 찾았다 — 중단');
  await browser.close();
  process.exit(0);
}

const allInputs = page.locator('input');
const emailInput = allInputs.nth(textIdx);
const passwordInput = allInputs.nth(passIdx);

try {
  await emailInput.click({ timeout: 5000 });
  await emailInput.fill(account.email, { timeout: 5000 });
} catch (e) {
  console.log(`■ 이메일 입력 실패, force로 재시도: ${(e as Error).message}`);
  await emailInput.fill(account.email, { force: true, timeout: 5000 });
}
try {
  await passwordInput.click({ timeout: 5000 });
  await passwordInput.fill(account.password, { timeout: 5000 });
} catch (e) {
  console.log(`■ 비밀번호 입력 실패, force로 재시도: ${(e as Error).message}`);
  await passwordInput.fill(account.password, { force: true, timeout: 5000 });
}
console.log('■ 이메일·비밀번호 입력 완료');
await screenshot('02-filled');

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
await screenshot('03-after-submit');

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
