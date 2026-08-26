/**
 * **정산서 한 장 — 관리자만.** 읽기만 한다.
 *
 * ★사장님 2026-08-26 「공급사별 영업채널별 정산서까지 만들어 낼수 있어야해」.
 *
 * ★발행자·수신처를 **등록된 회사 정보에서 읽는다.** 지어내지 않는다 —
 *   사업자번호를 지어내면 그게 그대로 세금계산서에 실린다. 없으면 빈칸으로 두고 «비었다»고 말한다.
 * ★우리 법인은 `partners/OP001`(프리패스모빌리티 주식회사)이다.
 * ★거르는 규칙은 여기 있고 **금액 산식은 없다** — 산식은 `settlement-stage.ts` 하나뿐이다.
 *
 *   GET /api/settlement/invoice?month=2026-08&axis=공급사&party=오토플러스
 */
import { NextResponse } from 'next/server';
import { getDatabase } from 'firebase-admin/database';
import { firebaseAdminApp, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { iso, ledgerError, readLedger, sheetsToken } from '@/lib/server/settlement-ledger-read';
import { billingMonth } from '@/lib/domain/settlement-stage';
import { nameKey } from '@/lib/domain/settlement-view';
import { EMPTY_PARTY, buildInvoice, type InvoiceParty } from '@/lib/domain/settlement-invoice';
import { driftOf, invoiceKey, nextInvoiceNo, type IssuedInvoice } from '@/lib/domain/settlement-invoice-code';
import { invoiceDocHtml, invoicePageHtml } from '@/lib/server/settlement-invoice-html';
import { invoiceXlsx, invoiceFileName } from '@/lib/server/settlement-invoice-xlsx';
import { providerBillGate, type Confirmation } from '@/lib/domain/settlement-confirm';
import { newId } from '@/lib/domain/ids';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 우리 법인 — partners 에 들어 있다(실측 2026-08-26). */
const ISSUER_CODE = 'OP001';
/** 발행 기록 — v4 overlay 에만 쓴다. v3 노드는 건드리지 않는다(.cursorrules 4). */
const ISSUED_NODE = 'v4/settlement_invoices';
/** 실적 확인 — 청구 앞에 놓인 문. 여기를 통과해야 공급사에 나간다. */
const CONFIRM_NODE = 'v4/settlement_confirmations';

const S = (v: unknown) => String(v ?? '').trim();

/**
 * 회사 한 곳을 정산서에 실을 모양으로.
 * ⚠ **키 이름이 한 가지가 아니다.** 실측 2026-08-26 — `partners/OP001` 은 `partner_name`·`ceo_name`
 *   을 쓰는데 `name`·`ceo` 만 읽고 있어 대표자가 빈칸으로 나갔다. 빈칸은 조용해서 안 보인다.
 */
const toParty = (raw: unknown, fallbackName = ''): InvoiceParty => {
  const o = (raw || {}) as Record<string, unknown>;
  return {
    name: S(o.name || o.partner_name || o.company_name) || fallbackName,
    bizNo: S(o.business_number || o.business_no || o.biz_no),
    ceo: S(o.ceo || o.ceo_name || o.representative),
    address: S(o.address || o.addr || o.company_address),
    phone: S(o.phone || o.tel),
    bank: S(o.bank_name || o.bank),
    account: S(o.bank_account || o.account_no || o.account),
    holder: S(o.bank_holder || o.account_holder),
  };
};

export async function GET(req: Request) {
  const who = await verifyActiveBearer(req).catch(() => null);
  if (!who) return NextResponse.json({ ok: false, reason: '로그인이 필요합니다.' }, { status: 401 });
  if (who.role !== 'admin') return NextResponse.json({ ok: false, reason: '관리자만 볼 수 있습니다.' }, { status: 403 });

  const url = new URL(req.url);
  const month = S(url.searchParams.get('month'));
  const axis = S(url.searchParams.get('axis')) === '영업채널' ? '영업채널' : '공급사';
  const party = S(url.searchParams.get('party'));
  /**
   * **내려받기 갈래.**
   *
   * ★사장님 2026-08-26 「정산서 다운로드하기랑 엑셀 다운로드 하기 있어야해」.
   * ```
   * (없음)  화면이 쓰는 JSON — 미리보기·게이트·빈칸 안내가 다 들어 있다
   * html    A4 정산서. 브라우저에서 열고 «인쇄 → PDF로 저장» 하면 그게 PDF 다
   * xlsx    상대가 자기 장부에 붙여 넣는 자료
   * ```
   * ★★**PDF 를 서버에서 굽지 않는다.** 그러려면 헤드리스 크롬을 얹어야 하는데,
   *   배포가 무거워지고 한글 폰트가 서버마다 달라 «글자가 깨진 청구서»가 나간다.
   *   브라우저 인쇄가 폰트·여백까지 우리가 맞춰 둔 그대로 나온다.
   * ★★**게이트·발행번호는 세 갈래가 같이 쓴다** — 아래 계산이 끝난 뒤에 갈라진다.
   *   먼저 갈라놓으면 「엑셀로 받으면 미확인 건도 나가는」 구멍이 생긴다.
   */
  const format = S(url.searchParams.get('format')).toLowerCase();
  /** 화면 미리보기 — 번호 없이도 A4 를 본다. 내려받기는 발행된 문서만. */
  const preview = S(url.searchParams.get('preview')) === '1';
  if (format && format !== 'html' && format !== 'xlsx') {
    return NextResponse.json({ ok: false, reason: 'format 은 html 또는 xlsx 입니다.' }, { status: 400 });
  }
  if (!month || !party) return NextResponse.json({ ok: false, reason: '청구월과 상대를 지정해 주세요.' }, { status: 400 });

  const token = await sheetsToken();
  if (!token) return NextResponse.json({ ok: false, reason: ledgerError() || '원장을 못 읽었습니다.' }, { status: 503 });

  const read = await readLedger(token);
  const key = nameKey(party);
  const isParty = (x: (typeof read)[number]) =>
    nameKey(axis === '공급사' ? x.row.supplier : x.extra.channel) === key;

  // 청구 줄 — 그 달에 «청구가 서는» 것만. 취소는 빠진다.
  const rows = read.filter((x) => isParty(x) && !x.row.cancelled && billingMonth(x.row) === month);
  // 환수 줄 — 환수일이 «그 달»에 든 것만. 청구를 고치지 않고 마이너스로 새로 선다.
  const clawbacks = read.filter((x) => isParty(x) && x.row.clawback && x.row.clawbackAt
    && iso(x.row.clawbackAt).slice(0, 7) === month);

  const db = getDatabase(firebaseAdminApp());
  const [issuerSnap, allSnap, allV4Snap] = await Promise.all([
    db.ref(`partners/${ISSUER_CODE}`).get().catch(() => null),
    db.ref('partners').get().catch(() => null),
    db.ref('v4/partners').get().catch(() => null),
  ]);
  const registry = { ...((allV4Snap?.val() || {}) as Record<string, unknown>), ...((allSnap?.val() || {}) as Record<string, unknown>) };
  // 상대 찾기 — 원장 이름이 줄여 적혀 있어 «앞머리가 유일할 때만» 붙인다(scopeRows 와 같은 규칙).
  const cands = Object.values(registry).filter((p) => {
    const k = nameKey(toParty(p).name);
    return !!k && (k === key || k.startsWith(key));
  });
  const receiver = cands.length === 1 ? toParty(cands[0], party) : { ...EMPTY_PARTY, name: party };

  const invoice = buildInvoice({
    axis, month, party,
    issuer: toParty(issuerSnap?.val()),
    receiver,
    rows: rows.map((x) => x.row),
    clawbacks: clawbacks.map((x) => ({ ...x.row, clawbackReason: x.extra.clawbackReason })),
  });

  // ★이미 발행된 문서면 그 번호를 «다시 쓴다». 재인쇄할 때마다 번호가 바뀌면 문서가 아니다.
  const issued = await findIssued(month, axis, party);

  /**
   * ★★**영업자 실적 확인이 먼저다**(사장님 2026-08-26
   *   「영업자한테 실적 먼저 확인하고 그게 ㅇㅋ 되면 공급사에 청구 거기서 한번 걸러지는구조야」).
   *   공급사 청구서는 그 줄들을 판 **영업채널들이 다 확인해야** 나간다.
   *   미확인은 미리보기에서 붉게 보이고, 번호 발행은 POST가 원장을 다시 읽어 서버에서 막는다.
   */
  let gate: string[] = [];
  if (axis === '공급사') {
    const confirms = ((await db.ref(CONFIRM_NODE).get().catch(() => null))?.val() || {}) as Record<string, Confirmation>;
    const ofMonth = Object.values(confirms).filter((c) => c.month === month);
    gate = providerBillGate(rows.map((x) => ({ channel: x.extra.channel, agent: x.row.agent })), ofMonth)
      .map((item) => `${item.channel} (${item.lines}건) — ${item.why}`);
  }

  /**
   * ★내려받기는 **발행된 문서만** 준다.
   *   번호 없는 종이가 밖으로 나가면 나중에 「그건 몇 번 문서였냐」에 답할 수 없다.
   *   미리보기는 화면(JSON)에서 얼마든지 본다.
   */
  if (format) {
    const downloading = !preview;
    if (downloading && !issued) {
      return NextResponse.json(
        { ok: false, reason: '아직 발행 전입니다. 발행하면 문서번호가 붙고 그때 내려받을 수 있습니다.' },
        { status: 409 },
      );
    }
    if (downloading && gate.length) {
      return NextResponse.json(
        { ok: false, reason: `실적 확인이 안 끝났습니다 — ${gate.join(' / ')}` },
        { status: 409 },
      );
    }
    if (format === 'xlsx' && preview) {
      return NextResponse.json({ ok: false, reason: '엑셀은 발행 후 내려받습니다.' }, { status: 400 });
    }
    const stamp = issued ? { invoiceNo: issued.invoiceNo, issuedAt: issued.issuedAt } : undefined;
    const name = invoiceFileName(invoice, format === 'xlsx' ? 'xlsx' : 'html');
    // ★파일 이름이 한글이라 filename* (RFC 5987) 로 준다. filename= 만 주면 «???.xlsx» 가 된다.
    const disp = downloading
      ? `attachment; filename="invoice.${format}"; filename*=UTF-8''${encodeURIComponent(name)}`
      : 'inline';
    if (format === 'xlsx') {
      const buf = invoiceXlsx(invoice, stamp);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': disp,
          'Cache-Control': 'no-store',
        },
      });
    }
    const html = invoicePageHtml(name.replace(/\.html$/, ''), invoiceDocHtml(invoice, stamp));
    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': disp, 'Cache-Control': 'no-store' },
    });
  }

  return NextResponse.json({
    ok: true,
    ...invoice,
    code: issued?.code || '',
    invoiceNo: issued?.invoiceNo || '',
    issuedAt: issued?.issuedAt || 0,
    // 발행 뒤 원장이 바뀌었으면 말한다 — 조용히 다른 금액을 인쇄하면 안 된다.
    driftNote: driftOf(issued, { supply: invoice.supply, vat: invoice.vat, lines: invoice.lines.length }),
    // 실적 확인이 안 끝났으면 종이에 붉게 세운다 — 「받아서 주는」 구조라 먼저 걸러야 한다.
    gate,
    // 상대를 못 특정했으면 말한다 — 조용히 빈 회사로 두면 그대로 인쇄된다.
    receiverNote: cands.length === 1 ? '' : cands.length === 0
      ? `「${party}」로 등록된 회사를 못 찾았습니다. 사업자 정보가 빈 채로 나갑니다.`
      : `「${party}」로 시작하는 회사가 ${cands.length}곳이라 하나로 못 정했습니다.`,
  });
}

