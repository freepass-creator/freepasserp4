import 'server-only';

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
  templatesForContract,
} from '@/lib/domain/esign-templates';
import { buildTemplateFieldsFromRecords } from '@/lib/domain/esign-template-fields';
import { pendingConsents } from '@/lib/domain/esign-inputs';

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

  return {
    db,
    contract,
    policy: mergeRecord(legacyPolicy?.val(), overlayPolicy?.val()),
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

function publicContractSnapshot(contract: EsignRecord): EsignRecord {
  const keys = [
    'contract_code', 'contract_date', 'customer_name', 'customer_phone', 'customer_birth',
    'customer_address',
    'car_number_snapshot', 'vehicle_name_snapshot', 'maker_snapshot', 'model_snapshot',
    'sub_model_snapshot', 'variant_snapshot', 'trim_name_snapshot', 'trim_extra_snapshot',
    'year_snapshot', 'fuel_type_snapshot', 'rent_month_snapshot', 'rent_amount_snapshot',
    'deposit_amount_snapshot', 'policy_name_snapshot', 'provider_company_code',
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
  if (!templatesForContract(args.contract).some((row) => row.id === template.id)) {
    throw new Error('이 계약에서 사용할 수 없는 표준계약서입니다.');
  }
  const selectionError = standardTemplateSelectionError(template, spec, args.policy);
  if (selectionError) throw new Error(selectionError);

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
  const templateSnapshot = buildTemplateFieldsFromRecords({
    contract,
    policy: args.policy,
    partner: args.partner,
    product: args.product,
    overrides,
  });
  const consentGroups = buildConsentGroups(contract, args.policy, template.insuranceSide);
  const landlordCompanyName = S(
    args.partner?.company_name || args.partner?.name || args.partner?.partner_name,
  );
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
    consentGroups,
    consentPages: paginateForMobile(consentGroups),
    consentAtoms: pendingConsents(contract),
    agreement: {
      title: SAMPLE_AGREEMENT.title,
      version: SAMPLE_AGREEMENT.version,
      sections: SAMPLE_AGREEMENT.sections,
      confirmLabel: AGREEMENT_CONFIRM_LABEL,
    },
    templateFields: templateSnapshot.fields,
    templateState: templateSnapshot.state,
  };
}

export async function appendFreepassEsignEvent(
  contractCode: string,
  type: string,
  details: EsignRecord = {},
): Promise<void> {
  const now = Date.now();
  const key = `${now}_${randomBytes(4).toString('hex')}`;
  await firebaseAdminDatabase().ref(`v4/esign_events/${contractCode}/${key}`).set({
    type,
    at: now,
    ...details,
  });
}

export function sessionHashFromContract(contract: EsignRecord): string {
  const stored = S(contract.esign_session_hash);
  if (/^[a-f0-9]{64}$/.test(stored)) return stored;
  const link = S(contract.esign_sign_url);
  const token = link.match(/\/sign\/(fps_[A-Za-z0-9_-]+)/)?.[1] || '';
  return token ? hashFreepassSignToken(token) : '';
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

export function eventRows(value: unknown): EsignRecord[] {
  const node = recordFromNode(value);
  if (!node) return [];
  return Object.values(node)
    .map(recordFromNode)
    .filter((row): row is EsignRecord => !!row)
    .sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
}
