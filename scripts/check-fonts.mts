/**
 * 폰트 토큰 정합성 가드 — 재난립 차단(디자인 정합성 Step 6, ESLint 대체).
 *   app/·components/ 의 raw fontWeight 800/900 · 오프스케일 fontSize 를 금지.
 *   위계는 크기(FS)+색으로, 두께는 FW 토큰(최대 head=700). 대표 금액 히어로 1개만 800 예외 허용 안 함(FW.head).
 *   실행: npx tsx scripts/check-fonts.mts   (0=정합 · 1=드리프트)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // scripts/ 의 부모 = 프로젝트 루트
const ROOTS = ['app', 'components'];
const BAN = [
  { re: /fontWeight:\s*[89]00\b/, msg: 'fontWeight 800/900 금지 → FW 토큰(title 650·head 700·strong 600·label 550)' },
  { re: /fontSize:\s*(11\.5|10\.5|13\.5|15\.5)\b/, msg: '오프스케일 fontSize 금지 → FS 토큰(cap 11·micro 10·body 13·title 14.5)' },
];

const hits: string[] = [];
function walk(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') walk(p); continue; }
    if (!e.name.endsWith('.tsx')) continue;
    const lines = readFileSync(p, 'utf8').split(/\r?\n/);
    lines.forEach((ln, i) => {
      for (const b of BAN) if (b.re.test(ln)) hits.push(`  ${p.slice(ROOT.length)}:${i + 1}\n    ${b.msg}\n    → ${ln.trim().slice(0, 120)}`);
    });
  }
}
for (const r of ROOTS) walk(join(ROOT, r));

if (hits.length) {
  console.log(`✗ 폰트 드리프트 ${hits.length}건 발견 — FW/FS 토큰으로 고칠 것:\n\n${hits.join('\n\n')}`);
  process.exit(1);
}
console.log('✓ 폰트 드리프트 0 — FW/FS 토큰 정합성 유지');
process.exit(0);
