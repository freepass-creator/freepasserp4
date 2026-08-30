/**
 * **한 시간마다 도는 시트 동기화 한 방** — 사장님 2026-08-19 「내가 말 안 해도 공급사시트 반영해서 한 시간에 한 번씩 새로운 차나 없어진 거 출고불가나 이런 거 작업해 줄 수 있나 · 알아서 돌아가는 시스템」.
 *
 * 차례(한 단계가 실패하면 거기서 멈추고 기록에 남긴다 — 낡은 값을 발행하지 않기 위해):
 *   ⓪ 손오공(D경로) pull → 차종마스터 매칭 정제 → 재고시트   ★2026-08-30 aiops 에서 옮겨옴
 *   ① 정제시트 갱신(아이카·오토플러스·이안카·아이언 = 원본에서 새 차·사라진 차(출고불가)·요금·상태를 가져온다)
 *   ①′ 공급사 정제칸 채움(차종마스터 매칭 — 원산지가 비면 보증금 계산이 막혀 요금이 통째로 사라진다)
 *   ② 차명 중복 정리(「쏘나타 쏘나타 DN8」 → 「쏘나타 DN8」)
 *   ③ 모델명 통일(엔카 기준: 벤츠 E200 → E-클래스 · BMW 520i → 5시리즈)
 *   ④ 입고일자 채움(그 차량번호가 우리 쪽에 처음 올라온 날)
 *   ⑤ 차량번호 셀에 사진링크 걸기
 *   ⑥ 판매시트 «4탭» 발행(상품리스트 · 손오공구독 · 픽업구독 · 오플구독) + 요금블록
 *   ⑥′ (건너뜀) 상품마스터는 이제 안 거친다 — ERP 가 판매시트를 그대로 읽는다. `--with-product-master` 로만 켠다
 *   ⑦ ERP 일일 동기(sheet/sync-daily) — 실패해도 밤 02:00 크론이 다시 돈다(경고만)
 *   ⑦′ ERP 를 시트 그대로 비춤 — 사진링크 · 모델/차명 · 시트에 없는 차 출고불가(일일 동기가 안 옮기는 것들)
 *   ⑧ 시트↔ERP 대조(audit-sheet-erp-parity) — 매시 기록에 「안 뜨는 차 N대」로 남긴다
 *   ⑨ 상태 갈림 신호(audit-status-drift) — 원본→정제시트→판매시트→ERP 중 «어디서 갈렸나». 고치지 않고 신호만
 *   ⑩ 천이 카드시트(손오공 정제칸만)   ⑪ 요금 검수(판매↔ERP)
 *
 * ★규격 = `C:/dev/aiops/docs/연동지도.md`. 원본 4곳은 **우리가 못 만진다** — 정제시트로 가져와
 *   정제칸을 채우고 · 판매 4탭을 만들고 · 천이를 만들고 · 상품리스트 기준으로 ERP 에 반영한다.
 *   사장님 2026-08-30 「프리패스는 AIOps 를 쓰지 않아. 프리패스 자체적으로 자동으로 하게 만들 거야.」
 *
 * 기본 dry-run(무엇이 바뀌는지만), 실제 반영은 --apply. 기록은 tmp/hourly-sync-log.txt(줄마다 한 번의 실행) · 자세한 출력은 tmp/hourly-sync-last.txt.
 *   npx tsx scripts/hourly-sync.mts --apply
 * ⚠ 겹쳐 돌지 않는다 — tmp/hourly-sync.lock 이 있으면(30분 안) 그냥 끝낸다(작업 스케줄러가 겹쳐 부르는 것 대비).
 */
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';

const APPLY = process.argv.includes('--apply');
const A = APPLY ? ['--apply'] : [];
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const started = Date.now();
/**
 * 겹침 잠금 — **PID 로 살아 있는지 본다.** 시각으로만 재면 30분 넘는 실행이 겹친다.
 *
 * ★코덱스 2026-08-30 지적: 「30분이 지나면 기존 실행이 살아 있어도 새 실행이 lock 을 덮어쓴다.
 *   먼저 끝난 실행이 lock 을 지우면 뒤 실행의 lock 도 함께 사라진다.」 — 실제로 이 전 구간은
 *   손오공 pull 까지 붙어 30분을 넘길 수 있다(2026-08-30 dry-run 이 15분에도 안 끝났다).
 * 그래서 «시간»이 아니라 «그 PID 가 살아 있나»로 판정하고, lock 은 **내가 쓴 것일 때만** 지운다.
 */
const LOCK = 'tmp/hourly-sync.lock';
/**
 * 심장박동 — 살아 있는 실행은 **30초마다** lock 을 만진다(아래 일꾼 스레드).
 * 이 시간(5분)이 지나도록 안 만져졌으면 그 실행은 죽었다.
 * ★단계가 아무리 길어도 심장은 계속 뛰므로, 「긴 단계 = 죽은 것」으로 오해하지 않는다.
 */
const HEARTBEAT_STALE_MS = 5 * 60_000;
/**
 * ★**실행 표딱지(runId)** — PID 가 아니라 이걸로 주인을 가린다.
 *   PID 는 OS 가 재사용한다. 표딱지는 안 겹친다(pid + 시작시각 + 난수).
 */
