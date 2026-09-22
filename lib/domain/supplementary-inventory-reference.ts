export type SupplementaryReferenceResult = {
  status: 'OBSERVED';
  referenceCount: number;
  canonicalCount: number;
  sharedCount: number;
  referenceOnlyCount: number;
  canonicalOnlyCount: number;
  duplicateReferenceKeys: number;
};

const key = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();

/**
 * 보완 시트는 새 원천을 덮거나 발행을 막지 않는다.
 * 현재 원천과의 대수·차번 겹침을 후속 확인용 증거로만 계산한다.
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
  return {
    status: 'OBSERVED',
    referenceCount: referenceSet.size,
    canonicalCount: canonicalSet.size,
    sharedCount,
    referenceOnlyCount,
    canonicalOnlyCount,
    duplicateReferenceKeys,
  };
}
