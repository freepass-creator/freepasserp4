/** 이안카(EANCAR) 사이트의 «렌더링된 화면»에서 1~60개월 요금표를 긁는다.
 *
 *  요금은 어느 API·JS 번들에도 없고 로그인한 화면(DOM)에만 있다(2026-09-17 다각도 실측 —
 *  /api/rates 는 role:b2b 계정에 진짜 403, /api/inventory 는 plain fetch·브라우저 헤더 흉내·
 *  실제 로그인 브라우저 세션 전체 응답 다 동일하게 요금 0건, JS 번들에도 차종명 자체가 없음).
 *  ChatGPT 독립 감사(audit 38)도 같은 결론이고, 렌더링 결과를 «운영 SSOT 소스»로 쓰지 말라고
 *  권고했다 — 그래서 이건 사람이 수기로 하던 요금 입력을 대신 긁어주는 «부트스트랩 보조
 *  도구»로만 쓴다. 매시간 자동동기(erp5-ssot-refresh.yml)에는 물리지 않는다 — 물리려면
 *  사장님 승인 먼저 받는다(CLAUDE.md 원칙).
 *
 *  계약(약정)기간 <select> 가 «전역» 필터라 하나 바꾸면 화면의 모든 차량이 그 기간 요금으로
 *  다시 그려진다(사장님 2026-09-17 확인 — 손오공/오토플러스처럼 차 하나에 60개월이 다 있는 게
 *  아니다). 그래서 8개 값(1·3·5·12·24·36·48·60)을 순서대로 골라 매번 카드 목록을 긁으면
 *  «차종명 → {개월: {rental, deposit}}» 테이블을 만들 수 있다 — 개별 차량(vehicleNo)이 아니라
 *  «차종(모델)» 단위 요금이다(사이트 카드 자체가 모델 단위로 묶여 있다).
 *
 *    IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' node scripts/이안카-요금스크랩.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const 루트 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = 'https://xn--le5bt3bwxk.com';
const HOST = 'xn--le5bt3bwxk.com';
const PERIODS = [1, 3, 5, 12, 24, 36, 48, 60];

function 계정읽기() {
  const raw = process.env.IANKA_ACCOUNT_JSON;
  if (!raw) throw new Error('IANKA_ACCOUNT_JSON 없다');
  const { email, password } = JSON.parse(raw);
  if (!email || !password) throw new Error('IANKA_ACCOUNT_JSON에 email/password가 없다');
  return { email, password };
}

async function 로그인쿠키() {
  const { email, password } = 계정읽기();
  let raw = [];
  const merge = (res) => { for (const c of res.headers.getSetCookie?.() ?? []) raw.push(c); };
  const r0 = await fetch(`${HOME}/login`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  merge(r0);
  const cookieHeader = raw.map((c) => c.split(';')[0]).join('; ');
  const r1 = await fetch(`${HOME}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader, 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ login: email, password }),
  });
  merge(r1);
  if (!r1.ok) throw new Error(`로그인 실패: ${r1.status}`);
  return raw.map((c) => {
    const [pair] = c.split(';');
    const [name, ...rest] = pair.split('=');
    return { name: name.trim(), value: rest.join('='), domain: HOST, path: '/', secure: true };
  });
}

const 숫자 = (s) => Number(String(s ?? '').replace(/[^\d]/g, '')) || null;

export async function 요금표긁기({ headless = true } = {}) {
  const cookies = await 로그인쿠키();
  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
    await context.addCookies(cookies);
    const page = await context.newPage();
    await page.goto(`${HOME}/`, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(2500);

    const select = page.locator('label.contractFilter select');
    await select.waitFor({ timeout: 15_000 });

    const 모델별 = new Map(); // name -> { [months]: { rental, deposit } }

    for (const months of PERIODS) {
      await select.selectOption(String(months));
      await page.waitForTimeout(800);

      // 목록이 "더보기" 버튼이나 스크롤형 지연로딩으로 잘려 있을 수 있다 —
      // 더 늘지 않을 때까지 버튼 클릭 + 맨 아래로 스크롤을 반복한다.
      let 정체횟수 = 0;
      for (let i = 0; i < 60 && 정체횟수 < 3; i++) {
        const before = await page.locator('article.rateCard').count();
        const more = page.locator('.results button, .resultsInventory button, section.results button');
        const clicked = await more.evaluateAll((els) => {
          for (const el of els) {
            const t = (el.textContent || '').trim();
            if (/더\s*보기|더\s*불러오기|load\s*more|more/i.test(t)) { el.click(); return t; }
          }
          return null;
        });
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(700);
        const after = await page.locator('article.rateCard').count();
        if (months === 1 && i < 3) {
          const btnTexts = await page.evaluate(() => Array.from(document.querySelectorAll('section.results button, .results button')).map((b) => b.textContent?.trim()));
          console.log(`    [디버그 라운드${i}] before=${before} after=${after} clicked=${clicked} 버튼목록=${JSON.stringify(btnTexts)}`);
        }
        정체횟수 = after <= before ? 정체횟수 + 1 : 0;
      }

      const cards = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('article.rateCard')).map((el) => {
          const name = el.querySelector('.vehicleName')?.getAttribute('title') || el.querySelector('.vehicleName')?.textContent || '';
          const rentalText = el.querySelector('.primaryRates .price strong')?.textContent || '';
          const depositText = el.querySelector('.primaryRates .depositBox strong')?.textContent || '';
          return { name: name.trim(), rentalText, depositText };
        });
      });
      for (const c of cards) {
        if (!c.name) continue;
        if (!모델별.has(c.name)) 모델별.set(c.name, {});
        모델별.get(c.name)[months] = { rental: 숫자(c.rentalText), deposit: 숫자(c.depositText) };
      }
      const uniqueNames = new Set(cards.map((c) => c.name)).size;
      console.log(`  [${months}개월] 카드 ${cards.length}개(고유 차종 ${uniqueNames}종) 긁음`);
    }

    return Object.fromEntries(모델별);
  } finally {
    await browser.close();
  }
}

async function main() {
  const table = await 요금표긁기({ headless: process.argv.includes('--headed') ? false : true });
  const 모델수 = Object.keys(table).length;
  console.log(`\n✅ 모델 ${모델수}종 요금표 확보`);
  const p = path.join(루트, 'lib/wonja/이안카요금.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ 갱신: new Date().toISOString(), 출처: 'DOM 렌더링(부트스트랩 전용, SSOT 아님)', 모델요금: table }, null, 1));
  console.log(`→ ${p}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
}
