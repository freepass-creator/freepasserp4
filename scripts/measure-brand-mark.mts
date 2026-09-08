/**
 * **간판(CI) 자** — 새 업체 로고를 받으면 «짐작하지 말고 이걸로 잰다».
 *
 * 사장님 2026-09-07~08 사이 간판 하나로 아홉 번 왕복했다. 뿌리는 늘 하나 —
 * **내가 브랜드를 «추정»했다.** 여백을 눈대중하고, 글꼴 지표를 어림하고, 「글자」가
 * 그림의 얼마인지 짐작했다. 그래서 부호까지 틀린 상수가 코드에 박힌 적도 있다.
 *
 * ★이 도구는 «막지» 않는다. 막는 것은 `check-brand-mark.mts`(게이트)의 몫이고,
 *   여기는 **표에 적을 값을 뽑아 주는 자**다. 그래서 실패로 끝나지 않는다.
 *
 * 쓰는 법
 * ```
 * npx tsx scripts/measure-brand-mark.mts assets/partner-logo/하허호.png
 * npx tsx scripts/measure-brand-mark.mts public/brand/uni-mark.png
 * ```
 *
 * 무엇을 찍나
 *   ① 크기·투명배경     그대로 써도 되는 파일인가
 *   ② 잉크 상자·여백    잘라야 하는가(그대로 두면 간판이 본문 왼선에서 밀린다)
 *   ③ 가로 조각 나눔    심볼/글자/뱃지가 각각 어디인가 → **`nameBand` 후보**
 *   ④ 많이 쓰인 색      브랜드색 후보
 *   ⑤ 대비             그 색으로 «글자»를 세워도 읽히는가(AA 4.5:1)
 *
 * 자세한 절차 = `docs/간판-CI-매뉴얼.md`
 */
import { readFileSync } from 'node:fs';
import { decodePng } from './lib/png.mts';

const file = process.argv[2];
if (!file) {
  console.error('쓰는 법: npx tsx scripts/measure-brand-mark.mts <png 경로>');
  process.exit(2);
}

const png = decodePng(readFileSync(file));
const { w, h } = png;
const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/* 상대휘도 — WCAG 정의 그대로. 「보기에 밝다」가 아니라 «잰» 밝기다. */
const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : (((c / 255) + 0.055) / 1.055) ** 2.4);
const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: [number, number, number], b: [number, number, number]) => {
  const [x, y] = [lum(...a) + 0.05, lum(...b) + 0.05];
  return Math.round((Math.max(x, y) / Math.min(x, y)) * 100) / 100;
};

console.log(`\n■ ${file}`);
console.log(`  크기 ${w}×${h} · colorType ${png.colorType} · 투명배경 ${png.hasAlpha ? '있음 ✓' : '없음 ✗ (흰 네모가 깔려 있다)'}`);

/* ② 잉크 상자 */
let x0 = w, x1 = -1, y0 = h, y1 = -1, inked = 0;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  if (!png.ink(x, y)) continue;
  inked++;
  if (x < x0) x0 = x; if (x > x1) x1 = x;
  if (y < y0) y0 = y; if (y > y1) y1 = y;
}
if (x1 < 0) { console.log('  ⚠ 그려진 것이 없습니다(빈 그림).'); process.exit(0); }
const pad = { 왼: x0, 오른: w - 1 - x1, 위: y0, 아래: h - 1 - y1 };
const slack = (n: number) => Math.max(1, Math.round(n * 0.01));
const over = Object.entries(pad).filter(([k, v]) => v > slack(k === '왼' || k === '오른' ? w : h));
console.log(`  잉크 x ${x0}~${x1} · y ${y0}~${y1}  (여백 왼 ${pad.왼} · 오른 ${pad.오른} · 위 ${pad.위} · 아래 ${pad.아래})`);
console.log(over.length
  ? `  ⚠ **잘라야 합니다** — ${over.map(([k, v]) => `${k} ${v}px`).join(' · ')} 이 붙어 있습니다(허용 1%).\n` +
    `    → 자르면 ${x1 - x0 + 1}×${y1 - y0 + 1}. 여백 보정을 CSS 로 하지 마세요(매뉴얼 §2②).`
  : '  여백 없음 ✓ — 그대로 쓸 수 있습니다.');

