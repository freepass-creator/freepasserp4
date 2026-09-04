/**
 * **한 달 정산을 «한 줄»로 돌린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-03 「이렇게 돌아갈수 있게끔 구조화하고」.
 *
 * ★★**순서가 규칙이다.** 도구를 따로따로 부르면 «어디까지 했는지»를 사람이 기억해야 하고,
 *   기억은 매달 어긋난다(2026-09-02 에 옛 판이 섞여 나갈 뻔했다). 순서를 여기 박아 둔다.
 *
 * ```
 * ① 시트 → ERP   새 줄만 끌어온다        settlement:import
 * ② 원자화        그 달 탭을 원자로       atomize-settlement-month
 * ③ 달 탭 발행    앞으로 5달치까지        publish-settlement-month --ahead=5
 * ④ 수수료 검산    표와 어긋난 줄을 센다    check-fee-consistency
 * ⑤ 정산서        PDF·엑셀·HTML         issue-settlement-invoices
 * ⑥ 쪽 검사       A4 에 넘치는지          check-invoice-overflow
 * ⑦ 드라이브       업체별로 올린다         upload-settlement-docs
 * ⑧ 공급사 시트   그 달 정산 탭을 붙인다     publish-supplier-settlement
 * ```
 *
 * ★**②는 옛 판을 걷는다.** 다시 돌리면 묵은 줄을 이름 대고 지운다.
 * ★**⑤ 앞에서 tmp 폴더를 비운다.** 안 비우면 지난 판이 섞여 나간다 — 실제로 그럴 뻔했다.
 * ⚠ 하나라도 빨간불이면 «거기서 멈춘다». 틀린 채로 다음 단계를 밟지 않는다.
 *
 *   npx tsx scripts/run-settlement-month.mts 2026-09
 *   npx tsx scripts/run-settlement-month.mts 2026-09 --apply
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '').trim();
const APPLY = process.argv.includes('--apply');
if (!MONTH) {
  console.log('\n  달을 주세요 — npx tsx scripts/run-settlement-month.mts 2026-09 [--apply]\n');
  process.exit(1);
}

/**
 * `advisory` = «알리되 멈추지 않는» 단계.
 * ★수수료 검산이 그렇다 — 표와 «다른» 줄은 틀린 게 아니라 «사람이 볼 줄»이다(가감 칸이 종이에 세운다).
 *   거기서 멈추면 매달 한 줄 때문에 정산서를 못 뽑는다. 대신 끝에 다시 한 번 크게 알린다.
 */
type Step = { no: string; what: string; cmd: string[]; needApply?: boolean; advisory?: boolean; before?: () => void };
const A = APPLY ? ['--apply'] : [];
const steps: Step[] = [
  { no: '①', what: '시트 → ERP (새 줄만)', cmd: ['npm', 'run', 'settlement:import', '--', ...A] },
  { no: '②', what: '원자화 (묵은 줄은 걷는다)', cmd: ['npx', 'tsx', 'scripts/atomize-settlement-month.mts', MONTH, ...A] },
  { no: '③', what: '달 탭 발행 (앞으로 5달)', cmd: ['npx', 'tsx', 'scripts/publish-settlement-month.mts', MONTH, '--ahead=5', ...A] },
  { no: '④', what: '수수료 검산', cmd: ['npx', 'tsx', 'scripts/check-fee-consistency.mts', MONTH], advisory: true },
  { no: '⑤', what: '정산서 만들기', cmd: ['npx', 'tsx', 'scripts/issue-settlement-invoices.mts', MONTH],
    before: () => { rmSync(`tmp/정산서-${MONTH}`, { recursive: true, force: true }); } },
  { no: '⑥', what: '쪽 검사 (A4)', cmd: ['node', 'scripts/check-invoice-overflow.mjs', `tmp/정산서-${MONTH}`] },
  { no: '⑦', what: '드라이브에 올리기', cmd: ['npx', 'tsx', 'scripts/upload-settlement-docs.mts', MONTH, ...A], needApply: true },
  { no: '⑧', what: '공급사 시트에 정산 탭 붙이기', cmd: ['npx', 'tsx', 'scripts/publish-supplier-settlement.mts', MONTH, ...A], needApply: true },
];

console.log(`\n■■ ${MONTH} 한 달 정산 — ${APPLY ? '반영' : 'dry-run (아무것도 안 바꾼다)'}\n`);
const done: string[] = []; const warn: string[] = [];
for (const s of steps) {
  if (s.needApply && !APPLY) { console.log(`  ${s.no} ${s.what}  — 건너뜀(--apply 라야 올린다)\n`); continue; }
  console.log(`\n${'─'.repeat(68)}\n  ${s.no} ${s.what}\n${'─'.repeat(68)}`);
  s.before?.();
  const r = spawnSync(s.cmd[0], s.cmd.slice(1), { stdio: 'inherit', shell: true });
  /**
   * ★★**윈도우에서 «끝내면서» 터지는 코드는 실패가 아니다.**
   *   0xC0000409(3221226505) — 파이어베이스가 붙잡고 있던 연결이 닫히면서 나는 소리다.
   *   우리 스크립트는 이미 `process.exit(0)` 을 부른 «뒤»라 일은 다 끝나 있다.
   *   (같은 자리에서 「Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)」이 같이 찍힌다.)
   *   ⚠ 그래도 «중간»에 죽으면 그 앞 단계의 검사에서 먼저 걸린다 — 이 관용은 마지막 한 걸음에만 해당한다.
   */
  const OK_AT_EXIT = [0, 3221226505];
  if (!OK_AT_EXIT.includes(r.status ?? 1) && s.advisory) {
    warn.push(`${s.no} ${s.what}`); done.push(`${s.no} ${s.what}  ⚠ 볼 줄 있음`); continue;
  }
  if (!OK_AT_EXIT.includes(r.status ?? 1)) {
    console.log(`\n⛔ ${s.no} ${s.what} 에서 멈췄습니다 (코드 ${r.status}).`);
    console.log('   ★틀린 채로 다음 단계를 밟지 않습니다. 위 메시지를 보고 고친 뒤 다시 부르세요.\n');
    process.exit(r.status ?? 1);
  }
  done.push(`${s.no} ${s.what}`);
}

console.log(`\n${'═'.repeat(68)}`);
console.log(`  ✓ ${MONTH} — ${done.length}단계 다 지났습니다`);
for (const d of done) console.log(`     ${d}`);
if (warn.length) {
  console.log(`\n  ⚠ ${warn.join(' · ')} — 표와 «다른» 줄이 있습니다.`);
  console.log('     틀린 게 아니라 «사람이 볼 줄»입니다. 월 탭의 「가감」·「가감 사유」 칸을 보세요.');
}
if (!APPLY) console.log('\n  ※ dry-run 이었습니다. 반영하려면 --apply 를 붙이세요.');
console.log(`${'═'.repeat(68)}\n`);
process.exit(0);
