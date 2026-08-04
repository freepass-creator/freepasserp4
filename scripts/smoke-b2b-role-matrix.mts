/**
 * Preview의 5역할 실계정 읽기 전용 smoke.
 * 토큰은 환경변수로만 받고 값·uid·상품키·원가를 출력하지 않는다.
 * 호출 endpoint는 GET /api/auth/session, GET /api/products/bridge뿐이다.
 */
import { splitProductPrivate, stripProductCost } from '../lib/firebase/rtdb-products';
import type { EntityRecord } from '../lib/intake/entities';

type SessionPayload = {
  role?: 'agent' | 'provider' | 'admin';
  rawRole?: string;
  organizationCode?: string;
  error?: string;
};

type BridgePayload = {
  products?: Record<string, EntityRecord>;
  count?: number;
  sourceCount?: number;
  error?: string;
};

type RoleCase = {
  label: string;
  tokenEnv: string;
  token: string;
  role: 'agent' | 'provider' | 'admin';
  rawRoles: string[];
  organizationCode: string;
};

const baseArg = process.argv.find((arg) => arg.startsWith('--base-url='));
const baseUrl = String(baseArg?.slice('--base-url='.length) || process.env.B2B_BASE_URL || '').replace(/\/$/, '');
const agentChannelCode = String(process.env.B2B_AGENT_CHANNEL_CODE || '').trim();
const providerCompanyCode = String(process.env.B2B_PROVIDER_COMPANY_CODE || '').trim();
const roleCases: RoleCase[] = [
  {
    label: '플랫폼 관리자', tokenEnv: 'B2B_PLATFORM_ADMIN_ID_TOKEN',
    token: String(process.env.B2B_PLATFORM_ADMIN_ID_TOKEN || '').trim(),
    role: 'admin', rawRoles: ['admin'], organizationCode: '',
  },
  {
    label: '영업채널 관리자', tokenEnv: 'B2B_AGENT_ADMIN_ID_TOKEN',
    token: String(process.env.B2B_AGENT_ADMIN_ID_TOKEN || '').trim(),
    role: 'agent', rawRoles: ['agent_admin', 'agent_manager'], organizationCode: agentChannelCode,
  },
  {
    label: '영업자', tokenEnv: 'B2B_AGENT_ID_TOKEN',
    token: String(process.env.B2B_AGENT_ID_TOKEN || '').trim(),
    role: 'agent', rawRoles: ['agent'], organizationCode: agentChannelCode,
  },
  {
    label: '공급사 관리자', tokenEnv: 'B2B_PROVIDER_ADMIN_ID_TOKEN',
    token: String(process.env.B2B_PROVIDER_ADMIN_ID_TOKEN || '').trim(),
    role: 'provider', rawRoles: ['provider_admin'], organizationCode: providerCompanyCode,
  },
  {
    label: '공급사 직원', tokenEnv: 'B2B_PROVIDER_ID_TOKEN',
    token: String(process.env.B2B_PROVIDER_ID_TOKEN || '').trim(),
    role: 'provider', rawRoles: ['provider'], organizationCode: providerCompanyCode,
  },
];

const failures: string[] = [];
const passes: string[] = [];
const check = (condition: boolean, message: string) => (condition ? passes : failures).push(message);

if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl)) {
  failures.push('B2B_BASE_URL 또는 --base-url은 HTTPS URL이어야 한다(로컬호스트 예외).');
}
if (!agentChannelCode) failures.push('B2B_AGENT_CHANNEL_CODE 환경변수 필요');
if (!providerCompanyCode) failures.push('B2B_PROVIDER_COMPANY_CODE 환경변수 필요');
for (const roleCase of roleCases) {
  if (!roleCase.token) failures.push(`${roleCase.tokenEnv} 환경변수 필요`);
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

async function get<T>(path: string, token = ''): Promise<{ status: number; payload: T; headers: Headers }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(30_000),
  });
  let payload = {} as T;
  try { payload = await response.json() as T; } catch { /* status로 판정 */ }
  return { status: response.status, payload, headers: response.headers };
}

if (baseUrl) {
  try {
    const [session, bridge] = await Promise.all([
      get<SessionPayload>('/api/auth/session'),
      get<BridgePayload>('/api/products/bridge'),
    ]);
    check(session.status === 403, `비인증 역할 확인 차단 HTTP 403 (실제 ${session.status})`);
    check(bridge.status === 403, `비인증 브리지 차단 HTTP 403 (실제 ${bridge.status})`);
  } catch (error) {
    failures.push(`비인증 요청 실패: ${(error as Error).message}`);
  }
}

