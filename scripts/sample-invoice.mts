/**
 * **정산서 양식 샘플을 파일로 뽑는다.** 읽기만 한다.
 *
 * ★사장님 2026-08-26 「정산서 양식좀 샘플좀 만들어봐」
 *   「공급사는 받는거고 영업자는 지급이잖아 그거 양식 예쁘게 잘 만들어서 줘야하는데」.
 *
 * ★★**두 문서는 방향이 반대라 세 가지가 뒤집힌다** — 화면(`app/settlement/invoice`)과 같은 규칙이다.
 * ```
 *           청구서(공급사)          지급명세서(영업채널)
 * 돈        공급사 ─▶ 우리          우리 ─▶ 영업채널
 * 공급자     우리                   영업채널
 * 계좌      우리 계좌(넣어 주세요)     상대 계좌(보냅니다)
 * ```
 * ⚠ **고객명은 가린다.** 샘플은 돌아다닌다 — 실제 고객 이름이 붙어 다니면 안 된다.
 * ⚠ 파일로만 만든다. 청구서는 회사·계좌가 든 문서라 바깥에 올리지 않는다.
 *
 *   npx tsx scripts/sample-invoice.mts        → tmp/정산서-샘플.html
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { billingMonth, type SettlementRow } from '../lib/domain/settlement-stage';
import { EMPTY_PARTY, buildInvoice, type InvoiceParty } from '../lib/domain/settlement-invoice';
import { invoiceDocHtml, invoicePageHtml } from '../lib/server/settlement-invoice-html';
import { nameKey } from '../lib/domain/settlement-view';

const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '2026-08').trim();
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const ON = (v: unknown) => /^(TRUE|참|Y|예|1)$/i.test(S(v));
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const esc = (v: unknown) => S(v).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] || c);
const SERIAL0 = Date.UTC(1899, 11, 30);
const D = (v: unknown): Date | null => {
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
/** 고객명은 첫 글자만 남긴다 — 샘플이 돌아다녀도 사람이 안 붙어 다니게. */
const mask = (v: string) => (v ? v[0] + '*'.repeat(Math.max(1, v.length - 1)) : '');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const api = async (u: string) => {
  const t = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
  const x = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${x.slice(0, 160)}`);
  return x ? JSON.parse(x) as { values?: unknown[][] } : {};
};

const recs: { r: SettlementRow; ch: string }[] = [];
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
      ch: S(r[at('영업채널')]),
      r: {
        plate, supplier: S(r[at('공급사')]), agent: S(r[at('영업담당자')]), product: S(r[at('상품구분')]),
        model: S(r[at('모델명')]), customer: mask(S(r[at('고객명')])),
        term: N(r[at('계약기간')]), rent: N(r[at('렌탈료')]), price: N(r[at('차량가액')]), payKind: S(r[at('분납여부')]),
        receivedAt: D(r[at('접수일')]), deliveredAt: D(r[at('인도일')]), clawbackAt: D(r[at('환수일')]),
        clawbackAmount: N(r[at('환수금액')]),
        paper: ON(r[at('계약서')]), delivered: !!D(r[at('인도일')]),
        cancelled: ON(r[at('계약취소')]), clawback: ON(r[at('환수')]),
        claimWritten: N(r[at('판매수수료')]), payWritten: N(r[at('출고수수료')]),
        supplierRate: N(r[at('공급사수수료율')]), agentRate: N(r[at('에이전시수수료율')]),
      },
    });
  }
}
const fixed = recs.filter((x) => !x.r.cancelled && billingMonth(x.r) === MONTH);

/** 우리 법인 — 값은 등록에서 온다. **지어내지 않는다**(주소·계좌는 아직 비어 있다). */
const US: InvoiceParty = {
  name: '프리패스모빌리티 주식회사', bizNo: '528-88-02988', ceo: '박영협',
  address: '', phone: '', bank: '', account: '', holder: '',
};

const make = (axis: '공급사' | '영업채널', party: string, receiver: InvoiceParty) => buildInvoice({
  axis, month: MONTH, party, issuer: US, receiver,
  rows: fixed.filter((x) => nameKey(axis === '공급사' ? x.r.supplier : x.ch) === nameKey(party)).map((x) => x.r),
});

// 샘플 상대 — 실제 8월 데이터에서 가장 큰 곳 둘
const claimInv = make('공급사', '손오공', { ...EMPTY_PARTY, name: '주식회사 손오공렌터카' });
const payInv = make('영업채널', '하허호', { ...EMPTY_PARTY, name: '하허호무심사 주식회사' });

const html = invoicePageHtml(
  `정산서 양식 샘플 ${MONTH}`,
  invoiceDocHtml(claimInv) + invoiceDocHtml(payInv),
);

writeFileSync('tmp/정산서-샘플.html', html, 'utf8');
console.log(`\n■ tmp/정산서-샘플.html`);
console.log(`   청구서(손오공)   ${claimInv.lines.length}건  ${won(claimInv.total)}`);
console.log(`   지급명세(하허호)  ${payInv.lines.length}건  ${won(payInv.total)}`);
console.log(`   빈칸 — 청구서 ${claimInv.missing.join(' · ') || '없음'}`);
console.log(`        지급명세 ${payInv.missing.join(' · ') || '없음'}\n`);
