/**
 * **「검사기가 초록인 것」과 「검사기가 무언가를 잡는 것」은 다른 주장이다.**
 * 이 자는 뒤쪽을 «기계로» 증명한다. 읽기 전용(임시 파일 하나만 쓰고 지운다). 어기면 exit 1.
 *
 * ## 왜 있나 — 2026-09-16 실측으로 여럿 나왔다
 *
 *   · `check:store`   자가진단이 **깨진 채 방치**됐고(대조군이 «실제 운영 파일»이라 코드가
 *                     깨끗해지자 죽었다), 그 뒤에 「RTDB 기준 24→0 인데 기준이 24 방치」가 숨어 있었다
 *   · `check:tokens`  **설명 주석**을 위반으로 셌다 — **오탐도 결함이다**
 *   · `check:workflows` `rm` 줄을 「준비」로 오인했고, 파일 아무 데나 `if: always()` 가 있으면 통과시켰다
 *   · PR #38 링크 검사  **엉뚱한 봉쇄에 먼저 걸려** 통과했다 — 시험된 적이 없었다
 *   · PR #38 head 검사  **같은 에러 코드** 때문에 「원장 전에 막았다」와 구별이 안 됐다
 *
 * ⇒ 정본 `scripts/ci-checker-manifest.json` 의 (a) 는 「CI 가 검사기를 «부르는가»」를 기계에 넘겼다.
 *   이 자는 (b) — 「그 검사기가 «잡기는 하는가»」를 기계에 넘긴다.
 *
 * ## 무엇을 하는가 — 「표본이 있다」가 아니라 「표본이 그 봉쇄를 시험한다」를 잰다
 *
 * 정본의 `required` 항목마다 `known_bad` 를 읽고, 봉쇄(blockade) 하나하나에 대해:
 *
 *   ㉠ **기준선**  검사기를 그대로 돌린다 → 초록이어야 한다
 *   ㉡ **무력화**  그 봉쇄 «하나만» 빼낸 사본을 만들어 돌린다 → **빨개져야 한다**
 *   ㉢ **분간**    빨개진 이유가 «그 대조군»인지 `표시` 글귀로 확인한다
 *                 ★이게 PR #38 의 교훈이다 — 같은 에러 코드면 「막았다」와 「엉뚱한 데서 죽었다」가
 *                   구별되지 않는다. 빨간불은 이유까지 대야 증거가 된다.
 *
 * 봉쇄를 하나씩만 빼므로, **그 봉쇄가 지키는 검사만** 빨개지는지가 드러난다.
 * 무력화 글귀가 소스에 정확히 한 번 안 나오면 그 자리에서 실패한다 — 표본이 코드에서
 * 떨어져 나간 것을 「통과」로 넘기지 않기 위해서다.
 *
 * ## ★「아직 없음」은 숨기지 않는다
 *
 * `required` 인데 아직 known-bad 가 없는 것은 `known_bad_pending` 에 «이유»와 함께 적는다.
 * 이 자는 그것을 **매번 소리 내어 센다**(초록불이어도 목록을 찍는다).
 * 등재 자체를 빼먹는 것은 `check:workflows` ⑤ 절이 막는다 —
 * **「모른다」를 「없다」로 바꾸지 않는다.**
 *
 *   npm run check:known-bad              전부 잰다
 *   npm run check:known-bad -- --자가진단  기계장치 자신을 잰다(가짜 검사기 둘로)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = 'scripts/ci-checker-manifest.json';

type 봉쇄 = { 이름: string; 무력화: [string, string] };
type KnownBad = { 표본: string; 표시: string; 인자?: string[]; 봉쇄: 봉쇄[] };
type Entry = { why?: string; reason?: string; workflow?: string; known_bad?: KnownBad; known_bad_pending?: string };
type Manifest = { required: Record<string, Entry> };

/** 무력화 사본이 앉을 자리. **검사기와 «같은 폴더»여야 한다** — `new URL('..')` 뿌리가 안 어긋나게. */
const MUTANT = join(ROOT, 'scripts', '.knownbad-mutant.mts');