if (baseUrl && roleCases.every((roleCase) => roleCase.token) && agentChannelCode && providerCompanyCode) {
  try {
    const results = await Promise.all(roleCases.map(async (roleCase) => ({
      roleCase,
      session: await get<SessionPayload>('/api/auth/session', roleCase.token),
      bridge: await get<BridgePayload>('/api/products/bridge', roleCase.token),
    })));

    const productsByLabel = new Map<string, Record<string, EntityRecord>>();
    for (const { roleCase, session, bridge } of results) {
      check(session.status === 200, `${roleCase.label} 역할 확인 HTTP 200 (실제 ${session.status})`);
      check(session.payload.role === roleCase.role, `${roleCase.label} 정규 역할 ${roleCase.role}`);
      check(roleCase.rawRoles.includes(String(session.payload.rawRole || '')), `${roleCase.label} 세부 역할 일치`);
      check(
        String(session.payload.organizationCode || '') === roleCase.organizationCode,
        `${roleCase.label} 조직 범위 코드 일치`,
      );
      check(
        /private/.test(String(session.headers.get('cache-control') || ''))
          && /no-store/.test(String(session.headers.get('cache-control') || ''))
          && /authorization/i.test(String(session.headers.get('vary') || '')),
        `${roleCase.label} 역할 응답 private/no-store`,
      );

      check(bridge.status === 200, `${roleCase.label} 브리지 HTTP 200 (실제 ${bridge.status})`);
      const products = bridge.payload.products || {};
      const keys = Object.keys(products);
      productsByLabel.set(roleCase.label, products);
      check(keys.length > 0, `${roleCase.label} 브리지 재고 1건 이상`);
      check(bridge.payload.count === keys.length, `${roleCase.label} 브리지 count 정합`);
      check(keys.length <= 2_000, `${roleCase.label} 브리지 응답 상한 2,000건 이내`);
      check(
        /private/.test(String(bridge.headers.get('cache-control') || ''))
          && /no-store/.test(String(bridge.headers.get('cache-control') || ''))
          && /authorization/i.test(String(bridge.headers.get('vary') || '')),
        `${roleCase.label} 브리지 응답 private/no-store`,
      );
    }

    const agentProducts = productsByLabel.get('영업자') || {};
    const agentAdminProducts = productsByLabel.get('영업채널 관리자') || {};
    const providerProducts = productsByLabel.get('공급사 직원') || {};
    const providerAdminProducts = productsByLabel.get('공급사 관리자') || {};
    const adminProducts = productsByLabel.get('플랫폼 관리자') || {};
    const publicKeys = Object.keys(agentProducts).sort();
    for (const [label, products] of productsByLabel) {
      check(stable(Object.keys(products).sort()) === stable(publicKeys), `${label} 공개 상품 집합 일치`);
    }

    const privateCount = (products: Record<string, EntityRecord>) => Object.values(products)
      .filter((row) => splitProductPrivate(row).privateRecord).length;
    check(privateCount(agentProducts) === 0, '영업자 private 원자 0건');
    check(privateCount(agentAdminProducts) === 0, '영업채널 관리자 private 원자 0건');

    for (const [label, products] of [
      ['공급사 직원', providerProducts],
      ['공급사 관리자', providerAdminProducts],
    ] as const) {
      const crossTenant = Object.values(products).filter((row) => (
        splitProductPrivate(row).privateRecord
        && String(row.provider_company_code || '').trim() !== providerCompanyCode
      )).length;
      check(crossTenant === 0, `${label} 타 공급사 private 원자 0건`);
      const publicMismatch = publicKeys.filter((key) => (
        stable(stripProductCost(products[key] || {})) !== stable(agentProducts[key] || {})
      )).length;
      check(publicMismatch === 0, `${label} 공개 투영 내용 일치`);
    }

    const adminPublicMismatch = publicKeys.filter((key) => (
      stable(stripProductCost(adminProducts[key] || {})) !== stable(agentProducts[key] || {})
    )).length;
    check(adminPublicMismatch === 0, '플랫폼 관리자 공개 투영 내용 일치');
    console.log(`집계: roles=${results.length} · products=${publicKeys.length} · 민감값/키 출력=0`);
  } catch (error) {
    failures.push(`5역할 실계정 요청 실패: ${(error as Error).message}`);
  }
}

for (const message of passes) console.log(`PASS ${message}`);
for (const message of failures) console.log(`FAIL ${message}`);
console.log(`\nB2B 5역할 읽기 smoke: ${failures.length ? 'NO-GO' : 'PASS'} · PASS ${passes.length} · FAIL ${failures.length}`);
if (failures.length) process.exitCode = 1;
