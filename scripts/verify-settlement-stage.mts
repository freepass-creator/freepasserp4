/**
 * **`settlement-stage.ts` 가 시트 결과를 그대로 재현하는지 본다.** 읽기만 한다.
 *
 * ★사장님 2026-08-25 「구글시트 취지를 반영해서 구현해줘봐」.
 *   옮겨 놓고 «맞겠지» 하면 안 된다 — 시트에서 굴려 확인된 수를 **코드가 다시 내는지** 세어 본다.
 *   여기가 초록이어야 ERP 화면을 그 위에 얹을 수 있다.
 *
 *   npx tsx scripts/verify-settlement-stage.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { billingLines, billingMonth, moneyOf, stageOf, type SettlementRow, type Stage } from '../lib/domain/settlement-stage';

const TABS: Stage[] = ['접수', '취소', '분납실적', '완납실적'];
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const ON = (v: unknown) => /^(TRUE|참|Y|예|1)$/i.test(S(v));
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const SERIAL0 = Date.UTC(1899, 11, 30);
const d = (v: string) => {
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

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const api = async (u: string): Promise<any> => {
  const tok = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
  const x = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${x.slice(0, 160)}`);
  return x ? JSON.parse(x) : {};
};

const rows: { row: SettlementRow; sheetStage: Stage }[] = [];
for (const tab of TABS) {
  const got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const all = ((got?.values || []) as unknown[][]).map((r) => (r || []).map(S));
  const hi = all.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  const h = all[hi];
  const at = (n: string) => h.indexOf(n);
  for (const r of all.slice(hi + 1)) {
    const plate = S(r[at('차량번호')]);
    if (!plate) continue;
    rows.push({
      sheetStage: tab,
      row: {
        plate, supplier: S(r[at('공급사')]), agent: S(r[at('영업담당자')]), product: S(r[at('상품구분')]),
        term: N(r[at('계약기간')]), rent: N(r[at('렌탈료')]), price: N(r[at('차량가액')]), payKind: S(r[at('분납여부')]),
        receivedAt: d(r[at('접수일')]), deliveredAt: d(r[at('인도일')]), clawbackAt: d(r[at('환수일')]),
        clawbackAmount: N(r[at('환수금액')]),
        paper: ON(r[at('계약서')]), delivered: !!d(r[at('인도일')]), cancelled: ON(r[at('계약취소')]), clawback: ON(r[at('환수')]),
        claimWritten: N(r[at('판매수수료')]), payWritten: N(r[at('출고수수료')]),
        supplierRate: N(r[at('공급사수수료율')]), agentRate: N(r[at('에이전시수수료율')]),
      },
    });
  }
}

console.log(`\n■ 원장 ${rows.length}줄을 코드로 다시 가른다\n`);
const mine = new Map<Stage, number>(); const sheet = new Map<Stage, number>();
/**
 * ★**「넘어갈 때가 된 것」과 「규칙이 갈린 것」은 다르다.**
 *   분납실적 → 완납실적 은 분납 만기가 지나 «시트를 다시 굴리면 되는» 상태다. 정상이다.
 *   그 밖의 어긋남만 빨강이다 — 둘을 같이 빨강으로 두면 사람이 빨강을 무시하게 된다(2026-08-26).
 */
const ripe: string[] = [];
const broken: string[] = [];
for (const { row, sheetStage } of rows) {
  const s = stageOf(row);
  mine.set(s, (mine.get(s) || 0) + 1);
  sheet.set(sheetStage, (sheet.get(sheetStage) || 0) + 1);
  if (s === sheetStage) continue;
  const line = `${row.plate.padEnd(11)} 시트 ${sheetStage} → 코드 ${s}`;
  (sheetStage === '분납실적' && s === '완납실적' ? ripe : broken).push(line);
}
console.log(`   ${'자리'.padEnd(8)}${'시트'.padStart(6)}${'코드'.padStart(6)}`);
for (const t of TABS) console.log(`   ${t.padEnd(8)}${String(sheet.get(t) || 0).padStart(6)}${String(mine.get(t) || 0).padStart(6)}${(sheet.get(t) || 0) === (mine.get(t) || 0) ? '  ✓' : '  ⛔'}`);
if (ripe.length) {
  console.log(`\n   · 넘어갈 때가 된 줄 ${ripe.length} — 분납 만기가 지났다. 시트를 다시 굴리면 제자리로 간다`);
  for (const w of ripe.slice(0, 8)) console.log(`      ${w}`);
  if (ripe.length > 8) console.log(`      … 외 ${ripe.length - 8}줄`);
}
if (broken.length) {
  console.log(`\n   ⛔ 규칙이 갈린 줄 ${broken.length}`);
  for (const w of broken.slice(0, 12)) console.log(`      ${w}`);
  if (broken.length > 12) console.log(`      … 외 ${broken.length - 12}줄`);
}

// ── 청구 — 월별 합계가 시트와 같은가
const FROM = '2026-08';
const byMonth = new Map<string, { n: number; claim: number; pay: number }>();
let unassigned = 0;
for (const { row } of rows) {
  const { lines, unassignedClawback } = billingLines(row);
  if (unassignedClawback) unassigned++;
  const m = billingMonth(row);
  if (!m || m < FROM || row.cancelled) continue;
  const money = moneyOf(row);
  const c = byMonth.get(m) || { n: 0, claim: 0, pay: 0 };
  c.n++; c.claim += money.claim; c.pay += money.pay;
  byMonth.set(m, c);
  void lines;
}
console.log(`\n■ 청구 — ${FROM} 부터`);
const won = (n: number) => n.toLocaleString('ko-KR');
for (const [m, c] of [...byMonth].sort().reverse()) {
  console.log(`   ${m}  ${String(c.n).padStart(3)}건  청구 ${won(c.claim).padStart(12)}  지급 ${won(c.pay).padStart(12)}  수익 ${won(c.claim - c.pay).padStart(11)}`);
}
if (unassigned) console.log(`   ⚠ 환수인데 환수일이 없어 달을 못 정한 줄 ${unassigned}`);

const ok = broken.length === 0;
console.log(`\n${ok
  ? (ripe.length
    ? `■ 초록 — 규칙은 안 갈렸다. 다만 ${ripe.length}줄이 완납실적으로 넘어갈 때가 됐다(시트를 굴리면 제자리).`
    : '■ 초록 — 코드가 시트와 같은 수를 낸다. ERP 를 이 위에 얹어도 된다.')
  : '⛔ 빨강 — 규칙이 갈렸다. 고치기 전에는 ERP 에 얹지 마라.'}\n`);
process.exit(ok ? 0 : 1);
