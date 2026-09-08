/**
 * **가벼운 회차 — 30분마다 「최신화」만 한다.** 기본 미리보기 · 반영은 `--apply`.
 *
 * > 사장님 2026-09-08 「**30분마다 돌아서 최신화를 항상 유지**했으면 좋겠는데」
 *
 * ⚠ 매시 회차(`hourly-sync`)는 **48분**이 걸린다 — 그대로 30분마다 돌리면 저희끼리 겹친다.
 *   그래서 「자주 바뀌는 것」만 떼어 여기 세웠다. 실측 **2분 18초**.
 *
 * ```
 * 가벼운 회차(30분)   상태·요금이 바뀌었나 보고 → 시트에 내고 → 박혔나 잰다
 *   ⑤′ 정산원장 계약상태     원장에 접수가 뜬 차를 계약중/출고불가로
 *   ⑬¼ 원천→원자 수집       아는 차의 «상태·주행·요금»만 · 사라진 차는 내림 · 새 차는 등록대기
 *   ⑬½¼ 상태 아물기         status ↔ vehicle_status 를 한 벌로
 *   ⑬½½ 원천 주소 검사       폐기 시트를 읽고 있지 않나
 *   ⑬¾ 원자 문지기          차가 아닌 줄 · 우리 몫 유출 · 대수 급감이면 «멈춘다»
 *   ⑯ 본시트 · ⑯¼ 하허호 F86 · ⑯½ 시트↔원자 대조
 *
 * 매시 회차(무거운 쪽)에만 있는 것
 *   손오공 pull · 정제시트 갱신 · 정제칸 채움 · ⑥ 판매 4탭 · ⑦ ERP 동기 · 천이카드 · 검수 도구들
 * ```
 *
 * ★★**오케스트레이터는 «하나»다 — 이 집 PC 의 작업 스케줄러**(「프리패스-자동동기」 · 매시).
 *   깃허브 워크플로는 그래서 cron 을 빼 두었다(켜면 두 대가 같은 시트를 쓴다).
 *   ⇒ 30분 회차도 **로컬 작업 스케줄러**로 건다 — `scripts/refresh-sync.cmd`.
 * ★무거운 회차가 도는 중이면 **아무것도 안 하고 나간다**(아래 자물쇠). 늦는 것이 겹치는 것보다 낫다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/refresh-sync.mts --apply
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const APPLY = process.argv.includes('--apply');
const A = APPLY ? ['--apply'] : [];
const kst = () => new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 16).replace('T', ' ');
const started = Date.now();
const out: string[] = [`■ 가벼운 회차(최신화) ${kst()} KST${APPLY ? '' : ' — 미리보기'}`];
const line: string[] = [];
const warn: string[] = [];

/**
 * 한 단계 — 찍고, 뽑고, 통과 여부를 돌려준다. 실패해도 다음으로 간다(멈춤은 문지기만).
 *
 * ★**«끝났다는 말»이 찍혔으면 통과로 본다** — 종료코드만 믿지 않는다.
 *   ⚠ 실측 2026-09-08 — Firestore 핸들이 열린 채 `process.exit()` 하면 libuv 가
 *   `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` 로 죽으며 «간헐적으로» 0 이 아닌 코드를 낸다.
 *   같은 스크립트를 따로 돌리면 0 이다. 그걸 실패로 세면 **회차가 거짓으로 운다** —
 *   거짓으로 우는 검사는 사람이 안 믿게 되고, 그게 진짜 경보까지 죽인다.
 *   ⇒ 「끝났다」는 말이 있으면 통과. 다만 코드가 어긋났다는 사실은 «적어» 둔다.
 */
