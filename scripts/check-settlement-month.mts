/**
 * **그 달 정산 3중 검사.** 읽기만 한다 — 아무것도 안 고친다.
 *
 * ★사장님 2026-09-01 작업순서
 *   ① 기 접수된 것 중 8월 청구하고 «남은 것»이 9·10월 그 이후로 갈 게 있는지
 *   ② «공급사별 수수료대로» 수수료가 산출된 건지
 *   ③ 8월 청구분이 태윤 매니저 계산과 «일치»하는지 — 공급사·영업채널 다
 *
 *   npx tsx scripts/check-settlement-month.mts 2026-08
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';

const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '2026-08').trim();
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원₩]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const D = (v: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(v)); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const roundsOf = (k: string) => { const m = /(\d)\s*회/.exec(S(k)); const n = m ? Number(m[1]) : 1; return n >= 2 ? n : 1; };
const SINCE = '2026-09';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });

type Row = Record<string, unknown>;
const rows = (Object.values((await db.ref('v4/settlement_rows').get()).val() || {}) as Row[]).filter((r) => r.cancelled !== true);
const monthOf = (r: Row): string => {
  if (S(r.billMonth)) return S(r.billMonth);
  const d = D(r.deliveredAt); if (!d) return '';
  const n = roundsOf(S(r.payKind));
  return ymOf(n >= 2 && ymOf(d) >= SINCE ? new Date(d.getFullYear(), d.getMonth() + (n - 1), d.getDate()) : d);
};
const locked = new Set(rows.map((r) => S(r.billMonth)).filter(Boolean));
const monthFor = (r: Row) => { const m = monthOf(r); if (!m) return ''; return S(r.billMonth) ? m : (locked.has(m) ? '' : m); };

// ─────────────────────────────────────────── ① 남은 것은 어느 달로
console.log(`\n■ ① 기 접수분 중 «${MONTH} 청구하고 남은 것» — 어느 달로 보낼까\n`);
const pending = rows.filter((r) => !monthFor(r));
const bumped = pending.filter((r) => !S(r.billMonth) && monthOf(r));
const noDate = pending.filter((r) => !monthOf(r));
console.log(`   ┌ 계산상 «${MONTH}» 인데 그 달이 확정돼 못 넣은 줄  ${bumped.length}건`);
let bc = 0; let bp = 0;
for (const r of bumped.sort((a, b) => S(a.deliveredAt).localeCompare(S(b.deliveredAt)))) {
  const c = N(r.claimWritten); const p = N(r.payWritten); bc += c; bp += p;
  console.log(`   │  ${S(r.plate).padEnd(11)} ${(S(r.supplier) || '(미기재)').padEnd(10)} ${S(r.channel).padEnd(7)} 인도 ${S(r.deliveredAt) || '—'} ${S(r.payKind).padEnd(6)} 청구 ${won(c).padStart(10)} 지급 ${won(p).padStart(10)}`);
}
console.log(`   │  ─────────────────────────────────────────────────────────────`);
console.log(`   │  합 ${bumped.length}건 · 청구 ${won(bc)} · 지급 ${won(bp)} · 이익 ${won(bc - bp)}`);
console.log(`   │  ⇒ 이 줄들은 «다음 달(${MONTH.slice(0, 4)}-${String(Number(MONTH.slice(5)) + 1).padStart(2, '0')})»로 보내는 것이 자연스럽다 — 인도는 됐고 청구만 안 나갔다.`);
console.log(`   └ 인도도 청구월도 «없는» 줄  ${noDate.length}건 — 인도 예정에 따라 사람이 정한다`);
for (const r of noDate) console.log(`      ${S(r.plate).padEnd(11)} ${(S(r.supplier) || '(미기재)').padEnd(10)} 접수 ${S(r.receivedAt) || '—'} ${S(r.payKind).padEnd(6)} ${S(r.payKind).includes('분납') ? '분납 → 인도월+(회차−1)개월' : '일시납 → 인도월'}`);

// ─────────────────────────────────────────── ② 수수료가 표대로 났나
console.log(`\n\n■ ② 공급사별 수수료표대로 산출됐나 — ${MONTH}\n`);
const tok = (await jwt.getAccessToken()).token;
const fr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent("'수수료표'!A1:H40")}?valueRenderOption=UNFORMATTED_VALUE`, { headers: { Authorization: `Bearer ${tok}` } });
const ft = (((await fr.json()) as { values?: unknown[][] }).values || []).map((v) => (v || []).map(S));
type Fee = { sup: string; product: string; term: string; basis: string; sr: number; ar: number };
const fees: Fee[] = [];
for (const x of ft) {
  if (!x[3] || !/고정|차량가액|대여료/.test(x[3])) continue;
  fees.push({ sup: S(x[0]), product: S(x[1]), term: S(x[2]), basis: S(x[3]), sr: N(x[4]), ar: N(x[5]) });
}
console.log(`   수수료표 ${fees.length}줄 읽음`);
/** ★찾는 차례 — ① 공급사+상품+기간 ② 공급사 빈칸(표준) ③ 없으면 «모른다» */
const feeFor = (sup: string, product: string, term: number): Fee | undefined =>
  fees.find((f) => f.sup === sup && f.product === product && (!f.term || Number(f.term) === term))
  || fees.find((f) => !f.sup && f.product === product && (!f.term || Number(f.term) === term));

