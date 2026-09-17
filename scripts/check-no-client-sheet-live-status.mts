/**
 * **화면이 공급사 시트를 «직접» 읽지 않는다.** 읽기 전용. 어기면 exit 1.
 *
 * ★★왜 있나 — 2026-09-01, 웹 상품찾기가 `/api/sheet/live-status` 로 **브라우저에서 공급사 시트를
 *   다시 읽어** 차량상태를 덮어썼다(60초마다 반복). 그래서 **대수가 582 → 694 로 1초 만에 튀었다** —
 *   ERP 가 「출고불가」라 한 414대 중 시트가 「팔 수 있다」고 한 것들이 되살아난 것이다.
 *   사장님 「댓수가 580 몇 대에서 1초 있다가 680 몇 대로 바뀐다. 왜 이렇게 바뀌냐고.」
 *
 * ⚠⚠ 그때 **목록에서만 걷었다.** 2026-09-06 검수에서 보니 모바일 상세(`app/m/[code]`)에
 *   같은 폴링이 그대로 남아 있었다 — 목록과 상세가 서로 다른 원천을 보면 «어느 상태가 맞는지»를
 *   아무도 못 말한다. 그래서 이 자를 둔다. **주석으로는 또 남는다.**
 *
 * ★규격: 시트 → ERP 반영은 **매시간 자동동기(`hourly-sync`)**와 서버 라우트의 몫이다.
 *   화면(브라우저)은 **ERP 가 아는 것**만 그린다.
 *
 *   npx tsx scripts/check-no-client-sheet-live-status.mts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 시트를 «서버에서» 읽는 정본 자리 — 여기만 이 주소를 알아도 된다. */
const SERVER_ONLY = [
  'app/api/sheet/live-status',
  'lib/server/sheet-live-status.ts',
  'lib/domain/sheet-live-status.ts',
  'scripts/',
  'docs/',
];
const ROOTS = ['app', 'components', 'features', 'lib', 'hooks'];
const EXT = /\.(ts|tsx)$/;
/** 브라우저가 시트를 부르는 자취 — 주소·옛 클라이언트 모듈 이름 둘 다 본다. */
const SMELLS = [/\/api\/sheet\/live-status/, /sheet-live-status-client/, /fetchSheetLiveStatuses/];

/**
 * **이 «한 자»가 파일 하나를 보고 「브라우저가 시트를 읽는가」를 답한다.**
 * 실제 파일에도, `tests/known-bad/client-sheet/` 의 표본에도 «같은 자»를 쓴다 —
 * 표본이 다른 길을 타면 그 표본은 이 검사기를 시험한 것이 아니다.
 */
function 시트를직접읽는가(글: string): string[] {
  /* ⚠ 주석은 뺀다 — 「예전엔 이랬다」고 적어 둔 설명까지 잡으면 아무도 이유를 못 적는다. */
  const code = 글.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return SMELLS.filter((re) => re.test(code)).map((r) => r.source);
}

/*
 * ── 대조군 — 안 잡히면 «재는 쪽»이 틀린 것이다 ─────────────────────────
 *
 * ★왜 파일로 두나(2026-09-16). check-store-canon 의 대조군은 한때 «실제 운영 파일»이었고,
 *   그 파일이 깨끗해지자 자가진단이 깨진 채 방치됐다. 그래서 표본은 운영 파일과 «떼어» 둔다.
 *   `잡아야/` 는 반드시 걸려야 하고 `말아야/` 는 절대 걸리면 안 된다 — **오탐도 결함이다.**
 * ★표본이 늘거나 SMELLS 에 자취를 더하면 여기 표본도 같이 더해라. 표본 없는 자취는 안 잡혀도 모른다.
 */
const 표본뿌리 = 'tests/known-bad/client-sheet';
const 틀린표본: string[] = [];
for (const [갈래, 기대] of [['잡아야', true], ['말아야', false]] as const) {
  const dir = `${표본뿌리}/${갈래}`;
  const names = readdirSync(dir).filter((n) => EXT.test(n));
  if (!names.length) 틀린표본.push(`${dir} — 표본이 «하나도 없다». 빈 대조군은 통과가 아니라 고장이다`);
  for (const n of names) {
    const 잡혔나 = 시트를직접읽는가(readFileSync(join(dir, n), 'utf8')).length > 0;
    if (잡혔나 !== 기대) {
      틀린표본.push(`${갈래}/${n} — ${기대 ? '잡아야 하는데 안 잡힌다' : '안 잡아야 하는데 잡힌다'}`);
    }
  }
}
if (틀린표본.length) {
  console.error(`\n✗ 검사기 고장 — 대조군 ${틀린표본.length}개가 어긋난다. 표본이 아니라 이 자를 고쳐라.\n`);
  for (const t of 틀린표본) console.error(`  ${t}`);
  console.error('');
  process.exit(1);
}
if (process.argv.includes('--자가진단')) {
  console.log(`✓ 대조군만 봤다 — ${표본뿌리} 표본이 전부 기대대로다(저장소는 안 훑었다)`);
  process.exit(0);
}

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name).replaceAll(String.fromCharCode(92), '/');
    if (statSync(path).isDirectory()) { walk(path, out); continue; }
    if (EXT.test(path)) out.push(path);
  }
  return out;
};

const hits: string[] = [];
for (const root of ROOTS) {
  let files: string[] = [];
  try { files = walk(root); } catch { continue; }
  for (const file of files) {
    if (SERVER_ONLY.some((p) => file.startsWith(p))) continue;
    const found = 시트를직접읽는가(readFileSync(file, 'utf8'));
    if (found.length) hits.push(`${file}: 브라우저가 공급사 시트를 읽습니다 — ${found.join(' · ')}`);
  }
}

if (hits.length) {
  console.error(`\n✗ 화면이 시트를 직접 읽습니다 — ${hits.length}건\n`);
  for (const h of hits) console.error(`  ${h}`);
  console.error('\n  시트→ERP 반영은 매시간 자동동기(hourly-sync)의 몫입니다. 화면은 ERP 가 아는 것만 그립니다.');
  console.error('  CLAUDE.md 「화면이 시트를 «직접» 읽어 상태를 덮지 않는다」\n');
  process.exit(1);
}
console.log('✓ 화면이 시트를 직접 읽지 않습니다 — 상태의 원천은 ERP 하나');
