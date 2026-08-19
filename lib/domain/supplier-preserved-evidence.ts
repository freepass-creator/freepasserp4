const S = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

export const SUPPLIER_NORMALIZED_TAIL_MARKER = '| 제조사(정제):' as const;

export type SupplierPreservedEvidence = {
  full: string;
  supplierDirect: string;
  normalizedTail: string;
  hasNormalizedTail: boolean;
};

/**
 * `공급사 원문보존`은 공급사 직접 원문 뒤에 내부 정제 꼬리를 덧붙이는 형식이다.
 * 매칭 근거에는 direct prefix만 쓰고 full 값은 추적·감사용으로 그대로 보존한다.
 */
export const splitSupplierPreservedEvidence = (value: unknown): SupplierPreservedEvidence => {
  const full = S(value);
  const segments = full.split('|').map(S);
  const markerSegmentIndex = segments.findIndex((segment) => {
    const normalized = segment.normalize('NFKC');
    const colonIndex = normalized.indexOf(':');
    if (colonIndex < 0) return false;
    return normalized.slice(0, colonIndex).replace(/\s+/g, '') === '제조사(정제)';
  });
  if (markerSegmentIndex < 0) {
    return { full, supplierDirect: full, normalizedTail: '', hasNormalizedTail: false };
  }
  return {
    full,
    supplierDirect: S(segments.slice(0, markerSegmentIndex).join(' | ')),
    normalizedTail: S(segments.slice(markerSegmentIndex).join(' | ')),
    hasNormalizedTail: true,
  };
};
