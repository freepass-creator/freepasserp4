import { NextResponse } from 'next/server';
import { verifyActiveBearer, firebaseAdminDatabase } from '@/lib/server/firebase-admin';
import {
  canAccessFreepassEsignContract,
  canManageFreepassEsign,
  loadFreepassEsignBundle,
  sha256,
  validContractCode,
  type EsignRecord,
} from '@/lib/server/freepass-esign';
import { buildRentalFactCertificateHtml, type RentalFactCertificateRow } from '@/lib/server/rental-fact-certificate';
import { renderFreepassPdf } from '@/lib/server/freepass-esign-document';
import { snapshotWithPrivateSubmission } from '@/lib/domain/esign-signed-snapshot';
import { businessRegistrationNumberOf } from '@/lib/domain/business-identity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
};
const S = (value: unknown) => String(value ?? '').trim();
const record = (value: unknown): EsignRecord | null => value && typeof value === 'object' && !Array.isArray(value) ? value as EsignRecord : null;
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

function fieldsOf(snapshot: EsignRecord | null) {
  return record(snapshot?.templateFields) || {};
}

function handoverOf(contract: EsignRecord) {
  const handover = record(contract.esign_handover);
  return {
    start: S(handover?.contract_start),
    end: S(handover?.contract_end),
  };
}

type SignedEvidence = { fields: EsignRecord; identity: string; sessionHash: string };

/**
 * 완료본과 같은 방식으로 고객의 비공개 제출값을 발행 스냅샷에 합성한다.
 * 식별값은 이 요청 안에서만 해시로 비교하고 응답·계약 공개 노드에는 남기지 않는다.
 */
async function signedEvidence(db: ReturnType<typeof firebaseAdminDatabase>, contract: EsignRecord, contractCode: string): Promise<SignedEvidence | null> {
  const sessionHash = S(contract.esign_session_hash);
  if (!sessionHash || S(contract.esign_provider) !== 'freepass' || S(contract.sign_status) !== '서명완료') return null;
  const [sessionSnap, privateSnap] = await Promise.all([
    db.ref(`v4/esign_sessions/${sessionHash}`).get().catch(() => null),
    db.ref(`v4/esign_private/${contractCode}/${sessionHash}`).get().catch(() => null),
  ]);
  const session = record(sessionSnap?.val());
  if (S(session?.status) !== 'signed') return null;
  const snapshot = record(session?.snapshot);
  if (!snapshot) return null;
  const sealed = snapshotWithPrivateSubmission(snapshot, record(privateSnap?.val()));
  const fields = fieldsOf(sealed);
  const id = S(fields.customer_id).replace(/[^0-9A-Za-z]/g, '');
  return { fields, identity: id ? sha256(`rental-fact:${id}`) : '', sessionHash };
}

async function availableRows(anchorCode: string, actor: Awaited<ReturnType<typeof verifyActiveBearer>>) {
  const anchor = await loadFreepassEsignBundle(anchorCode);
  if (!anchor || !canAccessFreepassEsignContract(actor, anchor.contract)) return null;
  const anchorEvidence = await signedEvidence(anchor.db, anchor.contract, anchorCode);
  const anchorHandover = handoverOf(anchor.contract);
  if (!anchorEvidence || !anchorHandover.start || !anchorHandover.end) return [{ contract: anchor.contract, code: anchorCode, selectable: false, fields: {} }];
  // 신원확인 값이 없던 레거시 완료본은 개별 발급만 허용한다.
  if (!anchorEvidence.identity) return [{ contract: anchor.contract, code: anchorCode, selectable: true, fields: anchorEvidence.fields }];
  const db = firebaseAdminDatabase();
  const [legacySnap, overlaySnap] = await Promise.all([
    db.ref('contracts').get().catch(() => null),
    db.ref('v4/contracts').get().catch(() => null),
  ]);
  const legacy = record(legacySnap?.val()) || {};
  const overlay = record(overlaySnap?.val()) || {};
  const codes = new Set([...Object.keys(legacy), ...Object.keys(overlay)]);
  const rows: Array<{ contract: EsignRecord; code: string; selectable: boolean; fields: EsignRecord }> = [];
  for (const code of codes) {
    const contract = { ...(record(legacy[code]) || {}), ...(record(overlay[code]) || {}) };
    if (!Object.keys(contract).length || !canAccessFreepassEsignContract(actor, contract)) continue;
    const handover = handoverOf(contract);
    if (!handover.start || !handover.end) continue;
    const evidence = await signedEvidence(db, contract, code);
    if (!evidence || evidence.identity !== anchorEvidence.identity) continue;
    rows.push({ contract, code, selectable: true, fields: evidence.fields });
  }
  return rows;
}

/** 같은 임차인의 확정 계약만 고르는 발급 대상 목록. */
export async function GET(request: Request) {
  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '전자계약 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor || !canManageFreepassEsign(actor)) return json({ error: '발급 서류를 볼 권한이 없습니다.' }, 403);
  const code = validContractCode(new URL(request.url).searchParams.get('contractCode'));
  if (!code) return json({ error: '기준 계약번호가 필요합니다.' }, 400);
  const rows = await availableRows(code, actor);
  if (!rows) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
  return json({
    rows: rows.map(({ contract, code: contractCode, selectable, fields }) => {
      const handover = handoverOf(contract);
      return {
        contractCode,
        vehicleName: S(contract.vehicle_name_snapshot || fields.vehicle_name),
        carNumber: S(contract.car_number_snapshot || contract.car_number),
        contractStart: handover.start,
        contractEnd: handover.end,
        selectable,
      };
    }),
  });
}

