import 'server-only';
import { applyPolicyDefaults } from '@/lib/domain/policy-defaults';

import { createHash, randomBytes } from 'node:crypto';
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
import { pendingConsents } from '@/lib/domain/esign-inputs';
import { esignAdditionalDriverLimit } from '@/lib/domain/esign-center';
import { additionalDriverCostLabel, productMatchesTemplate } from '@/lib/domain/esign-vehicle-selection';
import { freepassEsignRequiredDocuments } from '@/lib/domain/esign-required-documents';
import { isUsableInsurerName } from '@/lib/domain/policy-tier';

export type EsignRecord = Record<string, unknown>;

export const FREEPASS_ESIGN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const FREEPASS_ESIGN_CONSENT_VERSION = SAMPLE_AGREEMENT.version;
// CMS는 계약 완료 뒤 별도 신청·동의 흐름이다. 본계약 서명 필수동의에 섞지 않는다.
export const FREEPASS_ESIGN_REQUIRED_CONSENTS = ['rental_terms', 'privacy', 'credit', 'gps'] as const;

const S = (value: unknown) => String(value ?? '').trim();

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

function recordFromNode(value: unknown): EsignRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as EsignRecord : null;
}

/** 발행 당시 상품·보험·당사자 상태를 모두 봉인한 세션만 고객 링크로 재사용한다. */
export function hasFrozenFreepassTemplateState(session: EsignRecord | null | undefined): boolean {
  const snapshot = recordFromNode(session?.snapshot);
  return !!snapshot && isFrozenTemplateState(snapshot.templateState);
}

function mergeRecord(legacy: unknown, overlay: unknown): EsignRecord | null {
  const a = recordFromNode(legacy);
  const b = recordFromNode(overlay);
  return a || b ? { ...(a || {}), ...(b || {}) } : null;
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
  const contract = mergeRecord(legacyContract?.val(), overlayContract?.val());
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
  const storedPolicy = mergeRecord(legacyPolicy?.val(), overlayPolicy?.val());
  return {
    db,
    contract,
    policy: storedPolicy ? (applyPolicyDefaults(storedPolicy).next as EsignRecord) : storedPolicy,
    product: mergeRecord(legacyProduct?.val(), overlayProduct?.val()),
    partner: partnerFromNodes(legacyPartners?.val(), overlayPartners?.val(), providerCode),
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

/** 공개 링크는 개인 본인확인 화면이다. 법인·개인사업자 서명 권한 흐름을 개인 주민번호 흐름으로 추정하지 않는다. */
function unsupportedCustomerTypeIssueError(contract: EsignRecord): string {
  const customerType = S(contract.customer_type || contract.contract_customer_type || contract.customer_type_snapshot);
  if (customerType === '법인') return '법인 전자계약은 법인 서명권자·권한확인 절차가 준비된 뒤 발행할 수 있습니다.';
  if (customerType === '개인사업자') return '개인사업자 전자계약은 사업자 서류·세금계산서 발행정보 절차가 준비된 뒤 발행할 수 있습니다.';
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
  const customerTypeError = unsupportedCustomerTypeIssueError(args.contract);
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
  // 고객 직접가입 보험의 질권자는 실제 임대인 법인명으로 동결되어야 한다.
  // 빈 파트너를 "회사"라는 일반어로 봉인하면 가입증명서 대조 자체가 불가능하다.
  if (template.insuranceSide === '고객직접' && !landlordCompanyName) {
    throw new Error('보험별도 계약은 질권 설정을 확인할 임대인 상호를 먼저 입력해 주세요.');
  }
  const additionalDriverLimit = esignAdditionalDriverLimit(args.policy);
  const requiredDocuments = freepassEsignRequiredDocuments(args.policy, template.insuranceSide);
  const consentAtoms = [
    // CMS는 별도 신청서·동의 절차에서 처리한다. 본계약 링크에 은행 동의를 섞지 않는다.
    ...pendingConsents(contract).filter((atom) => atom.group !== 'bank'),
    ...(requiredDocuments.length ? [{
      key: 'supporting_documents_consent',
      label: '추가 제출서류 수집·이용 및 계약 렌터카사 제공 동의',
      group: 'customer',
      required: true,
      items: [...requiredDocuments.map((document) => document.label), '제출서류에 기재된 개인정보'],
      purpose: '렌터카 계약 심사, 계약 체결 및 계약상 의무 이행 확인',
      retention: '계약 종료 후 관계 법령이 정한 기간까지',
      recipients: landlordCompanyName ? [{
        name: landlordCompanyName,
        purpose: '임대차계약 심사·체결·이행 관리',
        items: requiredDocuments.map((document) => document.label),
      }] : [],
      refusalNote: '동의하지 않으면 렌터카사가 요구하는 계약서류를 확인할 수 없어 계약을 진행할 수 없습니다.',
    }] : []),
  ];
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
    consentAtoms,
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
