import 'server-only';
import { applyPolicyDefaults } from '@/lib/domain/policy-defaults';

import { createHash, randomBytes } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import { getStorage } from 'firebase-admin/storage';
import type { ActiveBearer } from '@/lib/server/firebase-admin';
import { firebaseAdminApp, firebaseAdminDatabase } from '@/lib/server/firebase-admin';
import {
  AGREEMENT_CONFIRM_LABEL,
  buildConsentGroups,
  paginateForMobile,
  SAMPLE_AGREEMENT,
} from '@/lib/domain/esign-consent-doc';
import { findContractKind } from '@/lib/domain/esign-contract-kind';
import {
  findTemplate,
  standardTemplateSelectionError,
} from '@/lib/domain/esign-templates';
import {
  buildTemplateFieldsFromRecords,
  freepassVehicleStateIssueError,
  frozenTemplateStateFromRecords,
  isFrozenTemplateState,
  omitTemplateSemanticStateFields,
} from '@/lib/domain/esign-template-fields';
import {
  buildFreepassConsentProfile,
  freepassConsentOperationalBlocker,
  FREEPASS_CONSENT_PROFILE_VERSION,
  isFrozenFreepassConsentProfile,
} from '@/lib/domain/freepass-esign-consents';
import { esignAdditionalDriverLimit } from '@/lib/domain/esign-center';
import { additionalDriverCostLabel, productMatchesTemplate } from '@/lib/domain/esign-vehicle-selection';
import { ESIGN_DOCUMENT_PRESETS, freepassEsignRequiredDocuments } from '@/lib/domain/esign-required-documents';
import { isUsableInsurerName } from '@/lib/domain/policy-tier';
import { isContractCancelled } from '@/lib/domain/contract';
import {
  canonicalFreepassDirectManualTerms,
  canonicalFreepassDirectManualTermsDraft,
} from '@/lib/domain/freepass-direct-manual-terms';

export {
  canonicalFreepassDirectManualTerms,
  canonicalFreepassDirectManualTermsDraft,
} from '@/lib/domain/freepass-direct-manual-terms';

export type EsignRecord = Record<string, unknown>;

/**
 * 서버가 직접 전자계약을 만들 때 함께 보관하는 비공개 정본.
 *
 * `v4/contracts`는 업무 목록·상태 전이를 위한 공개 projection이라 기존 클라이언트가
 * 읽을 수 있다. 가격·차량·정책·서식의 발행 근거는 이 seal만 신뢰한다. v4의 미정의
 * child는 RTDB rules의 `$other:false`로 클라이언트 접근이 막힌다.
 */
export type FreepassDirectContractSeal = {
  version: 'v1';
  contractCode: string;
  createdAt: number;
  createdByUid: string;
  requestHash: string;
  contract: EsignRecord;
  product: EsignRecord;
  policy: EsignRecord;
  partner: EsignRecord;
  templateId: string;
  contractKind: string;
  manualTerms: EsignRecord;
  settlementRateBasis: {
    productType: string;
    feeRate: number | null;
    payoutRate: number | null;
    status: 'sealed' | 'admin_review_required';
  };
};

export const FREEPASS_ESIGN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const FREEPASS_ESIGN_CONSENT_VERSION = FREEPASS_CONSENT_PROFILE_VERSION;

const S = (value: unknown) => String(value ?? '').trim();

