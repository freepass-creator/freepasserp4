/**
 * 판매시트 3탭 → ERP 시간별 동기.
 *
 * 상위 공급사·정제·판매시트는 별도 담당 정본이므로 이 작업은 절대 수정·재발행하지 않는다.
 * 기본은 완전한 읽기 전용 감사, `--apply`일 때만 ERP 동기 함수를 한 번 실행한다.
 */
import { appendFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');
const started = Date.now();
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const LOCK = 'tmp/hourly-sync.lock';
const LEGACY_LOCK_STALE_MS = 2 * 60 * 60_000;
const SERVER_ONLY_SHIM = ['./scripts/lib/server-only-shim.cjs'];

function activeLock(): boolean {
  if (!existsSync(LOCK)) return false;
  try {
    const lock = JSON.parse(readFileSync(LOCK, 'utf8')) as { pid?: number };
    if (Number.isInteger(lock.pid) && Number(lock.pid) > 0) {
      process.kill(Number(lock.pid), 0);
      return true;
    }
  } catch { /* 옛 잠금 또는 끝난 PID */ }
  return Date.now() - statSync(LOCK).mtimeMs < LEGACY_LOCK_STALE_MS;
}

if (activeLock()) {
  console.log('앞의 ERP 동기화가 아직 실행 중입니다 — 이번 호출을 건너뜁니다.');
  process.exit(0);
}
writeFileSync(LOCK, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

const detail: string[] = [`■ 판매시트→ERP ${APPLY ? '반영' : '읽기 감사'} ${kst()} KST`];
const summary: string[] = [];
const mask = (value: string): string => value
  .replace(/(\d{2,3}[가-힣])\d{4}/g, '$1****')
  .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, '[VIN 마스킹]');

function run(label: string, args: string[], pick: RegExp): { ok: boolean; picked: string[] } {
  const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', ...args], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const lines = `${result.stdout || ''}\n${result.stderr || ''}`
    .split(/\r?\n/)
    .map((line) => mask(line.trimEnd()))
    .filter((line) => line && !/DEP0190|trace-deprecation|Assertion/.test(line));
  const picked = lines.filter((line) => pick.test(line)).map((line) => line.trim());
  detail.push(`\n── ${label} ${result.status === 0 ? '✓' : '✗'}`, ...lines.slice(-50).map((line) => `   ${line.slice(0, 300)}`));
  console.log(`── ${label} ${result.status === 0 ? '✓' : '✗'}`);
  for (const line of picked.slice(0, 8)) console.log(`   ${line.slice(0, 220)}`);
  return { ok: result.status === 0, picked };
}

function finish(exitCode: number, reason = ''): never {
  const seconds = Math.round((Date.now() - started) / 1000);
  if (reason) detail.push(`\n⛔ 중단 — ${reason}`);
  detail.push(`\n■ 끝 ${kst()} KST · ${seconds}초`);
  writeFileSync('tmp/hourly-sync-last.txt', detail.join('\n'));
  appendFileSync('tmp/hourly-sync-log.txt', `${kst()} ${APPLY ? 'ERP반영' : '감사'} ${seconds}초 · ${summary.join(' · ')}${reason ? ` · 중단(${reason})` : ''}\n`);
  rmSync(LOCK, { force: true });
  if (reason) console.log(`⛔ 중단 — ${reason}`);
  else console.log(`■ 끝 — ${seconds}초 · 기록 tmp/hourly-sync-log.txt`);
  process.exit(exitCode);
}

try {
  const preflight = run('① 판매시트 읽기·커밋 경계', ['--require', ...SERVER_ONLY_SHIM, 'scripts/audit-sales-sync-preflight.mts'], /판매시트 ERP 사전감사|커밋 경계|커밋 차단|영구 부여기록/);
  summary.push(preflight.ok ? '사전감사 통과' : '사전감사 실패');
  if (!preflight.ok) finish(1, '판매시트 사전감사 실패');

  if (APPLY) {
    const sync = run('② ERP 동기', ['--require', ...SERVER_ONLY_SHIM, 'scripts/run-sheet-daily-sync-local.mts', '--apply'], /반영|원본 |미리보기|보류|실패|✗/);
    summary.push(sync.ok ? 'ERP 반영 통과' : 'ERP 반영 실패');
    if (!sync.ok) finish(1, 'ERP 동기 실패');
  } else {
    summary.push('ERP 미변경');
    console.log('── ② ERP 동기 — 건너뜀(읽기 감사 모드)');
  }

  const parity = run('③ 판매시트↔ERP·상품찾기 대조', ['--require', ...SERVER_ONLY_SHIM, 'scripts/audit-sheet-erp-parity.mts'], /판매시트 |판매→상품찾기|ERP→판매|핵심값 불일치|계약락 상태 예외/);
  summary.push(parity.ok ? '정합성 통과' : '정합성 불일치');
  if (!parity.ok) finish(2, '판매시트와 ERP/상품찾기 불일치');
  finish(0);
} catch (error) {
  finish(1, `실행 예외: ${String((error as Error)?.message || error)}`);
}
