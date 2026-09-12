/**
 * 가지 충돌·묵음·«고아» 검사 — 「충돌은 사고가 아니라 «묵힌 값»이다」(docs/병합-매뉴얼.md).
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
 * ★★**«고아 가지»를 같이 센다 — 이 검사가 못 보던 구멍이었다**(2026-09-12).
 *
 *   전에는 **열린 PR 의 가지만** 봤다. 그래서 **PR 을 닫는 행동이 그 가지를 감시망에서 지웠다.**
 *   실제로 그 일이 났다 — `feat/spring-atom-monitor` 는 2026-09-08 12:32 에 옮겨심기(#148·#149)가
 *   끝나고 12:54 에 PR(#15)이 닫혔는데, **12:56~16:07 사이에 28커밋이 더 들어갔다.**
 *   옮겨심기가 빠뜨린 건 0개였다 — 남은 43파일은 «닫힌 뒤»에 쌓인 것이다. 그런데 이 검사는
 *   나흘 동안 「✓ 충돌도 묵은 가지도 없다」고 말했다. 320커밋이 표 밖에 있었다.
 *   그중 하나(원천→원자 직접수집 자동화)가 안 와서, main 의 파인더는 원자를 «읽는데»
 *   그 원자를 원천에서 «채우는» 손이 main 에 없는 상태가 됐다.
 *
 *   ⇒ 고아 = **앞선 커밋이 있는데 PR 이 없거나 닫힌(미머지) 가지.** 그 작업은 어디에도 없다.
 *   ⚠ 머지된 가지는 세지 않는다 — 스쿼시라 옛 커밋을 이고 있어 «영원히 충돌»로 잡힌다(실측 134개).
 *
 * ★**«막힌 PR»도 센다** — 열린 PR 의 base 가 main 이 아니고 그 base 가 고아면,
 *   그 PR 은 아무리 초록이어도 **main 에 닿을 길이 없다.** PR #247(590파일)이 그 꼴이었다.
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
/**
 * 볼 필요 없는 가지 — 보관용·배포용.
 * ⚠ 전에는 `codex/` 도 여기 있었다. 그래서 **열린 PR 인 `codex/rtdb-cutover-current`(590파일)가
 *   표에 아예 안 나왔다.** 이름으로 감추면 감춘 줄도 모른다 — 열린 PR 은 이름을 안 가린다.
 */
const SKIP = /^origin\/(HEAD|main|archive\/|deploy\/)/;
/** 고아로 셀 만큼 «살아 있는» 가지인가 — 이 아래는 실험·잔재로 본다. */
const ORPHAN_MIN_AHEAD = 1;

