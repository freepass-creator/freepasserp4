/**
 * **한 시간마다 도는 시트 동기화 한 방** — 사장님 2026-08-19 「내가 말 안 해도 공급사시트 반영해서 한 시간에 한 번씩 새로운 차나 없어진 거 출고불가나 이런 거 작업해 줄 수 있나 · 알아서 돌아가는 시스템」.
 *
 * 차례(한 단계가 실패하면 거기서 멈추고 기록에 남긴다 — 낡은 값을 발행하지 않기 위해):
 *   ⓪ 손오공(D경로) pull → 라이브 「차종마스터」 행 복사 정제 → 재고시트   ★2026-08-30 aiops 에서 옮겨옴 · ★2026-09-01 이름은 F03이 아니라 라이브 탭
 *   ① 정제시트 갱신(아이카·오토플러스·이안카·아이언 = 원본에서 새 차·사라진 차(출고불가)·요금·상태를 가져온다)
 *   ①′ 공급사 정제칸 채움(라이브 차종마스터 행 — 손오공은 스킵. 원산지가 비면 보증금 계산이 막혀 요금이 통째로 사라진다)
 *   ② 차명 중복 정리(「쏘나타 쏘나타 DN8」 → 「쏘나타 DN8」)
 *   ③ 모델명 통일(엔카 기준: 벤츠 E200 → E-클래스 · BMW 520i → 5시리즈)
 *   ④ 입고일자 채움(그 차량번호가 우리 쪽에 처음 올라온 날)
 *   ⑤ 차량번호 셀에 사진링크 걸기
 *   ⑤′ 정산원장 최신 상태 반영(계약중 · 인도완료=출고불가)
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
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

const APPLY = process.argv.includes('--apply');
/**
 * ★`--같은범위` — **aiops 가 하는 단계만** 돈다(첫 대조용).
 *
 *   우리 파이프라인은 aiops 가 안 하는 단계를 더 한다 — 차명 정리·모델명 통일·입고일자·
 *   차번 사진링크·ERP 비추기. 이것들은 2026-08-28 이후 한 번도 안 돌아 **밀려 있고**,
 *   dry-run 기준 모델명 312칸·차번 링크 413개를 한꺼번에 쏟는다.
 *
 *   ⚠ 그리고 「모델명 통일(엔카 기준)」은 오늘 커서·코덱스가 한 「정제칸을 F03 확정 원자에
 *     맞추는 작업」과 **같은 칸을 건드릴 수 있다.** 부딪히는지 아무도 확인하지 않았다.
 *
 *   한 번에 두 가지를 바꾸면 시트가 이상해졌을 때 «오케스트레이터 이관» 탓인지
 *   «밀린 정제» 탓인지 못 가린다. 그래서 첫 대조는 이 플래그로 **같은 범위만** 돌린다.
 *   밀린 것은 F03 작업과의 충돌을 확인한 뒤 따로 켠다.
 */
const SAME_SCOPE = process.argv.includes('--같은범위');
/**
 * ★③ 모델명 통일은 **기본으로 끈다. 켜려면 `--모델명통일`.**
 *
 *   ①′ `fill-supplier-ai-columns` 가 차종마스터로 「모델명」을 채우는데,
 *   ③ `normalize-model-names` 도 **같은 칸을 엔카 기준으로 다시 쓴다.**
 *   둘 다 매시간 돌면 서로를 덮어써 값이 시간마다 흔들린다.
 *
 *   ③ 이 2026-08-28 부터 안 돈 것은 우연이 아니라 ①′ 가 그 역할을 대체했기 때문으로 보인다
 *   (aiops 차례에도 ③ 이 없다). 그래서 «끄는 것»을 기본으로 두고, 정말 필요하면 명시해서 켠다.
 *   ⚠ 켜기 전에 F03 정제 작업(커서·코덱스)과 같은 칸을 두고 다투지 않는지 먼저 확인할 것.
 *   dry-run 기준 312칸이 바뀐다 — 작은 변화가 아니다.
 */
