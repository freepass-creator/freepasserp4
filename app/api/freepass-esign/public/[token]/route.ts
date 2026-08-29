import { NextResponse } from 'next/server';
import {
  freepassEsignEventUpdates,
  hasFrozenFreepassConsentProfile,
  hasFrozenFreepassTemplateState,
  loadFreepassEsignBundle,
  loadFreepassSessionByToken,
  sha256,
  uploadPrivateEsignFile,
  type EsignRecord,
} from '@/lib/server/freepass-esign';
import { applySignerRoleToDocuments, SIGNER_ROLES } from '@/lib/domain/esign-required-documents';
import { hasMeaningfulFreepassSignature } from '@/lib/server/freepass-esign-signature';
import { driverAgeRange, residentIdInfo } from '@/lib/domain/esign-resident-id';
import { normalizeEsignRequiredDocuments } from '@/lib/domain/esign-required-documents';
import { encryptRrn } from '@/lib/server/rrn-crypto';

const SUBMISSION_CLAIM_TTL_MS = 90_000;
const PRIVATE_UPLOAD_TIMEOUT_MS = 45_000;

function submissionClaimAvailable(session: EsignRecord, now: number): boolean {
  const status = S(session.status);
  if (status === 'revoked' || Number(session.revokedAt || 0)) return false;
  if (status === 'sent' || status === 'opened') return true;
  return status === 'submitting'
    && Number(session.submittingAt || 0) > 0
    && Number(session.submittingAt || 0) <= now - SUBMISSION_CLAIM_TTL_MS;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('private upload timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PUBLIC_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
};
// 두 장과 서명 데이터를 합쳐 일반 서버리스 요청 제한 안에 머물도록 한다.
const MAX_IMAGE_BYTES = 1_500_000;
const S = (value: unknown) => String(value ?? '').trim();
/**
 * 손님 화면이 «지나온 단계»로 기록할 수 있는 키.
 *
 * ★여기 없는 키를 화면이 보내면 400 이 나고 손님이 그 화면에 갇힌다.
 *   화면에서 단계를 쪼개거나 새로 만들면 **반드시 여기에도 넣는다.**
 *   실제로 그래서 개인 계약이 「매출증빙」에서 막혀 있었다(2026-08-28).
 *   어긋나면 `sim-esign-progress-keys` 가 잡는다 — 사람 눈으로 맞추지 않는다.
 */
const PROGRESS_KEYS = new Set([
  'summary', 'privacy', 'identity',
  // 본인확인을 쪼갠 화면들 — 한 화면에 다 넣으면 폰에서 스크롤이 길어져 갈랐다
  'sales_proof', 'signer', 'tax_invoice', 'emergency', 'id_photo', 'selfie',
  // 계약조건 낱장(스냅샷의 consentPages 에서 온다) + 그 밖
  'vehicle', 'rental', 'payment', 'driver',
  'additional_driver', 'contract', 'documents', 'insurance', 'accident', 'service',
  'agreement', 'signature',
]);

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PUBLIC_HEADERS });
}

function childUpdates(prefix: string, values: EsignRecord): EsignRecord {
  const updates: EsignRecord = {};
  for (const [key, value] of Object.entries(values)) updates[`${prefix}/${key}`] = value;
  return updates;
}

function publicStatus(status: string) {
  if (status === 'pending_review' || status === 'approving' || status === 'rejecting') return '검토대기';
  if (status === 'signed') return '서명완료';
  if (status === 'revoked') return '해지';
  return status;
}

function imageFile(value: FormDataEntryValue | null, label: string): File {
  if (!(value instanceof File) || !value.size) throw new Error(`${label} 사진을 첨부해 주세요.`);
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(value.type)) throw new Error(`${label}는 사진 파일만 가능합니다.`);
  if (value.size > MAX_IMAGE_BYTES) throw new Error(`${label}는 1.5MB 이하로 첨부해 주세요.`);
  return value;
}

function extension(file: File) {
  if (/png/i.test(file.type)) return 'png';
  if (/webp/i.test(file.type)) return 'webp';
  if (/hei[cf]/i.test(file.type)) return 'heic';
  return 'jpg';
}

function record(value: unknown): EsignRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as EsignRecord : {};
}

/** 고객이 체크할 키는 발행 당시 봉인한 profile에서만 읽는다. */
function requiredConsentKeys(snapshot: EsignRecord): string[] {
  const profile = record(snapshot.consentProfile);
  const keys = Array.isArray(profile.requiredKeys) ? profile.requiredKeys.map(S).filter(Boolean) : [];
  if (!keys.includes('rental_terms') || !keys.includes('privacy') || keys.length !== new Set(keys).size) {
    throw new Error('동의 프로필이 올바르지 않아 새 링크 발행이 필요합니다.');
  }
  const atoms = Array.isArray(profile.atoms) ? profile.atoms.map(record) : [];
  const allowed = new Set(['rental_terms', ...atoms.map((atom) => S(atom.key)).filter(Boolean)]);
  if (keys.some((key) => !allowed.has(key))) {
    throw new Error('동의 프로필이 올바르지 않아 새 링크 발행이 필요합니다.');
  }
  return keys;
}

