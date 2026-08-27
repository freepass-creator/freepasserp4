/**
 * CI 자물쇠 재는 자 — 정산서 머리의 «마크 · 영문 워드마크 · 한글 상호» 를 실제로 잰다.
 *
 * ★눈으로 맞히지 말고 **잰다.** 2026-08-27 에 text-align:justify 로 두 번 틀렸다 —
 *   여백이 띄어쓰기 한 곳(28.6px)으로 몰렸는데 화면에서만 봐선 왜인지 몰랐다.
 *   재고 나서야 알았고, flex space-between 으로 바꿔 낱자 2.44px 균등이 됐다.
 *
 * 맞아야 하는 것 둘
 *   · 마크 높이 ≒ 글자 두 줄 높이
 *   · 한글 줄 폭 = 영문 워드마크 폭
 *
 * 쓰는 법
 *   node scripts/measure-ci-lockup.mjs "<정산서 html 경로>"
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(pathToFileURL(process.argv[2]).href);
await p.waitForTimeout(1500);
const r = await p.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const R = (el) => el.getBoundingClientRect();
  const mk = R(q('.hd .mk')), wm = R(q('.hd .wm'));
  const its = [...q('.hd .ko').querySelectorAll('i')];
  const gaps = its.slice(1).map((el, i) => [its[i].textContent + '→' + el.textContent,
    +(R(el).left - R(its[i]).right).toFixed(2)]);
  return { mk: +mk.height.toFixed(1), wm: +wm.height.toFixed(1),
           co: +R(q('.hd .co')).width.toFixed(1), ko: +R(q('.hd .ko')).width.toFixed(1),
           옆에: mk.right <= wm.left + 1, gaps };
});
console.log('  마크 높이 ' + r.mk + 'px  ·  글자 두 줄 ' + r.wm + 'px  ·  차이 ' + (r.wm - r.mk).toFixed(1) + 'px');
console.log('  영문 폭 ' + r.co + 'px  ·  한글 폭 ' + r.ko + 'px  ·  차이 ' + (r.ko - r.co).toFixed(1) + 'px');
console.log('  낱자 사이  ' + r.gaps.map(([c, g]) => c + ' ' + g).join('  |  '));
await b.close();

// ★재기만 하고 끝내면 다음에 또 놓친다 — 어긋나면 «틀렸다»고 말한다.
const 흠 = [];
if (!r.옆에) 흠.push('마크가 글자 옆이 아니라 위에 있다 (CSS 주석이 깨졌을 때 이렇게 된다)');
if (Math.abs(r.ko - r.co) > 1) 흠.push('한글 폭이 영문 폭과 다르다 — ' + (r.ko - r.co).toFixed(1) + 'px');
if (Math.abs(r.wm - r.mk) > 4) 흠.push('마크 높이가 글자 두 줄과 다르다 — ' + (r.wm - r.mk).toFixed(1) + 'px');
if (흠.length) {
  console.log('');
  for (const x of 흠) console.log('  ⛔ ' + x);
  console.log('');
  process.exit(1);
}
console.log('');
console.log('  ○ CI 자물쇠 맞습니다.');
console.log('');
