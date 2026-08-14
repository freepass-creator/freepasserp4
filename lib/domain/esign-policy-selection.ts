import type { EntityRecord } from '@/lib/intake/entities';
import { FREEPASS_POLICY_PACK } from '@/lib/domain/policy-defaults';
import { canIssueContract } from '@/lib/domain/policy-tier';
import type { EsignTemplate } from '@/lib/domain/esign-templates';

const S = (value: unknown) => String(value ?? '').trim();

function contractPolicyScore(policy: EntityRecord | null): number {
  if (!policy) return -1;
  const text = [policy.policy_name, policy.product_type, policy.contract_type, policy.policy_type]
    .map(S)
    .join(' ');
  const insurance = S(policy.insurance_included);
  return (canIssueContract(policy).ok ? 100 : 0)
    + (policy.is_freepass_common_policy === true ? 40 : 0)
    + (S(policy.policy_default_pack) === FREEPASS_POLICY_PACK ? 20 : 0)
    + (/렌트/.test(text) ? 20 : 0)
    + (/별도|개인/.test(insurance) ? 0 : insurance ? 10 : 0)
    + (/기본|표준|공통/.test(text) ? 5 : 0);
}

function policyInsuranceSide(policy: EntityRecord): '회사포함' | '고객직접' | null {
  const insurance = S(policy.insurance_included);
  if (!insurance) return null;
  return /별도|개인/.test(insurance) ? '고객직접' : '회사포함';
}

export function policyMatchesTemplate(policy: EntityRecord, template: EsignTemplate): boolean {
  const text = [policy.policy_name, policy.product_type, policy.contract_type, policy.policy_type]
    .map(S)
    .join(' ');
  const kindMatches = template.contractKind === '렌탈' ? /렌트/.test(text) : /구독/.test(text);
  return kindMatches && policyInsuranceSide(policy) === template.insuranceSide;
}

export function policiesForTemplate(
  rows: EntityRecord[],
  providerCode: string,
  template: EsignTemplate | null,
): EntityRecord[] {
  const linked = rows.filter((row) => S(row.provider_company_code) === providerCode);
  return template ? linked.filter((row) => policyMatchesTemplate(row, template)) : linked;
}

export function preferredPolicyForTemplate(
  rows: EntityRecord[],
  providerCode: string,
  template: EsignTemplate | null,
): EntityRecord | null {
  return policiesForTemplate(rows, providerCode, template).reduce<EntityRecord | null>((best, row) => (
    contractPolicyScore(row) > contractPolicyScore(best) ? row : best
  ), null);
}

/** 같은 공급사 정책 중 발송 가능한 프리패스 공통 렌트·보험포함 정책을 우선한다. */
export function preferredContractPolicy(rows: EntityRecord[], providerCode: string): EntityRecord | null {
  const linked = rows.filter((row) => S(row.provider_company_code) === providerCode);
  const rentRows = linked.filter((row) => /렌트/.test([
    row.policy_name, row.product_type, row.contract_type, row.policy_type,
  ].map(S).join(' ')));
  const candidates = rentRows.length ? rentRows : linked;
  return candidates.reduce<EntityRecord | null>((best, row) => (
    contractPolicyScore(row) > contractPolicyScore(best) ? row : best
  ), null);
}

export function policiesByProvider(rows: EntityRecord[]): Map<string, EntityRecord[]> {
  const grouped = new Map<string, EntityRecord[]>();
  for (const row of rows) {
    const providerCode = S(row.provider_company_code);
    if (!providerCode) continue;
    grouped.set(providerCode, [...(grouped.get(providerCode) || []), row]);
  }
  return grouped;
}
