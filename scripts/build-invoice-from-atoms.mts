/**
 * **원자 + 수수료표 로직으로 청구서를 «산출»하고, 적힌 값과 맞대 본다.** 읽기만.
 *
 * ★사장님 2026-09-01 「청구서를 우리 원자로 맞추고 수수표로 로직대로 산출해서 맞춰봐봐」
 *
 * ★★**두 값을 나란히 놓는다.**
 * ```
 * 적힌 값   원장에 적힌 판매·출고수수료 — 실제로 계산서를 끊은 금액. 매뉴얼 §7 「적힌 값이 이긴다」
 * 표 산출   원자(차량가액·대여료·기간)에 수수료표 로직을 걸어 «기계가» 낸 값
 * ```
 *   ★둘이 같으면 그 줄은 설명이 끝난 것이다.
 *   ★다르면 «왜 다른지»가 있어야 한다 — 메모든 사람 말이든. 없으면 그게 물어볼 자리다.
 *   ⚠ **표 산출로 «덮지 않는다».** 덮으면 실제로 끊은 계산서와 갈린다.
 *     실측 2026-09-01 — 전체 원장에서 덮었으면 868만원이 틀어졌다.
 *
 *   npx tsx scripts/build-invoice-from-atoms.mts 2026-08
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { feeRuleFor, type FeeRule } from '../lib/domain/settlement-fee-table';

const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '2026-08').trim();
const VAT = 0.1;
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원₩]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();

const EV = /EV\b|EV6|아이오닉|모델\s*[3YXS]|테슬라|니로|코나|폴스타/i;
/** ★전기차 특약이 있으면 그것이 이기되, 없으면 «일반 갈래»로 내려간다(fallback). */
const kindOf = (product: string, model: string): { kind: FeeRule['kind']; form?: string; fallback?: FeeRule['kind'] } => {
  if (/견적출고/.test(product)) return { kind: '신차', form: '매칭출고' };
  const ev = EV.test(model);
  if (/선출고/.test(product)) return ev ? { kind: '전기차', fallback: '신차', form: undefined } : { kind: '신차', form: '선출고' };
  if (/구독/.test(product)) return { kind: '구독' };
  return ev ? { kind: '전기차', fallback: '재렌트' } : { kind: '재렌트' };
};

type Row = Record<string, unknown>;
const rows = (Object.values((await db.ref('v4/settlement_rows').get()).val() || {}) as Row[])
  .filter((r) => r.cancelled !== true && S(r.billMonth) === MONTH);
const claws = (Object.values((await db.ref('v4/settlement_clawbacks').get()).val() || {}) as Row[]).filter((c) => S(c.month) === MONTH);

type L = { plate: string; sup: string; ch: string; model: string; product: string; term: number;
  writeC: number; writeP: number; calcC: number | null; calcP: number | null; why: string; target: string; ratio: number };
const lines: L[] = [];
for (const r of rows) {
  const sup = S(r.supplier); const product = S(r.product); const term = N(r.term); const model = S(r.model);
  const target = S(r.settleTarget) || '양쪽'; const ratio = N(r.settleRatio) || 1;
  const { kind, form, fallback } = kindOf(product, model);
  const f = feeRuleFor(sup, kind, term, form, fallback);
  let calcC: number | null = null; let calcP: number | null = null; let why = '';
  if (!f) why = '표에 그 공급사·갈래가 없다';
  else if (!f.auto) why = `표가 「${f.claim}」 — 사람이 정한다`;
  else {
    const base = f.basis === '정액' ? 0 : (f.basis === '차량가액' ? N(r.price) : N(r.rent) * term);
    calcC = Math.round((f.basis === '정액' ? Number(f.claim) : base * Number(f.claim)) * ratio);
    calcP = Math.round((f.basis === '정액' ? Number(f.pay) : base * Number(f.pay)) * ratio);
    // ★정산대상이 한쪽이면 반대쪽은 0 이다 — 요율과 무관하다
    if (target === '영업사만') calcC = 0;
    if (target === '공급사만') calcP = 0;
  }
  lines.push({
    plate: S(r.plate) || '(차번없음)', sup: sup || '(미기재)', ch: S(r.channel) || '(미기재)', model, product, term,
    writeC: target === '영업사만' || r.settleExclude === true ? 0 : Math.round(N(r.claimWritten) * ratio),
    writeP: target === '공급사만' || r.settleExclude === true ? 0 : Math.round(N(r.payWritten) * ratio),
    calcC, calcP, why, target, ratio,
  });
}

