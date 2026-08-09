import 'server-only';

import { chakhandealIssuePayload } from '@/lib/domain/chakhandeal-esign';

type RecordValue = Record<string, unknown>;

export type ChakhandealConfig = {
  baseUrl: URL;
  apiKey: string;
  memberCompany: string;
  templateId: string;
};

export type ChakhandealIssue = {
  contractId: string;
  verifyUrl: string;
  sealHash: string;
};

const text = (value: unknown): string => String(value ?? '').trim();

export function getChakhandealConfig(): ChakhandealConfig | null {
  const rawBase = text(process.env.CHAKHANDEAL_API_BASE_URL);
  const apiKey = text(process.env.CHAKHANDEAL_API_KEY);
  const memberCompany = text(process.env.CHAKHANDEAL_MEMBER_COMPANY);
  const templateId = text(process.env.CHAKHANDEAL_TEMPLATE_ID);
  if (!rawBase || !apiKey || !memberCompany || !templateId) return null;

  let baseUrl: URL;
  try { baseUrl = new URL(rawBase.endsWith('/') ? rawBase : `${rawBase}/`); }
  catch { return null; }
  const localDev = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(baseUrl.hostname);
  if (baseUrl.protocol !== 'https:' && !localDev) return null;
  if (baseUrl.username || baseUrl.password) return null;
  if (baseUrl.pathname !== '/') return null;
  return { baseUrl, apiKey, memberCompany, templateId };
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
    if (!response.ok) throw new Error(`착한거래 요청 실패 (${response.status})`);
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/** `templateId` 미지정이면 서버 기본 양식(`CHAKHANDEAL_TEMPLATE_ID`). 지정되면 그 공급사 양식으로 발행한다. */
export async function issueChakhandealContract(
  config: ChakhandealConfig,
  contract: RecordValue,
  templateId?: string,
  /**
   * 이 계약에 걸린 정책. **넘기지 않으면 계약서가 빈칸으로 나간다.**
   *
   * `chakhandealIssuePayload` 의 `policy` 가 옵셔널이라 안 넘겨도 타입 오류가 안 났고,
   * 실제로 안 넘기고 있었다(2026-08-09 발견). 정책관리를 아무리 채워도
   * 약정 주행거리·초과 요율·면책금·해지 조건이 전부 비어 계약서에 실렸다.
   * 발송 게이트는 정책을 읽는데 정작 계약서로 가는 통로가 없었다 — 게이트만 있고 길이 없었다.
   */
  policy?: RecordValue | null,
): Promise<ChakhandealIssue> {
  const externalRef = text(contract.contract_code);
  const identity = { ...config, templateId: text(templateId) || config.templateId };
  // 보험 방식도 정책에서 갈린다 — 개인보험형이면 약관 제9조의2가 함께 적용된다.
  const insuranceSide = /별도|개인/.test(text(policy?.insurance_included)) ? '고객직접' : '회사포함';
  const result = await callJson(config, '/api/v1/contract/issue', chakhandealIssuePayload(identity, contract, policy, insuranceSide), `freepass:${externalRef}:issue`);
  const contractId = text(result.contractId);
  if (!contractId || contractId.length > 200) throw new Error('착한거래 계약 식별자 누락');
  const rawVerifyUrl = text(result.verifyUrl);
  let verifyUrl = '';
  if (rawVerifyUrl) {
    try {
      const parsed = new URL(rawVerifyUrl);
      if (parsed.protocol === 'https:' && parsed.origin === config.baseUrl.origin && rawVerifyUrl.length <= 2_000) verifyUrl = rawVerifyUrl;
    } catch { /* 잘못된 검증 URL은 저장하지 않는다. */ }
  }
  return {
    contractId,
    verifyUrl,
    sealHash: text(result.sealHash).slice(0, 256),
  };
}

export async function sendChakhandealContract(config: ChakhandealConfig, contractId: string, externalRef: string): Promise<void> {
  await callJson(
    config,
    `/api/v1/contract/${encodeURIComponent(contractId)}/send`,
    { channel: 'sms' },
    `freepass:${externalRef}:send`,
  );
}
