/**
 * **한 시간마다 도는 시트 동기화 한 방** — 사장님 2026-08-19 「내가 말 안 해도 공급사시트 반영해서 한 시간에 한 번씩 새로운 차나 없어진 거 출고불가나 이런 거 작업해 줄 수 있나 · 알아서 돌아가는 시스템」.
 *
 * 차례(한 단계가 실패하면 거기서 멈추고 기록에 남긴다 — 낡은 값을 발행하지 않기 위해):
 *   ① 정제시트 갱신(아이카·오토플러스·이안카·아이언 = 원본에서 새 차·사라진 차(출고불가)·요금·상태를 가져온다)
 *   ② 차명 중복 정리(「쏘나타 쏘나타 DN8」 → 「쏘나타 DN8」)
 *   ③ 모델명 통일(엔카 기준: 벤츠 E200 → E-클래스 · BMW 520i → 5시리즈)
 *   ④ 입고일자 채움(그 차량번호가 우리 쪽에 처음 올라온 날)
 *   ⑤ 차량번호 셀에 사진링크 걸기
 *   ⑥ 판매시트 발행(상품리스트 · 손오공구독 · 오플구독)
 *   ⑥′ (건너뜀) 상품마스터는 이제 안 거친다 — ERP 가 판매시트를 그대로 읽는다. `--with-product-master` 로만 켠다
 *   ⑦ ERP 일일 동기(sheet/sync-daily) — 실패해도 밤 02:00 크론이 다시 돈다(경고만)
 *   ⑧ 시트↔ERP 대조(audit-sheet-erp-parity) — 매시 기록에 「안 뜨는 차 N대」로 남긴다
 *
 * 기본 dry-run(무엇이 바뀌는지만), 실제 반영은 --apply. 기록은 tmp/hourly-sync-log.txt(줄마다 한 번의 실행) · 자세한 출력은 tmp/hourly-sync-last.txt.
 *   npx tsx scripts/hourly-sync.mts --apply
 * ⚠ 겹쳐 돌지 않는다 — tmp/hourly-sync.lock 이 있으면(30분 안) 그냥 끝낸다(작업 스케줄러가 겹쳐 부르는 것 대비).
 */
import { appendFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');
const A = APPLY ? ['--apply'] : [];
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const started = Date.now();
const LOCK = 'tmp/hourly-sync.lock';
if (existsSync(LOCK) && Date.now() - statSync(LOCK).mtimeMs < 30 * 60_000) { console.log('앞의 실행이 아직 돈다(lock) — 이번은 건너뛴다'); process.exit(0); }
writeFileSync(LOCK, kst());

const out: string[] = [`■ 시간별 동기화 ${APPLY ? '반영' : '미리보기'} ${kst()} KST`];
const line: string[] = [];
const run = (label: string, args: string[], pick: RegExp): { ok: boolean; picked: string[] } => {
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', ...args], { encoding: 'utf8', shell: process.platform === 'win32', env: process.env, maxBuffer: 64 * 1024 * 1024 });
  const lines = `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l && !/DEP0190|trace-deprecation|Assertion/.test(l));
  const picked = lines.filter((l) => pick.test(l)).map((l) => l.trim());
  out.push(`\n── ${label} ${r.status === 0 ? '✓' : '✗'}`, ...lines.slice(-40).map((l) => `   ${l.slice(0, 300)}`));
  console.log(`── ${label} ${r.status === 0 ? '✓' : '✗'}`); for (const l of picked.slice(0, 6)) console.log(`   ${l.slice(0, 220)}`);
  return { ok: r.status === 0, picked };
};
const stop = (why: string) => {
  out.push(`\n⛔ 중단 — ${why}`); line.push(`중단(${why})`);
  writeFileSync('tmp/hourly-sync-last.txt', out.join('\n'));
  appendFileSync('tmp/hourly-sync-log.txt', `${kst()} ${APPLY ? '반영' : '미리'} ${Math.round((Date.now() - started) / 1000)}초 · ${line.join(' · ')}\n`);
  rmSync(LOCK, { force: true });
  console.log(`⛔ 중단 — ${why}`);
  process.exit(1);
};

// ① 정제시트(원본이 자체시트·홈페이지인 4곳) — 새 차 추가 · 사라진 차 출고불가 · 요금/상태 갱신
const s1 = run('① 정제시트 갱신', ['scripts/sync-mirror-all.mts', ...A], /새 차|사라진|갱신할|끝|실패|✓|✗/);
if (!s1.ok) stop('정제시트 갱신 실패');
line.push(`정제시트 ${s1.picked.find((l) => /새 차/.test(l))?.replace(/\s+/g, ' ').slice(0, 60) || 'ok'}`);

// ② 차명 중복 정리 → ③ 모델명 통일(엔카 기준)
const s2 = run('② 차명 중복 정리', ['scripts/tidy-vehicle-names.mts', ...A], /합계/);
if (!s2.ok) stop('차명 정리 실패'); line.push(s2.picked[0]?.replace('■ ', '차명 ') || '차명 0');
const s3 = run('③ 모델명 통일', ['scripts/normalize-model-names.mts', ...A], /합계/);
if (!s3.ok) stop('모델명 통일 실패'); line.push(s3.picked[0]?.replace('■ ', '모델명 ') || '모델명 0');

// ④ 입고일자(처음 올라온 날) → ⑤ 차량번호 셀 사진링크
const s4 = run('④ 입고일자', ['tmp/fill-intake-date.mts', ...A], /반영 끝|dry-run|쓸 칸/);
if (!s4.ok) stop('입고일자 실패'); line.push('입고일자 ok');
const s5 = run('⑤ 차량번호 링크', ['scripts/publish-plate-links.mts', ...A], /합계/);
if (!s5.ok) stop('차량번호 링크 실패'); line.push(s5.picked[0]?.replace('■ 합계 — ', '') || '링크 0');

// ⑥ 판매시트 3탭
const p1 = run('⑥ 상품리스트', ['scripts/publish-origin-tab.mts', ...A], /우리 시트 |반영 완료|중단|Error/);
if (!p1.ok) stop('상품리스트 발행 실패(공급사 0대 가드면 확인 후 --force-shrink)');
line.push(p1.picked.find((l) => /반영 완료/.test(l))?.replace('반영 완료 — 탭 ', '') || '상품리스트 ok');
const p2 = run('⑥ 손오공구독', ['scripts/publish-origin-tab.mts', '--only=RP012:구독', '--tab=손오공구독', '--at=1', ...A], /반영 완료|중단|Error/);
if (!p2.ok) stop('손오공구독 발행 실패');
const p2b = run('⑥ 손오공 요금블록', ['scripts/publish-sonogong-tab.mts', ...A], /반영 완료|Error/);
if (!p2b.ok) stop('손오공 요금블록 실패');
const p3 = run('⑥ 오플구독', ['scripts/publish-origin-tab.mts', '--only=RP023', '--tab=오플구독', '--at=2', ...A], /반영 완료|중단|Error/);
if (!p3.ok) stop('오플구독 발행 실패');
const p3b = run('⑥ 오플 요금블록', ['scripts/publish-sonogong-tab.mts', '--tab=오플구독', ...A], /반영 완료|Error/);
if (!p3b.ok) stop('오플 요금블록 실패');

// ⑥′ 상품마스터 — ERP 가 읽는 표. 공급사 시트 유입 갱신 → 발행값(판매시트)으로 맞춤.
//    ★2026-08-20 사장님 「erp랑도 연동해서 맞추고 있는 건가?」 — 이 두 단계가 빠져 상품마스터가 08-15 에 멈춰 있었고
//      새 차 28대(아이언 5·아이카 9·이안카 13 등)가 ERP 에 못 들어갔다. 이제 매시간 같이 돈다.
/**
 * ★2026-08-20 — **상품마스터는 안 거친다.** 사장님 「영업자가 보는 거랑 우리 ERP 랑 바로 연동하자 · 일단
 *   상품마스터 안 거치고」 · 「상품마스터 참조 안 하잖아 이제」. ERP 는 판매시트 3탭을 그대로 읽고,
 *   상품마스터는 «취급 이력 원장»으로만 남는다(탭 이름도 「상품마스터_구버전」).
 *   ⚠ 그런데 이 두 단계가 남아 있어 **매시 동기가 여기서 죽었다** — 구버전 탭은 50열이라 규격 52열과
 *     안 맞아 「상품마스터 A:AZ 헤더 불일치」가 나고, 뒤의 ⑦·⑧ 이 통째로 안 돌아 ERP 가 낡은 채로 있었다
 *     (실측 2026-08-20 10:07~12:13 · ERP 가 08:12 값에 멈춰 있었다).
 *   이력 원장을 갱신하고 싶은 날만 `--with-product-master` 로 켠다. 실패해도 발행·ERP 를 막지 않는다.
 */
if (process.argv.includes('--with-product-master')) {
  const m1 = run("⑥′ 상품마스터 갱신(이력 원장)", ['scripts/sync-product-master-live.mts', ...A], /created|문패|Error/);
  const m2 = run("⑥′ 상품마스터 ← 판매시트", ['scripts/sync-product-master-from-sales.mts', ...A], /어긋난 칸|되읽기|✓|Error/);
  line.push(m1.ok && m2.ok ? (m2.picked.find((l) => /어긋난 칸/.test(l))?.replace('어긋난 칸', 'PM 어긋난 칸') || 'PM ok') : 'PM 실패(경고)');
} else line.push('PM 건너뜀(구버전)');

// ⑦ ERP 일일 동기 — 로컬 코드로 돈다(배포본과 같은 함수). 실패는 경고(밤 02:00 크론이 다시 돈다).
//    ★2026-08-20 — ERP 원본이 «영업자 상품리스트»로 바뀌었다(lib/domain/sheet-erp-parity 규칙 ①).
//      배포 전에는 배포본 API 가 옛 경로(상품마스터)라, 로컬 스크립트로 돌려야 시트와 ERP 가 같아진다.
const erp = run('⑦ ERP 일일 동기', ['--require', './tmp/codex-server-only-shim.cjs', 'scripts/run-sheet-daily-sync-local.mts', ...A], /반영|미리보기|원본 |✗/);
line.push(erp.ok ? (erp.picked.find((l) => /원본 /.test(l))?.slice(0, 60) || 'ERP ok') : 'ERP 실패');

// ⑧ 대조 — 판매시트 ↔ ERP 가 실제로 같은지 매 시간 확인해 기록에 남긴다(규칙 정본 lib/domain/sheet-erp-parity.ts).
const chk = run('⑧ 시트↔ERP 대조', ['scripts/audit-sheet-erp-parity.mts'], /판매시트 |안 뜨는 차|없는 차/);
line.push(chk.picked.find((l) => /안 뜨는 차/.test(l))?.replace('■ ', '') || '대조 ok');

out.push(`\n■ 끝 ${kst()} KST · ${Math.round((Date.now() - started) / 1000)}초`);
writeFileSync('tmp/hourly-sync-last.txt', out.join('\n'));
appendFileSync('tmp/hourly-sync-log.txt', `${kst()} ${APPLY ? '반영' : '미리'} ${Math.round((Date.now() - started) / 1000)}초 · ${line.join(' · ')}\n`);
rmSync(LOCK, { force: true });
console.log(`■ 끝 — ${Math.round((Date.now() - started) / 1000)}초 · 기록 tmp/hourly-sync-log.txt`);