function settlementRate(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

/**
 * 전자계약 발행 시 정산에 쓸 요율은 브라우저·공개 partner 값이 아니라 Admin SDK가 읽은
 * private 기준값만 사용한다. 기준값이 비어 있으면 계약서 발행 자체는 가능하지만, 정산은
 * 임의 기본율로 만들지 않고 관리자 요율확정 전까지 닫는다.
 */
export async function resolveFreepassSettlementRateBasis(input: {
  db: Database;
  contract: EsignRecord;
  product: EsignRecord | null;
}): Promise<{
  productType: string;
  feeRate: number | null;
  payoutRate: number | null;
  status: 'sealed' | 'admin_review_required';
}> {
  const productType = S(input.product?.product_type);
  if (!productType) throw new Error('정산 기준을 동결할 차량 상품구분을 찾을 수 없습니다.');
  const providerCode = S(input.contract.provider_company_code);
  const agentUid = S(input.contract.agent_uid);
  const [partnerPrivateSnap, agentPrivateSnap] = await Promise.all([
    providerCode ? input.db.ref(`v4/partners_private/${providerCode}`).get().catch(() => null) : Promise.resolve(null),
    agentUid ? input.db.ref(`v4/users_private/${agentUid}`).get().catch(() => null) : Promise.resolve(null),
  ]);
  const partnerPrivate = recordFromNode(partnerPrivateSnap?.val());
  const agentPrivate = recordFromNode(agentPrivateSnap?.val());
  const feeRate = productType.startsWith('신차') ? 0 : settlementRate(partnerPrivate?.fee_rate);
  const payoutRate = settlementRate(agentPrivate?.agent_payout_rate);
  return {
    productType,
    feeRate,
    payoutRate,
    status: feeRate != null && payoutRate != null ? 'sealed' : 'admin_review_required',
  };
}

export function validContractCode(value: unknown): string {
  const code = S(value);
  if (!code || code.length > 100 || /[.#$\[\]\/\u0000-\u001f\u007f]/.test(code)) return '';
  return code;
}

export function canManageFreepassEsign(actor: ActiveBearer | null | undefined): boolean {
  if (!actor) return false;
  return actor.rawRole === 'admin'
    || actor.rawRole === 'agent'
    || actor.rawRole === 'agent_admin'
    || actor.rawRole === 'agent_manager';
}

/**
 * 전자계약 API의 레코드 경계.
 * Admin SDK는 RTDB rules를 우회하므로 API에서 계약 소유권을 다시 확인해야 한다.
 */
export function canAccessFreepassEsignContract(
  actor: ActiveBearer | null | undefined,
  contract: EsignRecord | null | undefined,
): boolean {
  if (!actor || !contract || !canManageFreepassEsign(actor)) return false;
  if (actor.rawRole === 'admin') return true;
  if (S(contract.agent_uid) === actor.uid) return true;
  return (actor.rawRole === 'agent_admin' || actor.rawRole === 'agent_manager')
    && !!actor.agentChannelCode
    && S(contract.agent_channel_code) === actor.agentChannelCode;
}

/** 고객 본인확인 자료 검토·승인·인도일 확정은 플랫폼 관리자 전용이다. */
export function canReviewFreepassEsign(actor: ActiveBearer | null | undefined): boolean {
  return actor?.rawRole === 'admin';
}

export function makeFreepassSignToken(): string {
  return `fps_${randomBytes(32).toString('base64url')}`;
}

export function hashFreepassSignToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function asEsignRecord(value: unknown): EsignRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as EsignRecord : null;
}

function recordFromNode(value: unknown): EsignRecord | null {
  return asEsignRecord(value);
}

/** 서버 전용 seal 값도 외부 입력처럼 구조를 다시 확인해 발행 경계에서 fail-closed 한다. */
export function readFreepassDirectContractSeal(value: unknown): FreepassDirectContractSeal | null {
  const row = asEsignRecord(value);
  if (!row || S(row.version) !== 'v1') return null;
  const contractCode = validContractCode(row.contractCode);
  const contract = asEsignRecord(row.contract);
  const product = asEsignRecord(row.product);
  const policy = asEsignRecord(row.policy);
  const partner = asEsignRecord(row.partner);
  const manualTerms = canonicalFreepassDirectManualTerms(row.manualTerms);
  const rate = asEsignRecord(row.settlementRateBasis);
  const feeRate = rate && rate.feeRate != null ? settlementRate(rate.feeRate) : null;
  const payoutRate = rate && rate.payoutRate != null ? settlementRate(rate.payoutRate) : null;
  const status = S(rate?.status);
  const template = findTemplate(row.templateId);
  const kind = findContractKind(S(row.contractKind));
  const canonicalDraft = canonicalFreepassDirectManualTermsDraft(manualTerms);
  const canonicalContract: EsignRecord = { ...contract, contract_draft: canonicalDraft || '' };
  if (!contractCode || !contract || !product || !policy || !partner || !rate || !manualTerms || !canonicalDraft
    || S(canonicalContract.contract_code) !== contractCode
    || String(canonicalContract.contract_source ?? '') !== 'direct'
    || S(product.product_code || product._key) !== S(canonicalContract.product_code)
    || S(policy.policy_code || policy._key) !== S(canonicalContract.policy_code)
    || S(partner.partner_code || partner.provider_company_code || partner._key) !== S(canonicalContract.provider_company_code)
    || !template || !kind || template.id !== S(row.templateId) || kind.key !== S(row.contractKind)
    || template.contractKind !== kind.kind || !productMatchesTemplate(product as never, template)
    || !!standardTemplateSelectionError(template, kind, policy)
    || S(canonicalContract.standard_template_id) !== template.id || S(canonicalContract.contract_kind) !== kind.key
    || S(canonicalContract.esign_maturity) !== kind.maturity || S(canonicalContract.esign_insurance_side) !== template.insuranceSide
    || !S(rate.productType) || S(rate.productType) !== S(canonicalContract.product_type_snapshot)
    || S(rate.productType) !== S(product.product_type)
    || !['sealed', 'admin_review_required'].includes(status)) return null;
  if (status === 'sealed' && (feeRate == null || payoutRate == null)) return null;
  return {
    version: 'v1',
    contractCode,
    createdAt: Number(row.createdAt || 0),
    createdByUid: S(row.createdByUid),
    requestHash: S(row.requestHash),
    contract: canonicalContract,
    product,
    policy,
    partner,
    templateId: S(row.templateId),
    contractKind: S(row.contractKind),
    manualTerms,
    settlementRateBasis: {
      productType: S(rate.productType), feeRate, payoutRate,
      status: status as 'sealed' | 'admin_review_required',
    },
  };
}

/** 공개 계약 projection이 private seal의 발행 근거와 달라지지 않았는지 확인한다. */
export function freepassDirectSealMatchesContract(current: EsignRecord, sealed: EsignRecord): boolean {
  const keys = [
    'contract_code', 'contract_number', 'contract_date', 'contract_origin', 'contract_source',
    'product_code', 'product_type_snapshot', 'policy_code', 'standard_template_id', 'contract_kind',
    'esign_contract_kind', 'esign_maturity', 'esign_insurance_side',
    'agent_uid', 'agent_code', 'agent_name', 'agent_channel_code', 'provider_company_code',
    'car_number_snapshot', 'vehicle_name_snapshot', 'year_snapshot', 'fuel_type_snapshot',
    'rent_month_snapshot', 'rent_amount_snapshot', 'deposit_amount_snapshot', 'deposit_payment_type',
    'payment_timing_snapshot', 'driver_age_snapshot', 'annual_mileage_snapshot', 'price_variant_snapshot',
    'mileage_surcharge_snapshot', 'age_surcharge_snapshot', 'pricing_snapshot_version',
    'special_terms_choice_snapshot', 'special_terms_snapshot', 'buyout_price', 'driver_scope',
  ];
  const currentDraft = canonicalFreepassDirectManualTermsDraft(current.contract_draft);
  const sealedDraft = canonicalFreepassDirectManualTermsDraft(sealed.contract_draft);
  return keys.every((key) => S(current[key]) === S(sealed[key]))
    && !!currentDraft
    && currentDraft === sealedDraft;
}

/** 새 직접 전자계약은 서버 seal + 고객 서명 + 관리자 승인 전에는 차량·정산의 기준이 될 수 없다. */
export function isFreepassDirectContract(contract: EsignRecord | null | undefined): boolean {
  // 새 client write는 Rules가 canonical `direct`를 만들지 못하게 막는다. 서버는 그보다
  // 넓게 인식해, 과거의 공백/파생 origin 같은 의심스러운 직접계약도 차량·정산에서
  // seal·서명·승인 증빙을 요구하는 쪽으로 fail-closed 한다.
  return S(contract?.contract_source) === 'direct'
    || /계약서직접등록|전자계약직접/.test(S(contract?.contract_origin));
}

export type FreepassDirectCompletion = {
  required: boolean;
  ok: boolean;
  reason: string;
  seal: FreepassDirectContractSeal | null;
  /** 정산 공개 레코드에는 고객이 승인 시 제출한 이름만 서버에서 옮긴다. */
  customerName: string;
};

/**
 * 공개 계약의 `서명완료` 문자열만으로는 완료를 신뢰하지 않는다. 직접계약은 private seal,
 * signed session, 승인된 private submission, 최종 verification까지 서로 같은 회차인지
 * 서버에서 교차 확인한다. legacy/ERP 계약은 기존 완료 흐름을 유지한다.
 */
export async function verifyFreepassDirectContractCompletion(input: {
  db: Database;
  contract: EsignRecord | null | undefined;
  contractCode?: string;
  /** 정산·계약완료처럼 실제 인도까지 끝난 단계에서는 관리자 인도일 증빙도 필요하다. */
  requireHandover?: boolean;
}): Promise<FreepassDirectCompletion> {
  const contract = input.contract || null;
  if (!isFreepassDirectContract(contract)) return { required: false, ok: true, reason: '', seal: null, customerName: '' };
  const contractCode = validContractCode(input.contractCode || contract?.contract_code);
  if (!contractCode) return { required: true, ok: false, reason: '직접 전자계약의 계약번호가 올바르지 않습니다.', seal: null, customerName: '' };
  const sealSnap = await input.db.ref(`v4/esign_contract_seals/${contractCode}`).get().catch(() => null);
  const seal = readFreepassDirectContractSeal(sealSnap?.val());
  if (!seal || seal.contractCode !== contractCode || !contract || !freepassDirectSealMatchesContract(contract, seal.contract)) {
    return { required: true, ok: false, reason: '서버가 동결한 직접 전자계약 기준을 확인하지 못했습니다. 새 계약서로 다시 만들어 주세요.', seal: null, customerName: '' };
  }
  const hash = S(contract.esign_session_hash);
  const sealHash = S(contract.esign_seal_hash);
  if (!/^[a-f0-9]{64}$/.test(hash) || !/^[a-f0-9]{64}$/.test(sealHash)) {
    return { required: true, ok: false, reason: '고객 전자서명과 관리자 승인 완료 후 진행할 수 있습니다.', seal: null, customerName: '' };
  }
  const [sessionSnap, privateSnap, verificationSnap, handoverSnap] = await Promise.all([
    input.db.ref(`v4/esign_sessions/${hash}`).get().catch(() => null),
    input.db.ref(`v4/esign_private/${contractCode}/${hash}`).get().catch(() => null),
    input.db.ref(`v4/esign_verifications/${sealHash}`).get().catch(() => null),
    input.requireHandover
      ? input.db.ref(`v4/esign_handover_verifications/${contractCode}`).get().catch(() => null)
      : Promise.resolve(null),
  ]);
  const session = asEsignRecord(sessionSnap?.val());
  const submission = asEsignRecord(privateSnap?.val());
  const verification = asEsignRecord(verificationSnap?.val());
  const handover = asEsignRecord(handoverSnap?.val());
  const snapshot = asEsignRecord(session?.snapshot);
  const consentProfile = asEsignRecord(snapshot?.consentProfile);
  const documentHash = S(contract.esign_document_sha256);
  const customerName = S(submission?.customer_name);
  const hasApprovedAssets = /^[a-f0-9]{64}$/i.test(S(submission?.signatureSha256))
    && /^[a-f0-9]{64}$/i.test(S(submission?.idCardSha256))
    && /^[a-f0-9]{64}$/i.test(S(submission?.selfieSha256))
    && /^[a-f0-9]{64}$/i.test(S(submission?.pdfSha256))
    && !!S(submission?.idCardPath)
    && !!S(submission?.selfiePath)
    && !!S(submission?.pdfPath)
    && S(submission?.pdfSha256) === documentHash;
  const insuranceEvidence = asEsignRecord(submission?.customer_insurance_evidence);
  const verificationInsuranceEvidence = asEsignRecord(verification?.customerInsuranceEvidence);
  const landlord = S(asEsignRecord(snapshot?.landlord)?.companyName);
  const customerInsuranceComplete = S(seal.contract.esign_insurance_side) !== '고객직접'
    || (S(insuranceEvidence?.certificateKey) === 'customer_insurance_certificate'
      && /^[a-f0-9]{64}$/i.test(S(insuranceEvidence?.sha256))
      && Number(insuranceEvidence?.verifiedAt || 0) > 0
      && !!S(insuranceEvidence?.verifiedBy)
      && !!landlord
      && S(insuranceEvidence?.lienholder) === landlord
      && S(verificationInsuranceEvidence?.sha256) === S(insuranceEvidence?.sha256)
      && S(verificationInsuranceEvidence?.lienholder) === landlord);
  const handoverComplete = !input.requireHandover || (
    consentProfile?.cmsRequiredBeforeHandover !== true
    && S(handover?.provider) === 'freepass'
    && S(handover?.contractCode) === contractCode
    && S(handover?.sessionHash) === hash
    && S(handover?.sealHash) === sealHash
    && S(handover?.documentSha256) === documentHash
    && !!S(handover?.handover_datetime)
    && !!S(handover?.contract_start)
    && !!S(handover?.contract_end)
    && Number(handover?.confirmedAt || 0) > 0
    && !!S(handover?.confirmedBy)
  );
  const complete = S(contract.esign_provider) === 'freepass'
    && S(contract.sign_status) === '서명완료'
    && Number(contract.sign_signed_at || 0) > 0
    && /^[a-f0-9]{64}$/i.test(documentHash)
    && S(session?.provider) === 'freepass'
    && S(session?.contractCode) === contractCode
    && S(session?.status) === 'signed'
    && S(session?.sealHash) === sealHash
    && hasFrozenFreepassTemplateState(session)
    && hasFrozenFreepassConsentProfile(session)
    && S(submission?.status) === 'approved'
    && S(submission?.sealHash) === sealHash
    && S(verification?.provider) === 'freepass'
    && S(verification?.contractCode) === contractCode
    && S(verification?.sealHash) === sealHash
    && S(verification?.documentSha256) === documentHash
    && Number(session?.approvedAt || 0) > 0
    && Number(submission?.approvedAt || 0) > 0
    && Number(verification?.signedAt || 0) > 0
    && hasApprovedAssets
    && customerInsuranceComplete
    && handoverComplete
    && !!customerName;
  return complete
    ? { required: true, ok: true, reason: '', seal, customerName }
    : {
      required: true,
      ok: false,
      reason: input.requireHandover
        ? '고객 전자서명·관리자 승인·인도일 확정이 모두 끝난 뒤 진행할 수 있습니다.'
        : '고객 전자서명과 관리자 승인 완료 후 진행할 수 있습니다.',
      seal: null,
      customerName: '',
    };
}

/** 발행 당시 상품·보험·당사자 상태를 모두 봉인한 세션만 고객 링크로 재사용한다. */
export function hasFrozenFreepassTemplateState(session: EsignRecord | null | undefined): boolean {
  const snapshot = recordFromNode(session?.snapshot);
  return !!snapshot && isFrozenTemplateState(snapshot.templateState);
}

/** 발행 시점에 필요한 동의 종류·전문을 동결한 세션만 고객 입력을 받을 수 있다. */
export function hasFrozenFreepassConsentProfile(session: EsignRecord | null | undefined): boolean {
  const snapshot = recordFromNode(session?.snapshot);
  return !!snapshot && isFrozenFreepassConsentProfile(snapshot.consentProfile);
}

function mergeRecord(legacy: unknown, overlay: unknown): EsignRecord | null {
  const a = recordFromNode(legacy);
  const b = recordFromNode(overlay);
  return a || b ? { ...(a || {}), ...(b || {}) } : null;
}

/**
 * 계약은 일반 기준정보와 달리 v3/v4 어느 한쪽의 취소·폐기만으로도 발행 대상에서
 * 제외된다. 단순 spread 병합이면 담당자가 overlay에 「계약요청」을 써서 v3 취소를
 * 되살릴 수 있으므로, terminal 상태를 다시 fail-closed로 고정한다.
 */
function mergeFreepassContract(legacy: unknown, overlay: unknown): EsignRecord | null {
  const a = recordFromNode(legacy);
  const b = recordFromNode(overlay);
  const merged = mergeRecord(a, b);
  if (!merged) return null;
  if (isContractCancelled(a as Record<string, unknown> | null) || isContractCancelled(b as Record<string, unknown> | null)) {
    merged.contract_status = '계약취소';
  }
  if (a?._deleted === true || !!a?.deletedAt || b?._deleted === true || !!b?.deletedAt) {
    merged._deleted = true;
    merged.deletedAt = a?.deletedAt || b?.deletedAt || 'tombstone';
  }
  return merged;
}

/** 취소·soft-delete 계약은 링크 재발행·고객자료 수집·PDF 생성을 모두 닫는다. */
export function isInactiveFreepassContract(contract: EsignRecord | null | undefined): boolean {
  return !contract
    || isContractCancelled(contract)
    || contract._deleted === true
    || !!contract.deletedAt;
}

function partnerFromNodes(legacyValue: unknown, overlayValue: unknown, providerCode: string): EsignRecord | null {
  const byCode = new Map<string, EsignRecord>();
  const take = (value: unknown) => {
    const node = recordFromNode(value);
    if (!node) return;
    for (const [key, raw] of Object.entries(node)) {
      const row = recordFromNode(raw);
      if (!row) continue;
      const code = S(row.partner_code || row.provider_company_code || key).toUpperCase();
      if (code) byCode.set(code, { ...(byCode.get(code) || {}), ...row, _key: key });
    }
  };
  take(legacyValue);
  take(overlayValue);
  return byCode.get(S(providerCode).toUpperCase()) || null;
}

export async function loadFreepassEsignBundle(contractCode: string) {
  const db = firebaseAdminDatabase();
  const [legacyContract, overlayContract] = await Promise.all([
    db.ref(`contracts/${contractCode}`).get().catch(() => null),
    db.ref(`v4/contracts/${contractCode}`).get().catch(() => null),
  ]);
  const contract = mergeFreepassContract(legacyContract?.val(), overlayContract?.val());
  if (!contract) return null;

  const policyCode = S(contract.policy_code);
  const productCode = S(contract.product_code);
  const providerCode = S(contract.provider_company_code);
  const [legacyPolicy, overlayPolicy, legacyProduct, overlayProduct, legacyPartners, overlayPartners] = await Promise.all([
    policyCode ? db.ref(`policies/${policyCode}`).get().catch(() => null) : Promise.resolve(null),
    policyCode ? db.ref(`v4/policies/${policyCode}`).get().catch(() => null) : Promise.resolve(null),
    productCode ? db.ref(`products/${productCode}`).get().catch(() => null) : Promise.resolve(null),
    productCode ? db.ref(`v4/products/${productCode}`).get().catch(() => null) : Promise.resolve(null),
    db.ref('partners').get().catch(() => null),
    db.ref('v4/partners').get().catch(() => null),
  ]);

  // 공급사에게 안 묻는 공통 조건(지연손해금·보관료·통지기한·청구 기준·정비점·자차 처리 제외 …)은
  // 프리패스 표준값으로 채워 계약서에 빈칸이 나가지 않게 한다. 회사 보험형의 보험사명은
  // 체결일 사실이므로 기본 안내문이 아니라 실제 명칭을 별도로 확인한다. 이미 있는 값은 덮지 않는다.
  const v4Product = recordFromNode(overlayProduct?.val());
  const storedPolicy = mergeRecord(legacyPolicy?.val(), overlayPolicy?.val());
  return {
    db,
    /** v4-only 계약은 서버가 만든 direct seal 없이는 발행하지 않는다. */
    legacyContractExists: !!legacyContract?.exists(),
    contract,
    policy: storedPolicy ? (applyPolicyDefaults(storedPolicy).next as EsignRecord) : storedPolicy,
    product: mergeRecord(legacyProduct?.val(), overlayProduct?.val()),
    // 신규 직접계약의 차량 정본은 v4/products뿐이다. v3 상품은 재고 기준으로 다시
    // 끌어오지 않는다(상품 bridge 영구 제외).
    v4Product: v4Product ? { ...v4Product, _key: productCode, product_code: productCode } : null,
    partner: partnerFromNodes(legacyPartners?.val(), overlayPartners?.val(), providerCode),
  };
}

/**
 * 새 직접계약 생성용 서버 source loader.
 *
 * 브라우저의 차량·정책 스냅샷을 다시 받지 않고 v3+v4의 현재 기준정보를 Admin SDK로
 * 읽는다. 이 함수의 결과는 곧바로 private seal에 복사되어 이후 발행에서는 live master
 * 변경에 영향을 받지 않는다.
 */
export async function loadFreepassDirectSource(productCode: string, policyCode: string): Promise<{
  db: Database;
  product: EsignRecord | null;
  policy: EsignRecord | null;
  partner: EsignRecord | null;
}> {
  const db = firebaseAdminDatabase();
  const productKey = S(productCode);
  const policyKey = S(policyCode);
  const [overlayProduct, legacyPolicy, overlayPolicy, legacyPartners, overlayPartners] = await Promise.all([
    productKey ? db.ref(`v4/products/${productKey}`).get().catch(() => null) : Promise.resolve(null),
    policyKey ? db.ref(`policies/${policyKey}`).get().catch(() => null) : Promise.resolve(null),
    policyKey ? db.ref(`v4/policies/${policyKey}`).get().catch(() => null) : Promise.resolve(null),
    db.ref('partners').get().catch(() => null),
    db.ref('v4/partners').get().catch(() => null),
  ]);
  // 상품은 v4/products가 독자 정본이다. v3 fallback은 삭제·차량상태·상품구분을
  // 과거 값으로 되살릴 수 있어 직접계약 서버 생성에는 절대 사용하지 않는다.
  const v4Product = recordFromNode(overlayProduct?.val());
  const product: EsignRecord | null = v4Product ? { ...v4Product, _key: productKey, product_code: productKey } : null;
  const storedPolicy = mergeRecord(legacyPolicy?.val(), overlayPolicy?.val());
  const policy = storedPolicy ? applyPolicyDefaults(storedPolicy).next as EsignRecord : null;
  const partner = partnerFromNodes(
    legacyPartners?.val(),
    overlayPartners?.val(),
    S(product?.provider_company_code),
  );
  return { db, product, policy, partner };
}

/**
 * 승인된 수기 오퍼는 ERP 재고 상품이 아닌 실차번호/차종을 쓴다. 그래도 정책·임대인은
 * 브라우저가 아니라 서버가 현재 정본에서 읽어 seal에 복사한다.
 */
export async function loadFreepassManualOfferSource(providerCode: string, policyCode: string): Promise<{
  db: Database;
  policy: EsignRecord | null;
  partner: EsignRecord | null;
}> {
  const db = firebaseAdminDatabase();
  const providerKey = S(providerCode);
  const policyKey = S(policyCode);
  const [legacyPolicy, overlayPolicy, legacyPartners, overlayPartners] = await Promise.all([
    policyKey ? db.ref(`policies/${policyKey}`).get().catch(() => null) : Promise.resolve(null),
    policyKey ? db.ref(`v4/policies/${policyKey}`).get().catch(() => null) : Promise.resolve(null),
    db.ref('partners').get().catch(() => null),
    db.ref('v4/partners').get().catch(() => null),
  ]);
  const storedPolicy = mergeRecord(legacyPolicy?.val(), overlayPolicy?.val());
  return {
    db,
    policy: storedPolicy ? applyPolicyDefaults(storedPolicy).next as EsignRecord : null,
    partner: partnerFromNodes(legacyPartners?.val(), overlayPartners?.val(), providerKey),
  };
}

function parseDraft(value: unknown): Record<string, string> {
  try {
    const raw = typeof value === 'string' ? JSON.parse(value) : value;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [key, val] of Object.entries(raw as EsignRecord)) {
      const k = S(key);
      const v = S(val);
      if (k && k.length <= 80 && v.length <= 500) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 유형은 승인 오퍼가 seal한 값만 쓴다. business flag만 있는 계약은 개인/법인 흐름을 추정하지 않는다. */
function customerTypeIssueError(contract: EsignRecord): string {
  const customerType = S(contract.customer_type || contract.contract_customer_type || contract.customer_type_snapshot);
  if (customerType && !['개인', '개인사업자', '법인'].includes(customerType)) return '계약자 유형을 확인할 수 없습니다. 승인 기본조건을 확인해 주세요.';
  const businessFlag = S(contract.customer_is_business).toLowerCase();
  if (!customerType && ['예', 'true', 'yes', '1'].includes(businessFlag)) {
    return '사업자 계약은 customer_type(개인사업자 또는 법인)를 확정한 뒤 별도 전자계약 절차로 발행해 주세요.';
  }
  return '';
}

function publicContractSnapshot(contract: EsignRecord): EsignRecord {
  const keys = [
    'contract_code', 'contract_date',
    'car_number_snapshot', 'vehicle_name_snapshot', 'maker_snapshot', 'model_snapshot',
    'sub_model_snapshot', 'variant_snapshot', 'trim_name_snapshot', 'trim_extra_snapshot',
    'year_snapshot', 'fuel_type_snapshot', 'rent_month_snapshot', 'rent_amount_snapshot',
    'deposit_amount_snapshot', 'payment_timing_snapshot', 'driver_age_snapshot', 'annual_mileage_snapshot',
    'price_variant_snapshot', 'mileage_surcharge_snapshot', 'age_surcharge_snapshot',
    'pricing_snapshot_version', 'special_terms_choice_snapshot', 'special_terms_snapshot',
    'policy_name_snapshot', 'provider_company_code',
  ];
  const out: EsignRecord = {};
  for (const key of keys) if (contract[key] !== undefined && contract[key] !== null) out[key] = contract[key];
  return out;
}

export function buildFreepassIssueSnapshot(args: {
  contract: EsignRecord;
  policy: EsignRecord | null;
  product: EsignRecord | null;
  partner: EsignRecord | null;
  standardTemplateId: string;
  contractKind: string;
  templateFields?: Record<string, string>;
}) {
  const template = findTemplate(args.standardTemplateId);
  const spec = findContractKind(args.contractKind);
  if (!template || !spec || template.contractKind !== spec.kind) {
    throw new Error('표준계약서 종류와 인수/반납 조합이 올바르지 않습니다.');
  }
  // 요청 body의 contractKind/template ID를 믿지 않는다. 계약의 차량 상품구분이 본문 종류를 결정한다.
  if (!args.product || !productMatchesTemplate(args.product, template)) {
    throw new Error('선택한 표준계약서가 차량 상품구분과 맞지 않습니다.');
  }
  const selectionError = standardTemplateSelectionError(template, spec, args.policy);
  if (selectionError) throw new Error(selectionError);
  const customerTypeError = customerTypeIssueError(args.contract);
  if (customerTypeError) throw new Error(customerTypeError);
  const vehicleStateError = freepassVehicleStateIssueError(args.contract, args.product);
  if (vehicleStateError) throw new Error(vehicleStateError);
  if (template.insuranceSide === '회사포함' && !isUsableInsurerName(args.policy?.insurer_name)) {
    throw new Error('보험포함 계약은 계약 체결일 기준 실제 가입 보험사·공제조합을 정책에 입력한 뒤 발행해 주세요.');
  }

  const contract = {
    ...args.contract,
    standard_template_id: template.id,
    esign_standard_template_label: template.label,
    contract_kind: spec.key,
    esign_contract_kind: spec.key,
    esign_maturity: spec.maturity,
    esign_insurance_side: template.insuranceSide,
  };
  const overrides = { ...parseDraft(args.contract.contract_draft), ...(args.templateFields || {}) };
  // 보험포함의 보험사명은 계약별 초안이 아니라 정책에 확정한 체결일 사실이다.
  // API body/과거 contract_draft가 이 값을 바꾸면 다른 보험사명으로 봉인될 수 있다.
  if (template.insuranceSide === '회사포함') delete overrides.insurer_name;
  const templateSnapshot = buildTemplateFieldsFromRecords({
    contract,
    policy: args.policy,
    partner: args.partner,
    product: args.product,
    overrides,
  });
  const templateState = frozenTemplateStateFromRecords({
    contract,
    product: args.product,
    insuranceSide: template.insuranceSide,
  });
  if (template.insuranceSide === '회사포함' && !isUsableInsurerName(templateSnapshot.fields.insurer_name)) {
    throw new Error('보험포함 계약서에 실제 가입 보험사·공제조합이 표시되지 않습니다. 정책을 확인해 주세요.');
  }
  if (template.insuranceSide === '회사포함'
    && S(templateSnapshot.fields.insurer_name) !== S(args.policy?.insurer_name)) {
    throw new Error('보험포함 계약서의 보험사명은 정책에 확정한 실제 가입 보험사·공제조합과 일치해야 합니다.');
  }
  const consentGroups = buildConsentGroups(contract, args.policy, template.insuranceSide);
  const landlordCompanyName = S(
    args.partner?.company_name || args.partner?.name || args.partner?.partner_name,
  );
  // 임대인 상호는 계약 당사자 표기와 개인정보 제공 상대방의 같은 기준값이다.
  // 특히 고객 직접가입 보험의 질권자도 이 값으로 봉인되므로, 빈 파트너를 일반어
  // "회사"로 대체해 발행하지 않는다.
  if (!landlordCompanyName) {
    throw new Error(template.insuranceSide === '고객직접'
      ? '보험별도 계약은 질권 설정을 확인할 임대인 상호를 먼저 입력해 주세요.'
      : '계약서와 개인정보 동의에 표시할 임대인 상호를 먼저 입력해 주세요.');
  }
  const additionalDriverLimit = esignAdditionalDriverLimit(args.policy);
  const customerType = S(args.contract.customer_type || args.contract.customer_type_snapshot);
  const partyPreset = customerType === '법인' ? 'corporate' : customerType === '개인사업자' ? 'business' : '';
  const partyDocuments = ESIGN_DOCUMENT_PRESETS.find((preset) => preset.key === partyPreset)?.documents || [];
  // 보험·정책 서류와 계약자 유형 서류를 모두 동결한다. 같은 key는 한 번만 남겨
  // 고객 업로드/관리자 검토 기준이 갈라지지 않게 한다.
  const requiredDocuments = [...freepassEsignRequiredDocuments(args.policy, template.insuranceSide), ...partyDocuments]
    .filter((document, index, rows) => rows.findIndex((candidate) => candidate.key === document.key) === index);
  const partyKeys = partyDocuments.map((document) => document.key);
  if (partyKeys.some((key) => !requiredDocuments.some((document) => document.required && document.key === key))) {
    throw new Error('계약자 유형별 필수 증빙을 동결하지 못했습니다. 승인 기본조건을 확인해 주세요.');
  }
  const consentProfile = buildFreepassConsentProfile({
    landlordCompanyName,
    gpsInstalled: templateSnapshot.fields.gps_installed,
    // template field의 CMS 기본값으로 정책 빈칸을 감추지 않는다. 결제방식은 실제
    // 정책에 확정된 값이어야 별도 CMS 인도 게이트도 계약 사실대로 동작한다.
    paymentMethod: args.policy?.payment_method,
    screeningCriteria: args.policy?.screening_criteria,
    requiredDocuments,
  });
  // CMS 출금동의·예금주 인증을 보관·검증하는 별도 흐름은 아직 연결되지 않았다.
  // 링크만 먼저 발행하면 고객 서명 후 인도·완료 단계에서 영구적으로 멈추므로 발행 전에 막는다.
  const consentOperationalBlocker = freepassConsentOperationalBlocker(consentProfile);
  if (consentOperationalBlocker) throw new Error(consentOperationalBlocker);
  return {
    contract: publicContractSnapshot(contract),
    landlord: { companyName: landlordCompanyName },
    contractKind: {
      key: spec.key,
      label: spec.label,
      kind: spec.kind,
      maturity: spec.maturity,
      title: spec.title,
      maturityNote: spec.maturityNote,
      insuranceSide: template.insuranceSide,
    },
    template: { id: template.id, label: template.label, version: template.version },
    additionalDriverPolicy: {
      allowed: additionalDriverLimit > 0,
      limit: additionalDriverLimit,
      cost: additionalDriverCostLabel(args.policy?.additional_driver_cost),
      driverScope: S(args.policy?.personal_driver_scope),
    },
    requiredDocuments,
    consentGroups,
    consentPages: paginateForMobile(consentGroups),
    consentProfile,
    // 고객 화면의 상세 표시는 동결된 profile만 쓴다. 호환 소비처도 같은 값을 보게 둔다.
    consentAtoms: consentProfile.atoms,
    agreement: {
      title: SAMPLE_AGREEMENT.title,
      version: SAMPLE_AGREEMENT.version,
      sections: SAMPLE_AGREEMENT.sections,
      confirmLabel: AGREEMENT_CONFIRM_LABEL,
    },
    // state 키는 어떤 초안/관리자 입력으로도 완료 PDF의 상품·보험 분기를 바꾸면 안 된다.
    templateFields: omitTemplateSemanticStateFields(templateSnapshot.fields),
    templateState,
  };
}

export async function appendFreepassEsignEvent(
  contractCode: string,
  type: string,
  details: EsignRecord = {},
): Promise<void> {
  await firebaseAdminDatabase().ref('v4').update(freepassEsignEventUpdates(contractCode, type, details));
}

/** v4 루트 다중경로 갱신에 계약 상태와 같은 트랜잭션으로 합칠 수 있는 감사이력 조각. */
export function freepassEsignEventUpdates(
  contractCode: string,
  type: string,
  details: EsignRecord = {},
): EsignRecord {
  const now = Date.now();
  const key = `${now}_${randomBytes(4).toString('hex')}`;
  return {
    [`esign_events/${contractCode}/${key}`]: { type, at: now, ...details },
  };
}

export function sessionHashFromContract(contract: EsignRecord): string {
  const stored = S(contract.esign_session_hash);
  if (/^[a-f0-9]{64}$/.test(stored)) return stored;
  const token = freepassSignTokenFromUrl(contract.esign_sign_url);
  return token ? hashFreepassSignToken(token) : '';
}

export function freepassSignTokenFromUrl(value: unknown): string {
  return S(value).match(/\/(?:sign\/)?(fps_[A-Za-z0-9_-]+)(?:[/?#]|$)/)?.[1] || '';
}

export function publicFreepassSignUrl(token: string, fallbackOrigin = ''): string {
  const publicOrigin = S(process.env.FREEPASS_ESIGN_PUBLIC_BASE_URL).replace(/\/+$/, '');
  if (publicOrigin) return `${publicOrigin}/${token}`;
  return `${S(fallbackOrigin).replace(/\/+$/, '')}/sign/${token}`;
}

export function canonicalFreepassSignUrl(value: unknown): string {
  const link = S(value);
  const token = freepassSignTokenFromUrl(link);
  return token && S(process.env.FREEPASS_ESIGN_PUBLIC_BASE_URL)
    ? publicFreepassSignUrl(token)
    : link;
}

export async function loadFreepassSessionByToken(token: string): Promise<{ hash: string; session: EsignRecord } | null> {
  if (!/^fps_[A-Za-z0-9_-]{30,100}$/.test(token)) return null;
  const hash = hashFreepassSignToken(token);
  const snap = await firebaseAdminDatabase().ref(`v4/esign_sessions/${hash}`).get().catch(() => null);
  const session = recordFromNode(snap?.val());
  return session ? { hash, session } : null;
}

export function freepassStorageBucket() {
  const bucketName = S(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
  if (!bucketName) throw new Error('Firebase Storage 버킷이 설정되지 않았습니다.');
  return getStorage(firebaseAdminApp()).bucket(bucketName);
}

export async function uploadPrivateEsignFile(path: string, bytes: Uint8Array, contentType: string) {
  const bucket = freepassStorageBucket();
  const file = bucket.file(path);
  await file.save(Buffer.from(bytes), {
    resumable: false,
    contentType,
    metadata: {
      cacheControl: 'private, no-store, max-age=0',
      metadata: { purpose: 'freepass-esign-private' },
    },
  });
  return { path, sha256: sha256(bytes), size: bytes.byteLength, contentType };
}

/**
 * 이미 제출된 첨부서류가 봉인 직전에도 같은 바이트인지 확인한다.
 * 공개 업로드와 제출 상태 전이가 겹쳐도 RTDB 포인터의 해시와 Storage 실물이 달라지면 승인하지 않는다.
 */
export async function privateEsignFileSha256(path: unknown): Promise<string | null> {
  const safePath = S(path);
  if (!safePath.startsWith('esign-private/') || safePath.includes('..') || safePath.includes('\u0000')) return null;
  try {
    const [bytes] = await freepassStorageBucket().file(safePath).download();
    return sha256(bytes);
  } catch {
    return null;
  }
}

export function eventRows(value: unknown): EsignRecord[] {
  const node = recordFromNode(value);
  if (!node) return [];
  return Object.values(node)
    .map(recordFromNode)
    .filter((row): row is EsignRecord => !!row)
    .sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
}
