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

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 우리 법인 — partners 에 들어 있다(실측 2026-08-26). */
const ISSUER_CODE = 'OP001';

const S = (v: unknown) => String(v ?? '').trim();

const toParty = (raw: unknown, fallbackName = ''): InvoiceParty => {
  const o = (raw || {}) as Record<string, unknown>;
  return {
    name: S(o.name || o.partner_name || o.company_name) || fallbackName,
    bizNo: S(o.business_number || o.business_no || o.biz_no),
    ceo: S(o.ceo),
    address: S(o.address),
    phone: S(o.phone),
    bank: S(o.bank_name),
    account: S(o.bank_account),
    holder: S(o.bank_holder),
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

  return NextResponse.json({
    ok: true,
    ...invoice,
    // 상대를 못 특정했으면 말한다 — 조용히 빈 회사로 두면 그대로 인쇄된다.
    receiverNote: cands.length === 1 ? '' : cands.length === 0
      ? `「${party}」로 등록된 회사를 못 찾았습니다. 사업자 정보가 빈 채로 나갑니다.`
      : `「${party}」로 시작하는 회사가 ${cands.length}곳이라 하나로 못 정했습니다.`,
  });
}