function 돌린다(스크립트: string, 인자: string[]): { code: number; out: string } {
  const r = spawnSync(process.execPath, [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 스크립트, ...인자], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * **한 검사기를 판정한다.** 통과하면 빈 배열, 아니면 어긋난 까닭들.
 * ★이 «한 자»가 실제 검사기에도, 자가진단의 가짜 검사기에도 똑같이 쓰인다 —
 *   기계장치를 다른 길로 시험하면 그건 이 기계장치를 시험한 것이 아니다.
 */
function 판정(이름: string, 스크립트: string, kb: KnownBad): string[] {
  const 탈: string[] = [];
  const 인자 = kb.인자 ?? [];
  const 원본 = readFileSync(join(ROOT, 스크립트), 'utf8');

  // ㉠ 기준선 — 손대지 않은 검사기는 초록이어야 한다. 빨갛다면 아래 판정은 의미가 없다.
  const 기준 = 돌린다(스크립트, 인자);
  if (기준.code !== 0) {
    탈.push(`${이름} — 기준선이 «이미» 빨갛다(exit ${기준.code}). 무력화 실험이 성립하지 않는다.\n      ${기준.out.trim().split('\n').slice(-3).join('\n      ')}`);
    return 탈;
  }

  if (!kb.봉쇄.length) 탈.push(`${이름} — 봉쇄가 «하나도» 적혀 있지 않다. 빈 목록은 증명이 아니다.`);

  for (const b of kb.봉쇄) {
    const [찾을것, 바꿀것] = b.무력화;
    const 횟수 = 원본.split(찾을것).length - 1;
    if (횟수 !== 1) {
      탈.push(
        `${이름} · ${b.이름} — 무력화 글귀가 ${스크립트} 에 ${횟수}번 나온다(정확히 1번이어야 한다).\n` +
          `      검사기가 바뀌어 표본이 «떨어져 나갔다». 정본의 무력화 글귀를 지금 코드에 맞춰라.`,
      );
      continue;
    }
    writeFileSync(MUTANT, 원본.split(찾을것).join(바꿀것), 'utf8');
    try {
      const r = 돌린다('scripts/.knownbad-mutant.mts', 인자);
      if (r.code === 0) {
        탈.push(
          `${이름} · 「${b.이름}」 봉쇄를 빼도 **초록이다**.\n` +
            `      표본이 이 봉쇄를 시험하지 «않는다». 「표본이 있다」와 「표본이 시험한다」는 다른 주장이다.\n` +
            `      고치기: ${kb.표본} 에 이 봉쇄가 «혼자» 막는 표본을 더해라.`,
        );
      } else if (!r.out.includes(kb.표시)) {
        // ★PR #38 — 같은 에러 코드로는 「막았다」와 「엉뚱한 데서 죽었다」가 구별되지 않는다.
        탈.push(
          `${이름} · 「${b.이름}」 봉쇄를 빼니 빨개지긴 했는데 «이유가 다르다»(「${kb.표시}」 가 안 보인다).\n` +
            `      엉뚱한 봉쇄에 먼저 걸린 것일 수 있다 — 그러면 이 표본은 시험된 적이 없다.\n` +
            `      ${r.out.trim().split('\n').slice(-3).join('\n      ')}`,
        );
      }
    } finally {
      rmSync(MUTANT, { force: true });
    }
  }
  return 탈;
}

/* ───────────────────────────────────────────────────────────────────────
 * 자가진단 — **기계장치 자신이 눈멀지 않았는가.**
 *
 * 가짜 검사기 둘을 판정한다. 정직한 쪽은 PASS, 눈먼 쪽은 FAIL 이 나와야 한다.
 * ★눈먼 쪽이 PASS 로 나오면 이 기계장치가 「봉쇄를 빼도 초록」을 못 잡는다는 뜻이다 —
 *   그러면 이 자는 제가 막으려던 바로 그 거짓 초록이 된다.
 */
if (process.argv.includes('--자가진단')) {
  const 무력화: [string, string] = ['const DETECT = /금지된자취/;', 'const DETECT = /(?!)/;'];
  /*
   * ★★네 사례가 «각각 다른 봉쇄»를 지킨다 — 봉쇄를 하나씩 빼 봐야 이게 드러난다.
   *   처음엔 정직·눈먼 둘뿐이었는데, 그때는 `r.code === 0` 봉쇄를 빼도 기계장치가 초록이었다.
   *   「표시」 검사가 같은 사고를 겹쳐 잡고 있어서 그 봉쇄가 «혼자서는» 시험된 적이 없었던 것이다.
   *   ⚠ 그 자리에서 «검사를 낮춰» 통과시키는 것이 가장 쉬운 실패 경로였다. 표본을 더하는 쪽으로 고쳤다.
   */
  const 사례: Array<[string, string, boolean, 봉쇄?]> = [
    ['정직한 검사기(대조군 있음)', 'tests/known-bad/_harness/정직한검사기.mts', true],
    ['눈먼 검사기(대조군 없음)', 'tests/known-bad/_harness/눈먼검사기.mts', false],
    ['거짓 초록(고장이라 적고 exit 0)', 'tests/known-bad/_harness/거짓초록검사기.mts', false],
    ['엉뚱하게 죽는 검사기(이유가 다르다)', 'tests/known-bad/_harness/엉뚱하게죽는검사기.mts', false],
    /*
     * ★★**「횟수 !== 1」(낡은 무력화 글귀) 봉쇄는 «일부러» 여기 안 넣는다** — 2026-09-16 실측.
     *
     *   넣으려다 실측해 보니, 그것을 빼도 자가진단이 초록이었다. 까닭을 따라가 보면:
     *   무력화 글귀가 코드에서 떨어져 나가면 사본이 원본과 «같아지고», 기준선이 초록이라는
     *   전제(㉠) 때문에 그 사본은 반드시 exit 0 이 된다 — 그러면 `r.code === 0` 봉쇄가
     *   **이미 그것을 잡는다.** 즉 이 자리는 독립된 안전 속성이 아니라 «말을 더 잘 해 주는» 자리다.
     *
     *   ⚠ 그래서 정본의 봉쇄로도 «안 적는다». 시험하지 못하는 것을 「시험했다」고 적는 것이
     *     바로 이 자가 막으려는 거짓말이다. 표본을 억지로 맞추거나 검사를 낮추느니
     *     **「이건 이 기계로 증명이 안 된다」를 적어 두는 편**이 정직하다.
     */
  ];
  const 틀린: string[] = [];
  for (const [설명, 경로, 통과해야하나, 별도봉쇄] of 사례) {
    const 탈 = 판정(설명, 경로, { 표본: '(없음)', 표시: '검사기 고장', 봉쇄: [별도봉쇄 ?? { 이름: '탐지기', 무력화 }] });
    const 통과했나 = 탈.length === 0;
    if (통과했나 !== 통과해야하나) {
      틀린.push(
        통과해야하나
          ? `${설명} — PASS 여야 하는데 FAIL 이다: ${탈.join(' / ')}`
          : `${설명} — FAIL 이여야 하는데 PASS 다. 기계장치가 「봉쇄를 빼도 초록」을 «못 잡는다».`,
      );
    }
  }
  if (틀린.length) {
    console.error(`\n✗ 기계장치 고장 — 자가진단 ${틀린.length}건이 어긋난다.\n`);
    for (const t of 틀린) console.error(`  ${t}`);
    console.error('');
    process.exit(1);
  }
  console.log('\n  ✓ 기계장치 자가진단 — 정직한 검사기는 PASS, 눈먼 검사기는 FAIL 로 갈렸다\n');
  process.exit(0);
}

/* ─────────────────────────────────────────────────────────────────────── */

const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST), 'utf8')) as Manifest;
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };

