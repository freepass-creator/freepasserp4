/**
 * **정산서가 마감과 같은 수를 내는가.** 읽기만 한다.
 *
 * ★사장님 2026-08-26 「공급사별 영업채널별 정산서까지 만들어 낼수 있어야해」.
 *   정산서는 «보기 좋은 종이»가 아니라 **나가는 돈**이다. 마감(close-month)과 한 원이라도
 *   다르면 둘 중 하나가 틀린 것이고, 어느 쪽이 틀렸는지는 받는 쪽이 먼저 안다.
 *
 * 그래서 두 가지를 센다 —
 *   ① 공급사별 정산서 합 == 그 달 청구 합
 *   ② 영업채널별 정산서 합 == 그 달 지급 합
 *
 *   npx tsx scripts/check-settlement-invoice.mts 2026-08
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { billingMonth, moneyOf, type SettlementRow } from '../lib/domain/settlement-stage';
import { nameKey } from '../lib/domain/settlement-view';
import { EMPTY_PARTY, buildInvoice } from '../lib/domain/settlement-invoice';

const MONTH = (process.argv[2] || '2026-08').trim();
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const ON = (v: unknown) => /^(TRUE|참|Y|예|1)$/i.test(S(v));
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
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

type Rec = { row: SettlementRow; channel: string };
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
      channel: S(r[at('영업채널')]),
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

const fixed = recs.filter((x) => !x.row.cancelled && billingMonth(x.row) === MONTH);
const claws = recs.filter((x) => x.row.clawback && x.row.clawbackAt && iso(x.row.clawbackAt).slice(0, 7) === MONTH);

console.log(`\n■ ${MONTH} — 원장 ${recs.length}줄 중 청구가 서는 ${fixed.length}건`);

let bad = 0;
for (const axis of ['공급사', '영업채널'] as const) {
  const parties = [...new Set(fixed.map((x) => (axis === '공급사' ? x.row.supplier : x.channel) || '(미기재)'))];
  console.log(`\n■ ${axis}별 ${axis === '공급사' ? '청구서' : '지급명세'} ${parties.length}장`);
  let sheetSum = 0;
  let paperSum = 0;
  for (const party of parties.sort()) {
    const key = nameKey(party);
    const mine = fixed.filter((x) => nameKey((axis === '공급사' ? x.row.supplier : x.channel) || '(미기재)') === key);
    const myClaws = claws.filter((x) => nameKey((axis === '공급사' ? x.row.supplier : x.channel) || '(미기재)') === key);
    const inv = buildInvoice({
      axis, month: MONTH, party,
      issuer: EMPTY_PARTY, receiver: EMPTY_PARTY,
      rows: mine.map((x) => x.row), clawbacks: myClaws.map((x) => x.row),
    });
    // 마감이 세는 방식 — 정산서와 «따로» 계산해서 맞춰 본다
    const direct = mine.reduce((s, x) => s + (axis === '공급사' ? moneyOf(x.row).claim : moneyOf(x.row).pay), 0)
      - myClaws.reduce((s, x) => s + (x.row.clawbackAmount || 0), 0);
    sheetSum += direct;
    paperSum += inv.supply;
    const ok = Math.abs(direct - inv.supply) < 1;
    if (!ok) bad++;
    console.log(`   ${ok ? '✓' : '⛔'} ${String(inv.lines.length).padStart(3)}줄  공급가 ${won(inv.supply).padStart(12)}  합계 ${won(inv.total).padStart(12)}  ${party}${inv.clawback ? `  (환수 −${won(inv.clawback)})` : ''}`);
    if (!ok) console.log(`        따로 센 값 ${won(direct)} 과 다르다`);
  }
  const ok = Math.abs(sheetSum - paperSum) < 1;
  if (!ok) bad++;
  console.log(`   ${ok ? '✓' : '⛔'} 합계 대조 — 따로 센 값 ${won(sheetSum)} · 정산서 합 ${won(paperSum)}`);
}

console.log(`\n${bad === 0 ? '■ 초록 — 정산서가 마감과 같은 수를 낸다.' : `⛔ 빨강 — ${bad}곳이 어긋난다. 보내기 전에 고쳐야 한다.`}\n`);
process.exit(bad === 0 ? 0 : 1);