const MODEL_NORMALIZE = process.argv.includes('--모델명통일');
/**
 * ★⑦′ ERP 비추기도 **기본으로 끈다. 켜려면 `--비추기`.**
 *
 *   dry-run 실측(2026-08-30 10:57) — 이 세 단계가 한 회차에 이만큼 바꾼다.
 *     사진 21대 · **이름 425대** · **145대를 「출고불가」로**
 *   145대 출고불가는 그 차들이 **매물 목록에서 사라진다**는 뜻이다. 2026-08-28 부터 안 돌아
 *   밀린 것이 한꺼번에 쏟아지는 것이고, 아무도 그 145대가 정말 없어진 차인지 확인하지 않았다.
 *   (⑧ 대조가 「ERP→판매 초과 374대」라고 말하는 그 무리다 — 왜 374대나 되는지가 먼저다)
 *
 *   ★설계 자체는 옳다 — 「시트에 없으면 ERP 도 비운다. 남의 차 사진·남의 차 이름보다 «없음»이 낫다」.
 *     다만 **밀린 것을 검토 없이 쏟는 것**과 «매시간 조금씩 반영»은 다른 일이다.
 *     한 번 사람이 목록을 보고 켠 뒤에는 기본으로 돌려도 된다.
 */
const MIRROR_ERP = process.argv.includes('--비추기');
/**
 * 건너뛴 단계를 «왜» 건너뛰었는지까지 적는다.
 * ★전에는 이유가 무엇이든 「건너뜀(--같은범위)」이라고 찍었다 — 15:00 자동회차는 그 플래그 없이
 *   돌았는데도 로그가 그렇게 남아, 나중에 보는 사람이 「같은범위로 돌렸구나」로 잘못 읽는다.
 *   **로그가 거짓말하면 그 로그는 안 보게 된다.**
 */
const skip = (label: string, why: string) => {
  line.push(`${label} 건너뜀(${why})`);
  console.log(`── ${label} — 건너뜀 · ${why}`);
  steps.push({ 단계: label, ok: true, 신호: `건너뜀 — ${why}` });
};
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
/**
 * ══ 겹침 잠금 — «주인 자리»는 한 번만 만들어지고, 뺏긴 실행은 되살릴 수 없다 ══
 *
 * ★코덱스 7차: 「쓴 뒤 되읽기」는 **마지막에 쓴 놈을 못 막는다.** A 가 나중에 쓰면
 *   A 는 자기 이름을 되읽고 계속 간다 — 둘 다 쓰기 단계로 갈 길이 남는다. 맞다.
 *   파일 «내용»으로 주인을 적는 한 이 문제는 안 닫힌다. 덮어쓰면 그만이기 때문이다.
 *
 * 그래서 주인을 «내용»이 아니라 **«파일의 존재»**로 바꿨다.
 *
 *   tmp/hourly-sync.lock/                 ← 잠금 = 디렉터리. mkdir 은 원자적이라 하나만 만든다
 *   tmp/hourly-sync.lock/owner-<표딱지>    ← 주인 자리. 이 파일이 있는 실행이 주인이다
 *
 *   · 심장박동 = 제 owner 파일의 **시각만 갱신**한다(`utimes`). **새로 만들지 않는다.**
 *   · 뺏기 = 디렉터리째 `rename` (원자적) → 한 놈만 성공하고, 그 안의 owner 파일도 같이 사라진다.
 *   · 그래서 **뺏긴 실행이 심장을 뛰려 하면 «파일이 없다»(ENOENT)** — 되살릴 방법이 없다.
 *     A 가 아무리 나중에 손대도 B 의 주인 자리를 빼앗지 못한다. 7차가 지적한 인터리빙이 여기서 닫힌다.
 */
const LOCKDIR = 'tmp/hourly-sync.lock';
const HEARTBEAT_STALE_MS = 5 * 60_000;
/** 실행 표딱지 — PID 는 OS 가 재사용하지만 이건 안 겹친다. */
const RUN_ID = `${process.pid}-${started}-${Math.random().toString(36).slice(2, 8)}`;
const OWNER = `${LOCKDIR}/owner-${RUN_ID}`;

