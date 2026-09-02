/**
 * **정제시트 전부를 원본에서 한 번에 갱신한다** — `mirror-sources.MIRROR_SOURCES` 표대로. 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-18 — 「정제시트 만들어서 실시간 연동」. «실시간»은 이 명령을 **자주 돌리는 것**이다 —
 *   `.github/workflows/mirror-sync.yml` 이 30분마다, `sheet-sync.yml` 이 발행 직전에 돈다(둘 다 main 에 올라가야 돈다).
 *   손으로는 발행 전에 한 번: `npx tsx scripts/sync-mirror-all.mts --apply && npx tsx scripts/publish-origin-tab.mts --apply`.
 * ★한 곳이 실패해도 나머지는 돈다. 실패는 마지막에 모아 보여 주고 종료코드 1 — 워크플로에서 빨간 불이 뜬다.
 * ★정책(`policies=true`)은 재고 다음에 옮기고, 그 시트만 `normalize-policy-values` 로 드롭다운·메모를 다시 입힌다.
 *
 *   npx tsx scripts/sync-mirror-all.mts                # 미리보기
 *   npx tsx scripts/sync-mirror-all.mts --apply
 *   npx tsx scripts/sync-mirror-all.mts --only=RP023,RP006 --apply
 */
import { spawnSync } from 'node:child_process';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';

const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const ONLY = new Set(arg('only').split(',').map(S).filter(Boolean));
const targets = MIRROR_SOURCES.filter((m) => !ONLY.size || ONLY.has(m.code));

/**
 * ★**일시적 실패는 한 번 더 해 본다. 그리고 실패했으면 «왜»를 반드시 남긴다.**
 *
 * ⚠ 2026-09-02 10:02 회차가 이안카(RP031) 하나 때문에 통째로 멎었다. 4분 뒤 **같은 명령을 손으로
 *   돌리니 그냥 성공**했다(갱신 2칸). 즉 그 순간의 일시적 실패였는데 —
 *   ① 여기서 `r.error`(자식이 시작조차 못 함)를 안 봐서 이유가 안 남았고,
 *   ② 실패 문구를 `lines.slice(-2)` 로 잡아 **머리글 「■ 규격화시트 갱신 반영」만** 위로 올라갔다.
 *   그래서 상위 회차 기록에도 이유가 없었고, 사람이 손으로 재현해야만 알 수 있었다.
 *   **이유 없는 빨간불은 다음에 아무도 안 믿는다.**
 *
 * ⚠ 재시도는 **일시적일 때만** 한다(시작 실패·요청한도·5xx). 「돌다가 어긋난 것」은 다시 해도 같다.
 *   쓰기 도구지만 매번 «지금 시트»와 견줘 바뀔 칸만 쓰므로, 한 번 더 돌아도 같은 값을 두 번 쓰지 않는다.
 */
const TRANSIENT = /\b429\b|rate.?limit|quota|RESOURCE_EXHAUSTED|\b50[0234]\b|UNAVAILABLE|ECONNRESET|ETIMEDOUT|socket hang up/i;
const run = (args: string[]): { ok: boolean; lines: string[]; why: string } => {
  for (let attempt = 1; ; attempt += 1) {
    const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', ...args], { encoding: 'utf8', shell: process.platform === 'win32', env: process.env });
    const raw = `${r.stdout || ''}\n${r.stderr || ''}`;
    const out = raw.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l && !/Assertion|\[fp4\]/.test(l));
    const ok = r.status === 0;
    if (ok) return { ok, lines: out, why: '' };
    const startFail = !!r.error;
    if (attempt < 2 && (startFail || TRANSIENT.test(raw))) {
      console.log(`     ⏳ 일시적 실패 — 15초 쉬고 한 번 더 (${startFail ? (r.error as NodeJS.ErrnoException).code || 'spawn' : '요청한도'})`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15_000);
      continue;
    }
    const why = r.error
      ? `실행 자체가 안 됐다(${(r.error as NodeJS.ErrnoException).code || ''} ${r.error.message})`
      : `종료코드 ${r.status ?? '없음'}${r.signal ? ` · 신호 ${r.signal}` : ''}`;
    return { ok, lines: out, why };
  }
};
const pick = (lines: string[], re: RegExp) => lines.filter((l) => re.test(l)).map((l) => l.trim());

console.log(`■ 정제시트 일괄 갱신 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳\n`);
const failed: string[] = [];
for (const m of targets) {
  const base = m.kind === 'iron'
    ? ['scripts/sync-mirror-sheet.mts', '--source=iron', `--to=${m.to}`, `--code=${m.code}`]
    : ['scripts/sync-mirror-sheet.mts', `--from=${m.from}`, `--to=${m.to}`, `--code=${m.code}`];
  const r = run(APPLY ? [...base, '--apply'] : base);
  const summary = pick(r.lines, /원본|갱신할 차|새 차|반영 완료|Error|오류|▲ 값이 아니라/);
  console.log(`  ${r.ok ? '✓' : '✗'} ${m.name}(${m.code}) 재고 — ${summary.join(' / ').slice(0, 300) || r.lines.slice(-3).join(' / ')}`);
  if (!r.ok) { failed.push(`${m.name} 재고: ${r.why} — ${r.lines.slice(-4).join(' / ').slice(0, 240)}`); continue; }
  if (!m.policies || m.kind !== 'sheet') continue;
  const p = run(['scripts/sync-mirror-policies.mts', `--from=${m.from}`, `--to=${m.to}`, `--code=${m.code}`, ...(APPLY ? ['--apply'] : [])]);
  const psum = pick(p.lines, /정책 미러|✓ 정책 탭|넣을 줄|Error/);
  console.log(`  ${p.ok ? '✓' : '✗'} ${m.name} 정책 — ${psum.join(' / ').slice(0, 300)}`);
  if (!p.ok) { failed.push(`${m.name} 정책: ${p.why} — ${p.lines.slice(-4).join(' / ').slice(0, 240)}`); continue; }
  if (APPLY && /✓ 정책 탭/.test(psum.join(' '))) {
    const n = run(['scripts/normalize-policy-values.mts', `--sheet=${m.to}`, '--apply']);
    console.log(`  ${n.ok ? '·' : '✗'} ${m.name} 정책 표기 — ${pick(n.lines, /합계/).join(' ').slice(0, 160)}`);
    if (!n.ok) failed.push(`${m.name} 정책 표기: ${n.why} — ${n.lines.slice(-4).join(' / ').slice(0, 240)}`);
  }
}
console.log('');
if (failed.length) { console.log(`  ✗ 실패 ${failed.length}\n     ${failed.join('\n     ')}`); process.exit(1); }
console.log(`  끝 — ${targets.length}곳 ${APPLY ? '반영' : '미리보기'} 이상 없음`);
