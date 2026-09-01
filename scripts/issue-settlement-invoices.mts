/**
 * **한 달치 정산서를 파일로 뽑는다** — ERP(파이어베이스)에서 바로. 읽기만, 발행 기록은 안 만든다.
 *
 * ★사장님 2026-08-26 「급한건 당월거랑 당장 이번달말일로 정산해서 9월초에 청구할거를 챙기는거」
 *   「공급사 영업채널 청구서가 각각 있음」.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ★★**두 갈래를 따로 뽑는다. 관문이 다르기 때문이다.**
 * ```
 * 지급명세서(영업채널)  우리가 «주는» 쪽 — 관문이 없다. 지금 바로 뽑는다
 * 청구서(공급사)       우리가 «받는» 쪽 — ★영업자 실적 확인이 끝나야 나간다
 * ```
 *   사장님 「받아서 주는 구조이니까 영업자한테 실적 먼저 확인하고 그게 ㅇㅋ 되면 공급사에 청구」.
 *   ⇒ 막힌 청구서도 «미리보기»로는 뽑는다. 다만 파일 이름에 「(확인대기)」를 붙여
 *     실수로 나가지 않게 한다.
 *
 * ★★**문서번호는 안 붙인다.** 번호를 붙이는 건 «발행»이고, 발행은 화면에서 사람이 한다
 *   (`POST /api/settlement/invoice`). 여기서 번호를 찍으면 원장에 없는 문서가 돌아다닌다.
 *
 * ★거래처 신원은 `partner-ci.ts` 정본에서 온다. 모르면 종이에 «모름»으로 찍힌다 — 지어내지 않는다.
 *
 *   npx tsx scripts/issue-settlement-invoices.mts 2026-08
 *   npx tsx scripts/issue-settlement-invoices.mts 2026-08 --only=영업채널
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { normalizeRecord, type SettlementRecord } from '../lib/domain/settlement-record';
import { billingMonth, type SettlementRow } from '../lib/domain/settlement-stage';
import { EMPTY_PARTY, buildInvoice, type InvoiceParty } from '../lib/domain/settlement-invoice';
import { invoiceDocHtml, invoicePageHtml } from '../lib/server/settlement-invoice-html';
import { invoiceXlsx, invoiceFileName } from '../lib/server/settlement-invoice-xlsx';
import { providerBillGate, type Confirmation } from '../lib/domain/settlement-confirm';
import { CORP } from '../lib/domain/corporate-ci';
import { ciOf } from '../lib/domain/partner-ci';
import { nameKey } from '../lib/domain/settlement-view';

const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '').trim();
if (!MONTH) { console.log('\n  달을 주세요 — npx tsx scripts/issue-settlement-invoices.mts 2026-08\n'); process.exit(1); }
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length);
const OUT = `tmp/정산서-${MONTH}`;

const S = (v: unknown) => String(v ?? '').trim();
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const D = (v: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(v)); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) {
  initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
}
const db = getDatabase();

/** 저장 기록 → 규칙이 먹는 줄. */
const asRow = (r: SettlementRecord): SettlementRow => ({
  ...r, receivedAt: D(r.receivedAt), deliveredAt: D(r.deliveredAt), clawbackAt: D(r.clawbackAt),
} as unknown as SettlementRow);

/**
 * 우리 법인 — **계좌는 등록에서 온다. 없으면 비운다.**
 * ⚠ 계좌를 지어내지 않는다. 빈 채로 나가면 종이가 「모름」이라고 말한다.
 */
const partners = {
  ...((await db.ref('v4/partners').get().catch(() => null))?.val() || {}),
  ...((await db.ref('partners').get().catch(() => null))?.val() || {}),
} as Record<string, Record<string, unknown>>;
const us = partners['OP001'] || {};
const US: InvoiceParty = {
  name: CORP.name, bizNo: CORP.bizNo, ceo: CORP.ceo, address: CORP.addr, phone: CORP.phone,
  bank: S(us.bank_name), account: S(us.bank_account), holder: S(us.bank_holder),
};

