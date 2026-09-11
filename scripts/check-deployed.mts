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
      console.log('\n✅ 운영에 안 올라간 화면 커밋 없음');
    }
  }

  /*
   * ★★★**«머지했다»와 «올라갔다»는 다른 말이다** (2026-09-10 사고).
   *
   *   이 검사는 여태 「git 에 있나」만 봤다. 커밋이 main 에 있으면 초록불을 줬는데, 실제로는
   *   **Vercel 빌드가 두 번 연속 실패해 운영이 네 시간 동안 옛 화면**이었다. 나는 「배포 완료」라고
   *   보고했고, 사장님은 고쳤다는 화면을 못 보고 계셨다 — CLAUDE.md 맨 위의 그 사고
   *   (「힘들게 수정해 놓으면 또 바뀌고」)와 **정확히 같은 꼴**이다. 원인은 환경변수 하나가
   *   지워진 것이었는데, **아무 검사도 그걸 안 보고 있었다.**
   *
   * ⇒ **운영이 «지금 무슨 커밋을 서빙하는지» 직접 묻는다**(`/api/version` 의 `sha`).
   *   git 이 아니라 «살아 있는 서버»에 묻는 것이라, 빌드가 실패했으면 여기서 드러난다.
   * ★못 물어봐도(망 없음·CI 안) **실패로 세지 않는다** — 이 검사의 본래 일은 git 대조다.
   *   운영 확인은 «있으면 좋은 한 겹»이고, 없다고 커밋을 막을 이유는 없다.
   */
  let liveMismatch = false;
  if (!asJson && !process.env.CI) {
    const site = process.env.FP_LIVE_URL || 'https://www.freepasserp.com';
    try {
      const head = git('rev-parse', base).slice(0, 7);
      const res = await fetch(`${site}/api/version`, { cache: 'no-store' });
      const body = await res.json() as { sha?: string };
      const live = String(body.sha || '').slice(0, 7);
      if (!live) {
        console.log('   (운영이 커밋을 안 알려 준다 — 건너뜀)');
      } else if (live === head) {
        console.log(`   운영도 같은 커밋을 서빙한다 — ${live} ✅`);
      } else {
        liveMismatch = true;
        console.error('\n✗ 머지는 됐는데 **운영에 안 올라갔다** — 배포가 실패했을 수 있다.');
        console.error(`   ${base} = ${head}  ·  운영 = ${live}`);
        console.error('   ⚠ 「머지했다」는 「올라갔다」가 아니다. 배포 상태를 본다:');
        console.error('     npx vercel ls freepasserp4 | grep -i production');
        console.error('     실패했으면  npx vercel inspect <주소> --logs  로 이유를 본다.');
        console.error('     (2026-09-10 에는 환경변수 NEXT_PUBLIC_FIREBASE_DATABASE_URL 이 지워져 있었다.)');
      }
    } catch {
      /* 망이 없거나 운영이 잠깐 안 열려도 커밋을 막지 않는다(위 머리말). */
      console.log('   (운영에 못 물어봤다 — 건너뜀)');
    }
  }

  /*
   * ⚠ `process.exit` 이 아니라 «종료코드만» 세운다 — 방금 연 http 연결이 아직 정리 중인데
   *   즉시 죽이면 윈도우 node 가 `UV_HANDLE_CLOSING` 어설션을 뱉는다(껍데기만 시끄럽고
   *   뜻은 없는 소리라, 다음 사람이 이걸 «검사가 깨졌다»로 읽는다).
   */
  process.exitCode = screenCommits.length === 0 && !liveMismatch ? 0 : 1;
} catch (e) {
  console.error('check:deployed 실패 —', (e as Error).message);
  process.exit(2);
}
