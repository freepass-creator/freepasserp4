/**
 * 직접 전자계약에서 영업자가 고를 수 있는 계약별 입력값의 작은 allowlist.
 *
 * 이 값은 서버 seal과 공개 projection에서 같은 의미로 비교된다. RTDB JSON object의
 * 키 순서는 계약 의미가 아니므로, 항상 알파벳순으로 직렬화한다. 서식의 다른 필드를
 * 덮을 수 있는 임의 key나 중첩 object는 발행 경계에서 닫는다.
 */
export type FreepassDirectManualTerms = Record<string, string>;

const S = (value: unknown) => String(value ?? '').trim();

export const FREEPASS_DIRECT_MANUAL_TERM_KEYS = [
  'deposit_installment', 'deposit_round_1', 'deposit_round_2', 'deposit_round_3',
  'auto_debit_date', 'buyback_price', 'driver_scope', 'maintenance_product',
  'special_terms', 'special_terms_choice', 'additional_driver',
  'drv1_name', 'drv1_relation', 'drv1_phone', 'drv2_name', 'drv2_relation', 'drv2_phone',
  'drv3_name', 'drv3_relation', 'drv3_phone', 'emergency_contact', 'emergency_relation',
] as const;

const ALLOWED_KEYS = new Set<string>(FREEPASS_DIRECT_MANUAL_TERM_KEYS);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Object key insertion order가 달라도 같은 계약별 입력은 같은 JSON으로 동결한다. */
export function canonicalFreepassDirectManualTerms(value: unknown): FreepassDirectManualTerms | null {
  let row: Record<string, unknown> | null;
  if (typeof value === 'string') {
    try { row = asRecord(JSON.parse(value)); }
    catch { return null; }
  } else {
    row = asRecord(value);
  }
  if (!row) return null;

  const normalized: FreepassDirectManualTerms = {};
  for (const key of Object.keys(row).sort()) {
    const input = row[key];
    const nested = input !== null && typeof input === 'object';
    if (!ALLOWED_KEYS.has(key) || nested || ['function', 'symbol', 'bigint'].includes(typeof input)) return null;
    const text = S(input);
    if (text.length > 2_000) return null;
    normalized[key] = text;
  }
  return normalized;
}

export function canonicalFreepassDirectManualTermsDraft(value: unknown): string | null {
  const terms = canonicalFreepassDirectManualTerms(value);
  return terms ? JSON.stringify(terms) : null;
}