const RUN_ID = `${process.pid}-${started}-${Math.random().toString(36).slice(2, 8)}`;
type LockFile = { runId?: string; pid?: number; startedAt?: string; heartbeat?: string };
const readLock = (): LockFile | null => {
  try { return JSON.parse(readFileSync(LOCK, 'utf8')) as LockFile; } catch { return null; }
};
/**
 * 잠금 «획득» — **원자적으로** 한 놈만 이긴다.
 *
 * ★코덱스 2026-08-30 5차: 「있나 보고 → 쓰기」 사이가 벌어져 있어, 둘이 동시에 「없네」를 보면
 *   둘 다 자기 것으로 덮어쓰고 같이 돈다. 심장박동은 «획득한 뒤»의 생존만 보장할 뿐 이 경쟁은 못 막는다.
 *
 * 그래서 둘 다 OS 의 원자적 연산으로 바꿨다.
 *   ① 새로 잡기   `open(..., 'wx')` — 파일이 이미 있으면 실패한다. 만드는 것과 «내가 만들었다»가 한 번에 일어난다.
 *   ② 죽은 것 뺏기 `rename(LOCK, LOCK.claim-내표딱지)` — 이름 바꾸기도 원자적이라 **한 놈만 성공**한다.
 *      진 쪽은 ENOENT 를 받고 조용히 물러난다. 「죽었네」를 둘이 동시에 봐도 뺏는 건 하나뿐이다.
 */
function acquireLock(): boolean {
  const write = () => {
    const fd = openSync(LOCK, 'wx');   // 이미 있으면 여기서 예외 — 이게 원자성이다
    try { writeSync(fd, JSON.stringify({ runId: RUN_ID, pid: process.pid, startedAt: kst(), heartbeat: kst() })); }
    finally { closeSync(fd); }
  };
  try { write(); return true; } catch { /* 이미 있다 — 아래에서 살았나 본다 */ }

  const quiet = existsSync(LOCK) ? Date.now() - statSync(LOCK).mtimeMs : Infinity;
  if (quiet < HEARTBEAT_STALE_MS) return false;   // 심장이 뛰고 있다 — 남의 실행이 살아 있다

  const claim = `${LOCK}.claim-${RUN_ID}`;
  try { renameSync(LOCK, claim); } catch { return false; }   // 뺏기 경쟁에서 졌다
  rmSync(claim, { force: true });
  try { write(); return true; } catch { return false; }
}
if (!acquireLock()) { console.log('앞의 실행이 아직 돈다(lock) — 이번은 건너뛴다'); process.exit(0); }
const writeLock = () => writeFileSync(LOCK, JSON.stringify({ ...readLock(), runId: RUN_ID, pid: process.pid, heartbeat: kst() }));
/**
 * 단계마다 부른다 — 「나 아직 살아 있다」. **먼저 «내 표딱지가 맞나»를 본다.**
 * 뺏겼으면 되뺏지 않고 물러난다(코덱스 3차). 새 실행은 처음부터 다시 도니 잃는 것도 없다.
 */
let lockLost = false;
const touchLock = () => {
  if (lockLost) return;
  const held = readLock();
  if (held && held.runId && held.runId !== RUN_ID) { lockLost = true; return; }
  try { writeLock(); } catch { /* 지워졌으면 다음 단계에서 다시 쓴다 */ }
};
/**
 * ★심장은 «단계 사이»가 아니라 **쉬지 않고** 뛰어야 한다.
 *   코덱스 4차: touchLock 은 spawnSync 전후에서만 뛴다 → 긴 단계 중엔 심장이 멎은 것처럼 보인다.
 *   일꾼 스레드가 30초마다 만진다. 메인이 막혀 있어도 스레드는 따로 돈다.
 *   프로세스가 죽으면 스레드도 죽으니 「죽으면 안 뛴다」는 그대로다.
 */
const heartbeat = new Worker(`
  const { workerData } = require('node:worker_threads');
  const { readFileSync, writeFileSync } = require('node:fs');
  const { lock, runId } = workerData;
  setInterval(() => {
    try {
      const held = JSON.parse(readFileSync(lock, 'utf8'));
      if (held.runId !== runId) return;          // 뺏겼다 — 되뺏지 않는다
      /* 있던 칸을 지우지 않는다 — startedAt 이 사라지면 형식이 갈린다. */
      writeFileSync(lock, JSON.stringify({ ...held, heartbeat: new Date().toISOString() }));
    } catch { /* 지워졌거나 읽는 중 — 다음 박동에 다시 */ }
    /* ⚠ 이 타이머에 unref 를 걸면 일꾼의 할 일이 없어져 **스레드가 즉시 죽는다.**
       처음에 그렇게 짰다가 실측으로 잡았다(메인 5초 막힘 · lock 0초 갱신). */
  }, 30_000);
`, { eval: true, workerData: { lock: LOCK, runId: RUN_ID } });
heartbeat.unref();
/** 내 표딱지일 때만 지운다 — 남의 실행 lock 을 지우면 그 실행이 무방비가 된다. */
const releaseLock = () => {
  const held = readLock();
  if (held && held.runId && held.runId !== RUN_ID) return;
  rmSync(LOCK, { force: true });
};

