/**
 * **수수료를 «데이터에서» 배운다.** 읽기만 — 아무것도 안 고친다.
 *
 * ★사장님 2026-09-01 「총 안맞는거 뭐야 저 수수료 제대로 학습해놔 매뉴얼대로」
 *
 * ★★**표를 믿지 않고 «실제로 끊은 금액»에서 역산한다.**
 *   원장에 적힌 판매수수료·출고수수료는 실제로 계산서를 끊은 값이다(매뉴얼 §7 「적힌 값이 이긴다」).
 *   그 값을 기준(차량가액·대여료×기간)으로 나누면 «실효요율»이 나온다.
 *   ⇒ 같은 공급사·상품·기간에서 실효요율이 «한 값으로 모이면» 그게 진짜 요율이다.
 *     흩어지면 요율이 아니라 «건별 협의»다 — 그건 표에 못 적는다.
 *
 * ★기준 셋 (매뉴얼 §7)
 * ```
 * 고정       건당 정액          요율칸이 1 이상이면 이것
 * 차량가액    차량가액 × 요율     선출고 · 견적출고
 * 대여료×기간 대여료 × 기간 × 요율  장기렌트 · 구독
 * ```
 *
 *   npx tsx scripts/learn-settlement-fees.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원₩]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pc = (n: number) => `${(n * 100).toFixed(2)}%`;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });

type Row = Record<string, unknown>;
const rows = (Object.values((await db.ref('v4/settlement_rows').get()).val() || {}) as Row[]).filter((r) => r.cancelled !== true);

/** 그 줄의 셈 기준과 밑값. 못 정하면 null. */
const baseOf = (r: Row): { basis: '고정' | '차량가액' | '대여료×기간'; base: number } | null => {
  const product = S(r.product); const term = N(r.term);
  const rate = N(r.supplierRate);
  if (rate >= 1) return { basis: '고정', base: 0 };
  if (/선출고|견적출고/.test(product)) { const p = N(r.price); return p ? { basis: '차량가액', base: p } : null; }
  if (/장기렌트|구독/.test(product)) { const b = N(r.rent) * term; return b ? { basis: '대여료×기간', base: b } : null; }
  return null;
};

type Cell = { plate: string; sup: string; product: string; term: number; basis: string; base: number; claim: number; pay: number; cr: number; ar: number; note: string };
const cells: Cell[] = []; const skip: string[] = [];
for (const r of rows) {
  const b = baseOf(r);
  const claim = N(r.claimWritten); const pay = N(r.payWritten);
  if (!b) { if (claim) skip.push(`${S(r.plate).padEnd(11)} ${(S(r.supplier) || '(미기재)').padEnd(10)} ${S(r.product)}${N(r.term) || ''} — 기준을 못 정한다(차량가액·대여료 없음)`); continue; }
  if (!claim) continue;
  cells.push({
    plate: S(r.plate), sup: S(r.supplier) || '(미기재)', product: S(r.product), term: N(r.term),
    basis: b.basis, base: b.base, claim, pay,
    cr: b.basis === '고정' ? claim : claim / b.base,
    ar: b.basis === '고정' ? pay : (b.base ? pay / b.base : 0),
    note: S(r.settleTerms) || S(r.note) || S(r.settleNote),
  });
}

console.log(`\n■ 원장 ${rows.length}줄 중 요율을 잴 수 있는 ${cells.length}줄 · 기준을 못 정한 ${skip.length}줄\n`);

/** 공급사 × 상품 × 기간으로 모아 «실효요율이 한 값으로 모이나» 본다. */
const key = (c: Cell) => `${c.sup}|${c.product}|${c.basis === '대여료×기간' ? c.term : ''}`;
const groups = new Map<string, Cell[]>();
for (const c of cells) { const k = key(c); (groups.get(k) || groups.set(k, []).get(k)!).push(c); }

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
type Learned = { sup: string; product: string; term: string; basis: string; cr: number; ar: number; n: number; agree: number; odd: Cell[] };
const learned: Learned[] = [];
for (const [k, list] of groups) {
  const [sup, product, term] = k.split('|');
  const basis = list[0].basis;
  // ★가장 많이 나온 요율이 그 조합의 «진짜» 요율이다. 한 건짜리는 요율이라 부르지 않는다.
  const tally = new Map<number, number>();
  for (const c of list) { const v = round4(c.cr); tally.set(v, (tally.get(v) || 0) + 1); }
  const [cr, agree] = [...tally].sort((a, b) => b[1] - a[1])[0];
  const arTally = new Map<number, number>();
  for (const c of list) if (round4(c.cr) === cr) { const v = round4(c.ar); arTally.set(v, (arTally.get(v) || 0) + 1); }
  const ar = [...arTally].sort((a, b) => b[1] - a[1])[0][0];
  learned.push({ sup, product, term, basis, cr, ar, n: list.length, agree, odd: list.filter((c) => round4(c.cr) !== cr) });
}
learned.sort((a, b) => b.n - a.n);