/** ★`core.quotePath=false` — 안 주면 한글 파일명이 8진수(ì …)로 나와 읽을 수가 없다. */
const G = (args: string[]) => ['-c', 'core.quotePath=false', ...args];
const git = (...args: string[]) => execFileSync('git', G(args), { encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
const gitTry = (...args: string[]) => { try { return git(...args); } catch { return ''; } };

if (!NO_FETCH) { try { git('fetch', 'origin', '--quiet', '--prune'); } catch { console.log('  (fetch 실패 — 있는 것으로 잰다)'); } }

/**
 * 충돌 파일 목록. `--write-tree` 는 성공하면 exit 0, 충돌이면 **exit 1 로 죽는다** —
 * 그래서 throw 를 잡아 stdout 을 읽어야 한다(에러가 아니라 «결과»다).
 */
function conflictsOf(ref: string, base = BASE): string[] {
  let out = '';
  try {
    out = execFileSync('git', G(['merge-tree', '--write-tree', '--name-only', base, ref]), { encoding: 'utf8', maxBuffer: 64 << 20 });
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
  pr?: number; base: string;
};
/** 앞선 커밋이 있는데 아무 PR 도 그것을 main 으로 데려가지 않는 가지. */
type Orphan = { ref: string; ahead: number; behind: number; pr?: number; state: string; lastAt: number; quietDays: number };

type Pr = { number: number; headRefName: string; baseRefName: string; state: string };

/**
 * PR 을 **상태 불문 전부** 받는다 — 닫힌 것까지 알아야 «고아»를 가릴 수 있다.
 * 한 가지에 PR 이 여럿이면 열림 > 머지 > 닫힘 순으로 그 가지의 «대표»를 고른다.
 */
let prOf = new Map<string, Pr>();
let haveGh = true;
try {
  const prs = JSON.parse(execFileSync(
    'gh', ['pr', 'list', '--state', 'all', '--limit', '400', '--json', 'number,headRefName,baseRefName,state'],
    { encoding: 'utf8', maxBuffer: 64 << 20 },
  )) as Pr[];
  const rank = (s: string) => (s === 'OPEN' ? 3 : s === 'MERGED' ? 2 : 1);
  for (const p of prs) {
    const k = `origin/${p.headRefName}`;
    const prev = prOf.get(k);
    if (!prev || rank(p.state) > rank(prev.state)) prOf.set(k, p);
  }
} catch { haveGh = false; prOf = new Map(); }

const allRefs = git('for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin')
  .split(/\r?\n/).filter((r) => r && !SKIP.test(r));

/** 열린 PR 의 가지 = 표에 세운다. gh 가 없으면 전부 보되 «그렇다고 말한다». */
const openRefs = haveGh ? allRefs.filter((r) => prOf.get(r)?.state === 'OPEN') : allRefs;
const scope = haveGh ? `열린 PR ${openRefs.length}개` : `원격 가지 ${allRefs.length}개(gh 없음 — 닫힌 것까지 잰다)`;

const rows: Row[] = [];
for (const ref of openRefs) {
  const pr = prOf.get(ref);
  /**
   * ★**그 PR 이 실제로 들어갈 곳**에 대고 잰다. base 가 main 이 아닌 PR 을 main 에 대고 재면
   *   제 base 와의 차이까지 「충돌」로 세어, 멀쩡한 PR 을 못 쓸 것으로 보이게 한다.
   *   base 자체가 문제인 경우는 아래 «막힌 PR»이 따로 말한다.
   */
  const base = pr && pr.baseRefName !== 'main' && gitTry('rev-parse', '--verify', `origin/${pr.baseRefName}`)
    ? `origin/${pr.baseRefName}` : BASE;
  const counts = gitTry('rev-list', '--left-right', '--count', `${base}...${ref}`);
  const [behind, ahead] = counts.split(/\s+/).map(Number);
  if (!ahead) continue;                       // 뒤처지기만 한 가지는 병합할 것이 없다
  const mb = gitTry('merge-base', base, ref);
  if (!mb) continue;
  const days = Math.round((Date.now() - Number(gitTry('log', '-1', '--format=%ct', mb)) * 1000) / 86400e3);
  /* 같은 제목이 양쪽에 있으면 이미 옮겨 간 것(스쿼시 머지) — 겹침 0 이 오히려 위험하다. */
  const mine = new Set(gitTry('log', '--format=%s', `${mb}..${ref}`).split(/\r?\n/).filter(Boolean));
  const theirs = gitTry('log', '--format=%s', `${mb}..${base}`).split(/\r?\n/).filter(Boolean);
  const sameSubjects = theirs.filter((s) => mine.has(s)).length;
  const conflicts = conflictsOf(ref, base);
  rows.push({ ref, ahead, behind, days, conflicts, sameSubjects, pr: pr?.number, base, stale: days > STALE_DAYS && behind > STALE_BEHIND });
}

/**
 * ★고아 — 앞선 커밋이 있는데 PR 이 없거나 «닫힘(미머지)»인 가지.
 *   머지된 가지는 세지 않는다(스쿼시 잔재 134개가 그렇다 — 실측 2026-09-12).
 */
const orphans: Orphan[] = [];
if (haveGh) {
  for (const ref of allRefs) {
    const pr = prOf.get(ref);
    if (pr && (pr.state === 'OPEN' || pr.state === 'MERGED')) continue;
    const counts = gitTry('rev-list', '--left-right', '--count', `${BASE}...${ref}`);
    const [behind, ahead] = counts.split(/\s+/).map(Number);
    if (!ahead || ahead < ORPHAN_MIN_AHEAD) continue;
    const lastAt = Number(gitTry('log', '-1', '--format=%ct', ref)) * 1000;
    orphans.push({
      ref, ahead, behind, pr: pr?.number,
      state: pr ? '닫힘(미머지)' : 'PR 없음',
      lastAt, quietDays: Math.round((Date.now() - lastAt) / 86400e3),
    });
  }
  orphans.sort((a, b) => b.ahead - a.ahead);
}

/** ★막힌 PR — base 가 main 이 아니고, 그 base 가 고아다. 초록이어도 main 에 닿을 길이 없다. */
const orphanRefs = new Set(orphans.map((o) => o.ref));
const blocked = rows.filter((r) => r.base !== BASE && orphanRefs.has(r.base));

rows.sort((a, b) => b.conflicts.length - a.conflicts.length || b.behind - a.behind);

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].length));
console.log(`\n  ${scope} — 기준 ${BASE}\n`);
console.log(`  ${pad('가지', 38)}${pad('앞', 6)}${pad('뒤', 6)}${pad('묵음', 7)}${pad('충돌', 7)}base`);
console.log(`  ${'─'.repeat(78)}`);
for (const r of rows) {
  const mark = r.conflicts.length ? '✗' : r.stale ? '⚠' : '✓';
  const c = r.conflicts.length ? `${r.conflicts.length}개` : '없음';
  /* base 가 main 이면 안 적는다 — 다른 데면 «어디에» 대고 잰 값인지 밝힌다. */
  const b = r.base === BASE ? '' : r.base.replace('origin/', '');
  console.log(`  ${mark} ${pad(r.ref.replace('origin/', ''), 36)}${pad(String(r.ahead), 6)}${pad(String(r.behind), 6)}${pad(`${r.days}일`, 7)}${pad(c, 7)}${b}`);
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

/**
 * ★막힌 PR 을 «먼저» 말한다 — 충돌보다 위다.
 *   충돌은 풀면 되지만, base 가 고아면 풀어도 main 에 안 닿는다.
 */
for (const r of blocked) {
  console.log(`\n  ⛔ PR#${r.pr ?? '-'} ${r.ref.replace('origin/', '')} — base 가 «고아» 가지다 (${r.base.replace('origin/', '')})`);
  console.log('     초록이어도 main 에 닿을 길이 없다. base 를 main 으로 다시 뜨거나, base 를 먼저 정리한다.');
}

if (orphans.length) {
  console.log(`\n  ★고아 가지 ${orphans.length}개 — 앞선 커밋이 있는데 그것을 main 으로 데려가는 PR 이 없다`);
  console.log(`  ${pad('가지', 38)}${pad('앞', 6)}${pad('뒤', 6)}${pad('멈춘지', 8)}상태`);
  console.log(`  ${'─'.repeat(78)}`);
  for (const o of orphans) {
    console.log(`  · ${pad(o.ref.replace('origin/', ''), 36)}${pad(String(o.ahead), 6)}${pad(String(o.behind), 6)}${pad(`${o.quietDays}일`, 8)}${o.state}${o.pr ? ` PR#${o.pr}` : ''}`);
  }
  console.log('\n    → 셋 중 하나로 «끝낸다». 열어 두는 것이 제일 나쁘다(그 사이 새 커밋이 또 떨어진다).');
  console.log('       ㉠ 필요한 것만 옮겨 심고 가지를 «지운다»(docs/병합-매뉴얼.md §3㉢)');
  console.log('       ㉡ 아직 살아 있는 작업이면 PR 을 «다시 연다» — 그래야 충돌이 표에 잡힌다');
  console.log('       ㉢ 버릴 것이면 태그만 박고 지운다 (`git tag archive/<이름> <가지> && git push --delete`)');
  console.log('    ⚠ PR 을 닫는 것으로는 «끝»이 아니다 — 2026-09-08 에 닫은 가지로 3시간 뒤 28커밋이 더 들어갔다.');
}

if (!bad.length && !stale.length && !orphans.length && !blocked.length) {
  console.log('\n  ✓ 충돌·묵음·고아 없다.\n');
  process.exit(0);
}
console.log(`\n  충돌 ${bad.length} · 묵음 ${stale.length} · 고아 ${orphans.length} · 막힌 PR ${blocked.length}  —  docs/병합-매뉴얼.md\n`);
process.exit(CI && (bad.length || blocked.length) ? 1 : 0);
