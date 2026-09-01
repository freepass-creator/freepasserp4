/**
 * **ERP 로 옮긴 원장이 시트와 «같은 정산»을 내나.** 읽기만. 아무것도 안 쓴다.
 *
 * ★사장님 2026-08-26 「시트는 데이터 한 번 가져갈 때만, 그 뒤엔 파이어베이스에 기입해서 정산」.
 *
 * ★★★**옮긴 것과 «계산이 맞는 것»은 다른 말이다.**
 *   앞 도구(`migrate-settlement-to-erp`)는 «칸이 같은가»를 봤다. 여기는 «답이 같은가»를 본다.
 *   자리(접수/분납실적/완납실적)·청구월·청구액은 ERP 에 «안 담고 계산»하므로,
 *   그 계산이 시트가 내던 답과 같아야 갈아탈 수 있다.
 *
 * ★비교하는 것 셋
 * ```
 * ① 자리     줄이 어느 탭에 서는가          (stageOf)
 * ② 청구월   그 줄이 몇 월에 청구되는가      (billingMonth)
 * ③ 금액     달마다 청구·지급·수익이 얼마인가 (moneyOf)
 * ```
 *
 * ⚠ 하나라도 갈리면 **시트를 내리지 마라.** 되돌릴 곳이 필요하다.
 *
 *   npx tsx scripts/check-erp-vs-sheet.mts
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { normalizeRecord, type SettlementRecord } from '../lib/domain/settlement-record';
import { billingMonth, bucketOf, moneyOf, type SettlementRow } from '../lib/domain/settlement-stage';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const ON = (v: unknown) => /^(TRUE|true|참|Y|예|1)$/i.test(S(v));
const a1 = (t: string) => `'${t.replace(/'/g, "''")}'`;
const SERIAL0 = Date.UTC(1899, 11, 30);
const D = (v: unknown): Date | null => {
  const t = S(v); if (!t) return null;
  const n = Number(t);
  if (Number.isFinite(n) && n > 20_000 && n < 80_000) {
    const u = new Date(SERIAL0 + Math.round(n) * 86_400_000);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  const x = new Date(t);
  return Number.isNaN(+x) ? null : new Date(x.getFullYear(), x.getMonth(), x.getDate());
};

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) {
  initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
}
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
/** 그 자리 날짜 그대로 `YYYY-MM-DD`. ★UTC 로 돌리지 않는다. */
const ymd = (d: Date | null) => (d
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : '');

const sheet = async (range: string) => {
  const t = (await jwt.getAccessToken()).token;
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`, { headers: { Authorization: `Bearer ${t}` } });
  const x = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${x.slice(0, 200)}`);
  return ((JSON.parse(x).values || []) as unknown[][]).map((v) => (v || []).map(S));
};

/** ERP 기록 → 규칙이 먹는 모양. 날짜 글자를 `Date` 로 되돌린다. */
const rowOf = (r: SettlementRecord): SettlementRow => ({
  plate: r.plate, supplier: r.supplier, agent: r.agent, product: r.product, model: r.model,
  customer: r.customer, term: r.term, rent: r.rent, price: r.price, payKind: r.payKind,
  receivedAt: D(r.receivedAt), deliveredAt: D(r.deliveredAt), clawbackAt: D(r.clawbackAt),
  clawbackAmount: r.clawbackAmount, paper: r.paper, delivered: r.delivered,
  cancelled: r.cancelled, clawback: r.clawback,
  claimWritten: r.claimWritten, payWritten: r.payWritten,
  supplierRate: r.supplierRate, agentRate: r.agentRate,
  deposit: r.deposit, channel: r.channel, paidRounds: r.paidRounds,
} as SettlementRow);

console.log('\n■ ERP 와 시트가 같은 정산을 내나\n');

// ── 시트 쪽 ────────────────────────────────────────────────
const fromSheet = new Map<string, { row: SettlementRow; tab: string }>();
for (const tab of ['접수', '취소', '분납실적', '완납실적']) {
  const all = await sheet(`${a1(tab)}!A1:BZ3000`);
  const hi = all.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  const h = all[hi];
  const at = (n: string) => { const i = h.indexOf(n); return i >= 0 ? i : -1; };
  const g = (r: string[], n: string) => { const i = at(n); return i >= 0 ? S(r[i]) : ''; };
  for (const r of all.slice(hi + 1)) {
    const plate = g(r, '차량번호'); if (!plate) continue;
    const recv = D(g(r, '접수일'));
    // ⚠ `toISOString()` 을 쓰지 않는다 — UTC 로 바꾸는 바람에 한국시간 자정이 «전날»이 된다.
    //   2026-08-26 그래서 431줄 중 428줄이 짝을 못 찾았다(금액은 맞는데 줄이 안 맞았다).
    fromSheet.set(`${plate}|${ymd(recv)}`, {
      tab,
      row: {
        plate, supplier: g(r, '공급사'), agent: g(r, '영업담당자'), product: g(r, '상품구분'),
        model: g(r, '모델명'), customer: g(r, '고객명'),
        term: N(g(r, '계약기간')), rent: N(g(r, '렌탈료')), price: N(g(r, '차량가액')), payKind: g(r, '분납여부'),
        receivedAt: recv, deliveredAt: D(g(r, '인도일')), clawbackAt: D(g(r, '환수일')),
        clawbackAmount: N(g(r, '환수금액')),
        paper: ON(g(r, '계약서')), delivered: !!D(g(r, '인도일')),
        cancelled: ON(g(r, '계약취소')), clawback: ON(g(r, '환수')),
        claimWritten: N(g(r, '판매수수료')), payWritten: N(g(r, '출고수수료')),
        supplierRate: N(g(r, '공급사수수료율')), agentRate: N(g(r, '에이전시수수료율')),
        deposit: N(g(r, '보증금')), channel: g(r, '영업채널'), paidRounds: N(g(r, '납입회차')),
      } as SettlementRow,
    });
  }
}