console.log('■ 배운 요율 — 공급사 × 상품 × 기간\n');
console.log('   공급사        상품     기간  기준        공급사율     에이전시율   건수  일치  어긋남');
for (const l of learned) {
  const rate = (v: number) => (l.basis === '고정' ? won(v) : pc(v));
  const mark = l.n === 1 ? '  (한 건 — 요율이라 부르기 이르다)' : l.odd.length ? `  ⚠ ${l.odd.length}건 다름` : '';
  console.log(`   ${l.sup.padEnd(12)} ${l.product.padEnd(8)} ${(l.term || '').padStart(3)}  ${l.basis.padEnd(10)} ${rate(l.cr).padStart(11)} ${rate(l.ar).padStart(11)}  ${String(l.n).padStart(4)} ${String(l.agree).padStart(5)}${mark}`);
}

console.log('\n\n■ ⚠ 같은 조합인데 «요율이 다른» 줄 — 여기가 안 맞는 것이다\n');
let oddN = 0; let oddAmt = 0;
for (const l of learned) {
  if (!l.odd.length) continue;
  const rate = (v: number) => (l.basis === '고정' ? won(v) : pc(v));
  console.log(`   ${l.sup} · ${l.product}${l.term ? ` ${l.term}개월` : ''} — 대세 ${rate(l.cr)} (${l.agree}/${l.n}건)`);
  for (const c of l.odd.sort((a, b) => b.claim - a.claim)) {
    oddN += 1;
    const want = l.basis === '고정' ? l.cr : Math.round(c.base * l.cr);
    oddAmt += c.claim - want;
    console.log(`      ${c.plate.padEnd(11)} 실효 ${rate(c.cr).padStart(11)} · 청구 ${won(c.claim).padStart(11)} (대세대로면 ${won(want)} · 차 ${won(c.claim - want)})${c.note ? `  「${c.note}」` : ''}`);
  }
  console.log('');
}
console.log(`   합 ${oddN}줄 · 대세와의 차 ${won(oddAmt)}`);

if (skip.length) {
  console.log(`\n\n■ 기준을 못 정한 ${skip.length}줄 — 차량가액도 대여료도 없다`);
  for (const s of skip.slice(0, 12)) console.log(`   ${s}`);
  if (skip.length > 12) console.log(`   … 외 ${skip.length - 12}줄`);
}

// ── 지금 수수료표와 대조 ──
const tok = (await jwt.getAccessToken()).token;
const fr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent("'수수료표'!A1:H40")}?valueRenderOption=UNFORMATTED_VALUE`, { headers: { Authorization: `Bearer ${tok}` } });
const ft = (((await fr.json()) as { values?: unknown[][] }).values || []).map((v) => (v || []).map(S));
type Fee = { sup: string; product: string; term: string; basis: string; sr: number; ar: number };
const fees: Fee[] = [];
for (const x of ft) if (x[3] && /고정|차량가액|대여료/.test(x[3])) fees.push({ sup: S(x[0]), product: S(x[1]), term: S(x[2]), basis: S(x[3]), sr: N(x[4]), ar: N(x[5]) });
console.log('\n\n■ 지금 「수수료표」와 배운 것이 다른 곳\n');
const seen = new Set<string>(); let diffN = 0;
for (const l of learned) {
  if (l.n < 2) continue;
  const f = fees.find((x) => x.sup === l.sup && x.product === l.product && (!x.term || x.term === l.term))
    || fees.find((x) => !x.sup && x.product === l.product && (!x.term || x.term === l.term));
  const tag = `${l.product}|${l.term}`;
  if (!f) { console.log(`   ✕ 표에 «없다» — ${l.sup} ${l.product}${l.term ? ` ${l.term}개월` : ''}  배운 값 ${l.basis === '고정' ? won(l.cr) : pc(l.cr)} / ${l.basis === '고정' ? won(l.ar) : pc(l.ar)}  (${l.n}건)`); diffN += 1; continue; }
  if (Math.abs(f.sr - l.cr) > 1e-9 || Math.abs(f.ar - l.ar) > 1e-9) {
    if (seen.has(tag) && !f.sup) continue;
    seen.add(tag);
    console.log(`   ⚠ ${(`${l.sup} ${l.product}${l.term ? ` ${l.term}` : ''}`).padEnd(24)} 표 ${l.basis === '고정' ? won(f.sr) : pc(f.sr)} / ${l.basis === '고정' ? won(f.ar) : pc(f.ar)}   →   배운 값 ${l.basis === '고정' ? won(l.cr) : pc(l.cr)} / ${l.basis === '고정' ? won(l.ar) : pc(l.ar)}  (${l.agree}/${l.n}건이 이 값)`);
    diffN += 1;
  }
}
if (!diffN) console.log('   ○ 표와 배운 것이 같다.');
process.exit(0);