const out: string[] = [`■ 시간별 동기화 ${APPLY ? '반영' : '미리보기'} ${kst()} KST`];
const line: string[] = [];
/** 상태로그 뼈대 — 연동지도가 요구하는 «단계별·커버리지·경고». 코덱스가 이걸 읽는다. */
const steps: Array<{ 단계: string; ok: boolean; 신호?: string; 요약?: string }> = [];
const warnings: string[] = [];
let coverage: { 총: number; 매칭: number; 모델없음: number; 트림실패: number; 매칭율: number } | null = null;
/** 한 단계라도 실패하면 false — 성공으로 «기록»하지 않기 위해서다. */
let allOk = true;
/**
 * runner = 'npx' (tsx 스크립트) · 'node' (손오공 .mjs — tsx 를 거칠 이유가 없다)
 *
 * ★구글 API 요청한도(429)는 **재시도한다** — 탭을 여럿 연달아 쓰면 흔히 걸린다.
 *   한도 때문에 한 탭이 실패하면 그 뒤 단계가 통째로 멈추고, 그건 「데이터가 틀린 것」이 아니라
 *   「잠깐 밀린 것」이다. 30초 쉬고 세 번까지 다시 해 본다.
 *   (run-sales-erp-hourly.mts 에 있던 장치를 정본 오케스트레이터로 옮겨 왔다 — 2026-08-30)
 */
const RATE_LIMIT = /\b429\b|rate.?limit|quota|RESOURCE_EXHAUSTED/i;
/**
 * 동기 대기 — `Atomics.wait` 로 **잠든다**. 바쁜 대기(while 루프)로 짰다가 코덱스에게 잡혔다:
 * 30초×2회면 1분을 코어 하나 100% 로 태운다. 이 스크립트는 단계가 순서대로만 도는
 * 동기 오케스트레이터라 async 로 바꿀 필요 없이 «진짜로 자는» 방법만 있으면 된다.
 */
const sleep = (ms: number) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
/**
 * ★`signal2ok` — **종료코드 2 를 «실패»가 아니라 «어긋남을 찾았다»로 읽는다.**
 *
 *   ⑧ 대조·⑨ 상태갈림·⑪ 요금검수는 «재는 자»다. 어긋남을 찾으면 exit 2 를 낸다 — 그게 정상 동작이고,
 *   특히 dry-run 에서는 ①~⑦ 이 아무것도 안 썼으니 **항상** 어긋난다.
 *   이걸 실패로 세면 매 실행이 실패로 끝나고 3시간마다 메일이 간다 → 아무도 그 메일을 안 믿게 된다.
 *   (2026-08-30 내가 allOk 를 넣으면서 실제로 이 병을 만들었다. 실측 exit=2 · 22단계 중 2건이 그것이었다.)
 *   exit 2 «말고» 다른 실패(1·크래시)는 그대로 실패다 — 재는 자 자체가 죽은 것이므로.
 */
const run = (label: string, args: string[], pick: RegExp, runner: 'npx' | 'node' = 'npx', signal2ok = false): { ok: boolean; picked: string[] } => {
  const bin = runner === 'node' ? 'node' : (process.platform === 'win32' ? 'npx.cmd' : 'npx');
  const argv = runner === 'node' ? args : ['tsx', ...args];
  for (let attempt = 1; ; attempt += 1) {
    touchLock();   // 시작 «전»에도 만진다 — 자식이 도는 동안은 못 만지므로 공백을 절반으로 줄인다
    /* 잠금을 뺏겼으면 **여기서 물러난다.** 뒤늦게 깨어난 쪽이 시트·ERP 를 같이 쓰면 안 된다. */
    if (lockLost) stop('잠금을 다른 실행이 가져갔다 — 이 회차는 물러난다(겹쳐 쓰지 않기 위해)');
    const r = spawnSync(bin, argv, { encoding: 'utf8', shell: process.platform === 'win32', env: process.env, maxBuffer: 64 * 1024 * 1024 });
    const raw = `${r.stdout || ''}\n${r.stderr || ''}`;
    const lines = raw.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l && !/DEP0190|trace-deprecation|Assertion/.test(l));
    const picked = lines.filter((l) => pick.test(l)).map((l) => l.trim());
    const 신호 = signal2ok && r.status === 2;   // 어긋남을 «찾았다» — 재는 자가 죽은 게 아니다
    const ok = r.status === 0 || 신호;
    if (!ok && attempt < 3 && RATE_LIMIT.test(raw)) {
      console.log(`── ${label} ⏳ 구글 요청한도 — 30초 쉬고 다시 (${attempt}/3)`);
      out.push(`\n── ${label} ⏳ 요청한도 재시도 ${attempt}`);
      sleep(30_000);
      continue;
    }
    out.push(`\n── ${label} ${ok ? '✓' : '✗'}${attempt > 1 ? ` (${attempt}회)` : ''}`, ...lines.slice(-40).map((l) => `   ${l.slice(0, 300)}`));
    console.log(`── ${label} ${ok ? '✓' : '✗'}${attempt > 1 ? ` (${attempt}회)` : ''}`);
    for (const l of picked.slice(0, 6)) console.log(`   ${l.slice(0, 220)}`);
    /* ★단계 결과를 남긴다. 「경고로 넘긴 단계」도 상태로그에서는 성공이 아니다.
       (코덱스 2026-08-30: 「⑩ 이 실패해도 ok:true 로 기록해 천이가 조용히 낡을 수 있다」) */
    touchLock();   // 「나 아직 살아 있다」 — 단계마다 심장박동(코덱스 2026-08-30 2차)
    steps.push({ 단계: label, ok, ...(신호 ? { 신호: '어긋남 있음' } : null), ...(picked.length ? { 요약: picked.slice(0, 3).join(' | ').slice(0, 300) } : null) });
    if (신호) warnings.push(`${label} — 어긋남 있음(신호)`);
    else if (!ok) { allOk = false; warnings.push(`${label} 실패`); }
    return { ok, picked };
  }
};
/**
 * ★**멈추면 메일로 알린다**(사장님 2026-08-20 「동기가 멈추면 메일로」).
 *   실측 2026-08-20 — 08:12 부터 12:13 까지 네 시간 멈춰 있었는데 **아무도 몰랐다.**
 *   기록은 파일에만 남았고 사장님이 「동기화 됐나?」 물어봐서 알았다. 자동은 «멈췄다는 사실이
 *   사람에게 닿을 때» 완성된다.
 * ⚠ 매시 실패하면 매시 메일이 온다 — 그러면 아무도 안 본다. **처음 실패한 때와 그 뒤 3시간마다**만 보낸다.
 *   다시 성공하면 「복구됨」을 한 번 보내고 세는 것을 지운다.
 *   보내는 도구는 이미 있는 `C:\dev\mailtool\send_mail.py`(GMAIL_ADDRESS·GMAIL_APP_PASSWORD 환경변수).
 */
