/**
 * **수수료표 ↔ «우리가 청구하는 값»의 정합성.** 읽기만.
 *
 * ★사장님 2026-09-01 「태윤이가 만들어놓은 수수료랑 우리가 지금 청구하는거랑 정합성이 맞아야 하고」
 *
 * ★★**정본은 `lib/domain/settlement-fee-table.ts` 다** — 시트를 파싱하지 않는다.
 *   ⚠ 2026-09-01 에 시트를 직접 읽다가, 표를 새로 찍은 순간 검사가 통째로 깨졌다(45줄이 「공급사 없음」).
 *     표의 «모양»이 바뀌면 파싱은 늘 깨진다. 코드를 보면 안 깨진다.
 *
 * ★**한 값으로 안 떨어지는 규칙이 있다**(`auto:false`) — 「최대 9%」·「한 달 렌탈료」·
 *   「12개월구독료100%+70만」·「보증금 5%→3%」. 그건 «틀렸다»가 아니라 «사람이 정한다»이다.
 *   기계는 판정을 미루고 «사람이 봐야 할 줄»로만 세운다.
 *
 *   npx tsx scripts/check-fee-consistency.mts 2026-08
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { FEE_RULES, feeKindOf, feeRuleFor } from '../lib/domain/settlement-fee-table';
import { settleTargetOf } from '../lib/domain/settlement-stage';

const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '2026-08').trim();
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원₩]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();


type Row = Record<string, unknown>;
const rows = (Object.values((await db.ref('v4/settlement_rows').get()).val() || {}) as Row[])
  .filter((r) => r.cancelled !== true && S(r.billMonth) === MONTH);

console.log(`\n■ 수수료표 규칙 ${FEE_RULES.length}줄 · 공급사 ${new Set(FEE_RULES.map((r) => r.supplier)).size}곳`);
console.log(`■ ${MONTH} 청구 ${rows.length}줄을 표와 맞댄다\n`);

let ok = 0; const judge: string[] = []; const diff: string[] = []; const none: string[] = [];
for (const r of rows) {
  const sup = S(r.supplier); const product = S(r.product); const term = N(r.term); const model = S(r.model);
  // ★정산조건이 먼저다 — 「영업사만」·정산제외·청구보류는 공급사 청구가 0 이고, 비율은 양쪽에 똑같이 곱한다.
  //   ⚠ 2026-09-02 — 이걸 안 봐서 박지원(영업사만)이 「표와 다름」으로 잘못 섰다. 청구탭은 맞게 찍고 있었다.
  const target = settleTargetOf(r.settleTarget);
  const ratio = N(r.settleRatio) || 1;
  const zero = target === '영업' || r.settleExclude === true || r.billHold === true;
  const claim = zero ? 0 : Math.round(N(r.claimWritten) * ratio);
  const { kind, form, fallback } = feeKindOf(product, model);
  const f = feeRuleFor(sup, kind, term, form, fallback);
  if (!f) { none.push(`   ${S(r.plate).padEnd(11)} ${(sup || '(미기재)').padEnd(12)} ${product}${term || ''} — 표에 그 공급사·갈래가 없다  청구 ${won(claim)}`); continue; }
  if (!f.auto) { judge.push(`   ${S(r.plate).padEnd(11)} ${sup.padEnd(12)} ${f.kind}${f.term ? ` ${f.term}개월` : ''} ${f.form} — 표가 「${f.claim}」 ⇒ 사람이 정한다.  청구 ${won(claim)}`); continue; }
  const rate = Number(f.claim);
  const base = f.basis === '정액' ? 0 : (f.basis === '차량가액' ? N(r.price) : N(r.rent) * term);
  const want = zero ? 0 : Math.round((f.basis === '정액' ? rate : base * rate) * ratio);
  if (Math.abs(claim - want) < 2) { ok += 1; continue; }
  diff.push(`   ${S(r.plate).padEnd(11)} ${sup.padEnd(12)} ${f.kind}${f.term ? ` ${f.term}개월` : ''} ${model.slice(0, 8).padEnd(9)} 청구 ${won(claim).padStart(11)} · 표 ${won(want).padStart(11)} · 차 ${won(claim - want).padStart(11)}  [${f.basis} ${typeof f.claim === 'number' && f.claim < 1 ? `${(f.claim * 100).toFixed(2)}%` : won(rate)}]`);
}
console.log(`   ○ 표대로 ${ok}줄 · ⚠ 표와 다름 ${diff.length}줄 · ★사람이 정하는 줄 ${judge.length} · ? 표에 없음 ${none.length}\n`);
if (diff.length) { console.log('■ ⚠ 표와 «다른» 줄 — 여기를 봐야 한다\n'); for (const d of diff) console.log(d); console.log(''); }
if (judge.length) { console.log('■ ★사람이 정하는 줄 — 표가 한 값으로 안 떨어진다\n'); for (const j of judge) console.log(j); console.log(''); }
if (none.length) { console.log('■ ? 표에 없는 공급사 — 표에 줄을 더해야 한다\n'); for (const n of none) console.log(n); }
process.exit(diff.length ? 1 : 0);
