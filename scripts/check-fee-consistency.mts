/**
 * **태윤 매니저 수수료표 ↔ 우리가 청구하는 값의 정합성.** 읽기만.
 *
 * ★사장님 2026-09-01 「태윤이가 만들어놓은 수수료랑 우리가 지금 청구하는거랑 정합성이 맞아야 하고」
 *
 * ★★**정본은 「수수료표」 탭의 «박태윤 입력» 구간(38행~)이다.**
 *   위쪽 「프리패스표준」은 내가 만든 요약이라 뒤졌다 — 실제 약정은 아래에 있다.
 *   ⚠ 2026-09-01 에 위쪽만 보고 「퍼시픽 3.50 인데 실제 3.00 이라 표가 틀렸다」고 했는데,
 *     아래에는 「보증금 5% = 3% / 10% = 4%」로 «둘 다» 적혀 있었다. 표가 아니라 내가 덜 읽은 것이다.
 *
 * ★표에 있는 셈법이 여럿이다 — 요율만이 아니다.
 * ```
 * 요율        차량가액 × r  ·  대여료 × 기간 × r
 * 정액        60만원 · 40만원 · 1,000,000
 * 한달렌탈료   스타 재렌트 — 한달 렌탈료(VAT포함) · 지급은 ×80%
 * 구독료+정액  손오공 구독 — 12개월구독료 100% + 기간별 10~70만
 * 범위        매칭출고 «최대 9%» — 한 값이 아니라 상한이다
 * 조건분기     퍼시픽 — 보증금 5%냐 10%냐로 갈린다
 * ```
 *   ⇒ **기계가 한 값으로 못 내는 칸이 있다.** 그건 「틀렸다」가 아니라 「사람이 정한다」이다.
 *
 *   npx tsx scripts/check-fee-consistency.mts 2026-08
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';

const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '2026-08').trim();
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원₩%]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pc = (n: number) => `${(n * 100).toFixed(2)}%`;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = (await jwt.getAccessToken()).token;

// ── 태윤 표 읽기 (38행~) ──
const fr = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent("'수수료표'!A37:H95")}?valueRenderOption=UNFORMATTED_VALUE`, { headers: { Authorization: `Bearer ${tok}` } });
const ft = (((await fr.json()) as { values?: unknown[][] }).values || []).map((v) => (v || []).map(S));
type TFee = { sups: string[]; product: string; term: string; basis: string; sr: string; ar: string; when: string; note: string };
const tfees: TFee[] = [];
let curSups: string[] = []; let curProduct = '';
for (const x of ft.slice(1)) {
  if (!x.some(Boolean)) continue;
  if (S(x[0])) curSups = S(x[0]).split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
  if (S(x[1])) curProduct = S(x[1]);
  if (!S(x[4]) && !S(x[5])) continue;
  tfees.push({ sups: [...curSups], product: curProduct, term: S(x[2]), basis: S(x[3]), sr: S(x[4]), ar: S(x[5]), when: S(x[6]), note: S(x[7]) });
}
console.log(`\n■ 태윤 매니저 수수료표 ${tfees.length}줄 읽음 · 공급사 ${new Set(tfees.flatMap((f) => f.sups)).size}곳\n`);

/** 그 줄에 맞는 표 줄. 이름은 «앞머리»로 맞춘다 — 원장은 줄여 적고 표는 정식 상호다. */
const head = (s: string) => s.replace(/\s|주식회사|㈜|렌터카|렌트카|모빌리티/g, '');
/** ★「48개월」·「12개월」에서 숫자만 뽑는다. `Number('48개월')` 은 NaN 이라 기간 매칭이 통째로 실패한다. */
const termNo = (s: string) => { const m = /(\d+)/.exec(S(s)); return m ? Number(m[1]) : 0; };
const anyTerm = (s: string) => /무관/.test(S(s)) || !S(s);
const findFee = (sup: string, product: string, term: number, model: string): TFee | undefined => {
  const cand = tfees.filter((f) => f.sups.some((s) => head(s) && (head(sup).startsWith(head(s)) || head(s).startsWith(head(sup)))));
  if (!cand.length) return undefined;
  /**
   * ★원장 말 → 표의 말
   * ```
   * 선출고   → 신차 (기준 「선출고」)
   * 견적출고 → 신차 (기준 「매칭출고」)   ★같은 「신차」인데 «기준»으로 갈린다
   * 구독     → 구독
   * 장기렌트 → 재렌트
   * ```
   */
  const isQuote = /견적출고/.test(product);
  const wantProduct = /선출고|견적출고/.test(product) ? '신차' : /구독/.test(product) ? '구독' : '재렌트';
  const wantBasis = isQuote ? '매칭출고' : /선출고/.test(product) ? '선출고' : '';
  // 전기차 특약이 있으면 그것이 이긴다
  const evc = cand.find((f) => f.product === '전기차' && /EV|아이오닉|모델\s*[3YXS]|테슬라|니로|코나|아이포드/i.test(model));
  if (evc) return evc;
  const byBasis = wantBasis ? cand.filter((f) => f.basis === wantBasis) : cand;
  return byBasis.find((f) => f.product === wantProduct && (anyTerm(f.term) || termNo(f.term) === term))
    || cand.find((f) => f.product === wantProduct && (anyTerm(f.term) || termNo(f.term) === term))
    || cand.find((f) => f.product === wantProduct && anyTerm(f.term));
};

