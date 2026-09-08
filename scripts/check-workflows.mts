/**
 * 워크플로 파일 검사 — 「돌기도 «전»에 죽는 워크플로」를 잡는다.
 *
 * 왜 있나(2026-09-08). `.github/workflows/sales-erp-hourly.yml` 의 **한 줄**이
 *
 *     env: { SA: ${{ secrets.GOOGLE_SA_JSON }} }
 *
 * 흐름형(`{ }`) 안에서 `${{` 의 `{` 를 YAML 이 «또 다른 흐름 매핑의 시작»으로 잡는다.
 * 그러면 GitHub 은 스텝을 돌리기도 전에 런을 실패시킨다 —
 * **그 워크플로는 첫 커밋부터 한 번도 성공한 적이 없었다(최근 100회 전부 failure).**
 * 사람 눈에는 안 보인다. 로그가 없고, 실패 이유가 「workflow file issue」한 줄이기 때문이다.
 *
 * ★그래서 «YAML 로 읽히는가»를 기계가 본다. 읽히기만 하면 되므로 GitHub 문법까지는 안 본다 —
 *   못 읽히는 것만으로도 워크플로는 죽어 있다.
 *
 * 쓰기: npm run check:workflows
 */
import { readdirSync, readFileSync } from 'node:fs';

const DIR = '.github/workflows';

/**
 * 아주 작은 YAML 「읽히는가」 검사. 의존성을 새로 들이지 않으려고 **이 결함만** 정확히 본다.
 * ⚠ 일반 YAML 파서가 아니다 — 흐름형 안의 맨몸 `${{ }}` 를 찾는 것이 목적이다.
 *   (이 한 가지가 이 저장소에서 실제로 워크플로를 죽인 유일한 문법 사고다.)
 */
const FLOW_EXPR = /^\s*[\w.-]+:\s*\{[^}]*\$\{\{/;

/** 흐름형 밖에서도 «값이 맨몸 ${{ }}» 이면 GitHub 은 읽지만 YAML 로는 위험하다 — 따옴표를 권한다. */
const hits: string[] = [];
let files = 0;

for (const f of readdirSync(DIR)) {
  if (!/\.ya?ml$/.test(f)) continue;
  files++;
  const lines = readFileSync(`${DIR}/${f}`, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('#')) return;
    if (FLOW_EXPR.test(line)) {
      hits.push(`  ${DIR}/${f}:${i + 1}\n      ${line.trim()}\n      → 흐름형(\`{ }\`) 안의 \${{ }} 는 YAML 이 못 읽는다. 블록형으로 풀어라:\n            env:\n              KEY: \${{ secrets.X }}`);
    }
  });
}

if (!hits.length) {
  console.log(`\n  ✓ 워크플로 ${files}개 — 「돌기 전에 죽는」 문법 없음\n`);
  process.exit(0);
}

console.log(`\n  ✗ 워크플로가 돌기도 «전»에 죽는다 — ${hits.length}건\n`);
for (const h of hits) console.log(h + '\n');
console.log('  이건 로그도 안 남는다. GitHub 이 파일을 못 읽어 런을 그냥 실패시킨다.');
console.log('  (2026-09-08: 이 한 줄로 판매·ERP 시간별 동기가 첫 커밋부터 한 번도 안 돌았다)\n');
process.exit(1);
