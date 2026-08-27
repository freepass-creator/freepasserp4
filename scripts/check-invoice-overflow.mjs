/**
 * 정산서 «쪽 넘침» 검사 — A4 한 장에 안 들어가면 잡는다.
 *
 * ★간격을 넓히면 줄이 아래로 밀려 꼬리(.ft)를 덮는다. 화면에선 안 보이고
 *   인쇄해야 드러난다. 그래서 «잰다» — 마지막 줄 아래끝이 꼬리 위끝을 넘으면 넘친 것이다.
 *
 *   node scripts/check-invoice-overflow.mjs <정산서 폴더>
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || 'tmp/정산서-2026-08';
const files = readdirSync(dir).filter((f) => f.endsWith('.html'));
const b = await chromium.launch();
const p = await b.newPage();
let bad = 0;
console.log('\n■ 쪽 넘침 검사 — ' + files.length + '장\n');
for (const f of files) {
  await p.goto(pathToFileURL(join(process.cwd(), dir, f)).href);
  await p.waitForTimeout(250);
  const r = await p.evaluate(() => [...document.querySelectorAll('.doc')].map((doc) => {
    const ft = doc.querySelector('.ft');
    const kids = [...doc.children].filter((el) => el !== ft && !el.classList.contains('noprint'));
    const low = Math.max(...kids.map((el) => el.getBoundingClientRect().bottom));
    return +(ft.getBoundingClientRect().top - low).toFixed(1);
  }));
  const worst = Math.min(...r);
  const nm = f.replace(/^2026-08 /, '').replace(/\.html$/, '');
  if (worst < 0) { bad++; console.log('  ⛔ ' + nm.padEnd(44) + r.length + '쪽 · ' + worst + 'px 넘침'); }
  else console.log('  ○ ' + nm.padEnd(44) + r.length + '쪽 · 여유 ' + worst + 'px');
}
await b.close();
console.log(bad ? '\n⛔ ' + bad + '장이 넘칩니다.\n' : '\n○ 다 들어갑니다.\n');
process.exit(bad ? 1 : 0);
