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

/**
 * ─────────────────────────────────────────────────────────────────────
 * ② 자격증명 «준비 단계»가 빠진 워크플로 — 2026-09-16 사고.
 *
 * 시크릿 `GOOGLE_SA_JSON`·`SONOGONG_ACCOUNT_JSON` 은 «둘 다 등록돼 있었다».
 * 죽은 이유는 시크릿을 러너의 «파일로 써 주는 준비 단계»가 워크플로마다 복붙돼 있었고
 * `sales-erp-hourly.yml` 만 손오공 준비를 빠뜨렸기 때문이다 —
 * 매 회차가 「⛔ 중단 — 손오공 계정 없음」으로 죽었다.
 *
 * ★「참조한다」가 아니라 「필요하다」를 본다. 워크플로가 손오공 API 를 타는 입구를
 *   `--손오공없이` 없이 부르면 → 손오공 계정이 **필요**하다.
 *   (scripts/hourly-sync.mts 가 .손오공계정.json 없으면 stop() 한다)
 */
const needsSonogongEntry = [
  'scripts/cloud-hourly-sync.mts',
  'scripts/run-hourly-with-ssot-gate.mts',
  'scripts/hourly-sync.mts',
  'sonokong/scripts/',
];

/**
 * 준비가 돼 있다고 인정하는 형태 — 합성 액션에 값을 넘기거나, (레거시) 직접 파일로 **쓰거나**.
 * ★일부러 깨 보고 고친 것: 처음엔 `.손오공계정.json` 이 파일 어디에든 있으면 준비된 걸로 쳤다.
 *   그러면 erp5-ssot-refresh.yml 에서 **쓰는 줄을 지워도** 맨 끝 `rm -rf ... .손오공계정.json`
 *   (삭제 단계)이 걸려 통과했다. 삭제는 준비의 증거가 아니다 — «쓰기»(`> 경로`)만 본다.
 */
const prepSonogongInput = /sonogong-account-json:/;
const prepSonogongWrite = />\s*\S*\.손오공계정\.json/;
const prepGoogleSaInput = /google-sa-json:/;
const prepGoogleSaWrite = />\s*\S*tmp\/firebase-auth\/\S+/;

/** 워크플로를 «스텝» 단위로 쪼갠다 — `if: always()` 가 «그 스텝»에 붙었는지 보려면 필요하다. */
function stepBlocks(lines: string[]): string[] {
  const blocks: string[] = [];
  let cur: string[] | null = null;
  for (const line of lines) {
    if (/^\s+- \S/.test(line)) {
      if (cur) blocks.push(cur.join('\n'));
      cur = [line];
    } else if (cur) {
      cur.push(line);
    }
  }
  if (cur) blocks.push(cur.join('\n'));
  return blocks;
}

/**
 * 「부른다」는 **`run:` 안에서만** 참이다.
 * ★실측: 이 검사를 처음 켰을 때 ssot-contract.yml 이 걸렸는데,
 *   거기 적힌 scripts/cloud-hourly-sync.mts 는 `on.push.paths` 의 **변경 감시 목록**이었다.
 *   그 워크플로는 그 스크립트를 돌리지 않는다. `paths:` 를 「부른다」로 세면 안 된다.
 */
function runBodies(lines: string[]): string {
  const out: string[] = [];
  let indent = -1;
  for (const line of lines) {
    if (indent >= 0) {
      // 빈 줄은 블록 스칼라 안에서 유효하다. 들여쓰기가 풀리면 블록이 끝난 것.
      if (!line.trim()) continue;
      const cur = line.length - line.trimStart().length;
      if (cur > indent) {
        out.push(line);
        continue;
      }
      indent = -1;
    }
    const m = /^(\s*)-?\s*run:\s*(.*)$/.exec(line);
    if (m) {
      if (m[2] && m[2] !== '|' && m[2] !== '>' && !/^[|>][-+]?$/.test(m[2])) out.push(m[2]);
      indent = m[1].length;
    }
  }
  return out.join('\n');
}

const gaps: string[] = [];

