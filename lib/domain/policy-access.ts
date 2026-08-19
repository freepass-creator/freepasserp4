import type { EntityRecord } from '@/lib/intake/entities';
import type { Role } from '@/lib/domain/deal';

/** 정책관리 화면의 역할별 조회 경계. 영업자는 정책 원문을 직접 조회하지 않는다. */
export function scopeManagedPolicies(
  policies: EntityRecord[],
  role: Role,
  providerCode = '',
): EntityRecord[] {
  if (role === 'admin') return policies;
  if (role !== 'provider' || !providerCode) return [];
  return policies.filter((policy) => String(policy.provider_company_code || '').trim() === providerCode);
}

/** 재고 편집용 정책 경계. 관리자만 전체, 공급사는 자기 정책만 본다. */
export function scopeInventoryPolicies(
  policies: EntityRecord[],
  role: Role,
  providerCode = '',
): EntityRecord[] {
  return scopeManagedPolicies(policies, role, providerCode);
}