function run(label: string, args: string[], pick: RegExp, doneWord?: RegExp): { ok: boolean; picked: string[]; 한도: boolean } {
  const t0 = Date.now();
  let r = spawnSync('npx', ['tsx', ...args], { encoding: 'utf8', shell: process.platform === 'win32', env: process.env });
  let txt = `${r.stdout || ''}${r.stderr || ''}`;
  /**
   * ★**요청한도면 «한 번» 쉬었다 다시 한다** — 매시 회차가 하는 것과 같다.
   *   ⚠ 구글 한도는 «분당»이라 429 가 즉시 떨어진다(실측 2초). 그대로 넘기면 그 단계가 매번 비고,
   *   30분마다 도는 회차에서는 «늘 한 칸이 빠진 회차»가 된다.
   *   ⇒ 35초 쉬고 한 번만 더. 그래도 안 되면 다음 회차 몫으로 넘긴다(기록엔 남긴다).
   */
  if (r.status !== 0 && /RESOURCE_EXHAUSTED|Quota exceeded|429/.test(txt)) {
    out.push(`   ⏳ ${label} — 요청한도, 35초 쉬고 한 번 더`);
    console.log(`⏳ ${label} — 요청한도, 35초 쉬고 한 번 더`);
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},35000)'], { stdio: 'ignore' });
    r = spawnSync('npx', ['tsx', ...args], { encoding: 'utf8', shell: process.platform === 'win32', env: process.env });
    txt = `${r.stdout || ''}${r.stderr || ''}`;
  }
  const picked = txt.split('\n').filter((l) => pick.test(l)).map((l) => l.replace(/\s+$/, ''));
  const 끝말 = !!doneWord && doneWord.test(txt);
  /**
   * ★**구글 요청한도는 «고장»이 아니다** — 다음 회차에 저절로 낫는다.
   *   ⚠ 30분마다 도는 회차에서 한도를 «실패»로 세면 알림이 늘 켜져 있게 되고,
   *   그러면 진짜 고장이 그 속에 묻힌다. 갈라서 적는다.
   */
  const 한도 = /RESOURCE_EXHAUSTED|Quota exceeded|429/.test(txt);
  const ok = r.status === 0 || 끝말;
  if (r.status !== 0 && 끝말) out.push(`   ※ 끝은 났는데 종료코드 ${r.status} — 핸들 닫힘 경합으로 본다`);
  const sec = Math.round((Date.now() - t0) / 1000);
  out.push(`\n── ${label} ${ok ? '✓' : '✗'} · ${sec}초`);
  for (const l of picked.slice(0, 6)) out.push(`   ${l}`);
  if (!ok) out.push(`   ✗ 종료코드 ${r.status}`);
  console.log(`${ok ? '✓' : '✗'} ${label} · ${sec}초`);
  return { ok, picked, 한도 };
}
const SHIM = ['--require', './scripts/lib/server-only-shim.cjs'];

/**
 * ★★**무거운 회차가 돌고 있으면 이번은 건너뛴다** — 둘이 같은 판매 4탭을 쓴다.
 *
 * ⚠⚠ 2026-09-08 실측 — 이 파이프라인의 오케스트레이터는 **이 집 PC 의 작업 스케줄러**
 *   「프리패스-자동동기」(매시 · `scripts/hourly-sync.cmd`)다. 깃허브 워크플로는 그래서 cron 을 뺐다
 *   (「오케스트레이터가 둘이면 시트·ERP 를 두 군데서 쓴다」).
 *   매시 회차는 **48분**이라 :30 에 이 회차를 돌리면 «거의 항상» 그 위에 겹친다.
 *   ⇒ 무거운 회차가 자물쇠를 쥐고 있으면 **아무것도 안 하고 나간다.**
 *   ★늦는 것이 겹치는 것보다 낫다 — 겹치면 한쪽이 쓰는 중에 다른 쪽이 덮는다.
 *
 * 자물쇠 = 무거운 회차가 남기는 기록 파일의 «나이». 회차가 끝나면 「■ 끝」이 찍힌다.
 * 아직 안 찍혔고 파일이 최근에 손대졌으면 «도는 중»으로 본다.
 */
{
  const LOG = 'tmp/hourly-sync-last.txt';
  try {
    const st = statSync(LOG);
    const 분 = (Date.now() - st.mtimeMs) / 60000;
    const txt = readFileSync(LOG, 'utf8');
    const 끝났나 = /\n■ 끝/.test(txt);
    if (!끝났나 && 분 < 70) {
      console.log(`⏭ 무거운 회차가 도는 중이다(${Math.round(분)}분째) — 이번 최신화는 건너뛴다.`);
      out.push(`\n⏭ 무거운 회차 진행중 — 건너뜀`);
      finish(true);
    }
  } catch { /* 기록이 없으면 무거운 회차가 안 돈 것 — 그냥 간다 */ }
}

