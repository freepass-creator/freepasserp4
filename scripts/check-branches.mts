/**
 * 가지 충돌·묵음 검사 — 「충돌은 사고가 아니라 «묵힌 값»이다」(docs/병합-매뉴얼.md).
 *
 * 왜 있나(2026-09-08). 열린 PR 여섯 중 **넷이 충돌**이었다. 그중 하나는 나흘 묵어
 * 충돌 파일이 30여 개가 됐고, 그건 풀 수가 없어 **병합을 포기**하고 「없는 것만」 옮겨 심었다.
 * 나흘 전에 이 표를 봤으면 그 가지는 하루치 충돌일 때 풀렸다.
 *
 * ★재는 법 — `git merge-tree --write-tree` 는 **작업본을 전혀 안 건드리고** 병합을 흉내 낸다.
 *   그래서 이 검사는 남의 가지·더러운 작업본에서도 안전하게 돈다.
 *
 * ★«커밋 제목 겹침»을 같이 센다. 겹침이 0 인데 충돌이 크면 그건 「같은 파일을 스쳤다」가 아니라
 *   **같은 일을 두 번 한 것**이다 — 병합으로 못 푼다(매뉴얼 §3㉢ 옮겨심기).
 *
 * 쓰기:
 *   npm run check:branches            표로 본다
 *   npm run check:branches -- --ci    충돌이 하나라도 있으면 exit 1
 *   npm run check:branches -- --no-fetch   fetch 없이(오프라인)
 */
import { execFileSync } from 'node:child_process';

const ARGV = process.argv.slice(2);
const CI = ARGV.includes('--ci');
const NO_FETCH = ARGV.includes('--no-fetch');

/** 묵음 경고선 — 이 둘을 «같이» 넘으면 옮겨심기를 검토할 때다. */
const STALE_DAYS = 3;
const STALE_BEHIND = 50;

const BASE = 'origin/main';
/** 볼 필요 없는 가지 — 보관용·남의 배포용. */
const SKIP = /^origin\/(HEAD|main|archive\/|deploy\/|codex\/)/;

