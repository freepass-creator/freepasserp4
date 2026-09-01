import 'server-only';

import { chakhandealIssuePayload } from '@/lib/domain/chakhandeal-esign';
import { findContractKind } from '@/lib/domain/esign-contract-kind';
import {
  standardTemplateSelectionError, type EsignTemplate, type StandardTemplateKey,
} from '@/lib/domain/esign-templates';
import {
  parseProviderTemplateOverrides,
  resolveContractTemplateProfile,
  type ContractTemplateProfile,
  type ProviderTemplateOverrides,
} from '@/lib/domain/esign-template-profile';

type RecordValue = Record<string, unknown>;

export type ChakhandealConfig = {
  baseUrl: URL;
  apiKey: string;
  memberCompany: string;
  templateIds: Record<StandardTemplateKey, string>;
  providerTemplates: ProviderTemplateOverrides;
};

export type ChakhandealIssue = {
  contractId: string;
  signUrl: string;
  expiresAt: number;
  verifyUrl: string;
  sealHash: string;
  contractKind: string;
  insuranceSide: '회사포함' | '고객직접';
  templateProfile: ContractTemplateProfile;
  warnings?: {
    missingRequired?: { field: string; label: string; from?: string | null }[];
    unknownKeys?: string[];
  };
};

export type ChakhandealSupplementEntry = {
  items: string[];
  message: string;
  requestedAt: number | null;
};

export type ChakhandealHandover = {
  handover_datetime: string;
  contract_start: string;
  contract_end: string;
  car_number: string;
  vin: string;
};

export type ChakhandealStatus = RecordValue & {
  contractId: string;
  externalRef: string;
  status: string;
  signUrl: string;
  templateFields: Record<string, string>;
  supplements: ChakhandealSupplementEntry[];
  supplementActive: ChakhandealSupplementEntry | null;
  handover: ChakhandealHandover | null;
  pendingHandover: boolean;
};

export type ChakhandealTemplateSection = {
  no: string;
  title: string;
  fields: string[];
};

const text = (value: unknown): string => String(value ?? '').trim();

export function getChakhandealConfig(): ChakhandealConfig | null {
  const rawBase = text(process.env.CHAKHANDEAL_API_BASE_URL);
  const apiKey = text(process.env.CHAKHANDEAL_API_KEY);
  const memberCompany = text(process.env.CHAKHANDEAL_MEMBER_COMPANY);
  const templateIds: Record<StandardTemplateKey, string> = {
    'freepass-rent-standard': text(process.env.CHAKHANDEAL_RENT_TEMPLATE_ID),
    'freepass-subscription-insurance-included': text(process.env.CHAKHANDEAL_SUBSCRIPTION_INSURANCE_INCLUDED_TEMPLATE_ID),
    'freepass-subscription-insurance-separate': text(process.env.CHAKHANDEAL_SUBSCRIPTION_INSURANCE_SEPARATE_TEMPLATE_ID),
    // 손오공 구독은 검토 양식이다. 별도 외부 템플릿과 발행 검증이 준비되기 전까지
    // 빈 값으로 유지해 provider 설정만으로 발행되지 않게 한다.
    'sonogong-rent-draft': '',
    'sonogong-subscription-insurance-included': '',
    'sonogong-subscription-insurance-separate': '',
    'sonogong-pickup-confirmation': '',
  };
  if (!rawBase || !apiKey || !memberCompany || Object.values(templateIds).some((id) => !id)) return null;

  let baseUrl: URL;
  try { baseUrl = new URL(rawBase.endsWith('/') ? rawBase : `${rawBase}/`); }
  catch { return null; }
  const localDev = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(baseUrl.hostname);
  if (baseUrl.protocol !== 'https:' && !localDev) return null;
  if (baseUrl.username || baseUrl.password) return null;
  if (baseUrl.pathname !== '/') return null;
  let providerTemplates: ProviderTemplateOverrides;
  try { providerTemplates = parseProviderTemplateOverrides(process.env.CHAKHANDEAL_PROVIDER_TEMPLATES_JSON); }
  catch (error) {
    console.error('[chakhandeal-esign] provider template config invalid', error instanceof Error ? error.message : 'unknown');
    return null;
  }
  return { baseUrl, apiKey, memberCompany, templateIds, providerTemplates };
}