for (const f of readdirSync(DIR)) {
  if (!/\.ya?ml$/.test(f)) continue;
  const raw = readFileSync(`${DIR}/${f}`, 'utf8');
  // 주석은 「부른다」의 증거가 아니다 — 지워 놓고 본다.
  const noComments = raw.split(/\r?\n/).filter((l) => !l.trimStart().startsWith('#'));
  const body = noComments.join('\n');
  const runs = runBodies(noComments);

  // ── 손오공: 필요한가? (`run:` 안에서 실제로 부르는가 — `paths:` 목록은 부르는 게 아니다)
  const callsSonogong = needsSonogongEntry.some((e) => runs.includes(e));
  const optedOut = runs.includes('--손오공없이');
  const sonogongReady = prepSonogongInput.test(body) || prepSonogongWrite.test(runs);
  if (callsSonogong && !optedOut && !sonogongReady) {
    gaps.push(
      `  ${DIR}/${f}\n` +
        `      손오공 API 를 타는데(${needsSonogongEntry.filter((e) => runs.includes(e)).join(', ')})\n` +
        `      SONOGONG_ACCOUNT_JSON 준비 단계가 없다 → 「⛔ 중단 — 손오공 계정 없음」으로 죽는다.\n` +
        `      고치기: uses: ./.github/actions/prepare-credentials 에\n` +
        `              sonogong-account-json: \${{ secrets.SONOGONG_ACCOUNT_JSON }}\n` +
        `              require-sonogong: 'true'`,
    );
  }

  // ── 구글 SA: 시크릿을 «참조»하면 반드시 파일로 써 줘야 한다(참조만 하면 아무 일도 안 일어난다).
  const googleSaReady = prepGoogleSaInput.test(body) || prepGoogleSaWrite.test(runs);
  if (/secrets\.GOOGLE_SA_JSON/.test(body) && !googleSaReady) {
    gaps.push(
      `  ${DIR}/${f}\n` +
        `      GOOGLE_SA_JSON 을 참조만 하고 파일로 쓰지 않는다 — 스크립트는 파일을 읽는다.`,
    );
  }

  // ── 준비를 했으면 «반드시» 지워야 한다.
  //    ★일부러 깨 보고 고친 것: 처음엔 파일 «전체»에 `if: always()` 가 하나라도 있으면 통과시켰다.
  //      sheet-sync.yml 은 「일일 반영 요약」 스텝이 이미 if: always() 라서, 삭제 스텝에서
  //      if: always() 를 떼도 검사기가 못 잡았다. 그래서 «삭제 스텝 자신»만 본다.
  const prepared = prepSonogongInput.test(body) || prepGoogleSaInput.test(body) || /printf '%s'/.test(body);
  if (prepared) {
    const cleanupSteps = stepBlocks(noComments).filter(
      (b) => /cleanup-credentials/.test(b) || /rm -rf .*(tmp\/firebase-auth|손오공계정)/.test(b),
    );
    if (!cleanupSteps.length) {
      gaps.push(`  ${DIR}/${f}\n      자격증명을 놓고 «지우는 단계»가 없다. if: always() 로 지워라.`);
    } else if (!cleanupSteps.some((b) => /^\s*if:\s*always\(\)\s*$/m.test(b))) {
      gaps.push(
        `  ${DIR}/${f}\n      자격증명 «삭제 스텝 자신»에 if: always() 가 없다 — 앞이 죽으면 키가 러너에 남는다.`,
      );
    }
  }
}

if (!hits.length && !gaps.length) {
  console.log(`\n  ✓ 워크플로 ${files}개 — 「돌기 전에 죽는」 문법 없음 · 자격증명 준비 구멍 없음\n`);
  process.exit(0);
}

if (hits.length) {
  console.log(`\n  ✗ 워크플로가 돌기도 «전»에 죽는다 — ${hits.length}건\n`);
  for (const h of hits) console.log(h + '\n');
  console.log('  이건 로그도 안 남는다. GitHub 이 파일을 못 읽어 런을 그냥 실패시킨다.');
  console.log('  (2026-09-08: 이 한 줄로 판매·ERP 시간별 동기가 첫 커밋부터 한 번도 안 돌았다)\n');
}

if (gaps.length) {
  console.log(`\n  ✗ 자격증명 준비 구멍 — ${gaps.length}건\n`);
  for (const g of gaps) console.log(g + '\n');
  console.log('  시크릿은 등록돼 있어도 «파일로 써 주는 준비 단계»가 없으면 아무 소용이 없다.');
  console.log('  (2026-09-16: sales-erp-hourly.yml 이 이것 하나로 매 회차 죽었다)\n');
}

process.exit(1);
