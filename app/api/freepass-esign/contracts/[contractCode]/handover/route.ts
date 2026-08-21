import { NextResponse } from 'next/server';
import { verifyActiveBearer } from '@/lib/server/firebase-admin';
import {
  appendFreepassEsignEvent,
  canReviewFreepassEsign,
  loadFreepassEsignBundle,
  sessionHashFromContract,
  validContractCode,
} from '@/lib/server/freepass-esign';
import { rentalPeriodEnd } from '@/lib/domain/rental-period';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization',
  'X-Content-Type-Options': 'nosniff',
};
const S = (value: unknown) => String(value ?? '').trim();
const record = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ contractCode: string }> },
) {
  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '전자계약 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor || !canReviewFreepassEsign(actor)) return json({ error: '관리자만 인도일을 확정할 수 있습니다.' }, 403);
  const contractCode = validContractCode((await params).contractCode);
  if (!contractCode) return json({ error: '계약번호가 올바르지 않습니다.' }, 400);
  let date = '';
  try { date = S((await request.json() as { handover_datetime?: unknown }).handover_datetime); }
  catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  if (!validDate(date)) return json({ error: '인도일(YYYY-MM-DD)이 필요합니다.' }, 400);

  const bundle = await loadFreepassEsignBundle(contractCode);
  if (!bundle) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
  if (S(bundle.contract.esign_provider) !== 'freepass' || S(bundle.contract.sign_status) !== '서명완료') {
    return json({ error: '프리패스 전자계약 서명이 끝난 뒤 인도일을 확정할 수 있습니다.' }, 409);
  }
  // 계약 노드의 esign_insurance_side/verified_at은 화면 표시용 사본이다.
  // agent가 v4 계약 필드를 바꿔도 인도 게이트를 우회하지 못하게, 봉인 세션·private 검증기록만 신뢰한다.
  const hash = sessionHashFromContract(bundle.contract);
  if (!hash) return json({ error: '봉인된 전자계약 세션을 찾을 수 없어 인도일을 확정할 수 없습니다.' }, 409);
  const [sessionSnap, privateSnap] = await Promise.all([
    bundle.db.ref(`v4/esign_sessions/${hash}`).get().catch(() => null),
    bundle.db.ref(`v4/esign_private/${contractCode}/${hash}`).get().catch(() => null),
  ]);
  const session = record(sessionSnap?.val());
  const sealHash = S(session.sealHash);
  if (S(session.contractCode) !== contractCode || S(session.status) !== 'signed' || !/^[a-f0-9]{64}$/i.test(sealHash)) {
    return json({ error: '봉인된 전자계약 완료 기록을 확인할 수 없어 인도일을 확정할 수 없습니다.' }, 409);
  }
  const verification = record((await bundle.db.ref(`v4/esign_verifications/${sealHash}`).get().catch(() => null))?.val());
  if (S(verification.contractCode) !== contractCode || S(verification.sealHash) !== sealHash) {
    return json({ error: '전자계약 봉인 검증기록을 확인할 수 없어 인도일을 확정할 수 없습니다.' }, 409);
  }
  const snapshot = record(session.snapshot);
  const snapshotKind = record(snapshot.contractKind);
  const insuranceSide = S(snapshotKind.insuranceSide);
  if (insuranceSide !== '회사포함' && insuranceSide !== '고객직접') {
    return json({ error: '봉인된 보험 조건을 확인할 수 없어 인도일을 확정할 수 없습니다.' }, 409);
  }
  if (insuranceSide === '고객직접') {
    const evidence = record(record(privateSnap?.val()).customer_insurance_evidence);
    const verificationEvidence = record(verification.customerInsuranceEvidence);
    const landlord = S(record(snapshot.landlord).companyName);
    const evidenceHash = S(evidence.sha256);
    if (S(evidence.certificateKey) !== 'customer_insurance_certificate'
      || !/^[a-f0-9]{64}$/i.test(evidenceHash)
      || !Number(evidence.verifiedAt)
      || !S(evidence.verifiedBy)
      || !landlord
      || S(evidence.lienholder) !== landlord
      || S(verificationEvidence.sha256) !== evidenceHash
      || S(verificationEvidence.lienholder) !== landlord) {
      return json({ error: '보험별도 계약은 봉인된 가입증명서의 회사 질권 설정을 확인한 뒤 인도일을 확정할 수 있습니다.' }, 409);
    }
  }
  const months = Number(bundle.contract.rent_month_snapshot || 0);
  if (!Number.isInteger(months) || months <= 0 || months > 120) {
    return json({ error: '계약 대여기간을 확인해 주세요.' }, 409);
  }
  const now = Date.now();
  const handover = {
    handover_datetime: date,
    contract_start: date,
    contract_end: rentalPeriodEnd(date, months),
    confirmedAt: now,
    confirmedBy: actor.uid,
  };
  await bundle.db.ref(`v4/contracts/${contractCode}`).update({ esign_handover: handover });
  await appendFreepassEsignEvent(contractCode, 'handover_confirmed', {
    actorUid: actor.uid,
    handoverDate: date,
  });
  return json({ ok: true, handover });
}