function requestEvidence(request: Request, sessionHash: string) {
  const forwarded = S(request.headers.get('x-forwarded-for')).split(',')[0].trim();
  const ip = forwarded || S(request.headers.get('x-real-ip')) || 'unknown';
  return {
    ipHash: sha256(`${sessionHash}:${ip}`),
    userAgent: S(request.headers.get('user-agent')).slice(0, 300),
  };
}

function birthDate(value: unknown): string | null {
  const result = S(value);
  const parsed = new Date(`${result}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(result)
    && !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === result
    && parsed <= new Date()
    ? result : null;
}

function ageOnBirthDate(birth: string, reference: unknown): number | null {
  const at = birthDate(reference);
  if (!at) return null;
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ay, am, ad] = at.split('-').map(Number);
  if (![by, bm, bd, ay, am, ad].every(Number.isFinite)) return null;
  return ay - by - (am < bm || (am === bm && ad < bd) ? 1 : 0);
}

function progressCount(progress: EsignRecord) {
  if (progress.agreement) return 6;
  if (progress.insurance) return 5;
  if (progress.rental || progress.payment || progress.driver) return 4;
  if (progress.vehicle) return 3;
  if (progress.identity) return 2;
  if (progress.privacy) return 1;
  return 0;
}

function validateServerProgress(session: EsignRecord) {
  const snapshot = record(session.snapshot);
  const progress = record(session.progress);
  const groups = Array.isArray(snapshot.consentGroups) ? snapshot.consentGroups : [];
  const required = new Set([
    'summary', 'privacy', 'identity', 'agreement',
    ...groups.map((group) => S(record(group).key)).filter(Boolean),
  ]);
  const additionalDriverPolicy = record(snapshot.additionalDriverPolicy);
  if (Number(additionalDriverPolicy.limit || 0) > 0) required.add('additional_driver');
  if (normalizeEsignRequiredDocuments(snapshot.requiredDocuments).length > 0) required.add('documents');
  const missing = [...required].filter((key) => !Number(progress[key] || 0));
  if (missing.length) throw new Error('서버에 확인 기록이 남지 않은 계약 단계가 있습니다. 처음부터 다시 확인해 주세요.');
}

function validateSubmission(payload: EsignRecord, snapshot: EsignRecord) {
  const name = S(payload.customer_name);
  const phone = S(payload.customer_phone).replace(/\D/g, '');
  const signature = S(payload.signature);
  const consents = Array.isArray(payload.consents) ? payload.consents.map(S) : [];
  if (!name || name.length > 40) throw new Error('성명은 1~40자로 입력해 주세요.');
  if (phone.length < 10 || phone.length > 11) throw new Error('연락처를 정확히 입력해 주세요.');
  if (!signature.startsWith('data:image/png;base64,') || signature.length > 600000) {
    throw new Error('전자서명을 다시 입력해 주세요.');
  }
  if (!hasMeaningfulFreepassSignature(signature)) {
    throw new Error('서명란에 성명을 또렷하게 적어 주세요. 한 점 또는 너무 짧은 표시는 사용할 수 없습니다.');
  }
  const requiredConsents = requiredConsentKeys(snapshot);
  const allowedConsents = new Set(requiredConsents);
  if (consents.length !== new Set(consents).size || consents.some((key) => !allowedConsents.has(key))) {
    throw new Error('동의 항목이 현재 계약의 발행 프로필과 일치하지 않습니다. 새 링크를 확인해 주세요.');
  }
  if (!requiredConsents.every((key) => consents.includes(key))) {
    throw new Error('필수 약관 동의가 누락되었습니다.');
  }
  const confirmations = record(payload.sectionConfirmations);
  const groups = Array.isArray(snapshot.consentGroups) ? snapshot.consentGroups : [];
  const missing = groups
    .map((group) => S(record(group).key))
    // 본인정보는 별도 본인확인 단계(progress.identity)에서 이미 서버에 기록한다.
    // 모바일에서 실제로 보여준 계약조건 페이지(차량·대여·결제…)만 여기서 다시 확인한다.
    .filter((key) => key && key !== 'identity' && !Number(confirmations[key] || 0));
  if (missing.length) throw new Error('확인하지 않은 계약 조건이 있습니다.');
  if (!Number(payload.summaryConfirmedAt || 0)) throw new Error('계약 요약을 먼저 확인해 주세요.');
  if (!Number(payload.agreementReadAt || 0)) throw new Error('약관을 끝까지 읽고 동의해 주세요.');
  const documentSourceViewedAt = Number(payload.documentPreviewedAt || 0);
  if (!Number.isFinite(documentSourceViewedAt) || documentSourceViewedAt <= 0 || documentSourceViewedAt > Date.now() + 5 * 60_000) {
    throw new Error('실제 계약서 원본을 열람한 뒤 동의해 주세요.');
  }
  for (const [key, limit] of [
    ['customer_id', 30], ['customer_address', 200],
    ['driver_license_no', 30],
    ['sales_proof_value', 30],
    ['emergency_relation', 30], ['emergency_name', 40], ['emergency_phone', 30],
    ['signer_name', 40], ['signer_role', 30],
  ] as const) {
    if (S(payload[key]).length > limit) throw new Error('입력값이 너무 깁니다.');
  }
  const corporate = S(record(snapshot.templateState).ct) === '법인';
  const soleProprietor = S(record(snapshot.templateState).tax) === '사업자';
  const customerId = S(payload.customer_id).replace(/\D/g, '');
  const customerBirth = corporate ? '' : birthDate(payload.customer_id);
  if (corporate && customerId.length !== 13) throw new Error('법인등록번호 13자리를 정확히 입력해 주세요.');
  if (!corporate && !customerBirth) throw new Error('생년월일을 YYYY-MM-DD 형식으로 입력해 주세요.');
  const templateFields = record(snapshot.templateFields);
  if (corporate) {
    if (S(payload.driver_license_no).replace(/\D/g, '').length !== 10) throw new Error('사업자등록번호 10자리를 정확히 입력해 주세요.');
    /*
     * ★법인은 «임차인»과 «서명하는 사람»이 다르다. 위의 customer_* 는 전부 법인 값이라,
     *   서명자를 따로 받지 않으면 «누가 서명했는가»가 어디에도 남지 않는다.
     *   그런데도 신분증·얼굴 사진은 받고 있었다 — 대조할 기준이 없는 사진이었다.
     * ⚠ 대표이사의 서명은 «위임»이 아니라 «대표권»이다(위임장 불요).
     *   위임장이 필요한 건 대표이사가 아닌 임직원이 서명할 때뿐이라, 관계를 값으로 받는다.
     */
    if (!S(payload.signer_name)) throw new Error('서명하시는 분의 성명을 입력해 주세요.');
    if (!(SIGNER_ROLES as readonly string[]).includes(S(payload.signer_role))) throw new Error('법인과의 관계를 선택해 주세요.');
  } else {
    const ageRange = driverAgeRange(templateFields.driver_age);
    // 인도일은 나중에 확정될 수 있으므로, 아직 비어 있으면 계약일을 연령 기준일로 쓴다.
    const ageReference = S(templateFields.contract_start) || S(templateFields.contract_date);
    const customerAge = ageOnBirthDate(customerBirth || '', ageReference);
    if (customerAge == null) throw new Error('계약일과 생년월일을 확인해 주세요.');
    if (ageRange.min != null && customerAge < ageRange.min) throw new Error(`이 계약은 만 ${ageRange.min}세 이상만 운전할 수 있습니다.`);
    if (ageRange.max != null && customerAge > ageRange.max) throw new Error(`이 계약은 만 ${ageRange.max}세 이하만 운전할 수 있습니다.`);
    if (!S(payload.driver_license_no)) throw new Error('운전면허번호를 입력해 주세요.');
    if (payload.id_card_rrn_masked_confirmed !== true) throw new Error('운전면허증의 주민번호를 가린 사본만 제출해 주세요.');
  }
  if (!S(payload.customer_address)) throw new Error('계약서에 기재할 주소를 입력해 주세요.');
  const business = {
    name: S(payload.tax_biz_name), no: S(payload.tax_biz_no).replace(/\D/g, ''), ceo: S(payload.tax_ceo),
    typeItem: S(payload.tax_biz_type_item), email: S(payload.tax_email), address: S(payload.tax_biz_address),
  };
  const businessTouched = !!(business.name || business.no || business.ceo || business.typeItem || business.email || business.address);
  const businessReady = !!(
    business.name && business.name.length <= 120
    && business.no.length === 10
    && business.ceo && business.ceo.length <= 80
    && business.typeItem && business.typeItem.length <= 160
    && /^\S+@\S+\.\S+$/.test(business.email) && business.email.length <= 160
    && business.address && business.address.length <= 200
  );
  if ((soleProprietor || businessTouched) && !businessReady) throw new Error('세금계산서 사업자 정보를 확인해 주세요.');
  const salesProofMethod = S(payload.sales_proof_method);
  const salesProofValue = S(payload.sales_proof_value);
  let salesProof: { method: 'phone' | 'rrn'; phone?: string; residentIdEncrypted?: string; consentAt?: number } | null = null;
  if (!corporate && !soleProprietor && !businessTouched) {
    if (salesProofMethod === 'phone') {
      const phone = salesProofValue.replace(/\D/g, '');
      if (phone.length < 10 || phone.length > 11) throw new Error('현금영수증을 받을 휴대전화번호를 정확히 입력해 주세요.');
      salesProof = { method: 'phone', phone };
    } else if (salesProofMethod === 'rrn') {
      const resident = residentIdInfo(salesProofValue);
      if (!resident) throw new Error('현금영수증용 주민등록번호를 정확히 입력해 주세요.');
      if (payload.sales_proof_rrn_consent !== true) throw new Error('현금영수증 발행용 주민등록번호 암호화 처리 동의가 필요합니다.');
      // 계약·PDF·공개 노드에는 절대 넣지 않고, 현금영수증 발행용 private submission에만 암호문을 둔다.
      salesProof = { method: 'rrn', residentIdEncrypted: encryptRrn(resident.digits), consentAt: Date.now() };
    } else {
      throw new Error('현금영수증 발행 수단을 선택해 주세요.');
    }
  }
  const emergencyRelation = S(payload.emergency_relation);
  const emergencyName = S(payload.emergency_name);
  const emergencyPhone = S(payload.emergency_phone).replace(/\D/g, '');
  if (!emergencyRelation) throw new Error('비상연락 관계를 입력해 주세요.');
  if (!emergencyName) throw new Error('비상연락 성명을 입력해 주세요.');
  if (emergencyPhone.length < 10 || emergencyPhone.length > 11) throw new Error('비상연락처를 정확히 입력해 주세요.');
  const additionalDriverPolicy = record(snapshot.additionalDriverPolicy);
  const additionalDriverLimit = Math.max(0, Math.min(3, Number(additionalDriverPolicy.limit || 0)));
  const rawAdditionalDrivers = Array.isArray(payload.additional_drivers) ? payload.additional_drivers : [];
  if (rawAdditionalDrivers.length > additionalDriverLimit) {
    throw new Error(`추가 운전자는 최대 ${additionalDriverLimit}명까지 등록할 수 있습니다.`);
  }
  const additionalDrivers = rawAdditionalDrivers.map((value, index) => {
    const driver = record(value);
    const driverName = S(driver.name);
    const relation = S(driver.relation);
    const driverPhone = S(driver.phone).replace(/\D/g, '');
    const driverLicenseNo = S(driver.driver_license_no);
    if (!driverName || driverName.length > 40) throw new Error(`추가 운전자 ${index + 1}의 성명을 확인해 주세요.`);
    if (!relation || relation.length > 30) throw new Error(`추가 운전자 ${index + 1}의 관계를 확인해 주세요.`);
    if (driverPhone.length < 10 || driverPhone.length > 11) throw new Error(`추가 운전자 ${index + 1}의 연락처를 확인해 주세요.`);
    if (!driverLicenseNo || driverLicenseNo.length > 30) throw new Error(`추가 운전자 ${index + 1}의 면허번호를 확인해 주세요.`);
    if (driver.license_rrn_masked_confirmed !== true) throw new Error(`추가 운전자 ${index + 1}의 면허증 주민번호를 가린 사본만 제출해 주세요.`);
    if (!Number(driver.consentAt || 0)) throw new Error(`추가 운전자 ${index + 1}의 개인정보 제공 동의가 필요합니다.`);
    return {
      name: driverName,
      relation,
      phone: driverPhone,
      driver_license_no: driverLicenseNo,
      license_rrn_masked_confirmed: true,
      consentAt: Number(driver.consentAt),
    };
  });
  return {
    name, phone, signature, consents, confirmations, additionalDrivers, customerBirth,
    emergencyRelation, emergencyName, emergencyPhone, business, salesProof, documentSourceViewedAt,
    /* 법인 여부와 서명자는 «여기서 이미 검증한 것»을 그대로 들고 간다.
       저장 자리에서 templateState 를 다시 읽으면 판정이 두 벌이 되고, 한쪽만 고치는 사고가 난다. */
    corporate,
    signer: corporate ? {
      name: S(payload.signer_name),
      role: S(payload.signer_role),
    } : null,
  };
}

function supportingDocumentsFor(session: EsignRecord, signerRole?: unknown): EsignRecord[] {
  const snapshot = record(session.snapshot);
  /* 위임 서류는 «해당 시»로 굳어 있다 — 서명자가 대표이사가 아니면 여기서 필수로 승격된다.
     손님 화면도 같은 함수를 쓴다(esign-required-documents.applySignerRoleToDocuments). */
  const requested = applySignerRoleToDocuments(normalizeEsignRequiredDocuments(snapshot.requiredDocuments), signerRole);
  const uploads = record(session.supportingUploads);
  const missing = requested.filter((document) => document.required && !S(record(uploads[document.key]).path));
  if (missing.length) {
    throw new Error(`필수 첨부서류를 제출해 주세요: ${missing.map((row) => row.label).join(' · ')}`);
  }
  return requested.flatMap((document) => {
    const upload = record(uploads[document.key]);
    if (!S(upload.path) || !S(upload.sha256)) return [];
    return [{
      key: document.key,
      label: document.label,
      note: document.note,
      required: document.required,
      originalName: S(upload.originalName),
      path: S(upload.path),
      sha256: S(upload.sha256),
      size: Number(upload.size || 0),
      contentType: S(upload.contentType),
      uploadedAt: Number(upload.uploadedAt || 0),
    }];
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const token = S((await params).token);
  // peek=1 — 관리자 미리보기용 «읽기만». 열람 전이·이벤트·스냅샷 보정 등 어떤 쓰기도 하지 않는다.
  // 손님이 붙여도 해될 것 없다: 진행(POST)이 첫 기록이 되며, 그때 openedAt 이 없으면 채운다.
  const peek = new URL(request.url).searchParams.get('peek') === '1';
  const loaded = await loadFreepassSessionByToken(token);
  if (!loaded) return json({ error: '유효하지 않은 전자계약 링크입니다.' }, 404);
  const { hash, session } = loaded;
  const now = Date.now();
  const status = S(session.status);
  if (status === 'revoked' || Number(session.revokedAt || 0)) {
    return json({ status: '해지', error: '해지된 전자계약 링크입니다.' }, 410);
  }
  if (status === 'signed' && Number(session.customerCopyExpiresAt || 0) > 0 && Number(session.customerCopyExpiresAt) <= now) {
    return json({ status: '만료', error: '고객 계약서 열람 링크가 만료되었습니다. 담당자에게 새 사본을 요청해 주세요.' }, 410);
  }
  if (Number(session.expiresAt || 0) <= now && !['pending_review', 'approving', 'rejecting', 'signed'].includes(status)) {
    return json({ status: '만료', error: '만료된 전자계약 링크입니다.' }, 410);
  }
  // 구형 스냅샷은 PDF 동결 단계에서 완료할 수 없다. signed 완료본은 이미 생성된
  // 고객 사본을 계속 열 수 있게 두되, 그 외 상태에서는 PII 수집/승인을 막는다.
  if (status !== 'signed' && (!hasFrozenFreepassTemplateState(session) || !hasFrozenFreepassConsentProfile(session))) {
    return json({ error: '계약서 또는 동의 프로필이 갱신되어 이 링크로는 진행할 수 없습니다. 담당자에게 새 링크 발행을 요청해 주세요.' }, 409);
  }
  if (['pending_review', 'approving', 'rejecting', 'signed'].includes(status)) {
    const documentUrl = status === 'signed'
      ? `/api/freepass-esign/public/${encodeURIComponent(token)}/document`
      : '';
    return json({
      ok: true,
      status: publicStatus(status),
      documentUrl,
      downloadUrl: documentUrl ? `${documentUrl}?download=1` : '',
    });
  }
  if (!['sent', 'opened'].includes(status)) {
    return json({ error: '지금은 전자계약을 열 수 없습니다.' }, 409);
  }
  const contractCode = S(session.contractCode);
  if (!contractCode) return json({ error: '계약 연결정보가 없습니다.' }, 409);
  const bundle = await loadFreepassEsignBundle(contractCode);
  const db = bundle?.db;
  if (!bundle || !db) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
  let snapshot = record(session.snapshot);
  const landlord = record(snapshot.landlord);
  if (!S(landlord.companyName)) {
    const companyName = S(bundle.partner?.company_name || bundle.partner?.name || bundle.partner?.partner_name);
    if (companyName) {
      // 기존 발행본에 누락된 임대인명만 한 번 보완해 이후 회사명 변경의 영향을 받지 않게 동결한다.
      if (!peek) await db.ref(`v4/esign_sessions/${hash}/snapshot/landlord`).set({ companyName });
      snapshot = { ...snapshot, landlord: { companyName } };
    }
  }
  let liveSession = session;
  if (!peek && !Number(session.openedAt || 0)) {
    const openedClaim = await db.ref(`v4/esign_sessions/${hash}`).transaction((current) => {
      // Admin SDK transaction은 로컬 캐시가 비어 있으면 첫 호출에 null을 줄 수 있다.
      // null을 abort하면 실제 세션을 다시 읽지 못해 손님 화면이 영구히 진행되지 않는다.
      if (!current) return current;
      if (Number(current.revokedAt || 0)) return;
      if (Number(current.expiresAt || 0) <= Date.now()) return;
      if (!['sent', 'opened'].includes(S(current.status)) || Number(current.openedAt || 0)) return;
      return { ...current, status: 'opened', openedAt: now };
    }, undefined, false);
    liveSession = record(openedClaim.snapshot.val());
    if (!openedClaim.committed) {
      if (S(liveSession.status) === 'revoked' || Number(liveSession.revokedAt || 0)) {
        return json({ status: '해지', error: '해지된 전자계약 링크입니다.' }, 410);
      }
      if (Number(liveSession.expiresAt || 0) <= Date.now()) {
        return json({ status: '만료', error: '만료된 전자계약 링크입니다.' }, 410);
      }
      if (!['sent', 'opened'].includes(S(liveSession.status))) {
        return json({ error: '지금은 전자계약을 열 수 없습니다.' }, 409);
      }
    } else {
      await db.ref(`v4/contracts/${contractCode}`).transaction((current) => {
        if (!current || S(current.esign_session_hash) !== hash || Number(current.sign_revoked_at || 0)) return;
        if (S(current.sign_status) === '서명완료') return;
        return { ...current, sign_status: '열람', esign_opened_at: now };
      }, undefined, false);
      await db.ref('v4').update(
        freepassEsignEventUpdates(contractCode, 'opened', requestEvidence(request, hash)),
      );
      const confirmed = (await db.ref(`v4/esign_sessions/${hash}`).get()).val() as EsignRecord | null;
      if (!confirmed || S(confirmed.status) === 'revoked' || Number(confirmed.revokedAt || 0)) {
        return json({ status: '해지', error: '해지된 전자계약 링크입니다.' }, 410);
      }
      liveSession = confirmed;
    }
  }
  return json({
    ok: true,
    status: '진행중',
    expiresAt: Number(session.expiresAt || 0),
    rejectReason: S(session.rejectReason),
    supplementItems: Array.isArray(session.supplementItems) ? session.supplementItems.map(S) : [],
    progress: record(liveSession.progress),
    uploadedSupportingDocumentKeys: Object.keys(record(liveSession.supportingUploads))
      .filter((key) => !!S(record(record(liveSession.supportingUploads)[key]).path)),
    previewDocumentUrl: `/api/freepass-esign/public/${encodeURIComponent(token)}/document?preview=1`,
    snapshot,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const token = S((await params).token);
  const loaded = await loadFreepassSessionByToken(token);
  if (!loaded) return json({ error: '유효하지 않은 전자계약 링크입니다.' }, 404);
  const { hash, session } = loaded;
  const now = Date.now();
  if (!hasFrozenFreepassTemplateState(session) || !hasFrozenFreepassConsentProfile(session)) {
    return json({ error: '계약서 또는 동의 프로필이 갱신되어 이 링크로는 진행할 수 없습니다. 담당자에게 새 링크 발행을 요청해 주세요.' }, 409);
  }
  if (!submissionClaimAvailable(session, now) || Number(session.expiresAt || 0) <= now) {
    return json({ error: '이미 제출했거나 만료된 링크입니다.' }, 409);
  }

  const contentType = S(request.headers.get('content-type')).toLowerCase();
  if (contentType.includes('application/json')) {
    let body: EsignRecord;
    try { body = await request.json() as EsignRecord; }
    catch { return json({ error: '진행정보 형식이 올바르지 않습니다.' }, 400); }
    const step = S(body.step);
    if (S(body.action) !== 'progress' || !PROGRESS_KEYS.has(step)) {
      return json({ error: '기록할 전자계약 단계가 올바르지 않습니다.' }, 400);
    }
    const contractCode = S(session.contractCode);
    const bundle = await loadFreepassEsignBundle(contractCode);
    if (!bundle) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
    const progressClaim = await bundle.db.ref(`v4/esign_sessions/${hash}`).transaction((current) => {
      // 첫 null 스냅샷은 그대로 돌려줘야 서버의 실제 값을 읽고 재시도한다.
      if (!current) return current;
      if (Number(current.revokedAt || 0)) return;
      if (!['sent', 'opened'].includes(S(current.status))) return;
      if (Number(current.expiresAt || 0) <= Date.now()) return;
      const saved = record(current.progress);
      if (Number(saved[step] || 0) > 0) return current;
      const progress = { ...saved, [step]: now };
      const writes = Object.keys(progress).filter((key) => PROGRESS_KEYS.has(key)).length;
      // peek 로만 열어 본 세션은 openedAt 이 없다 — 첫 진행 기록이 곧 열람이다.
      const opened = Number(current.openedAt || 0) ? {} : { status: 'opened', openedAt: now };
      return { ...current, ...opened, progress, progressWrites: writes, lastProgressAt: now };
    }, undefined, false);
    const progressedSession = record(progressClaim.snapshot.val());
    if (!progressClaim.committed) {
      if (S(progressedSession.status) === 'revoked' || Number(progressedSession.revokedAt || 0)) {
        return json({ error: '해지된 전자계약 링크입니다.' }, 410);
      }
      return json({ error: '지금은 진행정보를 저장할 수 없습니다.' }, 409);
    }
    const progress = record(progressedSession.progress);
    const reused = Number(progress[step] || 0) !== now;
    if (!reused) {
      await bundle.db.ref(`v4/contracts/${contractCode}`).transaction((current) => {
        if (!current || S(current.esign_session_hash) !== hash || Number(current.sign_revoked_at || 0)) return;
        if (S(current.sign_status) === '서명완료') return;
        return {
          ...current,
          sign_status: '진행중',
          esign_progress: progressCount(progress),
          esign_last_progress_at: now,
        };
      }, undefined, false);
    }
    return json({ ok: true, progress, ...(reused ? { reused: true } : {}) });
  }

  let payload: EsignRecord;
  let idCard: File | null = null;
  let selfie: File | null = null;
  let additionalDriverLicenses: File[];
  let supportingDocuments: EsignRecord[];
  try {
    const form = await request.formData();
    payload = JSON.parse(S(form.get('payload'))) as EsignRecord;
    const parsed = validateSubmission(payload, record(session.snapshot));
    // 법인은 법인등기·인감과 대표권/위임 서류로 계약권한을 확인한다. 법인 대표자나
    // 위임 임직원의 주민번호·면허증·얼굴 사진을 일괄 수집하지 않는다.
    if (!parsed.corporate) {
      idCard = imageFile(form.get('idCard'), '운전면허증');
      selfie = imageFile(form.get('selfie'), '본인 얼굴 사진');
    }
    additionalDriverLicenses = parsed.additionalDrivers.map((_, index) => imageFile(
      form.get(`additionalDriverLicense${index + 1}`),
      `추가 운전자 ${index + 1} 운전면허증`,
    ));
    /* 검증에서 확정한 서명자 관계를 그대로 넘긴다 — payload 를 여기서 다시 읽으면 판정이 두 벌이 된다. */
    supportingDocuments = supportingDocumentsFor(session, parsed.signer?.role);
    validateServerProgress(session);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '제출 내용을 확인해 주세요.' }, 400);
  }

  const contractCode = S(session.contractCode);
  const bundle = await loadFreepassEsignBundle(contractCode);
  if (!bundle) return json({ error: '계약을 찾을 수 없습니다.' }, 404);

  const claim = await bundle.db.ref(`v4/esign_sessions/${hash}`).transaction((current) => {
    // Admin SDK의 transaction은 로컬 캐시가 비어 있으면 첫 호출에서 null을 줄 수 있다.
    // null을 그대로 제안해야 서버 충돌 후 실제 값으로 재호출되며, 여기서 undefined를
    // 반환하면 정상 세션도 즉시 abort되어 제출이 영구적으로 막힌다.
    if (!current) return current;
    if (!submissionClaimAvailable(current, now)) return;
    if (Number(current.expiresAt || 0) <= Date.now()) return;
    return { ...current, status: 'submitting', submittingAt: now };
  }, undefined, false);
  const claimed = record(claim.snapshot.val());
  if (!claim.committed || S(claimed.status) !== 'submitting' || Number(claimed.submittingAt || 0) !== now) {
    return json({ error: '이미 제출 중이거나 처리된 계약입니다.' }, 409);
  }

  try {
    const [idBytes, selfieBytes, additionalDriverLicenseBytes] = await Promise.all([
      idCard ? idCard.arrayBuffer().then((value) => new Uint8Array(value)) : Promise.resolve(null),
      selfie ? selfie.arrayBuffer().then((value) => new Uint8Array(value)) : Promise.resolve(null),
      Promise.all(additionalDriverLicenses.map((file) => file.arrayBuffer().then((value) => new Uint8Array(value)))),
    ]);
    const root = `esign-private/${contractCode}/${hash}`;
    const [idAsset, selfieAsset, additionalDriverAssets] = await withTimeout(Promise.all([
      idCard && idBytes ? uploadPrivateEsignFile(`${root}/id-card.${extension(idCard)}`, idBytes, idCard.type) : Promise.resolve(null),
      selfie && selfieBytes ? uploadPrivateEsignFile(`${root}/selfie.${extension(selfie)}`, selfieBytes, selfie.type) : Promise.resolve(null),
      Promise.all(additionalDriverLicenses.map((file, index) => uploadPrivateEsignFile(
        `${root}/additional-driver-${index + 1}-license.${extension(file)}`,
        additionalDriverLicenseBytes[index],
        file.type,
      ))),
    ]), PRIVATE_UPLOAD_TIMEOUT_MS);
    const claimedSession = record(claim.snapshot.val());
    const progress = record(claimedSession.progress);
    const parsed = validateSubmission(payload, record(claimedSession.snapshot));
    const consentTimes: EsignRecord = {
      identity_verified: now,
      identity: Number(progress.identity || 0) || now,
      vehicle: Number(progress.vehicle || 0) || now,
      rental: Number(progress.rental || 0) || now,
      payment: Number(progress.payment || 0) || now,
      driver: Number(progress.driver || 0) || now,
      insurance: Number(progress.insurance || 0) || now,
      accident: Number(progress.accident || 0) || now,
      service: Number(progress.service || 0) || now,
      documents: now,
      agreement: Number(progress.agreement || 0) || now,
    };
    for (const key of parsed.consents) consentTimes[key] = now;
    const submission: EsignRecord = {
      status: 'pending_review',
      submittedAt: now,
      customer_name: parsed.name,
      customer_phone: parsed.phone,
      // 개인은 생년월일, 법인은 법인등록번호를 같은 계약서 식별 칸에만 기록한다.
      // 어느 경우에도 주민등록번호는 받거나 저장하지 않는다.
      customer_id: S(payload.customer_id),
      ...(parsed.customerBirth ? { customer_birth: parsed.customerBirth } : {}),
      customer_address: S(payload.customer_address),
      driver_license_no: S(payload.driver_license_no),
      /* 법인일 때만 싣는다 — 개인 계약에서는 서명자가 곧 계약자라 같은 값을 두 번 두지 않는다.
         권한은 법인등기·인감·위임 서류로 확인하므로 서명자 고유식별번호는 받지 않는다. */
      ...(parsed.signer ? {
        signer_name: parsed.signer.name,
        signer_role: parsed.signer.role,
      } : {}),
      emergency_relation: parsed.emergencyRelation,
      emergency_name: parsed.emergencyName,
      emergency_phone: parsed.emergencyPhone,
      ...(parsed.business.no.length === 10 ? {
        tax_biz_name: parsed.business.name, tax_biz_no: parsed.business.no, tax_ceo: parsed.business.ceo,
        tax_biz_type_item: parsed.business.typeItem, tax_email: parsed.business.email, tax_biz_address: parsed.business.address,
        tax_issue_type: '개인사업자 (사업자등록번호 발행)',
      } : {}),
      ...(parsed.salesProof ? { sales_proof: parsed.salesProof } : {}),
      additional_drivers: parsed.additionalDrivers.map((driver, index) => ({
        ...driver,
        licensePath: additionalDriverAssets[index].path,
        licenseSha256: additionalDriverAssets[index].sha256,
        licenseContentType: additionalDriverAssets[index].contentType,
      })),
      supporting_documents: supportingDocuments,
      signature: parsed.signature,
      signatureSha256: sha256(parsed.signature),
      consentTimes,
      clientConfirmations: parsed.confirmations,
      documentSourceViewedAt: parsed.documentSourceViewedAt,
      evidence: requestEvidence(request, hash),
      ...(idAsset ? {
        idCardPath: idAsset.path,
        idCardSha256: idAsset.sha256,
        idCardContentType: idAsset.contentType,
        idCardRrnMaskedConfirmed: true,
      } : {}),
      ...(selfieAsset ? {
        selfiePath: selfieAsset.path,
        selfieSha256: selfieAsset.sha256,
        selfieContentType: selfieAsset.contentType,
      } : {}),
    };
    const sessionUpdate: EsignRecord = {
        status: 'pending_review', submittedAt: now, submittingAt: null,
    };
    const contractUpdate: EsignRecord = {
        customer_name: parsed.name,
        customer_phone: parsed.phone,
        additional_driver: parsed.additionalDrivers.length ? `${parsed.additionalDrivers.length}인 지정` : '없음',
        sign_status: '검토대기',
        esign_progress: 7,
        esign_submitted_at: now,
        sign_consents: consentTimes,
        sign_rejected_at: null,
        sign_reject_reason: null,
        esign_documents: [
          ...(idAsset ? [{ key: 'driver_license', label: '운전면허증', submittedAt: now, sha256: idAsset.sha256 }] : []),
          ...(selfieAsset ? [{ key: 'selfie', label: '본인 얼굴 사진', submittedAt: now, sha256: selfieAsset.sha256 }] : []),
          ...additionalDriverAssets.map((asset, index) => ({
            key: `additional_driver_license_${index + 1}`,
            label: `추가 운전자 ${index + 1} 운전면허증`,
            submittedAt: now,
            sha256: asset.sha256,
          })),
          ...supportingDocuments.map((document) => ({
            key: `supporting_${S(document.key)}`,
            label: S(document.label),
            submittedAt: Number(document.uploadedAt || now),
            sha256: S(document.sha256),
          })),
        ],
        ...(idAsset && selfieAsset ? { esign_identity: {
          idCardSha256: idAsset.sha256,
          selfieSha256: selfieAsset.sha256,
          submittedAt: now,
          verifiedAt: 0,
        } } : {}),
    };
    // 고객 제출자료·검토상태·목록표시는 하나의 상태이므로 부분 완료가 생기지 않게 원자적으로 저장한다.
    await bundle.db.ref('v4').update({
      // 발행 때 서버 전용으로 보관한 fps_ 링크를 덮어쓰지 않는다.
      ...childUpdates(`esign_private/${contractCode}/${hash}`, submission),
      ...childUpdates(`esign_sessions/${hash}`, sessionUpdate),
      ...childUpdates(`contracts/${contractCode}`, contractUpdate),
      ...freepassEsignEventUpdates(contractCode, 'submitted', requestEvidence(request, hash)),
    });
    return json({ ok: true, status: '검토대기' });
  } catch (error) {
    await bundle.db.ref(`v4/esign_sessions/${hash}`).transaction((current) => {
      if (!current) return current;
      if (S(current.status) !== 'submitting' || Number(current.submittingAt || 0) !== now) return;
      return {
        ...current,
        status: Number(current.openedAt || 0) ? 'opened' : 'sent',
        submittingAt: null,
      };
    }, undefined, false).catch(() => {});
    console.error('[freepass-esign] public submit failed', contractCode, error instanceof Error ? error.message : 'unknown');
    return json({ error: '본인확인 자료와 서명을 안전하게 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
  }
}
