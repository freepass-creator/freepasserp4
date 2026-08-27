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
  const its = [...q('.hd .ko').querySelectorAll('i')];
  const gaps = its.slice(1).map((el, i) => [its[i].textContent + '→' + el.textContent,
    +(R(el).left - R(its[i]).right).toFixed(2)]);
  return { mk: +R(q('.hd .mk')).height.toFixed(1), wm: +R(q('.hd .wm')).height.toFixed(1),
           co: +R(q('.hd .co')).width.toFixed(1), ko: +R(q('.hd .ko')).width.toFixed(1), gaps };
});
console.log('  마크 높이 ' + r.mk + 'px  ·  글자 두 줄 ' + r.wm + 'px  ·  차이 ' + (r.wm - r.mk).toFixed(1) + 'px');
console.log('  영문 폭 ' + r.co + 'px  ·  한글 폭 ' + r.ko + 'px  ·  차이 ' + (r.ko - r.co).toFixed(1) + 'px');
console.log('  낱자 사이  ' + r.gaps.map(([c, g]) => c + ' ' + g).join('  |  '));
await b.close();
