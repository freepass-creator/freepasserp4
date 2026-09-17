/**
 * 진단 전용 — 이안카(https://xn--le5bt3bwxk.com/) 로그인 뒤 기간별(1~60개월) 요금이 어디서 오는지 본다.
 * 지금까지 확인: 로그인 POST /api/auth/login → eancar_session 쿠키. GET /api/inventory 는
 * 차량 목록·상태만 주고(rateOverride:null) 요금 필드가 없다(2026-09-17 diag-ianka-inventory-api.mts 실측).
 * 홈 화면 "계약(약정)기간" 칩(1개월·3개월·5개월·12개월·24개월·36개월·48개월·60개월)을 눌러가며
 * 뜨는 요청을 캡처하고, 차량 카드 하나를 눌러 상세 페이지에서도 같은 걸 본다. 비밀번호는 로그에 안 찍는다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-pricing.mts
 */
import { chromium } from 'playwright';

const HOME = 'https://xn--le5bt3bwxk.com';
const account = JSON.parse(process.env.IANKA_ACCOUNT_JSON || '{}') as { email?: string; password?: string };
if (!account.email || !account.password) throw new Error('IANKA_ACCOUNT_JSON에 email/password가 없다');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

type Captured = { method: string; url: string; body?: string; status?: number; respSample?: string };
const captured: Captured[] = [];
const seen = new Set<string>();

page.on('response', async (res) => {
  const req = res.request();
  const url = req.url();
  if (url.includes('/_next/') || url.includes('.js') || url.includes('.css') || url.includes('.png') || url.includes('.jpg') || url.includes('.svg') || url.includes('.woff')) return;
  if (!url.includes(HOME)) return;
  const key = `${req.method()} ${url} ${req.postData() || ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  let respSample = '';
  try {
    const ct = res.headers()['content-type'] || '';
    if (ct.includes('json') || ct.includes('text')) {
      const text = await res.text();
      respSample = text.slice(0, 800);
    }
  } catch {
    // 응답 본문을 못 읽는 경우(리다이렉트 등)는 무시한다.
  }
  captured.push({
    method: req.method(),
    url,
    body: req.postData()?.replace(account.password!, '***'),
    status: res.status(),
    respSample,
  });
});

async function screenshot(name: string) {
  try {
    await page.screenshot({ path: `/tmp/${name}.png`, fullPage: true });
  } catch (e) {
    console.log(`■ 스크린샷 실패(${name}): ${(e as Error).message}`);
  }
}

function dump(label: string) {
  console.log(`\n■ ${label} — 캡처된 요청 ${captured.length}건`);
  for (const c of captured) {
    console.log(`  ${c.method} ${c.url} → ${c.status}${c.body ? ` body=${c.body.slice(0, 200)}` : ''}`);
    if (c.respSample) console.log(`    resp: ${c.respSample.replace(/\n/g, ' ').slice(0, 400)}`);
  }
  captured.length = 0;
  seen.clear();
}

// 1) 로그인 — Cloudflare 챌린지 등으로 첫 시도가 씹힐 수 있어 로그인 성공(URL이 /login을 벗어남)까지 최대 3회 재시도한다.
console.log('■ /login 이동 및 로그인');
let loggedIn = false;
for (let attempt = 1; attempt <= 3 && !loggedIn; attempt++) {
  await page.goto(`${HOME}/login`, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(1500);
  const inputs = page.locator('input');
  await inputs.nth(0).fill(account.email);
  await inputs.nth(1).fill(account.password);
  const loginButton = page.getByRole('button', { name: '로그인', exact: true }).first();
  try {
    await Promise.all([
      page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 }).catch(() => {}),
      loginButton.count().then((c) => (c ? loginButton.click({ timeout: 5000 }) : inputs.nth(1).press('Enter'))),
    ]);
  } catch (e) {
    console.log(`■ 로그인 시도 ${attempt} 중 에러: ${(e as Error).message}`);
  }
  await page.waitForTimeout(1500);
  loggedIn = !page.url().includes('/login');
  console.log(`■ 로그인 시도 ${attempt} 뒤 URL: ${page.url()} (성공=${loggedIn})`);
}
dump('로그인 시도 전체');
if (!loggedIn) {
  console.log('■ 로그인 실패 — 중단');
  await screenshot('pricing-00-login-failed');
  await browser.close();
  process.exit(1);
}

// 2) 계약(약정)기간 칩을 하나씩 눌러본다
const periods = ['1개월', '3개월', '5개월', '12개월', '24개월', '36개월', '48개월', '60개월'];
for (const p of periods) {
  const chip = page.getByText(p, { exact: true }).first();
  const count = await chip.count().catch(() => 0);
  if (!count) {
    console.log(`■ "${p}" 칩을 못 찾음`);
    continue;
  }
  try {
    await chip.click({ timeout: 5000 });
    await page.waitForTimeout(1200);
    dump(`기간칩 "${p}" 클릭 뒤`);
  } catch (e) {
    console.log(`■ "${p}" 칩 클릭 실패: ${(e as Error).message}`);
  }
}
await screenshot('pricing-01-after-period-clicks');

// 3) 차량 카드 하나를 눌러 상세로 들어가본다
console.log('\n■ 차량 카드 클릭 시도');
const cardLink = page.locator('a').filter({ hasText: /레이|아반떼|투싼|K5|그랜저|카니발|스포티지|쏘렌토/ }).first();
const cardCount = await cardLink.count().catch(() => 0);
if (cardCount) {
  const href = await cardLink.getAttribute('href');
  console.log(`■ 카드 링크 href=${href}`);
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {}),
    cardLink.click({ timeout: 5000 }).catch((e) => console.log(`■ 카드 클릭 실패: ${e.message}`)),
  ]);
  await page.waitForTimeout(1500);
  dump('상세 페이지 진입 뒤');
  console.log(`■ 상세 페이지 URL: ${page.url()}`);
  await screenshot('pricing-02-detail-page');

  // 상세 페이지에서도 기간 칩이 있으면 눌러본다
  for (const p of periods) {
    const chip = page.getByText(p, { exact: true }).first();
    const count = await chip.count().catch(() => 0);
    if (!count) continue;
    try {
      await chip.click({ timeout: 5000 });
      await page.waitForTimeout(1000);
      dump(`상세 페이지 기간칩 "${p}" 클릭 뒤`);
    } catch (e) {
      console.log(`■ 상세에서 "${p}" 클릭 실패: ${(e as Error).message}`);
    }
  }
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 3000));
  console.log(`\n■ 상세 페이지 본문 표본:\n${bodyText}`);
} else {
  console.log('■ 차량 카드를 못 찾음 — 홈 본문 표본을 남긴다');
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 2000));
  console.log(bodyText);
}

await browser.close();
