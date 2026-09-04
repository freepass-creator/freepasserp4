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
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { feeKindOf, feeRuleFor } from '../lib/domain/settlement-fee-table';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원₩]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pc = (n: number) => `${(n * 100).toFixed(2)}%`;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();

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

// ── 표가 «어디까지» 맞나 — 태윤 매니저 원장 전수 대조 ──
/**
 * ★사장님 2026-09-02 「태윤이가 지금껏 했던 정산데이터 기준으로 어디까지 맞는지 학습해와」
 *
 * ★★**수수료표는 코드가 정본이다** — 시트를 파싱하지 않는다.
 *   ⚠ 2026-09-01 에 시트를 읽다가, 표를 다시 찍는 순간 검사가 통째로 깨졌다(45줄이 「공급사 없음」).
 *
 * 네 갈래로만 가른다 — ○ 표대로 · ⚠ 표와 다름 · ★사람이 정함(auto:false) · ? 표에 없음.
 * ★**「다름」과 「사람이 정함」은 다른 말이다.** 앞은 표가 틀렸거나 건별 협의고,
 *   뒤는 표가 이미 「한 값으로 안 떨어진다」고 «말하고 있는» 것이다.
 */
const VERDICT = { ok: 0, gap: 0, human: 0, none: 0 };
type Judge = { plate: string; sup: string; kind: string; term: number; model: string; claim: number; want: number; basis: string };
const gaps: Judge[] = []; const humans: string[] = []; const nones = new Map<string, { n: number; amt: number }>();
type Per = { n: number; ok: number; gap: number; human: number; none: number; amt: number; gapAmt: number };
const per = new Map<string, Per>();
const bump = (k: string): Per => per.get(k) || per.set(k, { n: 0, ok: 0, gap: 0, human: 0, none: 0, amt: 0, gapAmt: 0 }).get(k)!;

for (const r of rows) {
  const claim = N(r.claimWritten);
  if (!claim) continue;
  const sup = S(r.supplier) || '(미기재)'; const term = N(r.term); const model = S(r.model);
  const g = bump(sup); g.n += 1; g.amt += claim;
  const { kind, form, fallback } = feeKindOf(S(r.product), model);
  const f = feeRuleFor(S(r.supplier), kind, term, form, fallback);
  if (!f) {
    VERDICT.none += 1; g.none += 1;
    const k = `${sup} · ${kind}${term ? ` ${term}개월` : ''}`;
    const c = nones.get(k) || { n: 0, amt: 0 }; c.n += 1; c.amt += claim; nones.set(k, c);
    continue;
  }
  if (!f.auto) {
    VERDICT.human += 1; g.human += 1;
    humans.push(`   ${S(r.plate).padEnd(11)} ${sup.padEnd(11)} ${f.kind}${f.term ? ` ${f.term}개월` : ''} — 표가 「${f.claim}」  청구 ${won(claim)}`);
    continue;
  }
  const rate = Number(f.claim);
  const base = f.basis === '정액' ? 0 : (f.basis === '차량가액' ? N(r.price) : N(r.rent) * term);
  // ★밑값(차량가액·대여료)이 없으면 «틀렸다»가 아니라 «못 센다»다.
  if (f.basis !== '정액' && !base) { VERDICT.none += 1; g.none += 1; continue; }
  const want = f.basis === '정액' ? rate : Math.round(base * rate);
  if (Math.abs(claim - want) < 2) { VERDICT.ok += 1; g.ok += 1; continue; }
  VERDICT.gap += 1; g.gap += 1; g.gapAmt += claim - want;
  gaps.push({ plate: S(r.plate) || '(차번없음)', sup, kind: f.kind, term, model, claim, want, basis: f.basis });
}

