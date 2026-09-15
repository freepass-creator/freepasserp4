/**
 * 원자 표시 공백의 단일 규칙.
 *
 * 원본·정제 원자에는 이 문구를 저장하지 않는다. 소비처(ERP·판매시트)가
 * 빈 값을 사람에게 보여줄 때만 아래 세 상태로 투영한다.
 */
export const MISSING_VALUE_LABEL = '미입력' as const;
export const EXPLICIT_NONE_LABEL = '없음' as const;
export const NOT_APPLICABLE_LABEL = '해당없음' as const;

export type AtomDisplayState = 'value' | 'missing' | 'none' | 'not_applicable';
export type AtomDisplayResult = { state: AtomDisplayState; text: string };

const S = (value: unknown): string => String(value ?? '').trim();
const OPTION_FIELDS = new Set(['options', '옵션', '옵션(원문)']);
const ENGINE_FIELDS = new Set(['engine_cc', '배기량']);
const BATTERY_FIELDS = new Set(['battery_capacity', '배터리용량']);
const REQUIRED_DISPLAY_FIELDS = new Set([
  'vehicle_status', '배차상태', 'product_type', '구분',
  'maker', '제조사', 'model', '모델', 'sub_model', '세부모델',
  'trim_name', '세부트림', 'ext_color', '외장', 'int_color', '내장',
  'year', '연식', 'mileage', 'Km', 'fuel_type', '연료',
  'vehicle_class', '차종구분', 'origin', '원산지', 'drive_type', '구동',
  'seats', '인승', 'supplier_vehicle_name', '차명(원문)',
  'first_registration_date', '최초등록', 'location', '차고지',
  'policy_code', '정책UID', 'provider_name', '공급사',
]);

function isPureEv(atom: Record<string, unknown>): boolean {
  const fuel = S(atom.fuel_type).replace(/\s/g, '').toUpperCase();
  return fuel === '전기' || fuel === '전기차' || fuel === 'EV' || fuel === 'BEV';
}

function isCombustionOnly(atom: Record<string, unknown>): boolean {
  const fuel = S(atom.fuel_type).replace(/\s/g, '').toUpperCase();
  if (/하이브리드|HYBRID|PHEV/.test(fuel)) return false;
  return /가솔린|휘발유|디젤|경유|LPG|CNG/.test(fuel);
}

export function atomDisplayResult(field: string, value: unknown, atom: Record<string, unknown> = {}): AtomDisplayResult {
  const text = S(value);
  if (OPTION_FIELDS.has(field) && /^(?:없음|해당없음|선택옵션없음)$/.test(text.replace(/\s/g, ''))) {
    return { state: 'none', text: EXPLICIT_NONE_LABEL };
  }
  if (text) return { state: 'value', text };
  if (OPTION_FIELDS.has(field)) {
    const explicitNone = atom.option_explicit_none === true || S(atom.option_value_state).toUpperCase() === 'NONE';
    return explicitNone
      ? { state: 'none', text: EXPLICIT_NONE_LABEL }
      : { state: 'missing', text: MISSING_VALUE_LABEL };
  }
  if (BATTERY_FIELDS.has(field)) {
    return isPureEv(atom)
      ? { state: 'missing', text: MISSING_VALUE_LABEL }
      : isCombustionOnly(atom)
        ? { state: 'not_applicable', text: NOT_APPLICABLE_LABEL }
        : { state: 'missing', text: MISSING_VALUE_LABEL };
  }
  if (ENGINE_FIELDS.has(field) && isPureEv(atom)) return { state: 'not_applicable', text: NOT_APPLICABLE_LABEL };
  return REQUIRED_DISPLAY_FIELDS.has(field)
    ? { state: 'missing', text: MISSING_VALUE_LABEL }
    : { state: 'value', text: '' };
}

export function atomDisplayText(field: string, value: unknown, atom: Record<string, unknown> = {}): string {
  return atomDisplayResult(field, value, atom).text;
}

export function isAtomDisplayPlaceholder(field: string, value: unknown): boolean {
  const text = S(value);
  if (text === MISSING_VALUE_LABEL) return true;
  if (text === EXPLICIT_NONE_LABEL) return false;
  if (text === NOT_APPLICABLE_LABEL) return ENGINE_FIELDS.has(field) || BATTERY_FIELDS.has(field);
  return false;
}
