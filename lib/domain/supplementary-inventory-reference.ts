export type SupplementaryReferenceResult = {
  status: 'PASS' | 'HOLD';
  referenceCount: number;
  canonicalCount: number;
  sharedCount: number;
  referenceOnlyCount: number;
  canonicalOnlyCount: number;
  tolerance: number;
  duplicateReferenceKeys: number;
  reasons: string[];
};

const key = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();

/**
 * 보완참조는 원천을 덮지 않는다. 현재 원천/원자와 대략 같은 규모인지 확인하고,
 * 차이가 크면 발행만 HOLD한다. 보완 시트의 갱신 시차를 감안해 허용치는 참조 대수의 15% 또는 5대 중 큰 값이다.
 */
export function compareSupplementaryInventoryReference(
  referenceKeys: unknown[],
  canonicalKeys: unknown[],
): SupplementaryReferenceResult {
  const reference = referenceKeys.map(key).filter(Boolean);
  const canonical = canonicalKeys.map(key).filter(Boolean);
  const referenceSet = new Set(reference);
  const canonicalSet = new Set(canonical);
  const duplicateReferenceKeys = reference.length - referenceSet.size;
  const referenceOnlyCount = [...referenceSet].filter((value) => !canonicalSet.has(value)).length;
  const canonicalOnlyCount = [...canonicalSet].filter((value) => !referenceSet.has(value)).length;
  const sharedCount = [...referenceSet].filter((value) => canonicalSet.has(value)).length;
  const tolerance = Math.max(5, Math.ceil(referenceSet.size * 0.15));
  const reasons: string[] = [];
  if (!referenceSet.size) reasons.push('REFERENCE_EMPTY');
  if (!canonicalSet.size) reasons.push('CANONICAL_EMPTY');
  if (duplicateReferenceKeys) reasons.push('REFERENCE_DUPLICATE_KEYS');
  if (Math.abs(referenceSet.size - canonicalSet.size) > tolerance) reasons.push('COUNT_OUTSIDE_TOLERANCE');
  return {
    status: reasons.length ? 'HOLD' : 'PASS',
    referenceCount: referenceSet.size,
    canonicalCount: canonicalSet.size,
    sharedCount,
    referenceOnlyCount,
    canonicalOnlyCount,
    tolerance,
    duplicateReferenceKeys,
    reasons,
  };
}
