/**
 * 자동동기 겹침 잠금 — **누구나 다시 돌릴 수 있는 시험.**
 *
 * ★코덱스 7차: 「시험 코드·원시 로그가 저장소에 없어 독립 재실행·동일성 검증을 못 했다.」 맞다.
 *   그래서 tmp 에 던져 놓고 지우던 시험을 여기로 옮긴다.
 *
 *   npx tsx scripts/sim-hourly-sync-lock.mts          빠른 것만 (몇 초)
 *   npx tsx scripts/sim-hourly-sync-lock.mts --long   6분짜리 긴 단계 시험까지
 *
 * 잠금 방식은 `scripts/hourly-sync.mts` 와 «같다» — 주인은 파일 «내용»이 아니라
 * **주인 자리 파일의 존재**다. 그래서 뺏긴 실행은 소유권을 되살릴 수 없다.
 */
import { Worker } from 'node:worker_threads';
import {
  mkdirSync, openSync, closeSync, readdirSync, statSync, renameSync, rmSync, utimesSync, existsSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';

const LONG = process.argv.includes('--long');
const DIR = 'tmp/sim-lock.test';
const STALE_MS = 5 * 60_000;

const ownerPath = (id: string) => `${DIR}/owner-${id}`;

/** 주인 자리를 «만든다». mkdir 이 원자적이라 한 놈만 이긴다. */
function claim(id: string): boolean {
  try { mkdirSync(DIR); } catch { return false; }
  try { closeSync(openSync(ownerPath(id), 'wx')); return true; } catch { return false; }
}
/** 가장 최근 박동에서 얼마나 지났나. 주인 자리가 없으면 Infinity. */
function quietMs(): number {
  try {
    const files = readdirSync(DIR).filter((f) => f.startsWith('owner-'));
    if (!files.length) return Infinity;
    return Date.now() - Math.max(...files.map((f) => statSync(`${DIR}/${f}`).mtimeMs));
  } catch { return Infinity; }
}
function acquire(id: string): boolean {
  if (claim(id)) return true;
  if (quietMs() < STALE_MS) return false;
  const claimDir = `${DIR}.claim-${id}`;
  try { renameSync(DIR, claimDir); } catch { return false; }   // 뺏기 경쟁 — 한 놈만 성공
  rmSync(claimDir, { recursive: true, force: true });
  return claim(id);
}
/** 심장박동 — 시각만 갱신한다. **만들지 않는다.** 자리가 없으면 진 것이다. */
function beat(id: string): boolean {
  try { const now = new Date(); utimesSync(ownerPath(id), now, now); return true; } catch { return false; }
}
const owners = () => (existsSync(DIR) ? readdirSync(DIR).filter((f) => f.startsWith('owner-')) : []);
const reset = () => rmSync(DIR, { recursive: true, force: true });
const stale = (id: string) => { const old = new Date(Date.now() - 6 * 60_000); utimesSync(ownerPath(id), old, old); };

let bad = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) bad += 1;
};

// ── ① 동시에 달려들면 하나만 이긴다 ────────────────────────────────────────
reset();
{
  const won: string[] = [];
  for (let i = 0; i < 10; i += 1) if (acquire(`새로${i}`)) won.push(`새로${i}`);
  check('새로 잡기 — 10개가 달려들어도 하나만', won.length === 1, `이긴 것 ${won.length}개`);
}

// ── ② 심장이 멎은 잠금은 «한 놈만» 뺏는다 ──────────────────────────────────
{
  stale('새로0');
  const won: string[] = [];
  for (let i = 0; i < 8; i += 1) if (acquire(`뺏기${i}`)) won.push(`뺏기${i}`);
  check('죽은 잠금 뺏기 — 8개가 달려들어도 하나만', won.length === 1, `이긴 것 ${won.length}개 · 주인 [${owners().join(',')}]`);
}

// ── ③ ★뺏긴 실행이 «뒤늦게» 심장을 뛰어도 소유권을 못 되살린다 ─────────────
//     코덱스 7차가 짚은 인터리빙 — 예전(파일 내용에 주인을 적던) 방식에서는 여기서 덮어써졌다.
reset();
{
  acquire('A');
  stale('A');
  const bTook = acquire('B');
  const aLateBeat = beat('A');          // A 가 뒤늦게 박동 — 자리가 없어야 한다
  const only = owners();
  check('뺏긴 실행이 뒤늦게 박동해도 못 되살린다',
    bTook && !aLateBeat && only.length === 1 && only[0] === 'owner-B',
    `B 뺏음=${bTook} · A 늦은박동=${aLateBeat ? '성공(위험)' : '실패(정상)'} · 주인 [${only.join(',')}]`);
}

// ── ④ 살아 있는 잠금은 아무도 못 뺏는다 ────────────────────────────────────
reset();
{
  acquire('살아있음');
  check('심장이 뛰는 잠금은 남이 못 가져간다', !acquire('침입자'), `주인 [${owners().join(',')}]`);
}

// ── ⑤ (--long) 6분짜리 막힌 단계 동안 심장이 계속 뛰나 ─────────────────────
if (LONG) {
  reset();
  acquire('긴단계');
  const worker = new Worker(`
    const { workerData } = require('node:worker_threads');
    const { utimesSync } = require('node:fs');
    const t = setInterval(() => {
      try { const n = new Date(); utimesSync(workerData.owner, n, n); } catch { clearInterval(t); }
    }, 30_000);
  `, { eval: true, workerData: { owner: ownerPath('긴단계') } });
  worker.unref();

  const ages: number[] = [];
  let secondRunBlocked = true;
  for (let minute = 1; minute <= 6; minute += 1) {
    // 1분짜리 자식 — 그동안 메인 스레드는 완전히 막힌다(실제 단계와 같은 상황)
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { encoding: 'utf8' });
    ages.push(Math.round(quietMs() / 1000));
    if (minute === 3 && acquire('두번째실행')) secondRunBlocked = false;
  }
  void worker.terminate();
  check('6분 막힌 단계 내내 심장이 뛴다', Math.max(...ages) < 60, `분당 나이 ${ages.join('·')}초`);
  check('그 도중 두 번째 실행은 물러난다', secondRunBlocked);
}

reset();
console.log(bad ? `\n✗ 잠금 시험 ${bad}건 실패` : `\n✓ 잠금 시험 전부 통과${LONG ? ' (6분 시험 포함)' : ' (--long 으로 6분 시험까지)'}`);
process.exit(bad ? 1 : 0);