// ⑤′ 정산원장 계약상태 — 접수가 뜬 차를 계약중/출고불가로. 시트 칸과 원자를 같이 세운다.
const led = run('⑤′ 정산원장 계약상태', [...SHIM, 'scripts/mark-contract-in-listings.mts', ...A], /세울 차|고칠 칸|원자 |끝 —/, /끝 — 공급사/);
if (!led.ok) warn.push('정산원장 계약상태 실패');

// ⑬¼ 원천→원자 — 아는 차의 상태·주행·요금만. 새 차는 등록대기로.
const rot = run('⑬¼ 원천→원자 수집(돌아가며)', [...SHIM, 'scripts/ingest-rotation.mts', ...A], /돌아가며 수집|이틀 넘게|✔|✗/, /돌아가며 수집 —/);
if (rot.ok) line.push(rot.picked.find((l) => /돌아가며 수집/.test(l))?.replace(/^.*— /, '수집 ') || '수집 ok');
else (rot.한도 ? line : warn).push(rot.한도 ? '수집 한도(다음 회차)' : '원천→원자 수집 실패');

const heal = run('⑬½¼ 상태 아물기', [...SHIM, 'scripts/heal-atom-status.mts', ...A], /한 벌로 아물렀다|이미 한 벌|▲/, /아물렀다|이미 한 벌|미리보기/);
if (!heal.ok) warn.push('상태 아물기 실패');

const src = run('⑬½½ 원천 주소 검사', [...SHIM, 'scripts/audit-supplier-source.mts'], /주소는 전부 살아|죽은 원천|⛔/, /주소는 전부 살아/);
if (!src.ok) (src.한도 ? line : warn).push(src.한도 ? '주소검사 한도(다음 회차)' : '원천 주소가 어긋났다 — 폐기 시트를 읽고 있을 수 있다');

/** ★문지기만 «멈춘다» — 틀린 원자로 시트를 덮느니 이번 회차를 거른다. */
const gate = run('⑬¾ 원자 문지기', [...SHIM, 'scripts/check-atom-intake.mts'], /문지기 통과|막는다|▲|⛔/, /문지기 통과/);
if (!gate.ok) {
  out.push(`\n⛔ 문지기가 막았다 — 발행하지 않는다. 원자를 고치고 다시 돌린다.`);
  finish(false);
}

const pub = run('⑯ 본시트 발행', [...SHIM, 'scripts/make-sample-sheet-google.mts', '--main', ...A], /본시트 반영 완료|중단|Error/, /본시트 반영 완료/);
line.push(pub.ok ? (pub.picked.find((l) => /반영 완료/.test(l))?.replace(/^.*상품시트\(/, '').replace(/\).*$/, '') || '본시트 ok') : '★본시트 실패');
if (!pub.ok) warn.push('본시트 발행 실패');

const ch = run('⑯¼ 하허호 F86 발행', [...SHIM, 'scripts/build-channel-supplier-sheet.mts', ...A], /반영 완료|묵은 탭|이름을 모르는|Error/, /반영 완료 — 탭/);
if (!ch.ok) warn.push('F86 발행 실패 — 채널이 묵은 재고를 본다');

/** ★알림만 — 이미 나간 뒤라 멈춰도 안 되돌려진다. 대신 «무엇이 어긋났는지»를 남긴다. */
const par = run('⑯½ 시트↔원자 대조', [...SHIM, 'scripts/audit-sheet-vs-atom.mts'], /원자대로 박혔다|안 박혔다|빠진 차|남은 차|값이 다른 칸/, /원자대로 박혔다/);
if (par.ok) line.push('대조 ok');
else warn.push(par.picked.find((l) => /안 박혔다/.test(l))?.trim() || '시트↔원자 대조 어긋남');

finish(true);

function finish(done: boolean): never {
  const sec = Math.round((Date.now() - started) / 1000);
  out.push(`\n■ ${done ? '끝' : '중단'} ${kst()} KST · ${sec}초`);
  if (line.length) out.push(`   ${line.join(' · ')}`);
  for (const w of warn) out.push(`   ▲ ${w}`);
  mkdirSync('tmp', { recursive: true });
  writeFileSync('tmp/refresh-sync-last.txt', out.join('\n'), 'utf8');
  console.log(`\n${done ? '■ 끝' : '⛔ 중단'} · ${sec}초${warn.length ? ` · 알림 ${warn.length}` : ''}`);
  for (const w of warn) console.log(`   ▲ ${w}`);
  process.exit(done && !warn.length ? 0 : done ? 0 : 1);
}
