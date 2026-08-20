import type { EntityRecord } from '@/lib/intake/entities';
import type { Role } from '@/lib/domain/deal';

/**
 * 이 정책을 그 공급사가 쓸 수 있나.
 *
 * ★법인은 다르지만 «관계사»라 정책을 같이 쓰는 경우가 있다(사장님 2026-08-20 — 스타/스카이, 빌린카/엘씨, 경진카/경진렌트).
 *   정책 하나를 두 법인이 참조하게 하려면 정책 레코드에 `shared_with` 로 상대 코드를 적는다.
 *   법인마다 정책을 따로 두고 싶으면 그냥 각자 만들면 된다 — 이 필드를 안 쓰면 예전과 똑같다.
 *   ⚠ 계약서 임대인·정산은 «차의 공급사»가 정한다. 정책을 같이 쓴다고 명의까지 같아지지 않는다.
 */
export function policyUsableBy(policy: Pick<EntityRecord, string>, providerCode: string): boolean {
  const code = String(providerCode ?? '').trim();
  if (!code) return false;
  const owner = String((policy as Record<string, unknown>).provider_company_code ?? '').trim();
  if (owner === code) return true;
  const shared = (policy as Record<string, unknown>).shared_with;
  const list = Array.isArray(shared) ? shared : String(shared ?? '').split(/[,\s·]+/);
  return list.map((x) => String(x ?? '').trim()).filter(Boolean).includes(code);
}

/** 정책관리 화면의 역할별 조회 경계. 영업자는 정책 원문을 직접 조회하지 않는다. */
export function scopeManagedPolicies(
  policies: EntityRecord[],
  role: Role,
  providerCode = '',
): EntityRecord[] {
  if (role === 'admin') return policies;
  if (role !== 'provider' || !providerCode) return [];
  return policies.filter((policy) => policyUsableBy(policy, providerCode));
}

/** 재고 편집용 정책 경계. 관리자만 전체, 공급사는 자기 정책만 본다. */
export function scopeInventoryPolicies(
  policies: EntityRecord[],
  role: Role,
  providerCode = '',
): EntityRecord[] {
  return scopeManagedPolicies(policies, role, providerCode);
}