const ALERT_STATE = 'tmp/hourly-sync-alert.json';
/** 받는 사람 — 대표·강지수 팀장·박태윤(사장님 2026-08-20 「내거랑 강지수팀장이랑 박태윤이랑 같이 메일가게」). */
const ALERT_TO = (process.env.FP_ALERT_TO || 'pyh@teamjpk.com,kjs@teamjpk.com,pty@teamjpk.com')
  .split(',').map((x) => x.trim()).filter(Boolean);
const ALERT_GAP_MS = 3 * 60 * 60 * 1000;
type AlertState = { failingSince?: string; lastAlertAt?: number; count?: number };
const readAlert = (): AlertState => { try { return JSON.parse(readFileSync(ALERT_STATE, 'utf8')) as AlertState; } catch { return {}; } };
const sendMail = (subject: string, body: string) => {
  try {
    const bodyFile = 'tmp/hourly-sync-alert-body.txt';
    writeFileSync(bodyFile, body, 'utf8');
    const to = ALERT_TO.flatMap((addr) => ['--to', addr]);
    const r = spawnSync('python', ['C:/dev/mailtool/send_mail.py', ...to, '--subject', subject, '--body-file', bodyFile, '--from-name', '프리패스 자동동기'], { encoding: 'utf8', timeout: 120_000 });
    if (r.status !== 0) console.log(`   ⚠ 알림 메일 실패 — ${(r.stderr || r.stdout || '').split(/\r?\n/).filter(Boolean).slice(-2).join(' ')}`);
    else console.log(`   ✉ 알림 메일 보냄 → ${ALERT_TO.join(' · ')}`);
  } catch (e) { console.log(`   ⚠ 알림 메일 실패 — ${(e as Error).message.slice(0, 120)}`); }
};
/** 실패했을 때 — 처음이거나 3시간이 지났으면 보낸다. */
const alertFail = (why: string) => {
  const st = readAlert();
  const now = Date.now();
  const count = (st.count || 0) + 1;
  const since = st.failingSince || kst();
  const due = !st.lastAlertAt || (now - st.lastAlertAt) >= ALERT_GAP_MS;
  writeFileSync(ALERT_STATE, JSON.stringify({ failingSince: since, lastAlertAt: due ? now : st.lastAlertAt, count }));
  if (!due) return;
  sendMail(
    `[프리패스] 시트→ERP 자동동기 멈춤 — ${why}`,
    [
      `멈춘 단계: ${why}`,
      `처음 멈춘 때: ${since} · 그 뒤 ${count}번 연속 실패`,
      `이번 실행: ${kst()} KST`,
      '',
      '이 동안 ERP 는 마지막으로 성공한 값에 머뭅니다(공급사 시트를 고쳐도 안 넘어갑니다).',
      '',
      '푸는 법 — C:/dev/aiops/docs/sop/영업/ERP반영.md 「멈출 때」',
      '자세한 기록 — C:/dev/freepasserp4/tmp/hourly-sync-last.txt',
      '',
      '── 마지막 실행 꼬리 ──',
      out.slice(-25).join('\n'),
    ].join('\n'),
  );
};
/** 다시 성공했을 때 — 멈춰 있었다면 한 번만 「복구됨」. */
const alertRecovered = () => {
  const st = readAlert();
  if (!st.failingSince) return;
  writeFileSync(ALERT_STATE, JSON.stringify({}));
  sendMail(
    '[프리패스] 시트→ERP 자동동기 복구됨',
    [`${st.failingSince} 부터 ${st.count || 0}번 멈춰 있던 자동동기가 ${kst()} KST 에 다시 끝까지 돌았습니다.`, '', line.join(' · ')].join('\n'),
  );
};
/**
 * 상태로그 — 연동지도 「매 실행 상태로그 → 코덱스 검증」. **사람이 아니라 검사기가 읽는 자리**다.
 * 그래서 요약 문장이 아니라 «단계별·커버리지·경고»를 구조로 남긴다
 * (코덱스 2026-08-30: 「요약뿐이라 검증에 충분하지 않다」).
 */
