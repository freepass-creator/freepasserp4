import {
  findTemplate, type EsignTemplate, type StandardTemplateKey,
} from '@/lib/domain/esign-templates';

type Rec = Record<string, unknown>;
const S = (value: unknown): string => String(value ?? '').trim();

export type ProviderTemplateOverride = {
  providerCode: string;
  baseTemplateId: StandardTemplateKey;
  templateId: string;
  label: string;
  version: string;
  /** 업체별 문서가 상속한 해당 표준계약서의 판. 현재판과 다르면 발행 금지. */
  baseVersion: string;
};

export type ProviderTemplateOverrides = Record<
  string,
  Partial<Record<StandardTemplateKey, ProviderTemplateOverride>>
>;

export type ContractTemplateProfile = {
  mode: 'standard' | 'custom';
  providerCode: string;
  externalTemplateId: string;
  label: string;
  version: string;
  baseTemplateId: StandardTemplateKey;
  baseVersion: string;
};

export type ProviderContractIdentity = {
  code: string;
  companyName: string;
  ceo: string;
  businessNumber: string;
  phone: string;
  address: string;
};

function objectRecord(value: unknown): Rec | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Rec : null;
}

function safeToken(value: unknown, label: string, max = 200): string {
  const token = S(value);
  if (!token || token.length > max || /[\u0000-\u001f\u007f]/.test(token)) {
    throw new Error(`${label} 형식이 올바르지 않습니다.`);
  }
  return token;
}

/**
 * 서버 장부의 업체별 커스텀판을 세 표준계약서별로 읽는다.
 *
 * 예:
 * {
 *   "RP012": {
 *     "freepass-rent-standard": {
 *       "templateId":"tpl-rp012-rent", "label":"RP012 렌트 커스텀",
 *       "version":"rp012-rent-v1", "baseVersion":"sample-v1"
 *     }
 *   }
 * }
 */
export function parseProviderTemplateOverrides(raw: string | undefined): ProviderTemplateOverrides {
  const source = S(raw);
  if (!source) return {};
  let decoded: unknown;
  try { decoded = JSON.parse(source); }
  catch { throw new Error('업체별 계약서 설정 JSON이 올바르지 않습니다.'); }
  const root = objectRecord(decoded);
  if (!root) throw new Error('업체별 계약서 설정은 객체여야 합니다.');

  const output: ProviderTemplateOverrides = {};
  for (const [rawCode, rawProvider] of Object.entries(root)) {
    const providerCode = S(rawCode).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(providerCode)) {
      throw new Error(`업체별 계약서 공급사 코드가 올바르지 않습니다: ${rawCode}`);
    }
    if (output[providerCode]) throw new Error(`업체별 계약서 공급사 코드가 중복됩니다: ${providerCode}`);
    const providerEntries = objectRecord(rawProvider);
    if (!providerEntries) throw new Error(`업체별 계약서 설정이 객체가 아닙니다: ${providerCode}`);

    const parsed: Partial<Record<StandardTemplateKey, ProviderTemplateOverride>> = {};
    for (const [rawBaseId, rawEntry] of Object.entries(providerEntries)) {
      const base = findTemplate(rawBaseId);
      if (!base) throw new Error(`${providerCode} 커스텀판의 표준계약서 ID가 올바르지 않습니다: ${rawBaseId}`);
      const entry = objectRecord(rawEntry);
      if (!entry) throw new Error(`${providerCode} ${base.label} 커스텀 설정이 객체가 아닙니다.`);
      const baseVersion = safeToken(entry.baseVersion, `${providerCode} ${base.label} 기준판`, 100);
      if (baseVersion !== base.version) {
        throw new Error(`${providerCode} ${base.label} 커스텀판의 기준판이 현재 표준판과 다릅니다.`);
      }
      parsed[base.id] = {
        providerCode,
        baseTemplateId: base.id,
        templateId: safeToken(entry.templateId, `${providerCode} ${base.label} 템플릿 ID`),
        label: safeToken(entry.label || `${providerCode} ${base.label} 커스텀`, `${providerCode} ${base.label} 표시명`, 100),
        version: safeToken(entry.version, `${providerCode} ${base.label} 커스텀판`, 100),
        baseVersion,
      };
    }
    if (!Object.keys(parsed).length) throw new Error(`${providerCode} 업체별 계약서 설정이 비어 있습니다.`);
    output[providerCode] = parsed;
  }
  return output;
}

/** 선택된 표준계약서 1벌을 기본으로, 해당 업체의 같은 기준판 커스텀만 자동 적용한다. */
export function resolveContractTemplateProfile(
  standardTemplate: EsignTemplate,
  standardExternalTemplateId: string,
  providerCodeValue: unknown,
  overrides: ProviderTemplateOverrides,
): ContractTemplateProfile {
  const providerCode = S(providerCodeValue).toUpperCase();
  const custom = providerCode ? overrides[providerCode]?.[standardTemplate.id] : undefined;
  if (custom) {
    return {
      mode: 'custom',
      providerCode,
      externalTemplateId: custom.templateId,
      label: custom.label,
      version: custom.version,
      baseTemplateId: standardTemplate.id,
      baseVersion: custom.baseVersion,
    };
  }
  return {
    mode: 'standard',
    providerCode,
    externalTemplateId: safeToken(standardExternalTemplateId, `${standardTemplate.label} 외부 템플릿 ID`),
    label: standardTemplate.label,
    version: standardTemplate.version,
    baseTemplateId: standardTemplate.id,
    baseVersion: standardTemplate.version,
  };
}

/** 계약서 임대인/회사 영역에 들어갈 공급사 법정 표시값. */
export function providerContractIdentity(partner: Rec | null | undefined, fallbackCode: unknown): ProviderContractIdentity {
  const row = partner || {};
  return {
    code: S(row.partner_code || row.provider_company_code || fallbackCode),
    companyName: S(row.name || row.partner_name || row.company_name),
    ceo: S(row.ceo || row.representative_name || row.representative),
    businessNumber: S(row.business_number || row.biz_no || row.business_no),
    phone: S(row.phone || row.contact_phone || row.contact),
    address: S(row.address || row.company_address || row.business_address),
  };
}

export function missingProviderContractIdentity(identity: ProviderContractIdentity): string[] {
  const missing: string[] = [];
  if (!identity.code) missing.push('공급사코드');
  if (!identity.companyName) missing.push('상호');
  if (!identity.ceo) missing.push('대표자');
  if (!/^\d{10}$/.test(identity.businessNumber.replace(/\D/g, ''))) missing.push('사업자등록번호');
  if (!/^\d{9,11}$/.test(identity.phone.replace(/\D/g, ''))) missing.push('대표번호');
  if (!identity.address) missing.push('주소');
  return missing;
}
