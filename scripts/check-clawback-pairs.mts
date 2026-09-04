/**
 * **환수 크로스체크 — 「한쪽만 있는 환수」를 잡는다.**
 *
 * ★사장님 2026-09-04 「정산할때 크로스체크가 필요하네 공급사에 환수되면 어딘가에
 *   영업자 환수에도 들어가 있어야하는구조네」.
 *
 * ★★**환수는 «두 축»이 짝이다.** 공급사에서 토해내면(`supplierAmt`) 그 건으로 영업채널에
 *   나갔던 수수료도 되돌려받아야 한다(`agentAmt`). 한쪽만 적히면 —
 * ```
 * 공급사만 적힘   우리는 토해내는데 채널에 준 돈은 그대로 → 그 차액이 «우리 손실»이다
 * 채널만 적힘     채널에서 떼는데 공급사에는 청구가 그대로 → 상대가 「왜 뗐냐」고 묻는다
 * ```
 *   ⇒ 짝이 안 맞는 줄을 «달마다» 훑어 세운다. 사람이 기억으로 맞추는 일이 아니다.
 *
 * ★**한쪽이 «이미 처리»된 경우가 있다** — 태윤 매니저 2026-09-04 「하허호 환수는 미리 쳐놨습니다」.
 *   그건 틀린 게 아니라 «다른 데서 처리한» 것이다. `reason` 에 그 사정이 적혀 있으면 알아보고
 *   경고를 낮춘다 — 다만 «안 보이게 지우지는 않는다». 짝이 없다는 사실 자체는 남는다.
 *
 *   npx tsx scripts/check-clawback-pairs.mts
 *   npx tsx scripts/check-clawback-pairs.mts 2026-09
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const MONTH = S(process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();

type Row = Record<string, unknown>;
const claws = Object.entries((await db.ref('v4/settlement_clawbacks').get()).val() || {}) as [string, Row][];
const rows = Object.values((await db.ref('v4/settlement_rows').get()).val() || {}) as Row[];
const byPlate = new Map(rows.filter((r) => S(r.plate)).map((r) => [S(r.plate).replace(/\s/g, ''), r]));

const mine = claws.filter(([, c]) => !MONTH || S(c.month) === MONTH);
console.log(`\n■ 환수 크로스체크 — ${MONTH || '전체'} · ${mine.length}건\n`);

/** 「미리 쳐놨다 · 선반영 · 상계」 같은 말이 사유에 있으면 «다른 데서 처리»된 것으로 본다. */
const HANDLED = /미리|선반영|상계|이미|처리|반영함|차감함/;
let warn = 0;
for (const [k, c] of mine.sort((a, b) => S(a[1].month).localeCompare(S(b[1].month)))) {
  const sup = N(c.supplierAmt); const ag = N(c.agentAmt);
  const r = byPlate.get(S(c.plate).replace(/\s/g, ''));
  const paid = N(r?.payWritten);
  const both = sup > 0 && ag > 0;
  const noted = HANDLED.test(S(c.reason));
  const mark = both ? 'o' : noted ? '~' : '!';
  if (!both) warn++;
  console.log(`  ${mark} ${k}`);
  console.log(`     공급사 ${S(c.supplier).padEnd(8)} ${won(sup).padStart(10)}    영업채널 ${S(c.channel).padEnd(8)} ${won(ag).padStart(10)}`);
  if (!both) {
    const side = sup > 0 ? '영업채널' : '공급사';
    const guess = sup > 0 ? paid : 0;
    console.log(`     ⚠ ${side} 쪽이 «0» 입니다${guess ? ` — 그 건에 나간 지급은 ${won(guess)} 였습니다` : ''}`);
    console.log(`     ${noted ? `○ 사유에 적혀 있습니다 — ${S(c.reason)}` : '✕ 사유가 없습니다 — 빠뜨린 것인지 확인이 필요합니다'}`);
  }
}
console.log(warn
  ? `\n  ⚠ 짝이 안 맞는 환수 ${warn}건 — 「~」는 사유가 적힌 것, 「!」는 확인이 필요한 것입니다.\n`
  : '\n  ✓ 모두 두 축이 짝을 이룹니다.\n');
process.exit(0);
