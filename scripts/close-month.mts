/**
 * **한 달을 닫는다 — 무엇을 청구하고 무엇이 막혀 있나.** 읽기만 한다.
 *
 * ★사장님 2026-08-26 「일단 급한건 당월거랑 당장 이번달말일로 정산해서 9월초에 청구할거를 챙기는거」.
 *   그래서 이 스크립트가 답하는 것은 **9월 초에 들고 나갈 종이 한 장**이다 —
 *   누구에게 얼마를 청구하고, 누구에게 얼마를 주고, **무엇이 아직 안 되는가.**
 *
 * ★★**「없다」와 「아직」을 가른다.** 인도 전이면 청구가 «없는» 게 아니라 «아직»이다.
 *   그 둘을 섞으면 말일에 인도될 건을 놓치고, 놓친 건은 다음 달로 밀린다.
 *
 * ★청구는 인도가 관문이다. 스타·아이카 분납건만 **분납이 끝나야** 청구다(선지급 없음).
 * ★환수는 청구를 «고치지» 않는다 — 환수일이 든 달에 **마이너스 줄로 새로 선다.**
 *
 *   npx tsx scripts/close-month.mts            (기본 2026-08)
 *   npx tsx scripts/close-month.mts 2026-09
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import {
  billingLines, billingMonth, claimsOnComplete, lastPaymentDate, moneyOf, roundsOf,
  type SettlementRow,
} from '../lib/domain/settlement-stage';

const MONTH = (process.argv[2] || '2026-08').trim();
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const ON = (v: unknown) => /^(TRUE|참|Y|예|1)$/i.test(S(v));
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const won = (n: number) => n.toLocaleString('ko-KR');
const SERIAL0 = Date.UTC(1899, 11, 30);
const toDate = (v: unknown): Date | null => {
  const t = S(v);
  if (!t) return null;
  const n = Number(t);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const u = new Date(SERIAL0 + Math.round(n) * 86_400_000);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  const x = new Date(t);
  return Number.isNaN(+x) ? null : x;
};
const p2 = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date | null) => (d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : '');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const api = async (u: string): Promise<Record<string, unknown>> => {
  const t = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
  const x = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${x.slice(0, 160)}`);
  return x ? JSON.parse(x) : {};
};

type Rec = { row: SettlementRow; channel: string; tab: string };
const recs: Rec[] = [];
for (const tab of ['접수', '취소', '분납실적', '완료실적']) {
  const got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const all = ((got.values || []) as unknown[][]).map((r) => (r || []).map(S));
  const hi = all.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  const h = all[hi];
  const at = (n: string) => h.indexOf(n);
  for (const r of all.slice(hi + 1)) {
    const plate = S(r[at('차량번호')]);
    if (!plate) continue;
    recs.push({
      tab, channel: S(r[at('영업채널')]),
      row: {
        plate, supplier: S(r[at('공급사')]), agent: S(r[at('영업담당자')]), product: S(r[at('상품구분')]),
        term: N(r[at('계약기간')]), rent: N(r[at('렌탈료')]), price: N(r[at('차량가액')]),
        deposit: N(r[at('보증금')]), model: S(r[at('모델명')]), customer: S(r[at('고객명')]),
        payKind: S(r[at('분납여부')]),
        receivedAt: toDate(r[at('접수일')]), deliveredAt: toDate(r[at('인도일')]), clawbackAt: toDate(r[at('환수일')]),
        clawbackAmount: N(r[at('환수금액')]),
        paper: ON(r[at('계약서')]), delivered: !!toDate(r[at('인도일')]),
        cancelled: ON(r[at('계약취소')]), clawback: ON(r[at('환수')]),
        claimWritten: N(r[at('판매수수료')]), payWritten: N(r[at('출고수수료')]),
        supplierRate: N(r[at('공급사수수료율')]), agentRate: N(r[at('에이전시수수료율')]),
      },
    });
  }
}

console.log(`\n${'═'.repeat(64)}`);
console.log(`  ${MONTH} 마감 — 원장 ${recs.length}줄 기준`);
console.log('═'.repeat(64));

// ─────────────────────────────────────────── ① 확정 청구
const fixed = recs.filter((x) => !x.row.cancelled && billingMonth(x.row) === MONTH);
const claw = recs.filter((x) => x.row.clawback && x.row.clawbackAt && iso(x.row.clawbackAt).slice(0, 7) === MONTH);

const byName = (list: Rec[], pick: (x: Rec) => string, amount: (x: Rec) => number) => {
  const m = new Map<string, { n: number; v: number }>();
  for (const x of list) {
    const k = pick(x) || '(미기재)';
    const c = m.get(k) || { n: 0, v: 0 };
    c.n += 1; c.v += amount(x);
    m.set(k, c);
  }
  return [...m].sort((a, b) => b[1].v - a[1].v);
};

const claimOf = (x: Rec) => moneyOf(x.row).claim;
const payOf = (x: Rec) => moneyOf(x.row).pay;
const totClaim = fixed.reduce((s, x) => s + claimOf(x), 0);
const totPay = fixed.reduce((s, x) => s + payOf(x), 0);
const totClaw = claw.reduce((s, x) => s + (x.row.clawbackAmount || 0), 0);

console.log(`\n■ ① 확정 — ${MONTH} 에 청구할 것  ${fixed.length}건`);
console.log(`   청구 ${won(totClaim)}  ·  지급 ${won(totPay)}  ·  수익 ${won(totClaim - totPay)}`);
if (claw.length) console.log(`   환수(−) ${claw.length}건 ${won(totClaw)}  →  **실수령 ${won(totClaim - totClaw)}**`);

console.log('\n   ── 공급사별 청구 (세금계산서를 끊을 곳)');
for (const [name, v] of byName(fixed, (x) => x.row.supplier, claimOf)) {
  const c = claw.filter((x) => x.row.supplier === name);
  const minus = c.reduce((s, x) => s + (x.row.clawbackAmount || 0), 0);
  console.log(`      ${String(v.n).padStart(3)}건  ${won(v.v).padStart(12)}  ${name}${minus ? `   환수 −${won(minus)} (${c.length}건)` : ''}`);
}

console.log('\n   ── 영업채널별 지급 (돈이 나갈 곳)');
for (const [name, v] of byName(fixed, (x) => x.channel, payOf)) {
  console.log(`      ${String(v.n).padStart(3)}건  ${won(v.v).padStart(12)}  ${name}`);
}

// ─────────────────────────────────────────── ② 막힌 것
console.log(`\n■ ② 막힌 것 — 인도는 됐는데 ${MONTH} 청구가 안 서는 줄`);
const zeroClaim = fixed.filter((x) => claimOf(x) === 0);
const noRate = fixed.filter((x) => !x.row.supplierRate && !x.row.claimWritten);
const noAgent = fixed.filter((x) => payOf(x) === 0);
const show = (label: string, list: Rec[], why: string) => {
  console.log(`   ${list.length ? '⛔' : '✓'} ${label} ${list.length}건${list.length ? ` — ${why}` : ''}`);
  for (const x of list.slice(0, 8)) {
    console.log(`        ${x.row.plate.padEnd(11)} ${(x.row.supplier || '').padEnd(12)} ${x.row.product} ${x.row.term}개월 대여료 ${won(x.row.rent)}`);
  }
  if (list.length > 8) console.log(`        … 외 ${list.length - 8}건`);
};
show('청구액이 0', zeroClaim, '요율도 적힌 값도 없다. 이대로 두면 그냥 안 청구된다');
show('공급사 요율 없음', noRate, '요율표에서 못 찾았다');
show('지급액이 0', noAgent, '영업채널에 줄 것이 안 잡힌다');

// ─────────────────────────────────────────── ③ 아직 — 말일까지 인도되면 들어온다
const pending = recs.filter((x) => !x.row.cancelled && !x.row.delivered);
const thisMonthIn = pending.filter((x) => x.row.receivedAt && iso(x.row.receivedAt).slice(0, 7) === MONTH);
console.log(`\n■ ③ 아직 — 인도 전 ${pending.length}건 (이 중 ${MONTH} 접수 ${thisMonthIn.length}건)`);
console.log(`   말일까지 인도되면 ${MONTH} 청구로 들어온다. **「없다」가 아니라 「아직」이다.**`);
for (const x of pending.slice(0, 12)) {
  const would = moneyOf(x.row).claim;
  console.log(`      ${x.row.plate.padEnd(11)} ${(x.row.supplier || '(공급사 미정)').padEnd(12)} 접수 ${iso(x.row.receivedAt) || '—'} ${x.row.paper ? '계약서✓' : '계약서 대기'}${would ? `  인도되면 ${won(would)}` : ''}`);
}
if (pending.length > 12) console.log(`      … 외 ${pending.length - 12}건`);

// ─────────────────────────────────────────── ④ 스타·아이카 — 분납이 끝나야 청구
const onComplete = recs.filter((x) => !x.row.cancelled && claimsOnComplete(x.row));
console.log(`\n■ ④ 분납이 끝나야 청구하는 건 (스타·아이카) ${onComplete.length}건`);
for (const x of onComplete.slice(0, 10)) {
  const last = lastPaymentDate(x.row);
  console.log(`      ${x.row.plate.padEnd(11)} ${(x.row.supplier || '').padEnd(10)} ${roundsOf(x.row.payKind)}회 · 마지막 납입 ${iso(last) || '—'} → 청구월 ${billingMonth(x.row) || '아직'}`);
}
if (onComplete.length > 10) console.log(`      … 외 ${onComplete.length - 10}건`);

// ─────────────────────────────────────────── ⑤ 환수인데 달을 못 정한 것
const floating = recs.filter((x) => { const { unassignedClawback } = billingLines(x.row); return unassignedClawback; });
console.log(`\n■ ⑤ 환수인데 환수일이 없어 «어느 달에 뺄지» 못 정한 줄 ${floating.length}건`);
if (floating.length) {
  const sum = floating.reduce((s, x) => s + (x.row.clawbackAmount || 0), 0);
  console.log(`   ${won(sum)} 이 어느 달에도 안 서 있다. 날짜를 넣어야 마이너스 줄이 선다.`);
  for (const x of floating.slice(0, 10)) console.log(`      ${x.row.plate.padEnd(11)} ${(x.row.supplier || '').padEnd(12)} ${won(x.row.clawbackAmount || 0)}`);
  if (floating.length > 10) console.log(`      … 외 ${floating.length - 10}건`);
}

// ─────────────────────────────────────────── ⑥ 당월 실적(접수 기준)
const got = recs.filter((x) => x.row.receivedAt && iso(x.row.receivedAt).slice(0, 7) === MONTH);
console.log(`\n■ ⑥ ${MONTH} 접수 실적 ${got.length}건 — 인도완료 ${got.filter((x) => x.row.delivered).length} · 취소 ${got.filter((x) => x.row.cancelled).length}`);
for (const [name, v] of byName(got.filter((x) => !x.row.cancelled), (x) => x.row.agent, () => 1)) {
  console.log(`      ${String(v.n).padStart(3)}건  ${name}`);
}

writeFileSync(`tmp/close-${MONTH}.json`, JSON.stringify({
  month: MONTH,
  fixed: fixed.map((x) => ({ ...x.row, channel: x.channel, claim: claimOf(x), pay: payOf(x) })),
  clawback: claw.map((x) => ({ plate: x.row.plate, supplier: x.row.supplier, amount: x.row.clawbackAmount })),
  blocked: { zeroClaim: zeroClaim.length, noRate: noRate.length, noAgent: noAgent.length },
  pending: pending.length,
}, null, 2), 'utf8');
console.log(`\n   자세한 것 tmp/close-${MONTH}.json\n`);