/** 상대 — CI 정본이 상호·사업자번호·대표를 안다. 계좌는 거래처 등록에서. */
const partyOf = (alias: string): InvoiceParty => {
  const ci = ciOf(alias);
  const p = Object.values(partners).find((x) => nameKey(S(x.partner_name || x.name)) === nameKey(ci?.legal || alias)) || {};
  return {
    ...EMPTY_PARTY,
    name: S(ci?.legal) || alias, bizNo: S(ci?.bizNo), ceo: S(ci?.ceo),
    address: S(ci?.addr), phone: S(ci?.tel),
    /**
     * ★★**정산 계좌만 쓴다.** CI 정본의 `rentAccount`(대여료 전용계좌)를 여기 쓰면 안 된다 —
     *   그건 고객이 대여료를 넣는 정책 칸이고, 우리가 지급하는 곳이 아니다(2026-08-26 착각했다).
     * ⚠ 없으면 비운다. 종이가 「모름」이라고 말하는 게 틀린 계좌보다 낫다.
     */
    ...(S(ci?.payAccount)
      ? { bank: S(ci?.payAccount), account: '', holder: '' }
      : { bank: S(p.bank_name), account: S(p.bank_account), holder: S(p.bank_holder) }),
  };
};

/**
 * ★★★**뽑기 전에 «갈라졌나»부터 본다.**
 *   시트와 ERP 가 둘 다 살아 있어서, 사람이 시트에 적으면 ERP 가 모른다.
 *   실측 2026-08-26: 그렇게 한 건이 빠질 뻔했다(시트 432 · ERP 431).
 *   ⚠ 사람이 기억해서 검사를 돌리길 기대하지 않는다 — 여기서 «자동으로» 막는다.
 */
{
  const r = spawnSync('npx', ['tsx', 'scripts/check-settlement-drift.mts'], { stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.log('\n✕ 시트와 ERP 가 갈렸습니다 — 정산서를 뽑지 않았습니다.');
    console.log('   npx tsx scripts/migrate-settlement-to-erp.mts --apply  로 맞춘 뒤 다시 부르세요.\n');
    process.exit(1);
  }
}

const rows = Object.values((await db.ref('v4/settlement_rows').get()).val() || {}).map((r) => normalizeRecord(r as SettlementRecord));
const live = rows.filter((r) => !r.cancelled && billingMonth(asRow(r)) === MONTH);
const backs = rows.filter((r) => r.clawback && S(r.clawbackAt).slice(0, 7) === MONTH);
const confs = (Object.values((await db.ref('v4/settlement_confirmations').get().catch(() => null))?.val() || {}) as Confirmation[])
  .filter((c) => S(c.month) === MONTH);

console.log(`\n■ ${MONTH} 정산서 — ERP 에서 · 청구 대상 ${live.length}건 · 환수 ${backs.length}건\n`);
mkdirSync(OUT, { recursive: true });

const made: string[] = [];
const missing = new Set<string>();
/**
 * ★**이 달 장부** — 받을 돈 · 줄 돈 · 남는 것.
 *   장을 15장 뽑아 놓고 «이 달에 얼마 남나»를 어디서도 못 봤다.
 *   장부는 한 줄이면 되는데 그 한 줄이 없어서 매번 계산기를 두드렸다.
 */
const book = { 받을: 0, 줄: 0, 막힌장: 0, 막힌돈: 0 };

for (const axis of (['영업채널', '공급사'] as const)) {
  if (ONLY && ONLY !== axis) continue;
  const pick = (r: SettlementRecord) => (axis === '공급사' ? S(r.supplier) : S(r.channel));
  const parties = [...new Set(live.map(pick).filter(Boolean))]
    .sort((a, b) => live.filter((r) => pick(r) === b).length - live.filter((r) => pick(r) === a).length);

  console.log(`■ ${axis === '공급사' ? '청구서(공급사)' : '지급명세서(영업채널)'} ${parties.length}장`);
  for (const party of parties) {
    const mine = live.filter((r) => pick(r) === party);
    const inv = buildInvoice({
      axis, month: MONTH, party, issuer: US, receiver: partyOf(party),
      rows: mine.map(asRow),
      clawbacks: backs.filter((r) => pick(r) === party).map((r) => ({ ...asRow(r), clawbackReason: r.clawbackReason })),
    });

    // ★공급사 청구서는 영업자 실적 확인이 끝나야 나간다.
    const gate = axis === '공급사'
      // ★코드를 같이 넘긴다 — 관문은 코드가 있으면 코드로 붙는다(`lib/domain/sales-channel.ts`).
      ? providerBillGate(mine.map((r) => ({ channel: r.channel, channelCode: r.channelCode, agent: r.agent })), confs)
      : [];

    const tag = gate.length ? ' (확인대기)' : '';
    const base = `${OUT}/${invoiceFileName(inv, 'html').replace(/\.html$/, '')}${tag}`;
    writeFileSync(`${base}.html`, invoicePageHtml(`${MONTH} ${inv.kind} ${party}`, invoiceDocHtml(inv)), 'utf8');
    writeFileSync(`${base}.xlsx`, invoiceXlsx(inv));
    made.push(`${base}.html`);
    for (const m of inv.missing) missing.add(`${party} — ${m}`);

    if (axis === '공급사') { book.받을 += inv.total; if (gate.length) { book.막힌장++; book.막힌돈 += inv.total; } }
    else book.줄 += inv.total;

    console.log(`   ${gate.length ? '⛔' : '○'} ${party.padEnd(10)} ${String(inv.lines.length).padStart(2)}줄 ${won(inv.total).padStart(12)}원  ${inv.receiver.name}${tag}`);
    for (const g of gate) console.log(`        ${g.channel} (${g.lines}건) — ${g.why}`);
  }
  console.log();
}

const pad = (n: number) => won(n).padStart(14);
console.log(`■ ${MONTH} 장부`);
console.log(`   받을 돈  공급사 청구 ${pad(book.받을)}`);
console.log(`   줄 돈   영업채널 지급 ${pad(book.줄)}`);
console.log(`   ${'─'.repeat(34)}`);
console.log(`   남는 것            ${pad(book.받을 - book.줄)}   ${
  book.받을 ? ((book.받을 - book.줄) / book.받을 * 100).toFixed(1) : '0'
}%`);
if (book.막힌장) {
  console.log(`   ⛔ 그 중 ${book.막힌장}장 ${won(book.막힌돈)}원은 «아직 못 보냅니다»`);
  console.log(`      영업자 실적 확인이 끝나야 나갑니다.`);
}
console.log();

console.log(`■ ${made.length * 2}개 파일 → ${OUT}/`);
// ★PDF 는 «나가는 종이»다. 여기서 같이 굽는다 — 따로 돌리게 두면 HTML 만 고치고 PDF 는 옛것이 남는다.
//   ⚠ 브라우저를 띄우므로 몇 초 걸린다. 안 굽고 싶으면 --no-pdf.
if (!process.argv.includes('--no-pdf')) {
  const r = spawnSync('node', ['scripts/invoice-pdf.mjs', OUT], { stdio: 'inherit', shell: false });
  if (r.status) console.log('⚠ PDF 굽기가 실패했습니다 — HTML 은 그대로 있습니다.');
}
if (missing.size) {
  console.log(`\n★발송 전 채워야 할 것 ${missing.size}가지`);
  for (const m of [...missing].sort()) console.log(`   ${m}`);
}
console.log('\n⚠ 문서번호는 안 붙었습니다 — 발행은 화면에서 사람이 합니다(그때 번호가 박힙니다).\n');
process.exit(0);