// ── ERP 쪽 ────────────────────────────────────────────────
const snap = await getDatabase().ref('v4/settlement_rows').get();
const recs = Object.values((snap.val() || {}) as Record<string, SettlementRecord>).map((r) => normalizeRecord(r));
const fromErp = new Map(recs.map((r) => [`${S(r.plate)}|${S(r.receivedAt)}`, rowOf(r)]));

console.log(`   시트 ${fromSheet.size}줄 · ERP ${fromErp.size}줄`);
const onlySheet = [...fromSheet.keys()].filter((k) => !fromErp.has(k));
const onlyErp = [...fromErp.keys()].filter((k) => !fromSheet.has(k));
console.log(`   시트에만 ${onlySheet.length} · ERP 에만 ${onlyErp.length}`);
for (const k of [...onlySheet, ...onlyErp].slice(0, 6)) console.log(`      ${k}`);

// ── ① 자리 · ② 청구월 ─────────────────────────────────────
const now = new Date();
let sameBucket = 0; let sameMonth = 0;
const diffBucket: string[] = []; const diffMonth: string[] = [];
for (const [k, s] of fromSheet) {
  const e = fromErp.get(k); if (!e) continue;
  const [bs, be] = [bucketOf(s.row, now), bucketOf(e, now)];
  if (bs === be) sameBucket++; else diffBucket.push(`${k} — 시트 ${bs} / ERP ${be}`);
  const [ms, me] = [billingMonth(s.row), billingMonth(e)];
  if (ms === me) sameMonth++; else diffMonth.push(`${k} — 시트 ${ms || '없음'} / ERP ${me || '없음'}`);
}
console.log(`\n   ① 자리   같음 ${sameBucket} · 다름 ${diffBucket.length}`);
for (const x of diffBucket.slice(0, 6)) console.log(`      ${x}`);
console.log(`   ② 청구월  같음 ${sameMonth} · 다름 ${diffMonth.length}`);
for (const x of diffMonth.slice(0, 6)) console.log(`      ${x}`);

// ── ③ 달별 금액 ───────────────────────────────────────────
const tally = (rows: SettlementRow[]) => {
  const by = new Map<string, { n: number; claim: number; pay: number }>();
  for (const r of rows) {
    if (r.cancelled) continue;
    const m = billingMonth(r); if (!m) continue;
    const money = moneyOf(r);
    const c = by.get(m) || { n: 0, claim: 0, pay: 0 };
    c.n++; c.claim += money.claim; c.pay += money.pay;
    by.set(m, c);
  }
  return by;
};
const ts = tally([...fromSheet.values()].map((x) => x.row));
const te = tally([...fromErp.values()]);
const months = [...new Set([...ts.keys(), ...te.keys()])].sort().reverse().slice(0, 6);
console.log('\n   ③ 달별 금액');
let moneyBad = 0;
for (const m of months) {
  const a = ts.get(m) || { n: 0, claim: 0, pay: 0 };
  const b = te.get(m) || { n: 0, claim: 0, pay: 0 };
  const ok = a.n === b.n && Math.round(a.claim) === Math.round(b.claim) && Math.round(a.pay) === Math.round(b.pay);
  if (!ok) moneyBad++;
  console.log(`      ${m}  ${ok ? '✓' : '✕'}  시트 ${a.n}건 청구 ${Math.round(a.claim).toLocaleString()} 지급 ${Math.round(a.pay).toLocaleString()}`);
  if (!ok) console.log(`               ERP ${b.n}건 청구 ${Math.round(b.claim).toLocaleString()} 지급 ${Math.round(b.pay).toLocaleString()}`);
}

const fail = onlySheet.length + onlyErp.length + diffBucket.length + diffMonth.length + moneyBad;
console.log(fail
  ? `\n✕ ${fail}군데가 갈립니다 — 시트를 내리지 마세요.\n`
  : '\n○ 자리·청구월·금액이 다 같습니다. ERP 를 정본으로 세울 수 있습니다.\n');
process.exit(fail ? 1 : 0);
