/**
 * **정산과 통장이 맞는가.** 읽기만 한다 — 아무것도 쓰지 않는다.
 *
 * ★사장님 2026-08-26 「가능한 통장입출금내역과 정산이 다 맞아야함」.
 *   정산서는 «우리가 그런 줄 아는 것»이고, 통장은 «실제로 일어난 것»이다.
 *   둘이 다르면 통장이 맞다. 정산서를 고쳐야지 통장을 고칠 수는 없다.
 *
 * 어디를 보나 —
 * ```
 * 정산  정산원장(구글시트) → settlement-stage 규칙으로 그 달 청구·지급
 * 통장  프리패스_자금일보 / 2206계좌 (140-014-462206)  ★계정과목·업체명이 이미 붙어 있다
 * ```
 * 자금 쪽 정본과 함정은 `C:\dev\aiops/docs/자금대사매뉴얼.md` 에 있다. **거기가 먼저다.**
 *
 * ★★**받는 달과 청구하는 달이 다르다.** 8월분은 9월 초에 청구하고 9월 중에 들어온다.
 *   그래서 청구월 그 달만 보면 «하나도 안 들어왔다»가 되고, 그건 사실이 아니라 착시다.
 *   창(window)을 열어 청구월부터 몇 달 뒤까지 본다.
 * ⚠ 「없다」와 「아직」을 가른다. 안 들어온 것과 못 찾은 것은 다르다.
 * ⚠ 통장 한 줄이 여러 달 청구를 묶어 들어오기도 한다 — 그래서 «줄 대 줄»이 아니라
 *   **상대별 합계**로 맞댄다. 줄로 맞추려 들면 못 맞추고, 못 맞춘 것을 틀린 것으로 오해한다.
 *
 *   npx tsx scripts/reconcile-settlement-bank.mts 2026-07
 *   npx tsx scripts/reconcile-settlement-bank.mts 2026-08 --창=3
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { billingMonth, moneyOf, type SettlementRow } from '../lib/domain/settlement-stage';
import { isSameCompany, nameKey } from '../lib/domain/settlement-view';

/** 프리패스 자금일보 — aiops `lib/ids.mjs` 의 「프리패스_자금일보」. */
const CASHBOOK = '1BIs3AGsODGj5OxBuPDYj6KJs3T-budcVONl1TO85RwE';
const ACCOUNT_TAB = '2206계좌';

const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '2026-08').trim();
const WINDOW = Number((process.argv.find((a) => a.startsWith('--창=')) || '--창=2').split('=')[1]) || 2;

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
  const x = new Date(t.replace(/\./g, '-'));
  return Number.isNaN(+x) ? null : x;
};
const p2 = (n: number) => String(n).padStart(2, '0');
const ym = (d: Date | null) => (d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}` : '');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const api = async (u: string) => {
  const t = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
  const x = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${x.slice(0, 160)}`);
  return x ? JSON.parse(x) as { values?: unknown[][] } : {};
};