function writeStatus(ok: boolean, 중단?: string) {
  writeFileSync('tmp/자동동기-상태.json', JSON.stringify({
    시각: kst(), 반영: APPLY, 초: Math.round((Date.now() - started) / 1000),
    ok, ...(중단 ? { 중단 } : null),
    단계: steps, 커버리지: coverage, 경고: warnings, 요약: line,
  }, null, 2));
}

const stop = (why: string) => {
  out.push(`\n⛔ 중단 — ${why}`); line.push(`중단(${why})`);
  warnings.push(`중단 — ${why}`);
  writeFileSync('tmp/hourly-sync-last.txt', out.join('\n'));
  appendFileSync('tmp/hourly-sync-log.txt', `${kst()} ${APPLY ? '반영' : '미리'} ${Math.round((Date.now() - started) / 1000)}초 · ${line.join(' · ')}\n`);
  writeStatus(false, why);
  if (!lockLost) releaseLock();
  void heartbeat.terminate();   // 뺏긴 lock 은 남의 것이다 — 지우면 그 실행이 무방비가 된다
  console.log(`⛔ 중단 — ${why}`);
  if (APPLY) alertFail(why);
  process.exit(1);
};

/**
 * ⓪ 손오공(D경로) — API pull → 차종마스터 매칭 정제 → 재고시트.
 *
 * ★2026-08-30 aiops 에서 옮겨왔다(사장님 「프리패스는 AIOps 를 쓰지 않아. 프리패스 자체적으로」).
 *   전에는 `C:/dev/aiops/scripts/손오공-매일.mjs` 가 이 셋을 돌리고 나머지는 여기 스크립트를 불렀다 —
 *   즉 심장만 남의 집에 있었다. 이제 한 집에서 다 돈다.
 * ★계정 파일이 없으면 «건너뛴다». GitHub Actions 처럼 자격증명이 없는 데서 전 구간이 죽지 않게.
 *   (`sonokong/lib/wonja/.손오공계정.json` — git 에 올리지 않는다)
 */
const 손오공계정 = 'sonokong/lib/wonja/.손오공계정.json';
if (existsSync(손오공계정)) {
  const k1 = run('⓪ 손오공 pull', ['sonokong/scripts/손오공.mjs', '--조용'], /완료|실패/, 'node');
  if (!k1.ok) stop('손오공 pull 실패');
  const k2 = run('⓪ 손오공 정제(차종마스터 매칭)', ['sonokong/scripts/손오공-정제.mjs', '--json'], /총 \d+대|실패/, 'node');
  if (!k2.ok) stop('손오공 정제 실패');
  // 커버리지 — 「총 N대 · 매칭 N · 모델 시트에 없음 N · 트림/연식 매칭실패 N」. 85% 밑이면 차종마스터를 보강해야 한다.
  /* 연동지도 규격 = {총,매칭,모델없음,트림실패,매칭율} 다섯 칸. 셋만 적어 코덱스에게 잡혔다(2026-08-30 2차). */
  const cov = /총 (\d+)대 · 매칭 (\d+) · 모델 시트에 없음 (\d+) · 트림\/연식 매칭실패 (\d+)/.exec(k2.picked.join(' ') || '');
  if (cov) {
    const rate = Math.round((Number(cov[2]) / Number(cov[1])) * 100);
    coverage = {
      총: Number(cov[1]), 매칭: Number(cov[2]),
      모델없음: Number(cov[3]), 트림실패: Number(cov[4]), 매칭율: rate,
    };
    line.push(`손오공 정제 ${rate}%(${cov[2]}/${cov[1]})`);
    if (rate < 85) {
      const w = `손오공 정제 매칭율 ${rate}% (<85%) — 차종마스터 시트 보강 필요`;
      out.push(`\n⚠ ${w}`); warnings.push(w);
    }
  } else line.push('손오공 정제 ok');
  const k3 = run('⓪ 손오공 재고시트', ['sonokong/scripts/손오공-재고시트.mjs', ...(APPLY ? ['--쓰기'] : [])], /재고 ←|실패|Error/, 'node');
  if (!k3.ok) stop('손오공 재고시트 실패');
} else if (APPLY) {
  /**
   * ★계정이 없는데 `--apply` 로 도는 것은 **안전한 완주가 아니다**(코덱스 2026-08-30).
   *   ⓪ 을 건너뛴 채 ⑥ 에서 손오공구독·픽업구독을 다시 발행하면 «낡은 재고»가 새 발행처럼 찍힌다.
   *   GitHub Actions 에 손오공 시크릿을 붙이기 전에는 여기서 큰 소리로 멈추는 게 맞다 —
   *   조용히 도는 것보다 「시크릿을 넣어라」고 실패하는 편이 낫다.
   *   정말 손오공 없이 돌려야 하면 `--손오공없이` 를 명시한다(그때는 손오공 탭을 발행하지 않는다).
   */
  if (!process.argv.includes('--손오공없이')) {
    /* 중단도 «단계»로 남긴다 — run() 을 안 거치면 steps[] 가 비어 코덱스가 못 읽는다(2026-08-30 2차). */
    steps.push({ 단계: '⓪ 손오공', ok: false, 요약: '계정 파일 없음' });
    allOk = false;
    stop('손오공 계정 없음 — sonokong/lib/wonja/.손오공계정.json (정말 없이 돌리려면 --손오공없이)');
  }
  line.push('손오공 건너뜀(계정 없음 · 명시)');
  warnings.push('손오공 없이 진행 — 손오공구독·픽업구독 발행과 ⑩ 천이를 건너뛴다');
  warnings.push('⚠ ⑦ ERP 동기는 그대로 돈다 — 판매시트의 «낡은 손오공 탭»이 ERP 로 다시 반영될 수 있다');
  /* ★이 회차는 «온전한 실행»이 아니다. 경고만 남기면 ok:true·exit 0 으로 끝나 아무도 모른다(코덱스 3차).
     낡은 값이 ERP 로 흘러갈 수 있는 회차이므로 반드시 실패로 표시한다. */
  allOk = false;
} else {
  line.push('손오공 건너뜀(계정 없음 · 미리보기)');
  console.log('· ⓪ 손오공 — 계정 파일이 없어 건너뜁니다(sonokong/lib/wonja/.손오공계정.json)');
}
/** 손오공을 못 돌렸으면 손오공 탭은 «건드리지 않는다» — 낡은 값을 새로 발행하지 않기 위해. */
const 손오공탭발행 = existsSync(손오공계정);