async function callJson(config: ChakhandealConfig, path: string, body: RecordValue, idempotencyKey: string): Promise<RecordValue> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(new URL(path.replace(/^\//, ''), config.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `ApiKey ${config.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    const raw = await response.text();
    if (raw.length > 1_000_000) throw new Error('착한거래 응답 크기 초과');
    let parsed: RecordValue = {};
    try { parsed = raw ? JSON.parse(raw) as RecordValue : {}; } catch { /* 비 JSON 오류 본문은 외부로 노출하지 않는다. */ }
    if (!response.ok) {
      const err = new Error(`착한거래 요청 실패 (${response.status})`);
      Object.assign(err, { status: response.status });
      throw err;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(config: ChakhandealConfig, path: string): Promise<RecordValue> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(new URL(path.replace(/^\//, ''), config.baseUrl), {
      method: 'GET',
      headers: { Authorization: `ApiKey ${config.apiKey}`, Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    const raw = await response.text();
    if (raw.length > 1_000_000) throw new Error('착한거래 응답 크기 초과');
    let parsed: RecordValue = {};
    try { parsed = raw ? JSON.parse(raw) as RecordValue : {}; } catch { /* 외부 오류 본문은 감춘다. */ }
    if (!response.ok) {
      const err = new Error(`착한거래 요청 실패 (${response.status})`);
      Object.assign(err, { status: response.status });
      throw err;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function safeUrl(value: unknown, { sameOrigin }: { sameOrigin?: URL } = {}): string {
  const raw = text(value);
  if (!raw || raw.length > 2_000) return '';
  try {
    const parsed = new URL(raw);
    const localDev = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(localDev && parsed.protocol === 'http:')) return '';
    if (parsed.username || parsed.password) return '';
    if (sameOrigin && parsed.origin !== sameOrigin.origin) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

/** 발행 스냅샷 — 키·값 길이만 제한. RTDB에 다시 넣지 말 것. */
export function normalizeTemplateFields(raw: unknown, maxKeys = 200): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as RecordValue)) {
    const key = text(k).slice(0, 80);
    if (!key) continue;
    const val = text(v).slice(0, 2_000);
    if (!val) continue;
    out[key] = val;
    if (Object.keys(out).length >= maxKeys) break;
  }
  return out;
}

export function normalizeSupplementEntry(raw: unknown): ChakhandealSupplementEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as RecordValue;
  const items = Array.isArray(row.items)
    ? row.items.map((x) => text(x).slice(0, 60)).filter(Boolean).slice(0, 20)
    : [];
  const message = text(row.message).slice(0, 1000);
  const requestedAt = Number(row.requestedAt);
  return {
    items,
    message,
    requestedAt: Number.isFinite(requestedAt) && requestedAt > 0 ? requestedAt : null,
  };
}

export function normalizeSupplements(raw: unknown, max = 40): ChakhandealSupplementEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeSupplementEntry)
    .filter((x): x is ChakhandealSupplementEntry => !!x)
    .slice(0, max);
}

export function normalizeTemplateSections(raw: unknown, max = 40): ChakhandealTemplateSection[] {
  if (!Array.isArray(raw)) return [];
  const out: ChakhandealTemplateSection[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const sec = row as RecordValue;
    const fields = Array.isArray(sec.fields)
      ? sec.fields.map((f) => text(f).slice(0, 80)).filter(Boolean).slice(0, 80)
      : [];
    if (!fields.length) continue;
    out.push({
      no: text(sec.no).slice(0, 20),
      title: text(sec.title).slice(0, 120) || `구역 ${out.length + 1}`,
      fields,
    });
    if (out.length >= max) break;
  }
  return out;
}

/** 표준 3벌 중 관리자가 확정한 한 벌을 쓰고, 해당 업체의 같은 기준판 커스텀만 자동 적용한다. */
export async function issueChakhandealContract(
  config: ChakhandealConfig,
  contract: RecordValue,
  standardTemplate: EsignTemplate,
  contractKind: string,
  /**
   * 이 계약에 걸린 정책. **넘기지 않으면 계약서가 빈칸으로 나간다.**
   *
   * `chakhandealIssuePayload` 의 `policy` 가 옵셔널이라 안 넘겨도 타입 오류가 안 났고,
   * 실제로 안 넘기고 있었다(2026-08-09 발견). 정책관리를 아무리 채워도
   * 약정 주행거리·초과 요율·면책금·해지 조건이 전부 비어 계약서에 실렸다.
   * 발송 게이트는 정책을 읽는데 정작 계약서로 가는 통로가 없었다 — 게이트만 있고 길이 없었다.
   */
  policy?: RecordValue | null,
  partner?: RecordValue | null,
  opts?: {
    product?: RecordValue | null;
    templateFieldOverrides?: Record<string, string> | null;
  },
): Promise<ChakhandealIssue> {
  const externalRef = text(contract.contract_code);
  const resolvedContractKind = text(contractKind);
  const spec = findContractKind(resolvedContractKind);
  if (!spec) {
    throw new Error('관리자가 올바른 계약유형을 확정해 주세요.');
  }
  const selectionError = standardTemplateSelectionError(standardTemplate, spec, policy);
  if (selectionError) throw new Error(selectionError);
  const templateProfile = resolveContractTemplateProfile(
    standardTemplate,
    config.templateIds[standardTemplate.id],
    contract.provider_company_code,
    config.providerTemplates,
  );
  const identity = {
    memberCompany: config.memberCompany,
    templateId: templateProfile.externalTemplateId,
    contractKind: resolvedContractKind,
    templateProfile,
  };
  // 보험포함/별도는 표준 구독계약서 두 벌을 가르는 문서 조건이다.
  // 관리자 선택과 정책이 다르면 어느 쪽도 임의로 이기지 않고 발행을 막는다.
  const insuranceSide = standardTemplate.insuranceSide;
  const result = await callJson(
    config,
    '/api/v1/contract/issue',
    chakhandealIssuePayload(identity, contract, policy, insuranceSide, partner, opts),
    `freepass:${externalRef}:issue`,
  );
  const contractId = text(result.contractId);
  if (!contractId || contractId.length > 200) throw new Error('착한거래 계약 식별자 누락');
  const signUrl = safeUrl(result.signUrl);
  if (!signUrl) throw new Error('착한거래 서명 링크 누락');
  const rawWarnings = result.warnings;
  const warnings =
    rawWarnings && typeof rawWarnings === 'object' && !Array.isArray(rawWarnings)
      ? (rawWarnings as ChakhandealIssue['warnings'])
      : undefined;
  return {
    contractId,
    signUrl,
    expiresAt: Number(result.expiresAt) || 0,
    verifyUrl: safeUrl(result.verifyUrl, { sameOrigin: config.baseUrl }),
    sealHash: text(result.sealHash).slice(0, 256),
    contractKind: resolvedContractKind,
    insuranceSide,
    templateProfile,
    warnings,
  };
}

export async function getChakhandealContractStatus(
  config: ChakhandealConfig,
  contractId: string,
): Promise<ChakhandealStatus> {
  const result = await getJson(config, `/api/v1/contract/${encodeURIComponent(contractId)}`);
  const returnedId = text(result.contractId);
  if (!returnedId || returnedId !== contractId) throw new Error('착한거래 계약 식별자 불일치');
  const signUrl = safeUrl(result.signUrl);
  if (!signUrl) throw new Error('착한거래 서명 링크 누락');
  return {
    ...result,
    contractId: returnedId,
    externalRef: text(result.externalRef),
    status: text(result.status),
    signUrl,
    verifyUrl: safeUrl(result.verifyUrl, { sameOrigin: config.baseUrl }),
    documentUrl: safeUrl(result.documentUrl, { sameOrigin: config.baseUrl }),
    templateFields: normalizeTemplateFields(result.templateFields),
    supplements: normalizeSupplements(result.supplements),
    supplementActive: normalizeSupplementEntry(result.supplementActive),
    handover: normalizeHandover(result.handover),
    pendingHandover: result.pendingHandover === true,
  };
}

/** 서명 전 A4 초안 HTML. API Key는 서버에만 둔다. */
export async function fetchChakhandealDraftPreview(
  config: ChakhandealConfig,
  contractId: string,
  { save = false }: { save?: boolean } = {},
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const path = `api/v1/contract/${encodeURIComponent(contractId)}/preview?save=${save ? '1' : '0'}`;
    const response = await fetch(new URL(path, config.baseUrl), {
      method: 'GET',
      headers: { Authorization: `ApiKey ${config.apiKey}`, Accept: 'text/html' },
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    if (response.status === 409) {
      const raw = await response.text();
      let code = '';
      try { code = text((JSON.parse(raw) as RecordValue).code); } catch { /* */ }
      if (code === 'ALREADY_SIGNED') throw Object.assign(new Error('이미 서명된 계약입니다. 완료 PDF를 사용해 주세요.'), { status: 409, code });
      if (code === 'SIGN_IN_PROGRESS') throw Object.assign(new Error('서명 완료본을 생성하고 있습니다.'), { status: 409, code });
      throw Object.assign(new Error('초안을 열 수 없습니다.'), { status: 409, code: code || 'CONFLICT' });
    }
    if (!response.ok) throw new Error(`착한거래 초안 요청 실패 (${response.status})`);
    const ctype = (response.headers.get('content-type') || '').toLowerCase();
    if (!ctype.includes('text/html')) throw new Error('착한거래 초안 응답 형식 오류');
    const html = await response.text();
    if (!html || html.length > 8 * 1024 * 1024) throw new Error('착한거래 초안 크기 오류');
    return html;
  } finally {
    clearTimeout(timer);
  }
}

export async function openChakhandealSupplement(
  config: ChakhandealConfig,
  contractId: string,
  body: { items: string[]; message?: string },
): Promise<{
  supplementUrl: string;
  items: string[];
  message: string;
  supplements: ChakhandealSupplementEntry[];
}> {
  const items = (Array.isArray(body.items) ? body.items : [])
    .map((x) => text(x).slice(0, 60))
    .filter(Boolean)
    .slice(0, 20);
  if (!items.length) throw new Error('다시 받을 단계를 골라 주세요.');
  const result = await callJson(
    config,
    `/api/v1/contract/${encodeURIComponent(contractId)}/supplement`,
    { items, message: text(body.message).slice(0, 1000) },
    `freepass:${contractId}:supplement:${items.join(',')}:${Date.now()}`,
  );
  const supplementUrl = safeUrl(result.supplementUrl);
  if (!supplementUrl) throw new Error('착한거래 보완 링크 누락');
  return {
    supplementUrl,
    items: Array.isArray(result.items)
      ? result.items.map((x) => text(x).slice(0, 60)).filter(Boolean)
      : items,
    message: text(result.message).slice(0, 1000),
    supplements: normalizeSupplements(result.supplements),
  };
}

export function normalizeHandover(raw: unknown): ChakhandealHandover | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as RecordValue;
  const handover_datetime = text(row.handover_datetime).slice(0, 40);
  if (!handover_datetime && !text(row.contract_start)) return null;
  return {
    handover_datetime,
    contract_start: text(row.contract_start).slice(0, 40),
    contract_end: text(row.contract_end).slice(0, 40),
    car_number: text(row.car_number).slice(0, 40),
    vin: text(row.vin).slice(0, 80),
  };
}

/** 서명 완료 후 인도일 보완. */
export async function recordChakhandealHandover(
  config: ChakhandealConfig,
  contractId: string,
  body: { handover_datetime: string; car_number?: string; vin?: string },
): Promise<{ handover: ChakhandealHandover; pendingHandover: boolean }> {
  const handover_datetime = text(body.handover_datetime).slice(0, 40);
  if (!handover_datetime) throw new Error('인도일이 필요합니다.');
  const result = await callJson(
    config,
    `/api/v1/contract/${encodeURIComponent(contractId)}/handover`,
    {
      handover_datetime,
      car_number: text(body.car_number).slice(0, 40),
      vin: text(body.vin).slice(0, 80),
    },
    `freepass:${contractId}:handover:${handover_datetime}`,
  );
  const handover = normalizeHandover(result.handover);
  if (!handover?.handover_datetime) throw new Error('착한거래 인도일 응답 누락');
  return {
    handover,
    pendingHandover: result.pendingHandover === true,
  };
}

/** 템플릿 칸 + A4 구역(sections). 프리패스가 손으로 섹션표를 만들지 않게 한다. */
export async function getChakhandealTemplateFields(
  config: ChakhandealConfig,
  templateId: string,
): Promise<{
  templateId: string;
  fields: { field: string; label?: string; from?: string }[];
  sections: ChakhandealTemplateSection[];
}> {
  const id = text(templateId);
  if (!id || id.length > 120) throw new Error('templateId가 필요합니다.');
  const result = await getJson(config, `/api/v1/templates/${encodeURIComponent(id)}/fields`);
  const fields = Array.isArray(result.fields)
    ? result.fields
      .filter((row): row is RecordValue => !!row && typeof row === 'object' && !Array.isArray(row))
      .map((row) => ({
        field: text(row.field).slice(0, 80),
        label: text(row.label).slice(0, 120) || undefined,
        from: text(row.from).slice(0, 40) || undefined,
      }))
      .filter((row) => row.field)
      .slice(0, 300)
    : [];
  return {
    templateId: text(result.templateId) || id,
    fields,
    sections: normalizeTemplateSections(result.sections),
  };
}

export async function fetchChakhandealContractPdf(
  config: ChakhandealConfig,
  contractId: string,
): Promise<{ bytes: Uint8Array; sha256: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(
      new URL(`api/v1/contract/${encodeURIComponent(contractId)}/document?format=pdf`, config.baseUrl),
      {
        method: 'GET',
        headers: { Authorization: `ApiKey ${config.apiKey}`, Accept: 'application/pdf' },
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error(`착한거래 PDF 요청 실패 (${response.status})`);
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/pdf')) {
      throw new Error('착한거래 PDF 응답 형식 오류');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 100 || bytes.length > 30 * 1024 * 1024) throw new Error('착한거래 PDF 크기 오류');
    if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error('착한거래 PDF 헤더 오류');
    return { bytes, sha256: text(response.headers.get('x-contract-document-sha256')) };
  } finally {
    clearTimeout(timer);
  }
}
