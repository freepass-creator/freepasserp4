import type { EntityRecord } from '@/lib/intake/entities';

export type BusinessIdentityKind = 'partner' | 'user' | 'customer' | 'contract';

const FIELD_ORDER: Record<BusinessIdentityKind, readonly string[]> = {
  partner: ['business_number', 'business_no', 'biz_no'],
  user: ['business_no', 'business_number', 'biz_no'],
  customer: ['business_no', 'business_number', 'customer_business_number', 'biz_no'],
  contract: ['customer_business_number', 'business_number', 'business_no', 'biz_no'],
};

/** 사업자등록번호 비교·저장용 canonical 값. 표시는 별도 formatter가 담당한다. */
export function normalizeBusinessRegistrationNumber(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function businessRegistrationIdentity(
  record: EntityRecord | null | undefined,
  kind: BusinessIdentityKind,
): { value: string; source: string; conflict: boolean } {
  if (!record) return { value: '', source: '', conflict: false };
  const found = FIELD_ORDER[kind]
    .map((source) => ({ source, value: normalizeBusinessRegistrationNumber(record[source]) }))
    .filter((item) => item.value);
  const primary = found[0];
  return {
    value: primary?.value || '',
    source: primary?.source || '',
    conflict: new Set(found.map((item) => item.value)).size > 1,
  };
}

export function businessRegistrationNumberOf(
  record: EntityRecord | null | undefined,
  kind: BusinessIdentityKind,
): string {
  return businessRegistrationIdentity(record, kind).value;
}

export function hasBusinessRegistrationConflict(
  record: EntityRecord | null | undefined,
  kind: BusinessIdentityKind,
): boolean {
  return businessRegistrationIdentity(record, kind).conflict;
}
