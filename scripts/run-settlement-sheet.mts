/**
 * **정산원장을 한 번에 정리한다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-26 「이 셋을 한 줄로 묶어달라」.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ★★★**차례가 곧 안전장치다.** 따로 돌리면 뒤엣것이 앞엣것을 지운다.
 * ```
 * ① 대장 쌓기    상품시트 3탭 → v4/plate_registry   (누적 · 지우지 않는다)
 * ② 탭 정리      원장 네 탭을 다시 세운다            ★접수 탭을 «통째로 다시 쓴다»
 * ③ 대장 얹기    「차량대장」 탭 + 접수 빈 줄 자동 채움 ★반드시 ② 뒤
 * ```
 *   ⚠ **②만 돌리면 ③이 건 수식이 조용히 사라진다.** 차번을 적어도 공급사·모델명이
 *     안 따라오는데 «왜 안 되는지»가 화면 어디에도 안 나온다. 그게 제일 위험해서 묶었다.
 *   ⚠ 순서를 바꾸지 마라. ③을 ② 앞에 두면 그 자리에서 헛일이 된다.
 *
 * ★**하나가 넘어지면 멈춘다.** 반쯤 된 원장이 제일 나쁘다 —
 *   탭은 정리됐는데 대장이 안 얹히면 사람은 «다 됐다»고 믿고 쓴다.
 *
 * ★쓰기 할당량 — 구글은 «분당 60번»만 받는다. 사이를 띄운다(2026-08-26 실측으로 걸렸다).
 *
 *   npx tsx scripts/run-settlement-sheet.mts            무엇을 할지만 본다
 *   npx tsx scripts/run-settlement-sheet.mts --apply    실제로 돌린다
 */
import { spawnSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');

/** 도는 차례. **바꾸지 마라** — 위 머리말에 왜인지 적혀 있다. */
const STEPS = [
  { no: '①', why: '상품시트 → 차량대장 쌓기', file: 'scripts/build-plate-registry.mts' },
  { no: '②', why: '원장 네 탭 다시 세우기', file: 'scripts/build-settlement-tabs.mts' },
  { no: '③', why: '차량대장 탭 + 접수 자동 채움', file: 'scripts/publish-plate-registry-tab.mts' },
] as const;

/** 쓰기 할당량이 풀리게 사이를 띄운다. */
const breathe = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log(`\n■ 정산원장 정리 ${APPLY ? '(반영)' : '(dry-run)'}\n`);

for (const [i, s] of STEPS.entries()) {
  console.log(`\n────────── ${s.no} ${s.why}`);
  const r = spawnSync('npx', ['tsx', s.file, ...(APPLY ? ['--apply'] : [])], {
    stdio: 'inherit', shell: true,
  });
  if (r.status !== 0) {
    console.log(`\n✕ ${s.no} 에서 멈췄습니다 — ${s.file}`);
    console.log('   ★반쯤 된 원장이 제일 나쁩니다. 여기를 고치고 처음부터 다시 돌리세요.\n');
    process.exit(1);
  }
  // ★마지막 단계 뒤에는 안 쉰다. 쉬어 봐야 기다리기만 한다.
  if (APPLY && i < STEPS.length - 1) {
    console.log('\n   … 쓰기 할당량이 풀리게 40초 쉽니다');
    await breathe(40_000);
  }
}

console.log(`\n■ 끝${APPLY ? '' : ' — dry-run 이라 아무것도 안 썼습니다'}\n`);