/* ③ 가로 조각 — 잉크가 «끊기는» 열에서 나눈다. 심볼/글자/뱃지가 여기서 갈린다. */
const colHas: boolean[] = [];
for (let x = 0; x < w; x++) { let any = false; for (let y = 0; y < h && !any; y++) any = png.ink(x, y); colHas.push(any); }
const segs: [number, number][] = [];
for (let x = 0, s: number | null = null; x <= w; x++) {
  if (x < w && colHas[x]) { if (s === null) s = x; continue; }
  if (s !== null) { if (x - s > 2) segs.push([s, x - 1]); s = null; }
}
const inkH = y1 - y0 + 1;
console.log(`\n  ── 가로 조각 ${segs.length}개 (세로 비율은 «잉크 높이 ${inkH}» 기준) ──`);
const rows: { seg: string; band: number }[] = [];
for (const [a, b] of segs) {
  let sy0 = h, sy1 = -1;
  for (let y = 0; y < h; y++) for (let x = a; x <= b; x++) {
    if (!png.ink(x, y)) continue;
    if (y < sy0) sy0 = y; if (y > sy1) sy1 = y; break;
  }
  const sh = sy1 - sy0 + 1;
  const band = Math.round((sh / inkH) * 1000) / 1000;
  rows.push({ seg: `x ${a}~${b}`, band });
  console.log(`    ${`x ${a}~${b}`.padEnd(14)} 폭 ${String(b - a + 1).padStart(3)}  세로 ${sy0}~${sy1} (높이 ${String(sh).padStart(3)})  비율 ${band}`);
}
console.log(`  ★\`nameBand\` = **「이름 글자」 조각의 비율**입니다 — 사람이 그림을 보고 고릅니다.`);
console.log(`    ⚠ 기계가 대신 고르게 두지 않습니다. 실제로 하허호는 뱃지(0.5)가 글자(0.42)보다 높아,`);
console.log(`      「제일 높은 것」을 고르는 규칙이면 틀립니다. 그림을 열어 보고 고르세요.`);
console.log(`    · 비율 1 에 가까운 조각 = 심볼(세로를 다 쓴다)   · 면이 넓고 색이 다른 조각 = 뱃지`);
console.log(`    · 글자가 여러 조각으로 끊겨 있으면(낱자마다 하나) 그 무리의 비율은 서로 비슷합니다.`);
console.log(`    · 조각이 하나뿐이면 그림 전체가 글자라는 뜻이라 \`nameBand\` 를 안 줘도 됩니다.`);

/* ④⑤ 색과 대비 */
const count = new Map<string, number>();
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const [r, g, b, a] = png.at(x, y);
  if (a < 200) continue;
  const k = `${r},${g},${b}`;
  count.set(k, (count.get(k) || 0) + 1);
}
const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
console.log('\n  ── 많이 쓰인 색 (브랜드색 후보) ──');
const WHITE: [number, number, number] = [255, 255, 255];
for (const [k, n] of top) {
  const [r, g, b] = k.split(',').map(Number) as [number, number, number];
  const onWhite = ratio([r, g, b], WHITE);
  const whiteOn = onWhite; // 흰 바탕 위 글자 = 그 색 위 흰 글자 (대비는 대칭이다)
  const ok = onWhite >= 4.5;
  console.log(`    ${hex(r, g, b)}  ${String(n).padStart(6)}px   흰바탕 대비 ${onWhite}:1  ${ok ? '✓ 글자로 써도 읽힙니다' : '⚠ 글자로 쓰면 안 읽힙니다(AA 4.5:1)'}`);
  if (!ok && onWhite > 1.5) {
    /* 색상은 그대로 두고 명도만 내려 4.5 를 넘기는 «가장 덜 어두운» 값 */
    for (let p = 99; p > 0; p--) {
      const c: [number, number, number] = [Math.round(r * p / 100), Math.round(g * p / 100), Math.round(b * p / 100)];
      if (ratio(c, WHITE) >= 4.5) {
        console.log(`        → 명도 ${p}% 로 내리면 ${hex(...c)} (대비 ${ratio(c, WHITE)}:1). 색상은 그대로입니다.`);
        break;
      }
    }
  }
  void whiteOn;
}
console.log('\n  절차 = docs/간판-CI-매뉴얼.md · 게이트 = npm run check:brand\n');
