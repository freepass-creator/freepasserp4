/**
 * 회원사 로고 **후보**를 홈페이지에서 긁어 온다.
 *
 * ★★★**긁은 그림을 바로 종이에 올리지 않는다.** `assets/partner-logo/_후보/<별칭>/` 에만 담는다.
 *   자동으로 고른 그림은 틀리기 쉽다 — 배너·광고·남의 회사 로고가 잡힌다.
 *   사람이 보고 고른 뒤 `assets/partner-logo/<별칭>.png` 로 «옮겨야» 종이에 붙는다.
 *
 * ⚠ 남의 상표다. 허락받은 회사만 돌린다.
 *
 * ⛔⛔ **이름이 겹치는 회사를 조심한다.** 사장님 2026-08-27
 *   「손오공은 손오공주식회사 로고있어 완구회사」 —
 *   우리 거래처는 «주식회사 손오공렌터카»(882-87-00650 · 차현일)고,
 *   「손오공주식회사」는 완구 회사로 전혀 다른 법인이다.
 *   이름만 보고 고르면 완구 회사 상표가 렌터카 청구서에 찍힌다.
 *   ★고를 땐 «사업자번호와 대표»로 확인한다. 이름은 증거가 아니다.
 *
 *   node scripts/fetch-partner-logos.mjs            아는 홈페이지 전부
 *   node scripts/fetch-partner-logos.mjs 손오공 웰릭스   골라서
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SITES = [
  // ★sokrc.com — 「손오공 Agent」. automgt.co.kr 은 2026-08-27 에 주소가 안 풀렸다.
  ['손오공', 'https://sokrc.com'],
  ['오토플러스', 'https://autoplus.co.kr'],
  ['웰릭스', 'https://welrixmobility.com'],
  ['아이카', 'https://icar.or.kr'],
  ['우리캐피탈', 'https://wooricap-rentacar.com'],
  ['스타스카이', 'https://sratskyrent.wixsite.com/starskyrentcar'],
  // ★2026-09-03 — 옛 주소가 안 풀린다. 사장님이 준 주소(하허호무심사.com)로 바꾼다.
  ['하허호', 'https://xn--v92b23hm1b606a9pa6u.com'],
  // ★2026-09-03 — nae-cha.com 은 주소가 안 풀린다. F02 거래처시트가 적어 둔 주소로 바꾼다.
  ['렌트야', 'https://sggo.kr'],
  ['카핑', 'https://carping1.com'],
  ['오토원트', 'https://www.autowant.co.kr'],  // 사장님 2026-09-03
];
const ROOT = 'assets/partner-logo/_후보';
const want = process.argv.slice(2);
const list = want.length ? SITES.filter(([a]) => want.includes(a)) : SITES;
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/svg+xml': '.svg', 'image/webp': '.webp', 'image/x-icon': '.ico', 'image/gif': '.gif' };

const b = await chromium.launch();
console.log(`\n■ 로고 후보 긁기 — ${list.length}곳\n`);

for (const [alias, url] of list) {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  let found = [];
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await p.waitForTimeout(2500);
    found = await p.evaluate(() => {
      const abs = (u) => { try { return new URL(u, location.href).href; } catch { return ''; } };
      const out = [];
      const add = (u, why, w = 0) => { const a = abs(u); if (a && !out.some((x) => x.url === a)) out.push({ url: a, why, w }); };
      const og = document.querySelector('meta[property="og:image"], meta[name="og:image"]');
      if (og) add(og.content, 'og:image', 100);
      for (const l of document.querySelectorAll('link[rel*="icon"]')) add(l.href, 'icon ' + (l.sizes?.value || ''), 40);
      for (const img of document.querySelectorAll('img')) {
        const s = `${img.getAttribute('src') || ''} ${img.alt || ''} ${img.className || ''} ${img.id || ''}`.toLowerCase();
        const r = img.getBoundingClientRect();
        if (r.height < 8 || r.height > 200) continue;
        const inHead = !!img.closest('header, .header, #header, .gnb, .top, nav');
        if (/logo|로고|\bci\b|brand/.test(s)) add(img.currentSrc || img.src, 'logo 이름', 90 + (inHead ? 5 : 0));
        else if (inHead && r.top < 220) add(img.currentSrc || img.src, '머리쪽 그림', 60);
      }
      return out.sort((x, y) => y.w - x.w).slice(0, 5);
    });
  } catch (e) {
    console.log(`  ⛔ ${alias.padEnd(10)} 못 열었습니다 — ${String(e.message).split('\n')[0].slice(0, 60)}`);
    await p.close(); continue;
  }

  const dir = join(ROOT, alias);
  let saved = 0;
  for (const [i, c] of found.entries()) {
    try {
      const res = await p.request.get(c.url, { timeout: 15000 });
      if (!res.ok()) continue;
      const type = String(res.headers()['content-type'] || '').split(';')[0];
      const ext = EXT[type]; if (!ext) continue;
      const buf = await res.body(); if (buf.length < 400) continue;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${i + 1}-${c.why.replace(/[^\w가-힣]+/g, '')}${ext}`), buf);
      saved++;
    } catch { /* 못 받으면 넘어간다 */ }
  }
  console.log(`  ${saved ? '○' : '⛔'} ${alias.padEnd(10)} 후보 ${saved}장${saved ? `  → ${dir}/` : '   (쓸 만한 그림을 못 찾았습니다)'}`);
  await p.close();
}
await b.close();

console.log('');
console.log('  ★긁어 온 것은 «후보»입니다. 아직 종이에 안 붙습니다.');
console.log('  ⛔ 고르기 전에 «그 회사가 맞는지» 사업자번호·대표로 확인하세요 —');
console.log('     이름이 같은 다른 회사가 있습니다 (손오공렌터카 ↔ 손오공주식회사·완구).');
console.log('  1) 후보를 눈으로 보고 고른다');
console.log('  2) assets/partner-logo/<별칭>.png 로 옮긴다');
console.log('  3) npx tsx scripts/embed-partner-logos.mts');
console.log('');
