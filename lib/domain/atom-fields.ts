/**
 * 원자 «필드 → 역할» 레지스트리 (SSOT) — 사장님 2026-09-05 「공통 / 변동 / 비공통 구분해서 보여줘」.
 *
 * ★핵심 사상: 비공통을 «나열」하지 않고 «계산」한다.
 *   지금까지의 데닐리스트(STRUCT/HIDE)는 «공통에 넣는 걸 깜빡하면 그 칸이 비공통으로 샜다»
 *   — 실측(2026-09-05): vehicle_class·photo_link 를 공통에 안 넣어 「비공통」에 잘못 떨어졌고,
 *     정작 진짜 원본 `원문` 은 숨겨져 있었다. 공통을 비공통이라 하고 원본을 감춘 꼴.
 *
 *   ⇒ 아는 칸(공통·변동·정책·메타)만 여기 «명시」하고,
 *      **비공통 = 원자키 − 역할표 − 메타(`_`) = 계산**.
 *      그래서 공급사가 새 칸을 흘리면 «자동으로 비공통에 떨어져 눈에 띈다»(「새 칸 N개」).
 *      실수가 «안전한 쪽(드러남)»으로만 난다 — atom-invariants 의 «게이트» 사상과 같은 짝.
 *
 * 근거 정본: docs/원자-원천지도.md (② 불변 / ③④ 변동 / ⑤ 정책 / 원천 없는 칸).
 */

export type AtomRole = '공통' | '변동' | '정책' | '메타';

/**
 * 아는 칸의 역할. 여기 «없는» 비메타 키는 전부 비공통(계산). `_` 접두는 무조건 메타.
 * 원문(공급사 원본 blob)은 «일부러» 등재하지 않는다 → 비공통으로 계산돼 [D] 원문 구역에 뜬다.
 */
export const FIELD_ROLE: Record<string, AtomRole> = {
  // ② 불변 공통 — 차의 정체·제원 (한 번 박고 안 바뀜). 비어도 칸은 늘 있다(원천 미제공 ≠ 숨김).
  car_number: '공통', origin: '공통', maker: '공통', model: '공통', sub_model: '공통', trim_name: '공통',
  options: '공통', ext_color: '공통', int_color: '공통', year: '공통', fuel_type: '공통', engine_cc: '공통',
  seats: '공통', drive_type: '공통', battery_capacity: '공통', vehicle_class: '공통', product_type: '공통',
  photo_link: '공통', first_registration_date: '공통',
  // ③④ 변동 — 매시간 연동(출고상태·주행·요금). status_* 은 상태 파생/원문.
  status: '변동', status_kind: '변동', status_reason: '변동', status_label_raw: '변동', vehicle_status: '변동',
  mileage: '변동', price: '변동',
  // ⑤ 정책 — policy_code 로 policy 문서 조인(별도 구역).
  policy_code: '정책',
  // 메타 — 내부·출처·게이트. 비공통 계산에서 제외(단 공급사·원천은 화면에 «출처»로 노출).
  provider_company_code: '메타', partner_code: '메타', source: '메타', source_schema: '메타',
  sheet_source_tab: '메타', sheet_source_row: '메타', product_code: '메타', listable: '메타',
  확정: '메타', 검수상태: '메타', _key: '메타', companyId: '메타',
};

/** 목록/상세에서 «공통」을 찍는 순서 (정체 → 제원). photo_link·first_registration_date 는 목록엔 안 쓰고 상세 참고용. */
export const COMMON_ORDER = [
  'car_number', 'origin', 'maker', 'model', 'sub_model', 'trim_name',
  'options', 'ext_color', 'int_color', 'year', 'fuel_type', 'engine_cc',
  'seats', 'drive_type', 'battery_capacity', 'vehicle_class', 'product_type',
] as const;

/** 한 필드의 역할. 등재 안 된 비메타 키 = 비공통. */
export function roleOf(key: string): AtomRole | '비공통' {
  if (key.startsWith('_')) return '메타';
  return FIELD_ROLE[key] ?? '비공통';
}

/**
 * 비공통 키 = «계산». 원자에서 역할표·메타(`_`)·빈값을 뺀 나머지.
 * `원문` 및 공급사가 새로 흘린 미등재 키가 여기 떨어진다 → [D] 원문 구역 + 「새 칸」 경고.
 */
export function nonCommonKeys(atom: Record<string, unknown>): string[] {
  return Object.keys(atom).filter((k) => roleOf(k) === '비공통' && atom[k] != null && atom[k] !== '');
}

/** 미등재 «새 칸»(원문 제외) — 공급사가 새로 흘린 것. 있으면 검수 신호. */
export function unknownKeys(atom: Record<string, unknown>): string[] {
  return nonCommonKeys(atom).filter((k) => k !== '원문');
}