const sum = (f: (l: L) => number) => lines.reduce((a, b) => a + f(b), 0);
const clawC = claws.reduce((a, c) => a + N(c.supplierAmt), 0);
const clawP = claws.reduce((a, c) => a + N(c.agentAmt), 0);
const wC = sum((l) => l.writeC) - clawC; const wP = sum((l) => l.writeP) - clawP;
const cC = sum((l) => (l.calcC ?? l.writeC)) - clawC; const cP = sum((l) => (l.calcP ?? l.writeP)) - clawP;

console.log(`\n■ ${MONTH} — 청구서를 «원자 + 수수료표 로직»으로 산출해 적힌 값과 맞댄다`);
console.log(`   ${lines.length}줄 + 환수 ${claws.length}건\n`);
console.log('                     공급사 청구        영업채널 지급         우리 몫');
console.log(`   적힌 값        ${won(wC).padStart(14)} ${won(wP).padStart(18)} ${won(wC - wP).padStart(14)}`);
console.log(`   표 산출        ${won(cC).padStart(14)} ${won(cP).padStart(18)} ${won(cC - cP).padStart(14)}`);
console.log(`   차이           ${won(cC - wC).padStart(14)} ${won(cP - wP).padStart(18)} ${won((cC - cP) - (wC - wP)).padStart(14)}`);

const canCalc = lines.filter((l) => l.calcC !== null);
const same = canCalc.filter((l) => l.calcC === l.writeC && l.calcP === l.writeP);
const gap = canCalc.filter((l) => l.calcC !== l.writeC || l.calcP !== l.writeP);
console.log(`\n   기계가 낼 수 있는 줄 ${canCalc.length} — 같음 ${same.length} · 다름 ${gap.length}`);
console.log(`   사람이 정하는 줄 ${lines.length - canCalc.length}`);

if (gap.length) {
  console.log('\n■ ⚠ 적힌 값 ≠ 표 산출 — 왜 다른지 있어야 한다\n');
  console.log('   차량번호      공급사        구분          적힌 청구      표 산출       차');
  for (const l of gap.sort((a, b) => Math.abs((b.calcC ?? 0) - b.writeC) - Math.abs((a.calcC ?? 0) - a.writeC))) {
    console.log(`   ${l.plate.padEnd(12)} ${l.sup.padEnd(12)} ${(l.product + l.term).padEnd(12)} ${won(l.writeC).padStart(11)} ${won(l.calcC ?? 0).padStart(12)} ${won((l.calcC ?? 0) - l.writeC).padStart(12)}  ${l.model.slice(0, 8)}`);
  }
}
const human = lines.filter((l) => l.calcC === null);
if (human.length) {
  console.log('\n■ ★사람이 정하는 줄 — 적힌 값을 그대로 쓴다\n');
  for (const l of human) console.log(`   ${l.plate.padEnd(12)} ${l.sup.padEnd(12)} ${(l.product + (l.term || '')).padEnd(12)} 청구 ${won(l.writeC).padStart(11)}   ${l.why}`);
}

// ── 공급사별 대조 ──
const grp = (key: (l: L) => string, w: (l: L) => number, c: (l: L) => number) => {
  const m = new Map<string, { n: number; w: number; c: number }>();
  for (const l of lines) { const k = key(l); const g = m.get(k) || { n: 0, w: 0, c: 0 }; g.n++; g.w += w(l); g.c += c(l); m.set(k, g); }
  return [...m].sort((a, b) => b[1].w - a[1].w);
};
console.log('\n\n■ 공급사별 — 적힌 값 vs 표 산출\n');
console.log('   업체            건      적힌 값        표 산출        차       VAT포함(적힌 값)');
for (const [k, g] of grp((l) => l.sup, (l) => l.writeC, (l) => l.calcC ?? l.writeC)) {
  const d = g.c - g.w;
  console.log(`   ${k.padEnd(14)} ${String(g.n).padStart(2)} ${won(g.w).padStart(12)} ${won(g.c).padStart(13)} ${(d ? won(d) : '—').padStart(11)} ${won(g.w + Math.round(g.w * VAT)).padStart(15)}`);
}
console.log('\n■ 영업채널별 — 적힌 값 vs 표 산출\n');
console.log('   채널            건      적힌 값        표 산출        차       VAT포함(적힌 값)');
for (const [k, g] of grp((l) => l.ch, (l) => l.writeP, (l) => l.calcP ?? l.writeP)) {
  const d = g.c - g.w;
  console.log(`   ${k.padEnd(14)} ${String(g.n).padStart(2)} ${won(g.w).padStart(12)} ${won(g.c).padStart(13)} ${(d ? won(d) : '—').padStart(11)} ${won(g.w + Math.round(g.w * VAT)).padStart(15)}`);
}
console.log('\n   ⚠ 청구서는 «적힌 값»으로 나간다 — 표 산출로 덮으면 실제로 끊은 계산서와 갈린다.');
process.exit(0);
