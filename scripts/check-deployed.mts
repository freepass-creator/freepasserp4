/**
 * check:deployed — 운영(origin/main)에 «없는 화면 커밋»을 센다. (CLAUDE.md ★★ 규칙 1)
 *
 * 사장님 2026-09-01 「힘들게 수정해 놓으면 또 바뀐다」의 정체 = 회귀가 아니라 «미배포»였다.
 * 로컬에 화면 커밋이 쌓였는데 운영은 그대로라, 보실 때마다 「또 원래대로」가 됐다.
 * ⇒ 화면을 고쳤으면 그 자리에서 배포까지 간다. 이 게이트가 «운영에 없는 화면 커밋»을 세고,
 *    하나라도 있으면 exit 1. 묵은 날수까지 찍는다 — 며칠 묵었으면 그게 다음 「또 바뀌었다」다.
 *
 * 화면 커밋 = app 아래(단 app/api 제외)·components 아래 tsx, 또는 임의 css/scss 를 건드린 커밋.
 *   데이터·스크립트·문서·API 라우트만 바꾼 커밋은 «화면»이 아니라 세지 않는다(화면 회귀와 무관).
 *
 * 사용: npm run check:deployed [--fetch] [--base=origin/main] [--json]
 *   --fetch : 먼저 git fetch 로 운영 최신을 당겨 비교(CI·정확). 없으면 로컬 기준.
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const doFetch = args.includes('--fetch');
const asJson = args.includes('--json');
const baseArg = args.find((a) => a.startsWith('--base='));
const base = baseArg ? baseArg.split('=')[1] : 'origin/main';

const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8' }).trim();

// 화면 파일인가 — app/(api 제외) tsx/css, components/, 임의 css/scss
function isScreenFile(f: string): boolean {
  if (/^app\/api\//.test(f)) return false;
  if (/^app\/.*\.(tsx|css|scss)$/.test(f)) return true;
  if (/^components\/.*\.(tsx|css|scss)$/.test(f)) return true;
  if (/\.(css|scss)$/.test(f)) return true;
  return false;
}

try {
  if (doFetch) {
    const remote = base.includes('/') ? base.split('/')[0] : 'origin';
    const branch = base.includes('/') ? base.split('/').slice(1).join('/') : base;
    try { git('fetch', remote, branch); } catch { /* 오프라인이면 로컬 기준 */ }
  }
  // base 가 조상이든 갈라졌든, «운영에 없는» 내 커밋 = base..HEAD
  const range = `${base}..HEAD`;
  const raw = git('log', range, '--format=%H%ct%s');
  const lines = raw ? raw.split('\n') : [];

  const screenCommits: { hash: string; when: number; subject: string; files: string[] }[] = [];
  for (const line of lines) {
    const [hash, ct, subject] = line.split('');
    if (!hash) continue;
    const files = git('show', '--name-only', '--format=', hash).split('\n').map((s) => s.trim()).filter(Boolean);
    const screen = files.filter(isScreenFile);
    if (screen.length) screenCommits.push({ hash: hash.slice(0, 8), when: Number(ct) * 1000, subject, files: screen });
  }

  const now = Date.now();
  const oldestDays = screenCommits.length ? Math.floor((now - Math.min(...screenCommits.map((c) => c.when))) / 86_400_000) : 0;

  if (asJson) {
    console.log(JSON.stringify({ base, totalCommits: lines.length, screenCommits: screenCommits.length, oldestDays,
      commits: screenCommits.map((c) => ({ hash: c.hash, days: Math.floor((now - c.when) / 86_400_000), subject: c.subject })) }, null, 1));
  } else {
    console.log(`운영(${base}) 대비 로컬 커밋 ${lines.length}개 · 그중 «화면 커밋» ${screenCommits.length}개`);
    if (screenCommits.length) {
      console.log(`\n⚠ 운영에 안 올라간 화면 커밋 ${screenCommits.length}개 — 가장 묵은 것 ${oldestDays}일`);
      console.log('  (며칠 묵었으면 그게 다음 「또 바뀌었다」다 — PR 열어 Vercel 미리보기로 확인받고 머지)\n');
      for (const c of screenCommits.slice(0, 25)) {
        const days = Math.floor((now - c.when) / 86_400_000);
        console.log(`  ${c.hash} (${days}일) ${c.subject.slice(0, 60)}`);
      }
      if (screenCommits.length > 25) console.log(`  … 외 ${screenCommits.length - 25}개`);
    } else {
      console.log('\n✅ 운영에 안 올라간 화면 커밋 없음 — 화면은 배포와 일치');
    }
  }
  process.exit(screenCommits.length === 0 ? 0 : 1);
} catch (e) {
  console.error('check:deployed 실패 —', (e as Error).message);
  process.exit(2);
}
