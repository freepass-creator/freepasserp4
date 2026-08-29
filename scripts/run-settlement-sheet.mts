/**
 * **정산원장을 한 번에 정리한다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-26 「이 셋을 한 줄로 묶어달라」 → 2026-08-28 대장을 걷어내 «탭 정리» 하나만 남았다.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ★★**차량대장은 걷어냈다**(사장님 2026-08-28 「정산시트 만들거고 차량대장은 없어도 됨 ·
 *   그냥 수기로 입력하게 하자 이거 일이네… · 그냥 직접 입력하는거로 얼마 힘들지 않으니까」).
 *
 *   전에는 세 단계였다 — ① 상품시트 → `v4/plate_registry` 쌓기 · ② 탭 정리 ·
 *   ③ 「차량대장」 탭 + 접수 빈 줄 VLOOKUP 자동 채움. 차번만 적으면 공급사·모델명이
 *   따라오게 하려던 것인데, **대장을 «먹여 살리는» 일이 접수 몇 글자보다 컸다** —
 *   재고는 팔리면 빠지는데 정산은 팔린 뒤에 하니 원장 406대 중 375대(92%)가 대장에 없었고,
 *   그 375대는 「나중에 일괄 채울게」로 계속 남아 있었다. 자동인데 92%가 안 도는 자동이었다.
 *   ⇒ 접수는 **직접 적는다.** 남은 단계는 탭 정리 하나다.
 *
 *   ⚠ 되돌리려면 `build-plate-registry` · `publish-plate-registry-tab` 이 그대로 있다.
 *     되살릴 때는 ①②③ 차례를 지켜야 한다 — ②가 접수 탭을 통째로 다시 쓰므로
 *     ③을 앞에 두면 수식이 그 자리에서 지워진다(그래서 원래 한 줄로 묶여 있었다).
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

/** 도는 차례. 대장 두 단계는 2026-08-28 에 걷어냈다 — 위 머리말에 왜인지 적혀 있다. */
const STEPS = [
  { no: '①', why: '원장 네 탭 다시 세우기', file: 'scripts/build-settlement-tabs.mts' },
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