const 탈: string[] = [];
const 잰것: string[] = [];
const 아직없음: Array<[string, string]> = [];

for (const [이름, entry] of Object.entries(manifest.required)) {
  if (entry.known_bad_pending) {
    아직없음.push([이름, entry.known_bad_pending]);
    continue;
  }
  const kb = entry.known_bad;
  if (!kb) {
    // check:workflows ⑤ 가 먼저 막지만, 이 자도 제 눈으로 본다.
    탈.push(`${이름} — required 인데 known_bad 도 known_bad_pending 도 없다. 「모른다」를 「없다」로 바꾸지 마라.`);
    continue;
  }
  const cmd = pkg.scripts[이름];
  const m = cmd?.match(/(scripts\/[\w.-]+\.(?:mts|mjs|ts))/);
  if (!m) {
    탈.push(`${이름} — package.json 의 명령(${cmd ?? '없음'})에서 스크립트 경로를 못 읽었다.`);
    continue;
  }
  if (!existsSync(join(ROOT, kb.표본)) && kb.표본 !== '인라인') {
    탈.push(`${이름} — 표본 자리 ${kb.표본} 가 없다.`);
    continue;
  }
  const 결과 = 판정(이름, m[1], kb);
  if (결과.length) 탈.push(...결과);
  else 잰것.push(`${이름}  (봉쇄 ${kb.봉쇄.length}개 · 표본 ${kb.표본})`);
}

const 전체 = Object.keys(manifest.required).length;

console.log(`\n  known-bad 실측 — required ${전체}개 중 ${잰것.length}개가 «잡는다»는 것을 증명했다\n`);
for (const s of 잰것) console.log(`   ✓ ${s}`);

/*
 * ★★「아직 없음」을 숨기지 않는다. 초록불이어도 «매번» 찍는다.
 *   무엇이 비었는지 보이는 것이 이 일의 절반이다 — 안 보이면 다음 세션이 또 「다 됐다」고 센다.
 */
if (아직없음.length) {
  console.log(`\n  ⃝ 아직 known-bad 가 «없는» required — ${아직없음.length}개 (초록불이지만 «잡는다»는 증거는 없다)\n`);
  for (const [이름, 이유] of 아직없음) console.log(`   ⃝ ${이름}\n       ${이유}`);
  console.log(`\n   ⇒ 이 ${아직없음.length}개는 「통과했다」가 아니라 「시험된 적 없다」는 뜻이다.`);
  console.log('     하나씩 표본을 붙이고 정본의 known_bad_pending 을 known_bad 로 옮겨라.\n');
}

if (탈.length) {
  console.error(`\n  ✗ known-bad 표본이 제 구실을 못 한다 — ${탈.length}건\n`);
  for (const t of 탈) console.error(`   ${t}\n`);
  console.error('  「표본이 있다」와 「표본이 그 검사기를 시험한다」는 다른 주장이다.');
  console.error('  ⚠ 표본을 통과시키려고 «검사 조건을 낮추지» 마라 — 그게 가장 쉬운 실패 경로다.\n');
  process.exit(1);
}
process.exit(0);
