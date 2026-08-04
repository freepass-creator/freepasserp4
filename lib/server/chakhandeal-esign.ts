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

export async function issueChakhandealContract(config: ChakhandealConfig, contract: RecordValue): Promise<ChakhandealIssue> {
  const externalRef = text(contract.contract_code);
  const result = await callJson(config, '/api/v1/contract/issue', chakhandealIssuePayload(config, contract), `freepass:${externalRef}:issue`);
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
