/**
 * **정산에서 «빼는» 줄을 표시한다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-04 「sk게 왜 있어 그거는 접수하다가 그냥 보류로 빠진거라서 아니야」.
 *
 * ★★**지우지 않고 «빼기»로 표시한다**(`settleExclude`). 줄을 지우면 왜 없어졌는지 아무도 모르고,
 *   다음 동기에 원문에서 다시 들어온다. 남겨 두고 「센 것에서 뺀다」고 적는 것이 정본이다.
 * ★사유를 «반드시» 적는다 — 사유 없는 제외는 다음 달에 「이거 왜 빠졌지」가 된다.
 *
 *   npx tsx scripts/exclude-settlement-rows.mts --plates=190하8226,191하5913 --why="보류"
 *   npx tsx scripts/exclude-settlement-rows.mts --plates=… --why="보류" --apply
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const arg = (k: string) => S((process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('='));
const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');

const PLATES = arg('plates').split(',').map((p) => p.replace(/\s/g, '')).filter(Boolean);
const WHY = arg('why');
if (!PLATES.length || (!WHY && !UNDO)) {
  console.log('\n  차번과 사유를 주세요 — --plates=190하8226,191하5913 --why="접수 중 보류" [--apply] [--undo]\n');
  process.exit(1);
}

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();

type Row = Record<string, unknown>;
const all = Object.entries((await db.ref('v4/settlement_rows').get()).val() || {}) as [string, Row][];

console.log(`\n■ 정산 ${UNDO ? '제외 해제' : '제외'} ${PLATES.length}대 ${APPLY ? '(반영)' : '(대조만)'}\n`);
const patch: Record<string, unknown> = {};
let miss = 0;
for (const p of PLATES) {
  const hit = all.filter(([, r]) => S(r.plate).replace(/\s/g, '') === p);
  if (hit.length !== 1) { console.log(`  ✕ ${p} — «하나»로 못 찾음(${hit.length}건)`); miss++; continue; }
  const [k, r] = hit[0];
  console.log(`  ${UNDO ? '↩' : '−'} ${p.padEnd(10)} ${S(r.customer).padEnd(6)} ${S(r.supplier).padEnd(9)} ${S(r.channel).padEnd(7)} 인도 ${(S(r.deliveredAt) || '-').padEnd(11)} 청구 ${won(N(r.claimWritten)).padStart(10)} 지급 ${won(N(r.payWritten)).padStart(10)}`);
  patch[`${k}/settleExclude`] = UNDO ? null : true;
  patch[`${k}/settleNote`] = UNDO ? null : `정산제외 — ${WHY}`;
}
if (miss) { console.log(`\n  ✕ ${miss}대를 못 찾아 멈춥니다 — 차번을 확인해 주세요\n`); process.exit(1); }
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 건드렸습니다. --apply 로 반영합니다.\n'); process.exit(0); }

await db.ref('v4/settlement_rows').update(patch);
console.log(`\n   ✓ ${UNDO ? '해제했습니다' : '뺐습니다'} — 원장·정산서·시트 어디에서도 안 세어집니다\n`);
process.exit(0);
