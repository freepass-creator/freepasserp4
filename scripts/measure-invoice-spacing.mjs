/**
 * 정산서 간격·모서리 재는 자 — 공통 규격이 «정말» 먹었는지 잰다.
 *
 * ★맞아야 하는 것
 *   칸 사이       --sec     10px   (청구 금액 · 정산 내역 · 입금·문의 · 발송 전 확인)
 *   단락 바뀜      --sec-lg  14px   (띠 다음 첫 칸, 맺음말 앞)
 *   띠 아래 숨     --band    12px
 *   모서리        --r-box    7px   ★네 귀퉁이 다 — 위만 둥글면 표가 각져 보인다
 *
 * ⚠ 값이 맞아도 «맨숫자»로 박혀 있으면 규격이 아니다.
 *   한 곳을 고쳤을 때 따라오지 않으면 그건 규격 밖이다 (2026-08-27 에 셋 걸렸다).
 *
 * 쓰는 법
 *   node scripts/measure-invoice-spacing.mjs "<정산서 html 경로>"
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(pathToFileURL(process.argv[2]).href);
await p.waitForTimeout(1200);
const r = await p.evaluate(() => {
  const doc = document.querySelector('.doc');
  const kids = [...doc.children].filter((el) => el.getBoundingClientRect().height > 0);
  const R = (el) => el.getBoundingClientRect();
  const name = (el) => {
    const c = el.className || el.tagName.toLowerCase();
    const h = el.querySelector('.sec-h');
    return (h ? h.textContent.split('아래')[0].trim().slice(0, 14) : String(c)).trim();
  };
  const rows = kids.map((el, i) => ({
    이름: name(el),
    위: +R(el).top.toFixed(1),
    앞간격: i ? +(R(el).top - R(kids[i - 1]).bottom).toFixed(1) : null,
    css: getComputedStyle(el).marginTop,
  }));
  // 모서리 둥글기
  const rad = [...doc.querySelectorAll('table, .closing, .warn')].map((el) => {
    const g = getComputedStyle(el);
    const t = el.tagName === 'TABLE' ? el.querySelector('thead th, tbody td') : el;
    const s = getComputedStyle(t);
    return { 무엇: el.className || el.tagName, 위왼: s.borderTopLeftRadius, 아래왼: getComputedStyle(el.querySelector('tbody tr:last-child td, tbody tr:last-child th') || t).borderBottomLeftRadius };
  });
  return { rows, rad };
});
console.log('  칸 사이 간격');
for (const x of r.rows) console.log('    ' + String(x.이름).padEnd(16) + (x.앞간격 === null ? '(첫 칸)' : x.앞간격 + 'px').padEnd(10) + ' margin-top ' + x.css);
console.log('  모서리');
for (const x of r.rad) console.log('    ' + String(x.무엇).padEnd(16) + '위 ' + x.위왼 + '  아래 ' + x.아래왼);
await b.close();