// ① 정제시트(원본이 자체시트·홈페이지인 4곳) — 새 차 추가 · 사라진 차 출고불가 · 요금/상태 갱신
const s1 = run('① 정제시트 갱신', ['scripts/sync-mirror-all.mts', ...A], /새 차|사라진|갱신할|끝|실패|✓|✗/);
if (!s1.ok) stop('정제시트 갱신 실패');
line.push(`정제시트 ${s1.picked.find((l) => /새 차/.test(l))?.replace(/\s+/g, ' ').slice(0, 60) || 'ok'}`);

/**
 * ①′ 공급사 정제칸 채움 — 미러로 받아온 원문의 제조사·모델·원산지를 차종마스터로 매칭해 채운다.
 * ★미러(①)만 하고 이걸 빠뜨리면 «원산지 없음 → 보증금 계산 불가 → 요금 통째 소실»이 난다
 *   (2026-08-28 오플에서 실측). RTDB 를 쓰므로 server-only 심이 필요하다.
 */
const s1b = run('①′ 정제칸 채움', ['--require', './scripts/lib/server-only-shim.cjs', 'scripts/fill-supplier-ai-columns.mts', '--include-mirror', ...A], /차량번호 정본|채움|모두 |바로잡|Error/);
if (!s1b.ok) stop('정제칸 채움 실패');
line.push('정제칸 ok');

// ② 차명 중복 정리 → ③ 모델명 통일(엔카 기준)
const s2 = run('② 차명 중복 정리', ['scripts/tidy-vehicle-names.mts', ...A], /합계/);
if (!s2.ok) stop('차명 정리 실패'); line.push(s2.picked[0]?.replace('■ ', '차명 ') || '차명 0');
const s3 = run('③ 모델명 통일', ['scripts/normalize-model-names.mts', ...A], /합계/);
if (!s3.ok) stop('모델명 통일 실패'); line.push(s3.picked[0]?.replace('■ ', '모델명 ') || '모델명 0');

// ④ 입고일자(처음 올라온 날) → ⑤ 차량번호 셀 사진링크
const s4 = run('④ 입고일자', ['scripts/fill-intake-date.mts', ...A], /반영 끝|dry-run|쓸 칸/);
if (!s4.ok) stop('입고일자 실패'); line.push('입고일자 ok');
const s5 = run('⑤ 차량번호 링크', ['scripts/publish-plate-links.mts', ...A], /합계/);
if (!s5.ok) stop('차량번호 링크 실패'); line.push(s5.picked[0]?.replace('■ 합계 — ', '') || '링크 0');