// ─────────────────────────────────────────── 정산 쪽
type Rec = { row: SettlementRow; channel: string };
const recs: Rec[] = [];
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
    recs.push({
      channel: S(r[at('영업채널')]),
      row: {
        plate, supplier: S(r[at('공급사')]), agent: S(r[at('영업담당자')]), product: S(r[at('상품구분')]),
        term: N(r[at('계약기간')]), rent: N(r[at('렌탈료')]), price: N(r[at('차량가액')]),
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
/**
 * ★**누적으로 맞댄다.** 통장 한 줄이 여러 달 청구를 묶어 들어온다 —
 *   한 달만 떼어 통장 석 달치와 맞대면 늘 «더 들어온» 것으로 보인다(실측 2026-08-26).
 *   「다 맞아야 한다」는 물음의 답은 **그 달까지의 누계**끼리 맞대는 것이다.
 *   `--당월` 을 주면 그 달만 본다(방향만 볼 때).
 */
const ONLY = process.argv.includes('--당월');
const fixed = recs.filter((x) => {
  if (x.row.cancelled) return false;
  const m = billingMonth(x.row);
  return !!m && (ONLY ? m === MONTH : m <= MONTH);
});

/** 통장에 찍히는 것은 **부가세 포함 합계**다. 공급가로 맞대면 10% 가 늘 어긋난다. */
const sumBy = (pick: (x: Rec) => string, amount: (x: Rec) => number) => {
  const m = new Map<string, { n: number; v: number }>();
  for (const x of fixed) {
    const k = pick(x) || '(미기재)';
    const c = m.get(k) || { n: 0, v: 0 };
    c.n += 1; c.v += amount(x);
    m.set(k, c);
  }
  return m;
};
const claimBy = sumBy((x) => x.row.supplier, (x) => moneyOf(x.row).claimTotal);
const payBy = sumBy((x) => x.channel, (x) => moneyOf(x.row).payTotal);

// ─────────────────────────────────────────── 통장 쪽
const bank = await api(`https://sheets.googleapis.com/v4/spreadsheets/${CASHBOOK}/values/${encodeURIComponent(`${a1(ACCOUNT_TAB)}!A1:Z9000`)}`);
const brows = ((bank.values || []) as unknown[][]).map((r) => (r || []).map(S));
const bhi = brows.findIndex((r) => r.includes('입금액') && r.includes('출금액'));
if (bhi < 0) { console.log('⛔ 2206계좌 탭 머리글을 못 찾았다'); process.exit(1); }
const bh = brows[bhi];
const bat = (n: string) => bh.indexOf(n);

/** 청구월부터 창(개월)만큼 본다 — 8월분은 9월에 들어온다. */
const inWindow = (m: string) => {
  if (!m) return false;
  const [y0, m0] = MONTH.split('-').map(Number);
  const [y1, m1] = m.split('-').map(Number);
  const d = (y1 - y0) * 12 + (m1 - m0);
  // 누적이면 «그 뒤 창까지» 전부 — 옛 청구가 늦게 들어온 것도 담아야 맞는다.
  return ONLY ? (d >= 0 && d <= WINDOW) : d <= WINDOW;
};

type Move = { at: string; party: string; in: number; out: number; acct: string; memo: string };
const moves: Move[] = [];
for (const r of brows.slice(bhi + 1)) {
  const at = toDate(r[bat('거래일시')] || r[bat('일자(보조)')]);
  const m = ym(at);
  if (!inWindow(m)) continue;
  moves.push({
    at: S(r[bat('거래일시')]).slice(0, 10),
    party: S(r[bat('업체명')]) || S(r[bat('내용')]),
    in: N(r[bat('입금액')]), out: N(r[bat('출금액')]),
    acct: S(r[bat('계정과목')]), memo: S(r[bat('내용')]),
  });
}

const bankBy = (dir: 'in' | 'out') => {
  const m = new Map<string, { n: number; v: number }>();
  for (const mv of moves) {
    const v = dir === 'in' ? mv.in : mv.out;
    if (!v) continue;
    const k = nameKey(mv.party);
    if (!k) continue;
    const c = m.get(k) || { n: 0, v: 0 };
    c.n += 1; c.v += v;
    m.set(k, c);
  }
  return m;
};
const inBy = bankBy('in');
const outBy = bankBy('out');

// ─────────────────────────────────────────── 맞대 본다
const months = [MONTH, ...Array.from({ length: WINDOW }, (_, i) => {
  const [y, m] = MONTH.split('-').map(Number);
  const d = new Date(y, m - 1 + i + 1, 1);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
})];
console.log(`\n${'═'.repeat(70)}`);
console.log(`  ${MONTH} 정산 ↔ 통장 대사   (통장은 ${months.join(' · ')} 를 본다)`);
console.log(`  통장 ${ACCOUNT_TAB} · 창 안의 거래 ${moves.length}줄`);
console.log('═'.repeat(70));

/**
 * ★**통장은 정식 상호, 원장은 줄임말이다**(실측 2026-08-26) —
 *   통장 「웰릭스모빌리티」·「하허호무심사」·「손오공렌터카」 ↔ 원장 「웰릭스」·「하허호」·「손오공」.
 *   그대로 맞대면 다 «안 들어옴»으로 보인다. 실제로는 들어와 있었다.
 *
 * ★★**여기서는 앞머리가 겹쳐도 합친다 — 대사는 권한이 아니다.**
 *   화면·권한(`scopeRows`)은 «유일할 때만» 붙인다. 잘못 붙으면 남의 계약이 보이니까.
 *   대사는 반대다. 안 붙이면 «안 들어왔다»는 거짓 경보가 나고, 그 경보가 진짜 구멍을 덮는다.
 *   대신 **무엇을 합쳤는지 이름을 밝힌다** — 사람이 보고 아니라고 할 수 있어야 한다.
 */
const findBank = (ledgerName: string, got: Map<string, { n: number; v: number }>) => {
  const mine = nameKey(ledgerName);
  const hits = [...got].filter(([k]) => k === mine || k.startsWith(mine));
  return {
    hit: hits.reduce((a, [, v]) => ({ n: a.n + v.n, v: a.v + v.v }), { n: 0, v: 0 }),
    via: hits.map(([k]) => k),
  };
};

const table = (title: string, want: Map<string, { n: number; v: number }>, got: Map<string, { n: number; v: number }>, dirLabel: string) => {
  console.log(`\n■ ${title}`);
  let wSum = 0; let gSum = 0; let miss = 0;
  const names = [...want.keys()].sort();
  const used = new Set<string>();
  for (const name of names) {
    const w = want.get(name)!;
    const found = findBank(name, got);
    const g = found.hit;
    for (const v of found.via) used.add(v);
    wSum += w.v; gSum += g.v;
    const diff = g.v - w.v;
    const mark = g.v === 0 ? '·' : Math.abs(diff) < 10 ? '✓' : '⛔';
    if (mark !== '✓') miss++;
    const via = found.via.length && !(found.via.length === 1 && found.via[0] === nameKey(name))
      ? `  [통장 이름 ${found.via.join(', ')}]` : '';
    console.log(`   ${mark} ${name.padEnd(12)} 정산 ${won(w.v).padStart(13)} (${String(w.n).padStart(3)}건)   ${dirLabel} ${won(g.v).padStart(13)} (${String(g.n).padStart(3)}건)${g.v === 0 ? '   ← 아직 없음' : Math.abs(diff) >= 10 ? `   차이 ${diff > 0 ? '+' : ''}${won(diff)}` : ''}${via}`);
  }
  console.log(`   ── 합계  정산 ${won(wSum)}   ${dirLabel} ${won(gSum)}   차이 ${won(gSum - wSum)}`);
  return { wSum, gSum, miss, names: used };
};

const c = table('공급사에게 «받을» 것 ↔ 통장 입금 (부가세 포함)', claimBy, inBy, '입금');
const p = table('영업채널에 «줄» 것 ↔ 통장 출금 (부가세 포함)', payBy, outBy, '출금');

// 통장엔 있는데 정산엔 없는 상대 — 여기 큰 게 있으면 정산이 빠뜨린 것이다
const strayIn = [...inBy].filter(([k]) => !c.names.has(k)).sort((a, b) => b[1].v - a[1].v);
const strayOut = [...outBy].filter(([k]) => !p.names.has(k)).sort((a, b) => b[1].v - a[1].v);
const show = (title: string, list: [string, { n: number; v: number }][]) => {
  console.log(`\n■ ${title} ${list.length}곳`);
  for (const [k, v] of list.slice(0, 12)) {
    const real = moves.find((m) => nameKey(m.party) === k);
    console.log(`      ${won(v.v).padStart(12)} (${String(v.n).padStart(2)}건)  ${S(real?.party).padEnd(16)} ${S(real?.acct)}`);
  }
  if (list.length > 12) console.log(`      … 외 ${list.length - 12}곳`);
};
show('통장에는 있는데 이 달 정산에는 없는 «입금»처', strayIn);
show('통장에는 있는데 이 달 정산에는 없는 «출금»처', strayOut);

console.log('\n■ 읽는 법');
console.log('   ·  = 아직 안 들어옴/안 나감. 「없다」가 아니라 「아직」이다 — 청구서를 이제 보낸다.');
console.log('   ⛔ = 금액이 다르다. **통장이 맞다.** 정산 쪽을 먼저 의심한다.');
console.log('   위 «없는 입금/출금처»에 정산금 계정이 크게 잡혀 있으면, 그건 정산이 빠뜨린 것이다.');
console.log(`\n   자금 쪽 정본과 함정은 C:\\dev\\aiops/docs/자금대사매뉴얼.md 에 있다.\n`);
