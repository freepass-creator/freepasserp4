/**
 * **접수 → 실적 → 청구가 «한 줄»로 이어지는가.** 읽기만 한다.
 *
 * ★사장님 2026-08-26 「접수된거를 계속 물고 가야지 / 접수된거에서 실적이 되고 그 실적이 청구가 되는건데」.
 *   한 계약은 한 줄이고, 그 줄이 길을 따라간다. 중간에 끊기는 줄이 있으면 여기서 드러난다.
 *
 * 세 가지를 센다 —
 *   ① 어디까지 왔나 — 계약 전체를 걸음별로
 *   ② **길이 끊긴 줄** — 앞 걸음을 안 밟고 뒤 걸음에 가 있는 것(인도는 됐는데 접수일이 없다 등)
 *   ③ 다음에 할 일 — 무엇이 몇 건 밀려 있나
 *
 *   npx tsx scripts/check-settlement-timeline.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { billingMonth, nextInstalment, type SettlementRow } from '../lib/domain/settlement-stage';
import { nextTodoOf, reachedOf, timelineOf } from '../lib/domain/settlement-timeline';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const ON = (v: unknown) => /^(TRUE|참|Y|예|1)$/i.test(S(v));
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
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
const api = async (u: string) => {
  const t = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
  const x = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${x.slice(0, 160)}`);
  return x ? JSON.parse(x) as { values?: unknown[][] } : {};
};

const rows: SettlementRow[] = [];
for (const tab of ['접수', '취소', '분납실적', '완납실적']) {
  const got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const all = ((got.values || []) as unknown[][]).map((r) => (r || []).map(S));
  const hi = all.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  const h = all[hi];
  const at = (n: string) => h.indexOf(n);
  for (const r of all.slice(hi + 1)) {
    const plate = S(r[at('차량번호')]);
    if (!plate) continue;
    rows.push({
      plate, supplier: S(r[at('공급사')]), agent: S(r[at('영업담당자')]), product: S(r[at('상품구분')]),
      term: N(r[at('계약기간')]), rent: N(r[at('렌탈료')]), price: N(r[at('차량가액')]), payKind: S(r[at('분납여부')]),
      receivedAt: toDate(r[at('접수일')]), deliveredAt: toDate(r[at('인도일')]), clawbackAt: toDate(r[at('환수일')]),
      clawbackAmount: N(r[at('환수금액')]),
      paper: ON(r[at('계약서')]), delivered: !!toDate(r[at('인도일')]),
      cancelled: ON(r[at('계약취소')]), clawback: ON(r[at('환수')]),
      claimWritten: N(r[at('판매수수료')]), payWritten: N(r[at('출고수수료')]),
      supplierRate: N(r[at('공급사수수료율')]), agentRate: N(r[at('에이전시수수료율')]),
    });
  }
}

/** 청구서 발행 기록은 아직 안 보고, 「청구가 설 수 있나」까지만 본다. */
const lineOf = (r: SettlementRow) => timelineOf({
  receivedAt: iso(r.receivedAt), paper: !!r.paper,
  delivered: !!r.delivered, deliveredAt: iso(r.deliveredAt),
  cancelled: !!r.cancelled, clawback: !!r.clawback, clawbackAt: iso(r.clawbackAt),
  billingMonth: billingMonth(r), payKind: r.payKind, nextRound: iso(nextInstalment(r)),
  invoiced: false,
});

console.log(`\n■ 원장 ${rows.length}줄 — 한 계약이 한 줄로 어디까지 왔나`);
const reach = new Map<string, number>();
for (const r of rows) {
  const k = reachedOf(lineOf(r)).key;
  reach.set(k, (reach.get(k) || 0) + 1);
}
for (const [k, n] of [...reach].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(4)}건  ${k} 까지`);
}

// ② 길이 끊긴 줄 — 앞을 안 밟고 뒤에 가 있다
console.log('\n■ 길이 끊긴 줄 — 앞 걸음을 안 밟고 뒤에 가 있는 것');
const broken: { why: string; list: SettlementRow[] }[] = [
  { why: '인도는 됐는데 «접수일»이 없다 — 실적을 어느 달로 세야 할지 모른다', list: rows.filter((r) => r.delivered && !r.receivedAt) },
  { why: '인도는 됐는데 «계약서»가 안 켜져 있다 — 서류 없이 인도된 것으로 보인다', list: rows.filter((r) => r.delivered && !r.paper && !r.cancelled) },
  { why: '환수인데 «인도»가 안 돼 있다 — 청구된 적이 없는데 환수다', list: rows.filter((r) => r.clawback && !r.delivered) },
  { why: '취소인데 «인도»가 돼 있다 — 인도하고 취소면 환수여야 한다', list: rows.filter((r) => r.cancelled && r.delivered && !r.clawback) },
];
let bad = 0;
for (const b of broken) {
  console.log(`   ${b.list.length ? '⛔' : '✓'} ${b.list.length}건 — ${b.why}`);
  bad += b.list.length;
  for (const r of b.list.slice(0, 6)) {
    console.log(`        ${r.plate.padEnd(11)} ${(r.supplier || '').padEnd(10)} 접수 ${iso(r.receivedAt) || '—'} 인도 ${iso(r.deliveredAt) || '—'}`);
  }
  if (b.list.length > 6) console.log(`        … 외 ${b.list.length - 6}건`);
}

// ③ 다음에 할 일
console.log('\n■ 다음에 할 일 — 무엇이 밀려 있나');
const todo = new Map<string, number>();
for (const r of rows) {
  const t = nextTodoOf(lineOf(r));
  if (t) todo.set(t, (todo.get(t) || 0) + 1);
}
for (const [t, n] of [...todo].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}건  ${t}`);

console.log(`\n${bad === 0 ? '■ 초록 — 끊긴 줄이 없다. 접수가 실적으로, 실적이 청구로 이어진다.' : `⚠ 끊긴 줄 ${bad}건 — 사람이 봐야 한다.`}\n`);
