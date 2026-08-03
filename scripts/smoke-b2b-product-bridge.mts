/**
 * 배포 후 실계정 상품 브리지 smoke.
 * 토큰은 커맨드라인이 아니라 환경변수로만 받고, 토큰·상품키·원가 값은 출력하지 않는다.
 */
import { stripProductCost, splitProductPrivate } from '../lib/firebase/rtdb-products';
import type { EntityRecord } from '../lib/intake/entities';

type BridgePayload = {
  products?: Record<string, EntityRecord>;
  count?: number;
  sourceCount?: number;
  error?: string;
};

const baseArg = process.argv.find((arg) => arg.startsWith('--base-url='));
const baseUrl = String(baseArg?.slice('--base-url='.length) || process.env.B2B_BASE_URL || '').replace(/\/$/, '');
const agentToken = String(process.env.B2B_AGENT_ID_TOKEN || '').trim();
const providerToken = String(process.env.B2B_PROVIDER_ID_TOKEN || '').trim();
const providerCompany = String(process.env.B2B_PROVIDER_COMPANY_CODE || '').trim();
const failures: string[] = [];
const passes: string[] = [];
const check = (condition: boolean, message: string) => (condition ? passes : failures).push(message);

if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl)) {
  failures.push('B2B_BASE_URL 또는 --base-url은 HTTPS URL이어야 한다(로컬호스트 예외).');
}
if (!agentToken) failures.push('B2B_AGENT_ID_TOKEN 환경변수 필요');
if (!providerToken) failures.push('B2B_PROVIDER_ID_TOKEN 환경변수 필요');
if (!providerCompany) failures.push('B2B_PROVIDER_COMPANY_CODE 환경변수 필요');

async function request(token?: string): Promise<{ status: number; payload: BridgePayload }> {
  const response = await fetch(`${baseUrl}/api/products/bridge`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(30_000),
  });
  let payload: BridgePayload = {};
  try { payload = await response.json() as BridgePayload; } catch { /* status로 판정 */ }
  return { status: response.status, payload };
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

if (baseUrl) {
  try {
    const unauth = await request();
    check(unauth.status === 403, `비인증 브리지 차단 HTTP 403 (실제 ${unauth.status})`);
  } catch (error) {
    failures.push(`브리지 비인증 요청 실패: ${(error as Error).message}`);
  }
}

if (baseUrl && agentToken && providerToken && providerCompany) {
  try {
    const [agent, provider] = await Promise.all([request(agentToken), request(providerToken)]);
    check(agent.status === 200, `영업자 브리지 HTTP 200 (실제 ${agent.status})`);
    check(provider.status === 200, `공급사 브리지 HTTP 200 (실제 ${provider.status})`);
    const agentProducts = agent.payload.products || {};
    const providerProducts = provider.payload.products || {};
    const agentKeys = Object.keys(agentProducts).sort();
    const providerKeys = Object.keys(providerProducts).sort();
    check(agentKeys.length > 0, '영업자 브리지 재고 1건 이상');
    check(agent.payload.count === agentKeys.length, '영업자 응답 count 정합');
    check(provider.payload.count === providerKeys.length, '공급사 응답 count 정합');
    check(agentKeys.length <= 2_000 && providerKeys.length <= 2_000, '브리지 응답 상한 2,000건 이내');
    check(stable(agentKeys) === stable(providerKeys), '영업자·공급사 공개 상품 집합 일치');

    const agentPrivate = Object.values(agentProducts).filter((row) => splitProductPrivate(row).privateRecord).length;
    check(agentPrivate === 0, '영업자 원가·VIN·계좌·내부수수료 0건');

    let providerPrivate = 0;
    let providerCrossTenantPrivate = 0;
    let publicMismatch = 0;
    for (const key of providerKeys) {
      const row = providerProducts[key];
      if (splitProductPrivate(row).privateRecord) {
        providerPrivate++;
        if (String(row.provider_company_code || '') !== providerCompany) providerCrossTenantPrivate++;
      }
      if (agentProducts[key] && stable(agentProducts[key]) !== stable(stripProductCost(row))) publicMismatch++;
    }
    check(providerCrossTenantPrivate === 0, '공급사 타회사 private 원자 0건');
    check(publicMismatch === 0, '역할별 공개 상품 내용 일치');

    console.log(`집계: agent=${agentKeys.length} · provider=${providerKeys.length} · provider-own-private=${providerPrivate}`);
  } catch (error) {
    failures.push(`실계정 브리지 요청 실패: ${(error as Error).message}`);
  }
}

for (const message of passes) console.log(`PASS ${message}`);
for (const message of failures) console.log(`FAIL ${message}`);
console.log(`\nB2B 상품 브리지 smoke: ${failures.length ? 'NO-GO' : 'PASS'} · PASS ${passes.length} · FAIL ${failures.length}`);
if (failures.length) process.exitCode = 1;
