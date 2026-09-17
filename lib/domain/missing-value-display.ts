/**
 * 원자 표시 공백의 단일 규칙.
 *
 * 원본·정제 원자에는 이 문구를 저장하지 않는다. 소비처(ERP·판매시트)가
 * 빈 값을 사람에게 보여줄 때만 아래 세 상태로 투영한다.
 */
export const MISSING_VALUE_LABEL = '미입력' as const;
export const EXPLICIT_NONE_LABEL = '없음' as const;
export const NOT_APPLICABLE_LABEL = '해당없음' as const;

/**
 * ★**「미입력」·「해당없음」 글자색 — 연한 회색.** 사장님 2026-09-16 「미입력은 좀 색깔이 회색이어야지」·
 * 「연하게 미입력으로 가야지」. 값이 아니라 «아직 안 채운 칸»이라 검정이면 실제 값처럼 읽힌다.
 * ⚠ 배차상태 회색(`999999` — 계약중·출고불가)보다 **한 단계 연하게**. 둘이 같으면
 *   「못 파는 차」와 「값이 없는 칸」이 같은 무게로 보인다.
 * ★낱말과 «같은 파일»에 둔다 — 색만 딴 곳에 있으면 낱말을 늘릴 때 색이 빠진다
 *   (사장님 「ssot 규격 통일하고 이거 이제 잠그자」 2026-09-16).
 * ★「없음」은 옵션의 «업무 값»이라 눕히지 않는다 — 아래 `MISSING_DISPLAY_LABELS` 에 안 넣는다.
 */
export const MISSING_INK = 'B7B7B7' as const;
/** 연한 회색으로 눕히는 «표시 전용» 낱말들 — 시트 조건부서식·화면이 같은 목록을 본다. */
export const MISSING_DISPLAY_LABELS: readonly string[] = [MISSING_VALUE_LABEL, NOT_APPLICABLE_LABEL];

export type AtomDisplayState = 'value' | 'missing' | 'none' | 'not_applicable';

export type AtomDisplayResult = {
  state: AtomDisplayState;
  text: string;
};

const S = (value: unknown): string => String(value ?? '').trim();
/**
 * ★하이픈류 단독 값도 «빈칸」이다 — 사장님 2026-09-16 「하이픈도 미입력으로 봐야할거 같은데 ssot부터」.
 *   공급사 원문이 값 대신 「-」·「—」·「–」·「‑」(반각/전각/장단 하이픈 전부)만 적어 두는 경우가 있다 —
 *   사람은 「모른다」는 뜻으로 적지만 문자로는 «값 있음»(빈 문자열 아님)이라 지금까지 REQUIRED_DISPLAY_FIELDS
 *   판정을 피해 하이픈 그대로 시트에 찍혔다. 값 판정 «맨 앞»에서 하이픈류만 있으면 빈칸으로 내린다 —
 *   이 함수 하나만 고치면 SSOT 정의상 이 판정을 쓰는 모든 소비처(판매시트·ERP 등)에 한 번에 퍼진다.
 */
const DASH_ONLY = /^[-‐‑‒–—―−－]+$/;
const stripDashPlaceholder = (raw: string): string => (DASH_ONLY.test(raw) ? '' : raw);

const OPTION_FIELDS = new Set(['options', '옵션', '옵션(원문)']);
const ENGINE_FIELDS = new Set(['engine_cc', '배기량']);
const BATTERY_FIELDS = new Set(['battery_capacity', '배터리용량']);

/** 빈칸이면 업무상 누락으로 보여야 하는 판매 핵심 필드. */
const REQUIRED_DISPLAY_FIELDS = new Set([
  'vehicle_status', '배차상태', 'product_type', '구분',
  'maker', '제조사', 'model', '모델', 'sub_model', '세부모델',
  'trim_name', '세부트림', 'ext_color', '외장', 'int_color', '내장',
  'year', '연식', 'mileage', 'Km', 'fuel_type', '연료',
  'vehicle_class', '차종구분', 'origin', '원산지', 'drive_type', '구동',
  'seats', '인승', 'supplier_vehicle_name', '차명(원문)',
  'first_registration_date', '최초등록', 'location', '차고지',
  'policy_code', '정책UID', 'provider_name', '공급사',
  /**
   * ★2026-09-17 — 사장님 「차량가격도 입력안된거는 미입력으로 해주고」.
   *   차량가격(=소비자가격·차량가·차량가액 · 원자 `consumer_price`/`msrp`)은 차량 출고가이고
   *   취등록세·인수금의 «기준»이라, 빈칸이면 계산이 안 되는 칸이다 — 비어 있다는 사실이 보여야 한다.
   *   ⚠ 원천이 대부분 안 주는 칸이라 실측 절반(376대 중 188대)이 미입력으로 선다 — 그게 사실이다.
   */
  'consumer_price', 'msrp', '소비자가격', '차량가격',
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

/**
 * 값과 근거 상태를 함께 판정한다. 숫자 0은 값이므로 누락으로 바꾸지 않는다.
 * 옵션 근거 PASS는 `없음`의 증명이 아니다. 명시적인 NONE만 `없음`이다.
 */
export function atomDisplayResult(
  field: string,
  value: unknown,
  atom: Record<string, unknown> = {},
): AtomDisplayResult {
  const text = stripDashPlaceholder(S(value));
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

  if (ENGINE_FIELDS.has(field) && isPureEv(atom)) {
    return { state: 'not_applicable', text: NOT_APPLICABLE_LABEL };
  }

  return REQUIRED_DISPLAY_FIELDS.has(field)
    ? { state: 'missing', text: MISSING_VALUE_LABEL }
    : { state: 'value', text: '' };
}

export function atomDisplayText(
  field: string,
  value: unknown,
  atom: Record<string, unknown> = {},
): string {
  return atomDisplayResult(field, value, atom).text;
}

/** 판매시트의 표시 문구가 다시 ERP 원자값으로 유입되지 않게 하는 역방향 문지기. */
export function isAtomDisplayPlaceholder(field: string, value: unknown): boolean {
  const text = S(value);
  if (text === MISSING_VALUE_LABEL) return true;
  // `없음`은 옵션의 명시적 업무값이라 왕복 보존한다. 미입력/해당없음만 표시 전용이다.
  if (text === EXPLICIT_NONE_LABEL) return false;
  if (text === NOT_APPLICABLE_LABEL) return ENGINE_FIELDS.has(field) || BATTERY_FIELDS.has(field);
  return false;
}
