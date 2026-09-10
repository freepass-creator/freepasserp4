/**
 * **회차가 부르는 스크립트는 RTDB 에 «쓰지» 않는다.** 어기면 exit 1.
 *
 * > 사장님 2026-09-10 「너한테 지금 계속 얘기를 하는데도 **RTDB 를 왜 못 지우는지** … 답답해 죽겠다」
 *
 * ⚠⚠ **못 지운 까닭은 «많아서»가 아니라 «한 곳이 남아서»였다.**
 *   실측 2026-09-10 — 회차(`hourly-sync`·`refresh-sync`)가 부르는 스크립트 46개 중
 *   RTDB 에 **쓰는** 것은 `fix-atoms-from-refined-sheets`(⑬½ 원자 치유) **하나뿐**이었다.
 *   나머지는 읽기만 한다. 그 하나가 원자 SSOT(Firestore) 가 아닌 `v4/products` 에 쓰고
 *   「다음 미러가 전파」를 기다렸는데, 그 다리가 끊겨 있었다. 그래서
 *   **「기본형」 규칙이 이틀 동안 코드에 있는데 원자엔 기본형인 차가 한 대도 없었다.**
 *   ⇒ 그 하나를 Firestore 로 옮겼다. 이 검사는 **다시 생기는 것**을 막는다.
 *
 * ★**읽기는 아직 막지 않는다** — 감사·ERP 비추기 몇 곳이 아직 `v4/products` 를 읽는다.
 *   읽는 것은 값을 틀리게 만들지 않는다(늦을 뿐). **쓰는 것만이 두 집을 만든다.**
 *   읽기까지 끊는 것은 앱(ERP) 저장소 이관과 같이 가야 한다 — 그건 다른 공사다.
 *
 *   npm run check:cycle-no-rtdb-write
 */
import { readFileSync, existsSync } from 'node:fs';

const S = (v: unknown) => String(v ?? '').trim();

/** 회차 = 이 둘이 부르는 것 전부. 새 회차가 생기면 여기 더한다. */
const 회차 = ['scripts/hourly-sync.mts', 'scripts/refresh-sync.mts'];

const 부르는것 = new Set<string>();
for (const f of 회차) {
  if (!existsSync(f)) { console.error(`  ✗ ${f} 가 없다 — 명단을 고쳐라`); process.exit(1); }
  for (const m of readFileSync(f, 'utf8').matchAll(/scripts\/[a-zA-Z0-9._-]+\.mts/g)) 부르는것.add(m[0]);
}

/**
 * RTDB 에 «쓰는» 모양. 읽기(`.get()`·`.once(`)는 안 잡는다.
 * ⚠ 주석은 규칙을 정하지 못한다 — 먼저 걷어낸다(줄번호는 보존).
 */
const 쓰는꼴: [RegExp, string][] = [
  [/\.ref\([^)]*\)\s*\.\s*(update|set|remove|push|transaction)\s*\(/, 'RTDB 에 쓴다'],
  [/\.ref\(\)\s*\.\s*update\s*\(/, 'RTDB 루트에 통째로 쓴다'],
];
const 주석뺀다 = (raw: string): string =>
  raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
     .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

const 어긋남: string[] = [];
let 읽기만 = 0;
for (const f of [...부르는것].sort()) {
  if (!existsSync(f)) continue;
  const src = 주석뺀다(readFileSync(f, 'utf8'));
  const lines = src.split('\n');
  let 썼나 = false;
  lines.forEach((line, i) => {
    for (const [re, why] of 쓰는꼴) {
      if (re.test(line)) { 썼나 = true; 어긋남.push(`${f}:${i + 1} — ${why}\n      ${S(line).slice(0, 120)}`); }
    }
  });
  if (!썼나 && /getDatabase|v4\/(products|partners|policies)/.test(src)) 읽기만++;
}

console.log(`\n■ 회차가 RTDB 에 쓰는가 — 부르는 스크립트 ${부르는것.size}개`);
if (!어긋남.length) {
  console.log(`  ✓ 쓰는 곳 0 (읽기만 하는 곳 ${읽기만} — 아직 허용, 앱 저장소 이관과 같이 간다)\n`);
  process.exit(0);
}
console.error(`  ⛔ RTDB 에 쓰는 곳 ${어긋남.length}`);
for (const x of 어긋남) console.error(`    ${x}`);
console.error('\n  고치는 법 — 원자는 Firestore `products` 다. 그 문서에 바로 써라.');
console.error('  규칙 정본 = docs/원자-내려보내기-로직.md\n');
process.exit(1);