/** ★`core.quotePath=false` — 안 주면 한글 파일명이 8진수(ì …)로 나와 읽을 수가 없다. */
const G = (args: string[]) => ['-c', 'core.quotePath=false', ...args];
const git = (...args: string[]) => execFileSync('git', G(args), { encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
const gitTry = (...args: string[]) => { try { return git(...args); } catch { return ''; } };

if (!NO_FETCH) { try { git('fetch', 'origin', '--quiet', '--prune'); } catch { console.log('  (fetch 실패 — 있는 것으로 잰다)'); } }

/**
 * 충돌 파일 목록. `--write-tree` 는 성공하면 exit 0, 충돌이면 **exit 1 로 죽는다** —
 * 그래서 throw 를 잡아 stdout 을 읽어야 한다(에러가 아니라 «결과»다).
 */
function conflictsOf(ref: string): string[] {
  let out = '';
  try {
    out = execFileSync('git', G(['merge-tree', '--write-tree', '--name-only', BASE, ref]), { encoding: 'utf8', maxBuffer: 64 << 20 });
    return [];   // exit 0 = 깨끗
  } catch (e: any) {
    out = String(e?.stdout ?? '');
    if (!out) return ['(잴 수 없음)'];
  }
  /* 서식: 1줄 = 나무 oid · 그 뒤 «충돌 파일» 들 · 빈 줄 · 메시지. 빈 줄 앞까지가 파일이다. */
  const lines = out.split(/\r?\n/).slice(1);
  const end = lines.findIndex((l) => l.trim() === '');
  return (end < 0 ? lines : lines.slice(0, end)).filter(Boolean);
}

type Row = {
  ref: string; ahead: number; behind: number; days: number;
  conflicts: string[]; sameSubjects: number; stale: boolean;
};

/**
 * ★**열린 PR 의 가지만** 본다.
 *   머지된 가지는 스쿼시라 옛 커밋을 그대로 이고 있어 «영원히 충돌»로 잰다 —
 *   2026-09-08 실측 50개가 그랬다. 다 울리면 진짜 넷이 그 속에 묻힌다.
 *   `gh` 가 없으면 전부 보되 **그렇다고 말한다**(조용히 다른 것을 재지 않는다).
 */
let refs = git('for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin')
  .split(/\r?\n/).filter((r) => r && !SKIP.test(r));
let scope = `원격 가지 ${refs.length}개(gh 없음 — 닫힌 것까지 잰다)`;
try {
  const open = new Set<string>(
    (JSON.parse(execFileSync('gh', ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'headRefName'], { encoding: 'utf8' })) as Array<{ headRefName: string }>)
      .map((p) => `origin/${p.headRefName}`),
  );
  refs = refs.filter((r) => open.has(r));
  scope = `열린 PR ${refs.length}개`;
} catch { /* gh 없거나 로그인 안 됨 — 위 문구 그대로 전부 잰다 */ }

const rows: Row[] = [];
for (const ref of refs) {
  const counts = gitTry('rev-list', '--left-right', '--count', `${BASE}...${ref}`);
  const [behind, ahead] = counts.split(/\s+/).map(Number);
  if (!ahead) continue;                       // 뒤처지기만 한 가지는 병합할 것이 없다
  const mb = gitTry('merge-base', BASE, ref);
  if (!mb) continue;
  const days = Math.round((Date.now() - Number(gitTry('log', '-1', '--format=%ct', mb)) * 1000) / 86400e3);
  /* 같은 제목이 양쪽에 있으면 이미 옮겨 간 것(스쿼시 머지) — 겹침 0 이 오히려 위험하다. */
  const mine = new Set(gitTry('log', '--format=%s', `${mb}..${ref}`).split(/\r?\n/).filter(Boolean));
  const theirs = gitTry('log', '--format=%s', `${mb}..${BASE}`).split(/\r?\n/).filter(Boolean);
  const sameSubjects = theirs.filter((s) => mine.has(s)).length;
  const conflicts = conflictsOf(ref);
  rows.push({ ref, ahead, behind, days, conflicts, sameSubjects, stale: days > STALE_DAYS && behind > STALE_BEHIND });
}

rows.sort((a, b) => b.conflicts.length - a.conflicts.length || b.behind - a.behind);

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].length));
console.log(`\n  ${scope} — 기준 ${BASE}\n`);
console.log(`  ${pad('가지', 38)}${pad('앞', 6)}${pad('뒤', 6)}${pad('묵음', 7)}충돌`);
console.log(`  ${'─'.repeat(72)}`);
for (const r of rows) {
  const mark = r.conflicts.length ? '✗' : r.stale ? '⚠' : '✓';
  const c = r.conflicts.length ? `${r.conflicts.length}개` : '없음';
  console.log(`  ${mark} ${pad(r.ref.replace('origin/', ''), 36)}${pad(String(r.ahead), 6)}${pad(String(r.behind), 6)}${pad(`${r.days}일`, 7)}${c}`);
}

const bad = rows.filter((r) => r.conflicts.length);
const stale = rows.filter((r) => !r.conflicts.length && r.stale);

for (const r of bad) {
  console.log(`\n  ✗ ${r.ref} — 충돌 ${r.conflicts.length}개`);
  for (const f of r.conflicts.slice(0, 8)) console.log(`      ${f}`);
  if (r.conflicts.length > 8) console.log(`      … 그리고 ${r.conflicts.length - 8}개 더`);
  if (r.conflicts.length > 10 && r.sameSubjects === 0) {
    console.log('    ⛔ 커밋 제목 겹침 0 인데 충돌이 크다 = «같은 일을 두 번» 했다.');
    console.log('       병합하지 마라 — main 에서 새로 떠서 «없는 것만» 옮긴다(docs/병합-매뉴얼.md §3㉢).');
  } else {
    console.log('    → 가지에서 `git merge origin/main` 으로 «오늘» 푼다(매뉴얼 §3).');
  }
}
for (const r of stale) {
  console.log(`\n  ⚠ ${r.ref} — ${r.days}일 묵음 · ${r.behind}커밋 뒤처짐. 아직 안 붙었을 뿐이다.`);
  console.log('    → `git fetch origin && git merge origin/main` — 오늘 받으면 한두 줄이다.');
}

if (!bad.length && !stale.length) { console.log('\n  ✓ 충돌도 묵은 가지도 없다.\n'); process.exit(0); }
console.log(`\n  충돌 ${bad.length} · 묵음 ${stale.length}  —  docs/병합-매뉴얼.md\n`);
process.exit(CI && bad.length ? 1 : 0);
