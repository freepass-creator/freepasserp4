/**
 * **없는 토큰을 쓰고 있지 않은가** — 고전 스킨(`components/settlement/classic.css`)을 훑는다.
 *
 * ★★★사장님 2026-09-10 「근데 왜 상세 패널은 좀 다르지??」·「저거 UI 가 맞는 건가??」
 *
 *   재 보니 오른쪽 패널에 `box-shadow: var(--왼그늘, none)` 이 있었다.
 *   **`--왼그늘` 이라는 토큰은 어디에도 없다** — 내가 지어낸 이름이었고,
 *   폴백 `none` 때문에 그림자가 «조용히» 사라져 있었다.
 *
 * ⚠⚠ **없는 토큰은 에러가 안 난다.** CSS 는 모르는 변수를 만나면 폴백을 쓰거나 그 줄을 버린다.
 *   그래서 오타 하나가 «결이 통째로 빠진» 화면을 만들고, 아무도 모른 채 며칠이 간다.
 *   ★그림자·색은 «있으면 보이고 없으면 안 보이는» 것이라 특히 그렇다.
 *
 *   npm run check:tokens
 */
import { readFileSync } from 'node:fs';

const 벗 = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const css = 벗(readFileSync('components/settlement/classic.css', 'utf8'));

/** 이 파일이 «정의한» 토큰. */
const 정의 = new Set([...css.matchAll(/^\s*(--[가-힣A-Za-z0-9-]+)\s*:/gm)].map((m) => m[1]));
/** 이 파일이 «쓰는» 토큰. */
const 씀 = new Map<string, number>();
for (const m of css.matchAll(/var\((--[가-힣A-Za-z0-9-]+)/g)) 씀.set(m[1], (씀.get(m[1]) || 0) + 1);

/**
 * ★밖에서 오는 것 — 앱 전역 글꼴. 고전 스킨이 정의할 것이 아니다.
 *   여기 적는 것만 «밖에서 온다»고 인정한다. 적어 두지 않으면 다음 사람이 오타를 눈감아 준다.
 */
const 밖에서 = new Set([
  '--font-hangeul', '--font-mono',
  /** ★화면이 인라인으로 실어 주는 것 — 담당자가 가름바로 정한 값이라 CSS 가 정의하지 않는다.
   *   폴백이 «뜻이 있는» 기본값(반반)이라 없어도 화면이 제대로 선다. */
  '--아래높이',
]);

const 없는 = [...씀].filter(([k]) => !정의.has(k) && !밖에서.has(k)).sort();

console.log(`\n■ 고전 스킨 토큰 — 정의 ${정의.size}개 · 쓰임 ${씀.size}가지\n`);
if (!없는.length) {
  console.log('  ✓ 없는 토큰을 쓰는 곳이 없습니다.\n');
  process.exit(0);
}
console.log(`  ✕ 정의되지 않은 토큰 ${없는.length}가지\n`);
for (const [k, n] of 없는) {
  const 줄 = css.split('\n').findIndex((l) => l.includes(`var(${k}`)) + 1;
  console.log(`     ${k.padEnd(16)} ${String(n).padStart(2)}곳   (첫 자리 ${줄}줄)`);
}
console.log(`
  ★고치는 법 — 이름을 잘못 적었으면 «정의된 이름»으로 바꾸고,
    정말 새 토큰이 필요하면 \`.cl\` 토큰 블록에 «값을 정해» 넣는다.
  ⚠ 폴백(\`var(--없는, none)\`)으로 덮지 마라 — 그러면 사라진 것을 아무도 모른다.
`);
process.exit(1);