// ⑥ 판매시트 3탭
const p1 = run('⑥ 상품리스트', ['scripts/publish-origin-tab.mts', ...A], /우리 시트 |반영 완료|중단|Error/);
if (!p1.ok) stop('상품리스트 발행 실패(공급사 0대 가드면 확인 후 --force-shrink)');
line.push(p1.picked.find((l) => /반영 완료/.test(l))?.replace('반영 완료 — 탭 ', '') || '상품리스트 ok');
/* 손오공 탭 셋은 ⓪ 이 돌았을 때만 발행한다 — 안 돌았으면 낡은 값을 새 발행으로 찍게 된다. */
if (손오공탭발행) {
  const p2 = run('⑥ 손오공구독', ['scripts/publish-origin-tab.mts', '--only=RP012:구독', '--tab=손오공구독', '--at=1', ...A], /반영 완료|중단|Error/);
  if (!p2.ok) stop('손오공구독 발행 실패');
  const p2b = run('⑥ 손오공 요금블록', ['scripts/publish-sonogong-tab.mts', ...A], /반영 완료|Error/);
  if (!p2b.ok) stop('손오공 요금블록 실패');
  /* 픽업구독(손오공 픽업 = 티카) — 연동지도 「판매 4탭」의 하나. 빠져 있어 픽업이 판매시트에 안 실렸다. */
  const p2c = run('⑥ 픽업구독', ['scripts/publish-origin-tab.mts', '--only=RP012:픽업', '--tab=픽업구독', '--at=2', ...A], /반영 완료|중단|Error/);
  if (!p2c.ok) stop('픽업구독 발행 실패');
  const p2d = run('⑥ 픽업 요금블록', ['scripts/publish-sonogong-tab.mts', '--tab=픽업구독', ...A], /반영 완료|Error/);
  if (!p2d.ok) stop('픽업 요금블록 실패');
} else {
  line.push('손오공·픽업 탭 발행 건너뜀');
}
const p3 = run('⑥ 오플구독', ['scripts/publish-origin-tab.mts', '--only=RP023', '--tab=오플구독', '--at=3', ...A], /반영 완료|중단|Error/);
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
const erp = run('⑦ ERP 일일 동기', ['--require', './scripts/lib/server-only-shim.cjs', 'scripts/run-sheet-daily-sync-local.mts', ...A], /반영|미리보기|원본 |✗/);
line.push(erp.ok ? (erp.picked.find((l) => /원본 /.test(l))?.slice(0, 60) || 'ERP ok') : 'ERP 실패');

/**
 * ⑦′ **ERP 를 시트 그대로 비춘다 — 사진·이름·부재**(사장님 2026-08-20 「지금 기준으로 ERP 를 갈아엎어 줘야지
 *   사진 정보까지」 · 「모델 차명으로만 하기로 했잖아」 · 「이거 매뉴얼로 지정해서 이렇게 시트랑 연동되게 하자」).
 *   일일 동기(⑦)는 셀 «값»만 옮긴다. 그래서 이 셋이 빠져 시트를 고쳐도 ERP 가 안 따라왔다.
 *     · 사진 — 차량번호 «셀 링크»로 다녀서 아예 안 옮겨졌다(35우0775 에 161허1176 사진이 떠 있었다)
 *     · 이름 — 08-15 상품마스터가 박아 둔 옛 이름이 남았다(아반떼MD 를 「더 뉴 아반떼 CN7 스마트」로 불렀다)
 *     · 부재 — 부재처리는 공급사별로 돌아 «공급사 빈 차»(EXT_… 키)가 영영 남았다
 *   셋 다 **판매시트가 정본**이고, 시트에 없으면 ERP 도 비운다(남의 차 사진·남의 차 이름보다 «없음»이 낫다).
 *   실패해도 멈추지 않는다 — ⑧ 대조가 어긋남을 그대로 보여 준다.
 */
const mp = run("⑦′ 사진 시트대로", ['scripts/mirror-sales-photos.mts', ...A], /고칠 차|끝 —/);
const mn = run("⑦′ 이름 시트대로", ['scripts/mirror-sales-vehicle-name.mts', ...A], /고칠 차|끝 —/);
const ma = run("⑦′ 시트에 없는 차 출고불가", ['scripts/mirror-sales-absent.mts', ...A], /뜨는 차|끝 —/);
line.push([
  mp.ok ? (mp.picked.find((l) => /고칠 차/.test(l))?.replace('■ ERP 사진링크 ', '') || '사진 ok') : '사진 실패',
  mn.ok ? (mn.picked.find((l) => /고칠 차/.test(l))?.replace('■ 이름 ', '') || '이름 ok') : '이름 실패',
  ma.ok ? (ma.picked.find((l) => /뜨는 차/.test(l))?.replace('■ 판매시트에 없는데 상품찾기에 ', '') || '부재 ok') : '부재 실패',
].join(' · '));

// ⑧ 대조 — 판매시트 ↔ ERP 가 실제로 같은지 매 시간 확인해 기록에 남긴다(규칙 정본 lib/domain/sheet-erp-parity.ts).
const chk = run('⑧ 시트↔ERP 대조', ['scripts/audit-sheet-erp-parity.mts'], /판매시트 |안 뜨는 차|없는 차/, 'npx', true);
line.push(chk.picked.find((l) => /안 뜨는 차/.test(l))?.replace('■ ', '') || '대조 ok');

/**
 * ⑨ **상태가 어디서 갈렸나 — 신호만 낸다**(사장님 2026-08-20 「이거는 신호를 줘야 해 — 아이언은 홈피에서
 *   출고불가가 된 건지, 다른 데는 시트에서 출고불가가 된 건지 정제시트랑 원본시트랑 다 확인해야지」).
 *   고치지 않는다 — 자동으로 되돌리면 사람이 내린 판단을 지운다. 기록에 「상태 갈림 N대」로 남긴다.
 */
