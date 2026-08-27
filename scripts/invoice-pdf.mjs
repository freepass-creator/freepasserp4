/**
 * 정산서 HTML → **PDF**.
 *
 * ★종이가 그대로 나와야 한다 — A4, 여백 0, 바탕색 인쇄 켜기.
 *   `@page { size:A4; margin:0 }` 이 이미 잡혀 있어서 여기서 크기를 다시 정하지 않는다.
 *   ⚠ printBackground 를 끄면 남색 띠와 표 머리가 통째로 사라진다. 반드시 켠다.
 *
 * ★`.noprint`(발송 전 확인)는 «자동으로» 빠진다 — CSS 의 @media print 가 지운다.
 *   PDF 는 나가는 종이라 우리끼리 보는 표시가 남으면 안 된다.
 *
 * ★쪽 수를 «세서» 확인한다. HTML 의 `.doc` 개수와 PDF 쪽 수가 다르면 어딘가 밀린 것이다.
 *
 *   node scripts/invoice-pdf.mjs                      tmp/정산서-2026-08 전부
 *   node scripts/invoice-pdf.mjs <폴더>
 *   node scripts/invoice-pdf.mjs <html 파일 하나>
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

const arg = process.argv[2] || 'tmp/정산서-2026-08';
const isFile = statSync(arg).isFile();
const dir = isFile ? dirname(arg) : arg;
const files = isFile ? [basename(arg)] : readdirSync(dir).filter((f) => f.endsWith('.html'));

const b = await chromium.launch();
const p = await b.newPage();
console.log(`\n■ PDF 로 굽기 — ${files.length}장\n`);

let bad = 0;
for (const f of files) {
  const src = join(process.cwd(), dir, f);
  const out = src.replace(/\.html$/, '.pdf');
  const want = (readFileSync(src, 'utf8').match(/class="doc"/g) || []).length;

  await p.goto(pathToFileURL(src).href, { waitUntil: 'networkidle' });
  await p.emulateMedia({ media: 'print' });   // ★.noprint 를 실제로 지우고 굽는다
  await p.waitForTimeout(300);
  const buf = await p.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  writeFileSync(out, buf);

  // ★쪽 수를 센다 — PDF 안의 /Type /Page 개수
  const got = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  const ok = got === want;
  if (!ok) bad++;
  console.log(`  ${ok ? '○' : '⛔'} ${f.replace(/^2026-08 /, '').replace(/\.html$/, '').padEnd(42)}`
    + `${String(got)}쪽${ok ? '' : ` ← HTML 은 ${want}쪽입니다`}  ${(buf.length / 1024).toFixed(0)}KB`);
}
await b.close();

console.log('');
if (bad) { console.log(`  ⛔ ${bad}장이 HTML 과 쪽 수가 다릅니다.`); console.log(''); process.exit(1); }
console.log('  ○ 다 구웠습니다.');
console.log('');