const tot = VERDICT.ok + VERDICT.gap + VERDICT.human + VERDICT.none;
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
console.log('\n\n■■ 태윤 매니저 원장 전수 — «지금 수수료표»로 어디까지 설명되나\n');
console.log(`   금액이 적힌 ${tot}줄 기준`);
console.log(`      ○ 표대로 떨어짐        ${String(VERDICT.ok).padStart(4)}줄  ${pct(VERDICT.ok, tot).padStart(6)}`);
console.log(`      ⚠ 표와 다름            ${String(VERDICT.gap).padStart(4)}줄  ${pct(VERDICT.gap, tot).padStart(6)}`);
console.log(`      ★ 표가 «사람이 정한다»   ${String(VERDICT.human).padStart(4)}줄  ${pct(VERDICT.human, tot).padStart(6)}   (틀린 게 아니다 — 표가 이미 그렇게 말한다)`);
console.log(`      ? 표에 없거나 못 셈     ${String(VERDICT.none).padStart(4)}줄  ${pct(VERDICT.none, tot).padStart(6)}`);
const decidable = VERDICT.ok + VERDICT.gap;
console.log(`\n   ★기계가 셀 수 있는 ${decidable}줄 중 ${VERDICT.ok}줄이 표대로 = ${pct(VERDICT.ok, decidable)}`);

console.log('\n\n■ 공급사별 — 어디는 표를 믿어도 되나\n');
console.log('   공급사         줄수  표대로   다름  사람  없음    적중률       청구합        다른 금액');
for (const [k, g] of [...per].sort((a, b) => b[1].amt - a[1].amt)) {
  const dec = g.ok + g.gap;
  const hit = dec ? pct(g.ok, dec) : '—';
  const flag = !dec ? '' : g.ok === dec ? '  ○ 믿어도 된다' : g.ok === 0 ? '  ✕ 못 믿는다' : '  ⚠ 갈린다';
  console.log(`   ${k.padEnd(12)} ${String(g.n).padStart(4)} ${String(g.ok).padStart(6)} ${String(g.gap).padStart(6)} ${String(g.human).padStart(5)} ${String(g.none).padStart(5)} ${hit.padStart(8)} ${won(g.amt).padStart(13)} ${(g.gapAmt ? won(g.gapAmt) : '').padStart(13)}${flag}`);
}

if (gaps.length) {
  console.log('\n\n■ ⚠ 표와 «다른» 줄 — 표가 못 따라가는 자리\n');
  console.log('   차량번호      공급사       갈래  기준          적힌 값        표 산출          차        배수');
  for (const g of gaps.sort((a, b) => Math.abs(b.claim - b.want) - Math.abs(a.claim - a.want)).slice(0, 30)) {
    const x = g.want ? (g.claim / g.want).toFixed(2) : '—';
    console.log(`   ${g.plate.padEnd(12)} ${g.sup.padEnd(11)} ${g.kind.padEnd(4)} ${g.basis.padEnd(12)} ${won(g.claim).padStart(11)} ${won(g.want).padStart(12)} ${won(g.claim - g.want).padStart(12)}  ${x}배`);
  }
  if (gaps.length > 30) console.log(`   … 외 ${gaps.length - 30}줄`);
}

if (nones.size) {
  console.log('\n\n■ ? 표에 없는 조합 — 표에 줄을 더해야 하는 자리\n');
  for (const [k, c] of [...nones].sort((a, b) => b[1].amt - a[1].amt).slice(0, 20)) console.log(`   ${k.padEnd(28)} ${String(c.n).padStart(3)}줄  청구 ${won(c.amt).padStart(12)}`);
}
if (humans.length) {
  console.log(`\n\n■ ★표가 «사람이 정한다»고 말하는 ${humans.length}줄 — 적힌 값을 그대로 쓴다\n`);
  for (const h of humans.slice(0, 12)) console.log(h);
  if (humans.length > 12) console.log(`   … 외 ${humans.length - 12}줄`);
}
console.log('\n   ⚠ 청구서는 «적힌 값»으로 나간다 — 표 산출로 덮으면 실제로 끊은 계산서와 갈린다.\n');
process.exit(0);