/* ★⑨ 의 exit 2 는 「갈림을 찾았다」가 아니라 **「감사를 온전히 못 했다」**(globalErrors·unknownRows)다.
   신호로 넘기면 «못 본 것»을 «본 것»으로 적게 된다 — 코덱스 3차 지적. 실패로 둔다. */
const drift = run('⑨ 상태 갈림 신호', ['scripts/audit-status-drift.mts'], /상태가 다른 차|★/);
// 미확인(동일 차번 상태 충돌 등)은 감사가 읽어 낸 유의미한 신호다. 이때 exit=2가
// 나도 요약을 버리고 «0»이나 단순 실패로 적지 않는다. 요약 자체가 없을 때만 실패다.
const driftSummary = drift.picked.find((l) => /상태가 다른 차/.test(l))?.replace('■ ', '');
line.push(driftSummary || '상태 갈림 검사 실패');

/**
 * ⑩ 천이컴퍼니 영업채널 카드시트 — 연동지도 「천이 채널 ← 손오공만」.
 *   손오공 정제칸 + 대여료만 받아 최저가 카드로 만든다. 판매시트·공급사에서는 안 땡긴다.
 *   ⚠ 담당 GitHub Actions 가 main 에 없어 크론이 영영 안 돌아 천이가 3일 묵어 있었다(2026-08-28).
 *      그래서 매시간 도는 이 잡에 붙여 둔다.
 */
/**
 * ★손오공을 못 돌린 회차에는 **천이를 찍지 않는다**(코덱스 2026-08-30 2차).
 *   천이 카드는 «손오공 정제칸만» 먹는다. 손오공이 낡은 채로 다시 찍으면
 *   「방금 갱신된 카드」로 보이는 낡은 값이 채널에 나간다 — 안 찍는 편이 낫다.
 *   ⑦ ERP 동기는 전 공급사가 걸려 있어 멈출 수 없다. 대신 경고를 크게 남긴다.
 */
if (손오공탭발행) {
  const ch = run('⑩ 천이 카드시트', ['scripts/publish-channel-cards.mts', '--channel=천이컴퍼니', ...A], /반영 완료|Error/);
  line.push(ch.ok ? '천이 ok' : '천이 실패');
} else {
  const w = '천이 건너뜀 — 손오공을 못 돌린 회차라 낡은 카드를 새로 찍지 않는다';
  line.push('천이 건너뜀'); warnings.push(w); out.push(`
⚠ ${w}`);
}

/**
 * ⑪ 자기검수 — 판매↔ERP 요금 정합. 「판매엔 있는데 ERP 요금 0」인 차 수를 남긴다.
 *   정상 기준선 3대(협의·더미 차번). 갑자기 늘면 원산지·정제칸 구멍이다.
 */
const fee = run('⑪ 요금 검수(판매↔ERP)', ['--require', './scripts/lib/server-only-shim.cjs', 'scripts/audit-sales-vs-erp.mts'], /없는 차 \d+대|유효가격 0|살아있음 \d+/);   /* ⑪ 는 어긋나도 exit 0 이라 signal2ok 이 무의미하다(코덱스 3차) */
const feeN = /ERP 목록에 없는 차 (\d+)대/.exec(fee.picked.join(' ') || '');
line.push(feeN ? `요금검수 ${feeN[1]}대` : '요금검수 ok');
if (feeN && Number(feeN[1]) > 6) out.push(`\n⚠ 요금검수 — 판매엔 있는데 ERP 요금 0인 차 ${feeN[1]}대(>6). 원산지·정제칸 구멍 의심`);

const seconds = Math.round((Date.now() - started) / 1000);
out.push(`\n■ ${allOk ? '끝' : '끝(일부 실패)'} ${kst()} KST · ${seconds}초`);
writeFileSync('tmp/hourly-sync-last.txt', out.join('\n'));
appendFileSync('tmp/hourly-sync-log.txt', `${kst()} ${APPLY ? '반영' : '미리'} ${seconds}초 · ${allOk ? '' : '⚠일부실패 · '}${line.join(' · ')}\n`);
writeStatus(allOk);
releaseLock();
void heartbeat.terminate();
/**
 * ★실패가 하나라도 있으면 «성공으로 끝내지 않는다».
 *   전에는 ⑦~⑪ 이 실패해도 ok:true 로 적고 exit 0 이라 천이가 조용히 낡아도 아무도 몰랐다
 *   (코덱스 2026-08-30). aiops 도 즉시 중단은 안 하지만 마지막에 exit 1 을 낸다 — 그 규격을 따른다.
 */
if (!allOk) {
  console.log(`■ 끝(일부 실패) — ${seconds}초 · ${warnings.join(' · ')}`);
  if (APPLY) alertFail(warnings.join(' · '));
  process.exit(1);
}
if (APPLY) alertRecovered();   // 멈춰 있었다면 「복구됨」을 한 번 보낸다
console.log(`■ 끝 — ${seconds}초 · 기록 tmp/hourly-sync-log.txt · 상태 tmp/자동동기-상태.json`);