/** 선택한 한 대 또는 여러 대를 한 장의 기관제출용 확인서로 발급한다. */
export async function POST(request: Request) {
  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '전자계약 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor || !canManageFreepassEsign(actor)) return json({ error: '발급 서류를 만들 권한이 없습니다.' }, 403);
  let rawCodes: unknown;
  try { rawCodes = (await request.json() as { contractCodes?: unknown }).contractCodes; }
  catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  const codes = Array.isArray(rawCodes) ? [...new Set(rawCodes.map(validContractCode).filter(Boolean))] : [];
  if (!codes.length || codes.length > 30) return json({ error: '1~30건의 계약을 선택해 주세요.' }, 400);

  const bundles = await Promise.all(codes.map(async (code) => ({ code, bundle: await loadFreepassEsignBundle(code) })));
  if (bundles.some(({ bundle }) => !bundle || !canAccessFreepassEsignContract(actor, bundle!.contract))) return json({ error: '선택한 계약 중 접근할 수 없는 항목이 있습니다.' }, 404);
  const normalized = bundles as Array<{ code: string; bundle: NonNullable<Awaited<ReturnType<typeof loadFreepassEsignBundle>>> }>;
  if (codes.length > 1) {
    const lessors = new Set(normalized.map(({ bundle }) => S(bundle.contract.provider_company_code).toUpperCase()));
    if (lessors.size !== 1 || ![...lessors][0]) return json({ error: '서로 다른 임대인의 계약은 한 확인서로 발급할 수 없습니다.' }, 409);
  }
  const rows: RentalFactCertificateRow[] = [];
  let fields: EsignRecord = {};
  let firstEvidence: SignedEvidence | null = null;
  for (const { code, bundle } of normalized) {
    const contract = bundle.contract;
    const handover = handoverOf(contract);
    if (S(contract.esign_provider) !== 'freepass' || S(contract.sign_status) !== '서명완료' || !handover.start || !handover.end) {
      return json({ error: `${code}: 전자서명 완료와 인도일 확정 후 발급할 수 있습니다.` }, 409);
    }
    const evidence = await signedEvidence(bundle.db, contract, code);
    if (!evidence) return json({ error: `${code}: 완료 전자계약 스냅샷을 찾을 수 없습니다.` }, 409);
    if (!firstEvidence) { firstEvidence = evidence; fields = evidence.fields; }
    if (codes.length > 1 && (!evidence.identity || evidence.identity !== firstEvidence.identity)) return json({ error: '서로 다른 임차인의 계약은 한 확인서로 발급할 수 없습니다.' }, 409);
    rows.push({
      contractCode: S(contract.contract_number || contract.contract_code || code),
      carNumber: S(contract.car_number_snapshot || contract.car_number),
      vehicleName: S(contract.vehicle_name_snapshot || evidence.fields.vehicle_name),
      contractStart: handover.start,
      contractEnd: handover.end,
    });
  }
  const now = new Date();
  const issuedAt = `${now.getFullYear()}. ${String(now.getMonth() + 1).padStart(2, '0')}. ${String(now.getDate()).padStart(2, '0')}.`;
  const partner = normalized[0].bundle.partner;
  const companyName = S(fields.company_name || partner?.company_name || partner?.name || partner?.partner_name);
  const companyCeoTitle = S(fields.company_ceo_title || partner?.ceo_title || '대표');
  const companyCeo = S(fields.company_ceo || partner?.ceo || partner?.ceo_name);
  const companyBizNo = S(fields.company_biz_no || businessRegistrationNumberOf(partner || {}, 'partner'));
  if (!companyName || !companyBizNo) return json({ error: '발급인의 상호 또는 사업자등록번호가 없어 확인서를 만들 수 없습니다.' }, 409);
  const issuerSource = fields.company_name && fields.company_biz_no ? 'sealed_snapshot' : 'partner_profile_legacy_fallback';
  const html = buildRentalFactCertificateHtml({
    issuedAt,
    companyName,
    companyCeoTitle,
    companyCeo,
    companyBizNo,
    customerName: S(fields.customer_name),
    customerPhone: S(fields.customer_phone),
    customerAddress: S(fields.customer_address),
    rows,
  });
  try {
    const pdf = await renderFreepassPdf(html);
    const issueHash = sha256(pdf);
    await normalized[0].bundle.db.ref('v4/esign_issuance/rental-fact').push({
      type: 'rental_fact_certificate', contractCodes: codes, issuedAt: Date.now(), issuedBy: actor.uid, documentSha256: issueHash, issuerSource,
    });
    return new NextResponse(Uint8Array.from(pdf).buffer, {
      headers: { ...HEADERS, 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="rental-fact-${codes.length}vehicles.pdf"` },
    });
  } catch {
    return json({ error: '이 서버에는 확인서 PDF 생성용 Chrome이 없습니다.' }, 503);
  }
}