type Row = Record<string, unknown>;
const rows = (Object.values((await db.ref('v4/settlement_rows').get()).val() || {}) as Row[])
  .filter((r) => r.cancelled !== true && S(r.billMonth) === MONTH);
console.log(`■ ${MONTH} 청구 ${rows.length}줄을 표와 맞댄다\n`);

let okN = 0; const judge: string[] = []; const miss: string[] = [];
for (const r of rows) {
  const sup = S(r.supplier); const product = S(r.product); const term = N(r.term); const model = S(r.model);
  const claim = N(r.claimWritten); const pay = N(r.payWritten);
  const f = findFee(sup, product, term, model);
  if (!f) { miss.push(`   ${S(r.plate).padEnd(11)} ${(sup || '(미기재)').padEnd(10)} ${product}${term || ''} — 표에 그 공급사가 없다  청구 ${won(claim)}`); continue; }
  const rate = N(f.sr);
  const numeric = /^[\d.]+$/.test(f.sr.replace(/,/g, ''));
  if (!numeric) { judge.push(`   ${S(r.plate).padEnd(11)} ${sup.padEnd(10)} ${product}${term} — 표가 「${f.sr}」 ⇒ 기계가 한 값으로 못 낸다. 청구 ${won(claim)}`); continue; }
  const base = rate >= 1 ? 0 : (/선출고|견적출고/.test(product) ? N(r.price) : N(r.rent) * term);
  const want = rate >= 1 ? rate : Math.round(base * rate);
  if (Math.abs(claim - want) < 2) { okN += 1; continue; }
  judge.push(`   ${S(r.plate).padEnd(11)} ${sup.padEnd(10)} ${product}${term} ${model.slice(0, 8).padEnd(9)} 청구 ${won(claim).padStart(10)} · 표 ${won(want).padStart(10)} · 차 ${won(claim - want).padStart(10)}  [표 ${f.product}/${f.term || '무관'} ${f.sr}]`);
}
console.log(`   ○ 표대로인 줄 ${okN} · ⚠ 봐야 할 줄 ${judge.length} · ? 표에 공급사 없음 ${miss.length}\n`);
for (const j of judge) console.log(j);
if (miss.length) { console.log(''); for (const m of miss) console.log(m); }

console.log('\n\n■ 표에서 «기계가 한 값으로 못 내는» 칸 — 사람이 정한다');
for (const f of tfees.filter((x) => !/^[\d.,]+$/.test(x.sr))) {
  console.log(`   ${f.sups.join('·').slice(0, 28).padEnd(30)} ${f.product.padEnd(5)} ${(f.term || '무관').padEnd(7)} ${f.basis.padEnd(6)} 「${f.sr}」`);
}
process.exit(0);