/** 잠금 안의 주인 자리들 — 정상이면 하나뿐이다. 가장 최근 박동을 살아있음으로 본다. */
function ownerQuietMs(): number {
  try {
    const files = readdirSync(LOCKDIR).filter((f) => f.startsWith('owner-'));
    if (!files.length) return Infinity;
    const newest = Math.max(...files.map((f) => statSync(`${LOCKDIR}/${f}`).mtimeMs));
    return Date.now() - newest;
  } catch { return Infinity; }
}
/** 주인 자리를 «만든다». mkdir 이 원자적이라 한 놈만 이긴다. */
function claimOwnership(): boolean {
  try { mkdirSync(LOCKDIR); } catch { return false; }   // 이미 있으면 진 것
  try { closeSync(openSync(OWNER, 'wx')); writeFileSync(`${LOCKDIR}/info.json`, JSON.stringify({ runId: RUN_ID, pid: process.pid, startedAt: kst() })); return true; }
  catch { return false; }
}
function acquireLock(): boolean {
  mkdirSync('tmp', { recursive: true });
  if (claimOwnership()) return true;
  if (ownerQuietMs() < HEARTBEAT_STALE_MS) return false;   // 심장이 뛴다 — 남의 실행이 살아 있다
  /* 죽었다 — 디렉터리째 원자적으로 치우고 새로 만든다. rename 은 한 놈만 성공한다. */
  const claim = `${LOCKDIR}.claim-${RUN_ID}`;
  try { renameSync(LOCKDIR, claim); } catch { return false; }
  rmSync(claim, { recursive: true, force: true });
  return claimOwnership();
}
if (!acquireLock()) { console.log('앞의 실행이 아직 돈다(lock) — 이번은 건너뛴다'); process.exit(0); }

let lockLost = false;
/**
 * 심장박동 — **내 owner 파일의 시각만 갱신한다. 만들지 않는다.**
 * 뺏겼으면 그 파일이 없으므로 여기서 ENOENT 가 나고, 그게 「내가 졌다」는 신호다.
 */
const touchLock = () => {
  if (lockLost) return;
  try { const now = new Date(); utimesSync(OWNER, now, now); }
  catch { lockLost = true; }
};
/** 내 주인 자리가 아직 있을 때만 치운다 — 남의 실행 잠금을 지우지 않는다. */
const releaseLock = () => {
  if (lockLost || !existsSync(OWNER)) return;
  rmSync(LOCKDIR, { recursive: true, force: true });
};
/**
 * 일꾼 스레드가 30초마다 뛴다 — 메인이 `spawnSync` 로 막혀 있어도 따로 돈다.
 * 파일이 사라졌으면(뺏겼으면) 박동을 멈춘다. **다시 만들지 않는다.**
 */
const heartbeat = new Worker(`
  const { workerData, parentPort } = require('node:worker_threads');
  const { utimesSync } = require('node:fs');
  const { owner } = workerData;
  const beat = setInterval(() => {
    try { const now = new Date(); utimesSync(owner, now, now); }
    catch (e) {
      /* ★«자리가 없다»(ENOENT = 뺏겼다)와 «잠깐 실패했다»(EBUSY·EPERM 등)를 **가른다.**
         전에는 둘 다 멈췄다 — 그러면 일시적 오류 한 번에 심장이 조용히 멎고,
         메인은 그걸 모른 채 계속 돌다가 남에게 잠금을 뺏긴다(코덱스 8차 시나리오).
         잠깐 실패는 다음 박동에 다시 해 본다. */
      if (e && e.code === 'ENOENT') { clearInterval(beat); parentPort.postMessage('lost'); }
    }
    /* ⚠ 이 타이머에 unref 를 걸면 일꾼의 할 일이 없어져 스레드가 즉시 죽는다(2026-08-30 실측). */
  }, 30_000);
`, { eval: true, workerData: { owner: OWNER } });
/* 일꾼이 「뺏겼다」를 알리면 메인도 바로 안다 — 자식 단계가 끝날 때까지 기다리지 않는다. */
heartbeat.on('message', (msg) => { if (msg === 'lost') lockLost = true; });
heartbeat.unref();

