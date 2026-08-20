/**
 * **문서 자동 동기화** — `docs/` 안이 바뀌면 커밋하고 GitHub에 올린다.
 * 사장님 2026-08-20 「로컬이랑 깃허브랑 자동으로 연동되게 해줘」(디자인 기획서를 커서·코덱스가 같이 보게).
 *
 * ⚠ `docs/` 만 담는다 — `git add -A` 를 쓰지 않는다.
 *   이 리포는 여러 세션이 동시에 만지고 있어서, 전부 담으면 남이 작업 중인 코드가 딸려 올라간다.
 *   (실제로 오늘 다른 세션이 `-A` 로 담아 이 문서들이 코드 커밋에 섞여 들어갔다.)
 *
 * ⚠ `--autostash` 로 당긴다 — 남이 만지던 미저장 변경이 있어도 rebase 가 죽지 않게.
 * ⚠ 올릴 게 없으면 아무것도 하지 않는다(빈 커밋을 쌓지 않는다).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';

const REPO = 'C:\\dev\\freepasserp4';
const LOG = `${REPO}\\tmp\\docs-sync-log.txt`;

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const stamp = () => new Date().toLocaleString('ko-KR', { hour12: false });
const say = (msg) => {
  const line = `${stamp()}  ${msg}`;
  console.log(line);
  try { mkdirSync(`${REPO}\\tmp`, { recursive: true }); appendFileSync(LOG, `${line}\n`, 'utf8'); } catch { /* 기록 실패는 동기화를 막지 않는다 */ }
};

try {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');

  git('add', '--', 'docs');
  const staged = git('diff', '--cached', '--name-only', '--', 'docs');
  if (!staged) {
    // 담을 게 없으면 원격만 확인하고 끝낸다. 남의 커밋을 대신 밀지 않는다.
    say('변경 없음');
    process.exit(0);
  }

  const files = staged.split('\n').filter(Boolean);
  const head = files.slice(0, 3).map((f) => f.replace(/^docs\//, '')).join(' · ');
  const more = files.length > 3 ? ` 외 ${files.length - 3}건` : '';
  git('commit', '-m', `문서 — ${head}${more}`);
  say(`커밋 ${files.length}건: ${files.join(', ')}`);

  git('pull', '--rebase', '--autostash', 'origin', branch);
  git('push', 'origin', branch);
  say(`푸시 완료 → origin/${branch}`);
} catch (e) {
  // stdout/stderr 를 남겨야 무엇 때문에 멈췄는지 안다(충돌·인증·네트워크).
  const detail = [e?.message, e?.stdout?.toString?.(), e?.stderr?.toString?.()].filter(Boolean).join(' | ');
  say(`실패: ${detail}`);
  process.exit(1);
}