/** 발행 기록을 찾는다 — 같은 달·같은 축·같은 상대면 같은 문서다. */
async function findIssued(month: string, axis: string, party: string): Promise<IssuedInvoice | null> {
  const snap = await getDatabase(firebaseAdminApp()).ref(ISSUED_NODE).get().catch(() => null);
  const all = (snap?.val() || {}) as Record<string, IssuedInvoice>;
  const want = invoiceKey(month, axis, party);
  return Object.values(all).find((v) => invoiceKey(v.month, v.axis, v.party) === want) || null;
}

/**
 * **발행 — 번호를 붙인다.** 붙는 순간 그건 나간 문서다.
 *
 * ★사장님 2026-08-26 「정산코드랑 이런거는 신규코드 발행 매뉴얼에 따르고」.
 *   규격(`docs/ERP5_CODE_SYSTEM.md`) 그대로 — 대체키 `stl_` + 사람이 읽는 번호는 별도 필드.
 * ★**두 번 눌러도 번호는 하나다.** 이미 있으면 그것을 돌려준다.
 * ⚠ v4 overlay 에만 쓴다. v3 노드는 건드리지 않는다.
 */
export async function POST(req: Request) {
  const who = await verifyActiveBearer(req).catch(() => null);
  if (!who) return NextResponse.json({ ok: false, reason: '로그인이 필요합니다.' }, { status: 401 });
  if (who.role !== 'admin') return NextResponse.json({ ok: false, reason: '관리자만 발행할 수 있습니다.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as {
    month?: string; axis?: string; party?: string; supply?: number; vat?: number; total?: number; lines?: number;
  };
  const month = S(body.month);
  const axis = S(body.axis) === '영업채널' ? '영업채널' : '공급사';
  const party = S(body.party);
  if (!month || !party) return NextResponse.json({ ok: false, reason: '청구월과 상대를 지정해 주세요.' }, { status: 400 });

  const already = await findIssued(month, axis, party);
  if (already) return NextResponse.json({ ok: true, ...already, reused: true });

  const db = getDatabase(firebaseAdminApp());
  if (axis === '공급사') {
    // UI 경고가 아니라 서버에서 다시 원장을 읽어 막는다. 직접 API 호출로 우회할 수 없다.
    const token = await sheetsToken();
    if (!token) return NextResponse.json({ ok: false, reason: ledgerError() || '원장을 못 읽었습니다.' }, { status: 503 });
    const read = await readLedger(token);
    const partyKey = nameKey(party);
    const rows = read.filter((x) => nameKey(x.row.supplier) === partyKey
      && !x.row.cancelled && billingMonth(x.row) === month);
    const confirms = ((await db.ref(CONFIRM_NODE).get().catch(() => null))?.val() || {}) as Record<string, Confirmation>;
    const gate = providerBillGate(rows.map((x) => ({ channel: x.extra.channel, agent: x.row.agent })),
      Object.values(confirms).filter((item) => item.month === month));
    if (gate.length) {
      return NextResponse.json({
        ok: false,
        reason: `영업채널 실적 확인이 끝나야 발행할 수 있습니다 — ${gate.map((item) => `${item.channel} (${item.lines}건)`).join(' · ')}`,
      }, { status: 409 });
    }
  }
  const snap = await db.ref(ISSUED_NODE).get().catch(() => null);
  const all = (snap?.val() || {}) as Record<string, IssuedInvoice>;
  const rec: IssuedInvoice = {
    code: newId('settlement'),
    invoiceNo: nextInvoiceNo(month, axis, Object.values(all).map((v) => v.invoiceNo)),
    month, axis, party,
    supply: Number(body.supply) || 0,
    vat: Number(body.vat) || 0,
    total: Number(body.total) || 0,
    lines: Number(body.lines) || 0,
    issuedAt: Date.now(),
    issuedBy: who.uid,
  };
  await db.ref(`${ISSUED_NODE}/${rec.code}`).set(rec);
  return NextResponse.json({ ok: true, ...rec, reused: false });
}
