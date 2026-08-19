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

const run = (args: string[]): { ok: boolean; lines: string[] } => {
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', ...args], { encoding: 'utf8', shell: process.platform === 'win32', env: process.env });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l && !/Assertion|\[fp4\]/.test(l));
  return { ok: r.status === 0, lines: out };
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
  if (!r.ok) { failed.push(`${m.name} 재고: ${r.lines.slice(-2).join(' / ').slice(0, 200)}`); continue; }
  if (!m.policies || m.kind !== 'sheet') continue;
  const p = run(['scripts/sync-mirror-policies.mts', `--from=${m.from}`, `--to=${m.to}`, `--code=${m.code}`, ...(APPLY ? ['--apply'] : [])]);
  const psum = pick(p.lines, /정책 미러|✓ 정책 탭|넣을 줄|Error/);
  console.log(`  ${p.ok ? '✓' : '✗'} ${m.name} 정책 — ${psum.join(' / ').slice(0, 300)}`);
  if (!p.ok) { failed.push(`${m.name} 정책: ${p.lines.slice(-2).join(' / ').slice(0, 200)}`); continue; }
  if (APPLY && /✓ 정책 탭/.test(psum.join(' '))) {
    const n = run(['scripts/normalize-policy-values.mts', `--sheet=${m.to}`, '--apply']);
    console.log(`  ${n.ok ? '·' : '✗'} ${m.name} 정책 표기 — ${pick(n.lines, /합계/).join(' ').slice(0, 160)}`);
    if (!n.ok) failed.push(`${m.name} 정책 표기: ${n.lines.slice(-2).join(' / ').slice(0, 200)}`);
  }
}
console.log('');
if (failed.length) { console.log(`  ✗ 실패 ${failed.length}\n     ${failed.join('\n     ')}`); process.exit(1); }
console.log(`  끝 — ${targets.length}곳 ${APPLY ? '반영' : '미리보기'} 이상 없음`);
