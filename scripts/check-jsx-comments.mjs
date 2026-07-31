// JSX 자식 위치의 `//` 주석 = 화면에 글자로 그대로 찍힌다. 전수 검사.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const bad = [];
function walk(d) {
  for (const f of readdirSync(d, { withFileTypes: true })) {
    if (f.name === 'node_modules' || f.name.startsWith('.next')) continue;
    const p = join(d, f.name);
    if (f.isDirectory()) { walk(p); continue; }
    if (!f.name.endsWith('.tsx')) continue;
    const lines = readFileSync(p, 'utf8').split('\n');
    lines.forEach((L, i) => {
      const t = L.trim();
      if (!t.startsWith('//')) return;
      const prev = (lines[i - 1] || '').trim();
      const next = (lines[i + 1] || '').trim();
      // 앞줄이 JSX 여는 태그/프래그먼트로 끝나고 다음 줄이 JSX/표현식으로 시작하면 자식 위치다.
      // ※ `return (` 다음 줄은 자식이 아니라 **JSX 이전**이라 그냥 JS 주석이다 — 화면에 안 찍힌다.
      //   자기닫힘(`/>`)도 자식을 여는 게 아니다.
      const prevOpensJsx = prev === '<>'
        || (/^<[A-Za-z]/.test(prev) && prev.endsWith('>') && !prev.endsWith('/>'));
      const nextIsJsx = next.startsWith('<') || next.startsWith('{');
      if (prevOpensJsx && nextIsJsx) bad.push(`${p}:${i + 1}  ${t.slice(0, 80)}`);
    });
  }
}
for (const d of ['app', 'components', 'features']) walk(d);
console.log(bad.length ? bad.join('\n') : '✓ JSX 자식 위치의 // 주석 없음');