const mine = rows.filter((r) => monthFor(r) === MONTH);
const bad: string[] = []; const unknown: string[] = []; let okN = 0;
for (const r of mine) {
  const sup = S(r.supplier); const product = S(r.product); const term = N(r.term);
  const f = feeFor(sup, product, term);
  if (!f) { unknown.push(`   ${S(r.plate).padEnd(11)} ${(sup || '(미기재)').padEnd(10)} ${product.padEnd(8)} ${term}개월 — 표에 없다`); continue; }
  const base = f.basis === '고정' ? 1 : f.basis === '차량가액' ? N(r.price) : N(r.rent) * term;
  const wantC = f.basis === '고정' ? f.sr : Math.round(base * f.sr);
  const wantP = f.basis === '고정' ? f.ar : Math.round(base * f.ar);
  const gotC = N(r.claimWritten); const gotP = N(r.payWritten);
  const dc = gotC - wantC; const dp = gotP - wantP;
  if (Math.abs(dc) < 2 && Math.abs(dp) < 2) { okN += 1; continue; }
  bad.push(`   ${S(r.plate).padEnd(11)} ${(sup || '(미기재)').padEnd(10)} ${product}${term} ${f.basis.padEnd(6)}`
    + ` 청구 ${won(gotC).padStart(10)} (표 ${won(wantC)}${dc ? ` · 차 ${won(dc)}` : ''})`
    + ` 지급 ${won(gotP).padStart(10)} (표 ${won(wantP)}${dp ? ` · 차 ${won(dp)}` : ''})`);
}
console.log(`   ○ 표와 맞는 줄 ${okN} · ⚠ 다른 줄 ${bad.length} · ? 표에 없는 줄 ${unknown.length}\n`);
for (const b of bad) console.log(b);
if (unknown.length) { console.log(''); for (const u of unknown) console.log(u); }

// ─────────────────────────────────────────── ③ 태윤 계산과 대조
console.log(`\n\n■ ③ ${MONTH} — 우리 표 (공급사별 · 영업채널별)\n`);
const line = (r: Row) => {
  const target = S(r.settleTarget) || '양쪽'; const ratio = N(r.settleRatio) || 1;
  const hold = r.billHold === true; const excl = r.settleExclude === true;
  return {
    claim: excl || target === '영업사만' || hold ? 0 : Math.round(N(r.claimWritten) * ratio),
    pay: excl || target === '공급사만' ? 0 : Math.round(N(r.payWritten) * ratio),
  };
};
const claws = (Object.values((await db.ref('v4/settlement_clawbacks').get()).val() || {}) as Row[]).filter((c) => S(c.month) === MONTH);
const grp = (key: (r: Row) => string, side: 'claim' | 'pay') => {
  const m = new Map<string, { n: number; v: number }>();
  for (const r of mine) { const k = key(r) || '(미기재)'; const g = m.get(k) || { n: 0, v: 0 }; g.n++; g.v += line(r)[side]; m.set(k, g); }
  for (const c of claws) { const k = S(side === 'claim' ? c.supplier : c.channel) || '(미기재)'; const g = m.get(k) || { n: 0, v: 0 }; g.n++; g.v -= N(side === 'claim' ? c.supplierAmt : c.agentAmt); m.set(k, g); }
  return [...m].sort((a, b) => b[1].v - a[1].v);
};
console.log('   [공급사별 청구]');
let TC = 0;
for (const [k, g] of grp((r) => S(r.supplier), 'claim')) { TC += g.v; console.log(`   ${k.padEnd(14)} ${String(g.n).padStart(2)}건 ${won(g.v).padStart(12)}  VAT포함 ${won(g.v + Math.round(g.v * 0.1)).padStart(12)}`); }
console.log(`   ${'합계'.padEnd(14)}    ${won(TC).padStart(12)}  VAT포함 ${won(TC + Math.round(TC * 0.1)).padStart(12)}`);
console.log('\n   [영업채널별 지급]');
let TP = 0;
for (const [k, g] of grp((r) => S(r.channel), 'pay')) { TP += g.v; console.log(`   ${k.padEnd(14)} ${String(g.n).padStart(2)}건 ${won(g.v).padStart(12)}  VAT포함 ${won(g.v + Math.round(g.v * 0.1)).padStart(12)}`); }
console.log(`   ${'합계'.padEnd(14)}    ${won(TP).padStart(12)}  VAT포함 ${won(TP + Math.round(TP * 0.1)).padStart(12)}`);

const TY: Record<string, { c: number; p: number }> = { '2026-08': { c: 48_073_770, p: 40_339_156 } };
const ty = TY[MONTH];
if (ty) {
  console.log(`\n   ★태윤 매니저   청구 ${won(ty.c)} · 지급 ${won(ty.p)}`);
  console.log(`     우리 표      청구 ${won(TC)} · 지급 ${won(TP)}`);
  console.log(`     차이         청구 ${won(TC - ty.c)} · 지급 ${won(TP - ty.p)}`);
  console.log(`\n   ⚠ 업체별 대조는 태윤 매니저의 «업체별 합계»가 있어야 한다 — 총액만으로는 어느 업체가 다른지 모른다.`);
  console.log(`     실증: 우리캐피탈 10,403,278 하나를 받자마자 「영업사만 정산해야함」 규칙이 바로 잡혔다.`);
}
process.exit(0);
