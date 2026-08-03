import type { EntityRecord } from '@/lib/intake/entities';

export type GuardedProductPatch = {
  key: string;
  patch: EntityRecord;
  /** 시트 병합 계획을 만든 시점의 기존 ERP 레코드. */
  expected: EntityRecord;
};

export type GuardedProductPatchResult = {
  updated: number;
  conflicts: string[];
};

export const PRODUCT_PATCH_GUARD_FIELDS = [
  'updatedAt',
  'updated_at',
  '_deleted',
  'deletedAt',
  'status',
  'vehicle_status',
  'locked_by_contract',
] as const;

const hasOwn = (record: EntityRecord | null, key: string): boolean =>
  !!record && Object.prototype.hasOwnProperty.call(record, key);

function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

/**
 * 조건부 상품 쓰기의 공통 비교 규칙.
 *
 * RTDB의 current는 v4 공개 오버레이만 보므로, 아직 오버레이하지 않은 필드는
 * 방금 strict-fresh로 읽은 v3∪v4 expected 값을 그대로 사용한다. 반대로 current에
 * 필드가 생겼다면 검증 이후 누군가 쓴 값이므로 expected와 반드시 같아야 한다.
 */
export function productPatchPreconditionMatches(
  current: EntityRecord | null,
  expected: EntityRecord,
  patch: EntityRecord,
  opts: {
    overlayFallback?: boolean;
    guardFields?: readonly string[];
  } = {},
): boolean {
  if (!current && !opts.overlayFallback) return false;
  const fields = new Set<string>([
    ...Object.keys(patch),
    ...(opts.guardFields ?? PRODUCT_PATCH_GUARD_FIELDS),
  ]);
  for (const field of fields) {
    const actual = opts.overlayFallback && !hasOwn(current, field)
      ? expected[field]
      : current?.[field];
    if (!same(actual, expected[field])) return false;
  }
  return true;
}