const out: string[] = [`■ 시간별 동기화 ${APPLY ? '반영' : '미리보기'} ${kst()} KST`];
const line: string[] = [];
/** 상태로그 뼈대 — 연동지도가 요구하는 «단계별·커버리지·경고». 코덱스가 이걸 읽는다. */
const steps: Array<{ 단계: string; ok: boolean; 초?: number; 신호?: string; 요약?: string }> = [];
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
/**
 * ★다시 해 볼 만한 실패 — **한도(429)만이 아니라 «서버가 잠깐 안 되는 것»(503·500·UNAVAILABLE)도** 넣는다.
 *   2026-08-31~09-01 에 ⑩ 천이가 다섯 번 실패했는데 전부 이것이었다:
 *     `Error: 503 {"error":{"code":503,"message":"The service is currently unavailable."}}`
 *   카드 내용은 다 만들어 놓고(손오공 장기렌트 8 · 구독 72 · 웰릭스 9) **마지막 쓰기에서** 구글이
 *   잠깐 안 받아 준 것이다. 503 은 429 보다 더 명백한 「잠깐 밀린 것」인데 재시도 대상이 아니라
 *   그냥 실패로 끝났다 — 우리 데이터는 멀쩡한데 회차가 빨간불이 됐다.
 */
/**
 * ⚠ `spawn UNKNOWN`·`EBUSY` 도 «잠깐 밀린 것»이다 — 2026-09-02 에 이안카 정책이 그것으로 죽어
 *   ①에서 회차가 멈췄고 발행·ERP 가 두 시각 안 돌았다. 자식이 «또 자식을» 못 띄운 경우라
 *   부모의 `r.error` 는 서지 않는다. 그래서 «글자»로도 잡는다.
 */
const RATE_LIMIT = /\b429\b|rate.?limit|quota|RESOURCE_EXHAUSTED|\b50[0234]\b|UNAVAILABLE|ECONNRESET|ETIMEDOUT|socket hang up|spawn\s+(UNKNOWN|EBUSY|EAGAIN|ENOMEM)/i;
/**
 * tsx 실행기의 «파일 경로» — npx 를 안 거치려고 직접 짚는다(run() 주석 참고).
 * ⚠ `require.resolve('tsx/dist/cli.mjs')` 는 안 된다 — tsx 가 그 경로를 export 하지 않아
 *   `ERR_PACKAGE_PATH_NOT_EXPORTED` 가 난다. 그래서 **파일 자리로** 짚는다.
 */
