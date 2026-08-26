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
import { canBill, type Confirmation } from '@/lib/domain/settlement-confirm';
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
   *   공급사 청구서는 그 줄들을 판 **영업담당자들이 다 확인해야** 나간다.
   *   ⚠ 막지는 않고 «말한다» — 종이에 붉게 세워서 사람이 보고 멈추게 한다.
   *     서버가 문서 생성을 막아 버리면 급할 때 우회로가 생기고, 우회로가 곧 구멍이 된다.
   */
  const gate: string[] = [];
  if (axis === '공급사') {
    const confirms = ((await db.ref(CONFIRM_NODE).get().catch(() => null))?.val() || {}) as Record<string, Confirmation>;
    const ofMonth = Object.values(confirms).filter((c) => c.month === month);
    /**
     * ★★**관문은 «영업채널» 단위다**(사장님 2026-08-26 「공급사 영업채널 청구서가 각각 있음」) —
     *   청구서가 「달 × 상대」로 나가니 확인도 그 단위여야 짝이 맞는다.
     *   사람 이름으로 세면 동명이인 때문에 영영 안 열린다(실측: 원장 56명 중 3명이 동명이인).
     */
    const byChannel = new Map<string, number>();
    for (const x of rows) {
      const ch = S(x.extra.channel) || S(x.row.agent) || '(영업채널 미기재)';
      byChannel.set(ch, (byChannel.get(ch) || 0) + 1);
    }
    for (const [channel, n] of byChannel) {
      // 채널 이름이 줄여 적혀 있어도(하허호 ↔ 하허호무심사) 앞머리로 붙인다.
      const c = ofMonth.find((v) => {
        const a = nameKey(v.who);
        const b = nameKey(channel);
        return !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a));
      }) || null;
      const { ok, why } = canBill(c, n);
      if (!ok) gate.push(`${channel} (${n}건) — ${why}`);
    }
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
