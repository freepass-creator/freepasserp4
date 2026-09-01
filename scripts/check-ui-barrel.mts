/**
 * `components/ui` 배럴 점검 — 새 원자를 만들고 **내보내는 것을 잊지 않게** 한다.
 *
 * ★왜 필요한가: `components/ui/index.tsx` 는 ERP 원자의 «문»이다.
 *   파일만 만들고 이 문에 걸지 않으면 `@/components/ui` 에서 import 하는 순간
 *   **화면 전체가 500 으로 안 뜬다.**
 *   실제로 `flow-actions` · `summary-stats` 둘이 안 걸려서 손님 서명 화면이 죽어 있었다
 *   (2026-08-28. 「Export FlowActions doesn't exist in target module」).
 *
 * ⚠ tsc 도 이걸 잡는다 — 다만 «누군가 그 이름을 import 한 뒤»에만 잡는다.
 *   이 검사는 **import 하기 전에** 잡는다. 새 원자를 만들어 두고 아직 아무 데서도 안 쓰면
 *   tsc 는 조용하고, 나중에 처음 쓰는 사람이 500 을 만난다. 그 시차를 없애는 것이 목적이다.
 *   (2026-08-28 실측: summary-stats 를 빼면 tsc 도 잡는다. 이 검사가 tsc 를 대신하지 않는다.)
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = 'components/ui';
/** 배럴이 아니거나, 값이 아니라 «토큰»만 골라 내보내는 것 — 일부러 별표(*)로 안 연다. */
const SKIP = new Set(['index', 'tokens']);

const barrel = readFileSync(`${DIR}/index.tsx`, 'utf8');
const files = readdirSync(DIR)
  .filter((name) => /\.tsx?$/.test(name))
  .map((name) => name.replace(/\.tsx?$/, ''))
  .filter((base) => !SKIP.has(base));

assert.ok(files.length > 10, `원자 파일이 너무 적게 잡혔습니다 (${files.length}개) — 이 검사의 경로가 틀렸습니다`);

const missing = files.filter((base) => !barrel.includes(`'./${base}'`));
assert.deepEqual(
  missing, [],
  `components/ui/index.tsx 에서 안 내보내는 파일이 있습니다.\n`
  + `  이대로 두면 @/components/ui 에서 import 하는 화면이 500 으로 죽습니다(tsc 는 통과합니다):\n`
  + missing.map((base) => `    export * from './${base}';`).join('\n'),
);

console.log(`✓ ui 배럴: 원자 ${files.length}개가 모두 index.tsx 에서 나간다`);