const TSX_CLI = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));
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
  /**
   * ★**npx 를 안 거친다 · 셸도 안 쓴다.**
   *   `npx.cmd` 는 안에서 `CALL "C:\Program Files\nodejs\node.exe" …` 를 부르는데, `shell:true` 로 넘기면
   *   **경로의 공백(`Program Files`)에서 따옴표가 깨져** 그대로 죽는다:
   *     「'CALL "C:\Program Files\nodejs\node.exe" …' 은(는) 명령 또는 외부 명령…이 아닙니다」
   *   2026-09-02 에 이것으로 회차가 네 번 멎었다(15:31·16:31·20:01·20:09) — 그때마다 발행·ERP 가 안 돌았다.
   *   아침의 `spawn UNKNOWN`(⑦⑧⑨) 도 같은 뿌리다. 셸을 한 겹 더 태워서 생긴 일이다.
   *   지금 도는 node(`process.execPath`)로 **tsx 를 직접** 부르면 따옴표 문제 자체가 없어진다.
   */
  const bin = process.execPath;
  const argv = runner === 'node' ? args : [TSX_CLI, ...args];
  const stepStarted = Date.now();
  for (let attempt = 1; ; attempt += 1) {
    touchLock();   // 시작 «전»에도 만진다 — 자식이 도는 동안은 못 만지므로 공백을 절반으로 줄인다
    /* 잠금을 뺏겼으면 **여기서 물러난다.** 뒤늦게 깨어난 쪽이 시트·ERP 를 같이 쓰면 안 된다. */
    if (lockLost) stop('잠금을 다른 실행이 가져갔다 — 이 회차는 물러난다(겹쳐 쓰지 않기 위해)');
    /* ★한 단계에 시간 상한을 둔다(30분). 전에는 상한이 없어 네트워크 재시도로 자식이 60분 넘게
       매달릴 수 있었고, 그 사이 잠금이 stale 로 보여 남이 가져갔다(코덱스 8차 시나리오 1단계).
       실측 최장 단계는 몇 분이라 30분이면 넉넉하다. 넘으면 그 회차는 실패로 끝난다. */
    const r = spawnSync(bin, argv, {
      encoding: 'utf8', env: process.env,   // ⚠ shell 을 쓰지 않는다 — 위 주석(따옴표 깨짐)
      maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60_000,
    });
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
    /**
     * ★**«시작조차 못 한 것»은 한 번 더 해 본다.**
     *   `r.error` 는 자식이 실행되지 못했다는 뜻이다(ENOENT·EBUSY·EAGAIN…). 이건 그 단계가
     *   틀렸다는 신호가 아니라 **그 순간 기계가 바빴다**는 신호다 — 2026-09-02 09:16 에 ⑦⑧⑨ 가
     *   연달아 이렇게 죽었고, 손으로 돌리니 셋 다 멀쩡했다. 한 번 죽었다고 회차를 버릴 이유가 없다.
     *   ⚠ 다만 «돌다가 실패한 것»(종료코드 ≠ 0)은 재시도하지 않는다 — 그건 진짜 어긋남이고,
     *      쓰기 단계를 두 번 돌리면 같은 것을 두 번 쓸 수 있다.
     */
    if (!ok && r.error && attempt < 3) {
      const code = (r.error as NodeJS.ErrnoException).code || '';
      console.log(`── ${label} ⏳ 실행이 시작되지 않았다(${code}) — 15초 쉬고 다시 (${attempt}/3)`);
      out.push(`\n── ${label} ⏳ 시작 실패 재시도 ${attempt} — ${code} ${r.error.message}`);
      sleep(15_000);
      continue;
    }
    /**
     * ★**실패했으면 «왜»를 반드시 한 줄 남긴다.**
     *
     * ⚠ 2026-09-02 09:16 회차에서 ⑦⑧⑨ 가 **출력 한 줄 없이** ✗ 로 끝났다. 손으로 돌리면 셋 다 멀쩡했다.
     *   원인을 못 찾은 이유는 여기 있었다 — `spawnSync` 의 **`r.error` 를 아무도 안 봤다.**
     *   자식이 «시작조차 못 하면»(ENOENT·EBUSY·EAGAIN 등) stdout/stderr 가 통째로 비어
     *   `lines` 가 빈 배열이 되고, 기록에는 `── ⑦ ERP 일일 동기 ✗` 한 줄만 남는다.
     *   **이유 없는 빨간불은 다음에 아무도 안 믿는다.** 종료코드·신호·실행오류를 같이 적는다.
     */
    const 진단 = !ok
      ? [`   ✗ 왜 — ${r.error ? `실행 자체가 안 됐다(${(r.error as NodeJS.ErrnoException).code || ''} ${r.error.message})` : `종료코드 ${r.status ?? '없음'}`}`
         + `${r.signal ? ` · 신호 ${r.signal}` : ''}${lines.length ? '' : ' · 자식이 아무것도 못 찍었다'}`]
      : [];
    out.push(`\n── ${label} ${ok ? '✓' : '✗'}${attempt > 1 ? ` (${attempt}회)` : ''}`, ...진단, ...lines.slice(-40).map((l) => `   ${l.slice(0, 300)}`));
    console.log(`── ${label} ${ok ? '✓' : '✗'}${attempt > 1 ? ` (${attempt}회)` : ''}`);
    for (const l of 진단) console.log(l);
    for (const l of picked.slice(0, 6)) console.log(`   ${l.slice(0, 220)}`);
    /* ★단계 결과를 남긴다. 「경고로 넘긴 단계」도 상태로그에서는 성공이 아니다.
       (코덱스 2026-08-30: 「⑩ 이 실패해도 ok:true 로 기록해 천이가 조용히 낡을 수 있다」) */
    touchLock();   // 「나 아직 살아 있다」 — 단계마다 심장박동(코덱스 2026-08-30 2차)
    /* ★단계마다 «몇 초 걸렸나»를 남긴다. 2026-08-30 18시 회차가 37분(평소 12분)이었는데
       단계별 시간이 없어 «어디가 느렸는지» 끝내 못 좁혔다. 결과값은 멀쩡했다 — 시간만 셋이 됐다.
       느려지는 것은 대개 «무엇이 무너지기 전»의 첫 신호다. 그걸 보려면 재 두어야 한다. */
    const 초 = Math.round((Date.now() - stepStarted) / 1000);
    /** ★실패면 «이유»를 상태로그에도 싣는다 — 상태판·메일이 읽는 곳이 여기다. 요약이 비면 아무도 이유를 못 본다. */
    const 요약 = picked.length ? picked.slice(0, 3).join(' | ').slice(0, 300) : (진단[0] || '').trim().slice(0, 300);
    steps.push({ 단계: label, ok, 초, ...(신호 ? { 신호: '어긋남 있음' } : null), ...(요약 ? { 요약 } : null) });
    if (초 >= 300) {   // 5분 넘게 걸린 단계는 눈에 띄게 남긴다
      const w = `${label} 이 ${Math.round(초 / 60)}분 걸렸다(평소보다 오래)`;
      warnings.push(w); console.log(`   ⏱ ${w}`);
    }
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
 * 정제칸은 **빈 칸만 한 번**. 상태·요금만 매번 갱신. 이미 있는 이름칸은 안 덮는다.
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
  const k2 = run('⓪ 손오공 정제(라이브 차종마스터 행 복사)', ['sonokong/scripts/손오공-정제.mjs', '--json'], /총 \d+대|실패/, 'node');
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
/**
 * ①′-손 **손오공 원산지 채움** — ①′ 가 손오공을 «안 타서» 아무도 안 채우던 칸이다.
 *
 * ★원산지는 표시값이 아니라 «돈»이다 — 보증금 배율(국산 ×2 · 수입 ×3)의 근거라
 *   비면 보증금 계산이 막히고 **요금이 통째로 사라진다**(2026-08-28 오플 실사고).
 * ⚠ 실측 2026-09-02: 손오공구독 72대 중 원산지가 24%밖에 안 차 있었다 — 91칸이 비어 있었고
 *   손으로 채웠다. **비는 이유가 「담당이 없다」였으므로 회차에 붙인다.** 안 붙이면 새 차마다 또 빈다.
 *   빈 칸만 채우므로 사람이 적은 값은 안 덮는다.
 */
const s1bs = run('①′-손 원산지 채움(전 공급사)', ['scripts/fill-origin.mts', ...A], /빈 칸|채웠다|채울 칸|Error/);
if (!s1bs.ok) stop('원산지 채움 실패');
line.push(s1bs.picked.find((l) => /채웠다|채울 칸/.test(l))?.replace(/^.*?—\s*/, '원산지 ') || '원산지 ok');
const s1c = run('①″ 라이브 이름 폐쇄', ['scripts/close-refined-names-to-live-master.mts', '--include-mirror', ...A], /미리보기|반영|라이브 행 폐쇄|Error/);
if (!s1c.ok) stop('라이브 이름 폐쇄 실패');
line.push('이름폐쇄 ok');
const s1d = run('①‴ 원문-디올뉴 게이트', ['scripts/audit-raw-ad-prefix.mts'], /게이트 ok|게이트 실패|Error/);
if (!s1d.ok) stop('원문 없는 디올뉴 게이트 실패');
line.push('원문철자 ok');

// ② 차명 중복 정리 → ③ 모델명 통일(엔카 기준)
if (SAME_SCOPE) skip('② 차명 중복 정리', 'aiops 범위 밖(--같은범위)');
else {
  const s2 = run('② 차명 중복 정리', ['scripts/tidy-vehicle-names.mts', ...A], /합계/);
  if (!s2.ok) stop('차명 정리 실패'); line.push(s2.picked[0]?.replace('■ ', '차명 ') || '차명 0');
}
if (SAME_SCOPE || !MODEL_NORMALIZE) skip('③ 모델명 통일', SAME_SCOPE ? 'aiops 범위 밖(--같은범위)' : '기본 꺼짐 — ①′ 와 같은 칸(모델명)을 다툰다. --모델명통일 로만 켠다');
else {
  const s3 = run('③ 모델명 통일', ['scripts/normalize-model-names.mts', ...A], /합계/);
  if (!s3.ok) stop('모델명 통일 실패'); line.push(s3.picked[0]?.replace('■ ', '모델명 ') || '모델명 0');
}

// ④ 입고일자(처음 올라온 날) → ⑤ 차량번호 셀 사진링크
if (SAME_SCOPE) { skip('④ 입고일자', 'aiops 범위 밖(--같은범위)'); skip('⑤ 차량번호 링크', 'aiops 범위 밖(--같은범위)'); } else {
  const s4 = run('④ 입고일자', ['scripts/fill-intake-date.mts', ...A], /반영 끝|dry-run|쓸 칸/);
  if (!s4.ok) stop('입고일자 실패'); line.push('입고일자 ok');
  const s5 = run('⑤ 차량번호 링크', ['scripts/publish-plate-links.mts', ...A], /합계/);
  if (!s5.ok) stop('차량번호 링크 실패'); line.push(s5.picked[0]?.replace('■ 합계 — ', '') || '링크 0');
}

/**
 * ⑤′ 정산원장이 계약 상태의 정본이다.
 * 손오공 API는 재고·가격·사진을 갱신할 뿐, 인도완료를 알 수 없다. 따라서
 * 공급사 원본을 모두 갱신한 뒤, 판매시트 발행 전에 원장 최신 행으로
 * 계약중/출고불가를 세운다. 출고불가를 계약중으로 풀지 않는 보호 규칙은
 * mark-contract-in-listings가 소유한다.
 */
const contractStatus = run('⑤′ 정산원장 계약상태', ['scripts/mark-contract-in-listings.mts', ...A], /세울 차|고칠 칸|끝|Error/);
if (!contractStatus.ok) stop('정산원장 계약상태 반영 실패');
line.push(contractStatus.picked.find((l) => /고칠 칸/.test(l))?.replace(/\s+/g, ' ').trim() || '정산 상태 ok');

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
if (SAME_SCOPE || !MIRROR_ERP) {
  const why = SAME_SCOPE ? 'aiops 범위 밖(--같은범위)'
    : '기본 꺼짐 — 밀린 것이 한꺼번에 쏟아진다(이름 425대·출고불가 145대). --비추기 로만 켠다';
  skip('⑦′ 사진 시트대로', why); skip('⑦′ 이름 시트대로', why); skip('⑦′ 시트에 없는 차 출고불가', why);
} else {
const mp = run("⑦′ 사진 시트대로", ['scripts/mirror-sales-photos.mts', ...A], /고칠 차|끝 —/);
const mn = run("⑦′ 이름 시트대로", ['scripts/mirror-sales-vehicle-name.mts', ...A], /고칠 차|끝 —/);
const ma = run("⑦′ 시트에 없는 차 출고불가", ['scripts/mirror-sales-absent.mts', ...A], /뜨는 차|끝 —/);
line.push([
  mp.ok ? (mp.picked.find((l) => /고칠 차/.test(l))?.replace('■ ERP 사진링크 ', '') || '사진 ok') : '사진 실패',
  mn.ok ? (mn.picked.find((l) => /고칠 차/.test(l))?.replace('■ 이름 ', '') || '이름 ok') : '이름 실패',
  ma.ok ? (ma.picked.find((l) => /뜨는 차/.test(l))?.replace('■ 판매시트에 없는데 상품찾기에 ', '') || '부재 ok') : '부재 실패',
].join(' · '));
}

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
/**
 * ★**총계로 울리지 않는다 — «누구 몫»으로 울린다.** (2026-09-02)
 *
 * 전에는 「ERP 목록에 없는 차 N대」가 6을 넘으면 경보였다. 그런데 그 N 은
 * **공급사가 요금을 안 적은 차까지 다 더한 수**다. 공급사가 새로 들어오면 저절로 늘고,
 * 그러면 매시간 「요금이 샌다」가 울린다 — 실제로 2026-09-02 에 580→708대로 늘며 7→13이 됐고,
 * 열어 보니 **내 몫은 0건**이었다(전부 공급사 빈칸).
 *
 * 재는 자(`audit-sales-vs-erp`)가 이제 넷으로 가르므로, 경보는 **내가 고칠 수 있는 것**에만 건다:
 *   · 「나르다 빠졌다」 = 대여료·보증금이 다 있는데 ERP 가 0 → **파이프라인이 흘린 것. 울린다.**
 *   · 「보증금이 비었다」 = 공급사가 채우면 사는 차 → 세어서 «보여만» 준다(사장님이 공급사에 요청).
 *   · 「시트에도 대여료 없음」 = 공급사 몫. 울리지 않는다.
 * **거짓 빨간불을 없애야 진짜 빨간불을 믿는다.**
 */
const fee = run('⑪ 요금 검수(판매↔ERP)', ['--require', './scripts/lib/server-only-shim.cjs', 'scripts/audit-sales-vs-erp.mts'], /없는 차 \d+대|나르다 빠졌다|보증금이 비었다|살아있음 \d+/);
const feeAll = fee.picked.join(' ');
const feeN = /ERP 목록에 없는 차 (\d+)대/.exec(feeAll);
const 흘림 = Number(/(\d+)대\s+대여료·보증금 다 있는데/.exec(feeAll)?.[1] || 0);
const 보증금빔 = Number(/(\d+)대\s+★대여료는 있는데 보증금이 비었다/.exec(feeAll)?.[1] || 0);
line.push(feeN
  ? `요금검수 ${feeN[1]}대(내몫 ${흘림} · 보증금빔 ${보증금빔})`
  : '요금검수 ok');
if (흘림 > 0) {
  out.push(`\n⚠ ★요금검수 — **나르다 빠뜨린 차 ${흘림}대**. 대여료·보증금이 다 있는데 ERP 가 0이다. 원산지·정제칸 구멍 의심`);
  allOk = false;   // 내 몫이 생겼으면 그 회차는 성공이 아니다
}
if (보증금빔 > 0) out.push(`\n· 요금검수 — 공급사가 보증금만 채우면 사는 차 ${보증금빔}대(경보 아님 — 사장님이 공급사에 요청)`);

/**
 * ⑫ **채울 것 목록 갱신 — 새 차가 들어온 그 시각에 안다.**
 *
 * ★사장님 2026-09-03 「**새로운 차 나오면 그걸 연동을 못 하네.**」
 *   새 차가 유입되면 라이브 차종마스터에 그 차종 행이 없어 **정제칸이 빈 채로 상품리스트에 나간다.**
 *   마스터에 행을 «자동으로» 넣는 것은 금지다 — 지어내기이고, 코덱스 NO-GO 이며,
 *   2026-08-28 에 그렇게 하다 픽업 모델 135/341 을 잃었다.
 *   그래서 **채우는 것은 사람에게 남기되, «무엇을 채워야 하나»는 매시간 자동으로 갱신한다.**
 *   지난 회차와 견줘 «새로 생긴 차종»이 있으면 그 자리에서 알린다(총계만 보면 상쇄돼 안 보인다).
 *
 * ⚠ 읽기 전용이다 — 시트도 ERP 도 안 건드린다. 실패해도 회차를 멈추지 않는다(경고만).
 */
const todo = run('⑫ 채울 것 목록', ['scripts/report-fill-todo.mts'], /넣을 것|받을 것|새로 생긴|늘었나/);
const 새차종 = /★새로 생긴 «마스터에 없는 차종» (\d+)가지/.exec(todo.picked.join(' '))?.[1];
line.push(새차종 ? `★마스터에 없는 새 차종 ${새차종}가지` : (todo.ok ? '채울것 ok' : '채울것 실패'));
if (새차종) {
  out.push(`\n■ ★새 차가 들어왔는데 차종마스터에 행이 없다 — ${새차종}가지`);
  out.push('   tmp/보강-차종마스터.tsv 를 마스터에 붙여넣으면 다음 회차에 정제칸이 채워진다');
}

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
