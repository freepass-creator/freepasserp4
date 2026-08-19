/**
 * 프리패스 표준 정책 기본값 — **실계약서에서 뽑은 것**.
 *
 * ★출처가 추측이 아니다
 *   지금 쓰는 계약서(`계약서양식/01. JPK_개인(개인사업자) 계약서.xlsx` → `esign-standard-terms.ts`)와
 *   A4 서식(`rental-contract.html`)의 고정문구에 **이미 박혀 있던 숫자**를 그대로 옮겼다.
 *   그러니 이 값을 넣으면 «지금 나가는 계약서와 같은 계약»이 된다. 새로 정하는 것이 아니다.
 *
 * ★왜 정책으로 빼는가
 *   지금은 코드·서식에 박혀 있어 공급사마다 다르게 둘 수 없다.
 *   공급사가 하나만 더 붙어도 깨진다. 정책으로 빼면 표준은 이 기본값이고, 다른 곳은 고쳐 쓴다.
 *
 * ★비워 둔 것은 «모르는 것»이다
 *   추측으로 채우지 않는다. 계약서에 숫자가 없던 항목은 `null` 로 두고 «확인 필요»로 표시한다.
 *   빈칸이 흠이지만, 틀린 기본값은 그 값으로 계약이 굳어 버린다.
 */

import { isDomesticMaker } from '@/lib/domain/product-filters';

export type PolicyDefault = {
  key: string;
  label: string;
  /** null = 계약서에 숫자가 없어 정할 수 없음. 사람이 정해야 한다. */
  value: string | number | null;
  /** 이 값을 어디서 가져왔는지. 근거 없는 기본값은 두지 않는다. */
  source: string;
};

/**
 * 프리패스 기본정책 패키지 식별자.
 *
 * 계약에 어떤 기본 묶음이 적용됐는지 로그·문서에서 같은 이름으로 추적할 수 있게 한다.
 * 값 변경은 계약 조건 변경이므로 새 버전으로 올리고 검증한 뒤 배포한다.
 */
export const FREEPASS_POLICY_PACK = 'freepass-common-rent-2026-08-14-v1' as const;

export const POLICY_DEFAULTS: PolicyDefault[] = [
  /* ── 정책 등록 기본값 ── 공급사별 예외만 고쳐 쓰는 프리패스 운영 표준 */
  {
    key: 'policy_name', label: '정책명', value: '프리패스 공통 렌트 · 보험료 포함',
    source: '프리패스 정책등록 기본명 — 공급사별 정책명으로 수정 가능',
  },
  {
    key: 'policy_type', label: '정책유형', value: '중고렌트',
    source: '프리패스 표준 장기대여 기본 상품 — 신차는 별도 정책으로 등록',
  },
  {
    key: 'screening_criteria', label: '심사조건', value: '무심사', // 사장님 2026-08-19 셋(무심사·소득확인·신용조회) — 옛 「신용무관」=무심사
    source: '프리패스 저신용·무심사 영업 기본정책',
  },
  {
    key: 'credit_grade', label: '신용등급', value: '무관',
    source: '심사기준 「신용무관」과 동일한 기본값',
  },
  {
    key: 'basic_driver_age', label: '기본운전자연령', value: '만 26세 이상', // 사장님 2026-08-19 — 시트 규격 글자(select)
    source: '프리패스 표준 계약서 만 26세 이상 보험 기준',
  },
  {
    key: 'driver_age_lowering', label: '연령하향', value: '만 21세까지',
    source: '프리패스 연령별 면책금 표의 최저 계약 가능 연령',
  },
  {
    key: 'driver_age_upper_limit', label: '최대연령', value: '만 70세 이하', // 시트 규격 글자
    source: '프리패스 기본정책 만 70세 이하',
  },
  {
    key: 'license_period', label: '면허 경력요건', value: '1년 이상', // 사장님 2026-08-19 프리패스 기본 정책(손오공 시트 기본행)
    source: '프리패스 기본정책 — 별도 지정이 없으면 면허 경력 제한 없음',
  },
  {
    key: 'age_lowering_cost', label: '연령 하향 요금', value: '10만원', // 정액·정률 겸용 글자(policy-money-rate 가 읽음)
    source: '프리패스 기본정책 — 연령하향 계약 월 10만원',
  },
  {
    key: 'annual_mileage', label: '약정 주행거리', value: '연 30,000km', // 사장님 2026-08-19 프리패스 기본 정책
    source: '프리패스 기본정책 — 연간 2만km',
  },
  {
    key: 'mileage_upcharge_per_10000km', label: '1만km 추가', value: '대여료의 10%', // 사장님 2026-08-19 — 정률
    source: '프리패스 기본정책 — 약정 주행거리 1만km 추가 시 월 10만원',
  },
  {
    key: 'payment_method', label: '결제방식', value: 'CMS 자동이체',
    source: '프리패스 장기렌터카 대여료 기본 수납 방식',
  },
  {
    key: 'payment_timing', label: '대여료 납부 조건', value: '선불',
    source: '프리패스 표준 기본값 · 공급사 정책 또는 개별계약에서 후불로 변경 가능',
  },
  {
    key: 'payment_due_date', label: '월 납부일', value: '매월 25일',
    source: '기존 프리패스 A4 표준계약서의 월 납부일 기본값',
  },
  {
    key: 'rental_region', label: '대여지역', value: '전국',
    source: '프리패스 기본 영업지역',
  },
  {
    key: 'delivery_fee', label: '탁송비', value: '일부지원', // 사장님 2026-08-19 프리패스 기본 정책
    source: '차량·지역별 실제 탁송비 협의 후 확정',
  },
  {
    key: 'deposit_installment', label: '보증금 분납', value: '2회까지',
    source: '프리패스 기본정책 — 보증금 2회차 관리 기준과 일치',
  },
  {
    key: 'deposit_card_payment', label: '보증카드', value: '가능',
    source: '프리패스 기본정책 — 보증금 카드 수납 가능',
  },
  {
    key: 'personal_driver_scope', label: '개인운전자범위', value: '본인+직계가족', // 사장님 2026-08-19 프리패스 기본 정책(시트 규격 글자)
    source: '프리패스 개인계약 기본 운전자 범위',
  },
  {
    key: 'business_driver_scope', label: '법인운전자범위', value: '임직원', // 사장님 2026-08-19
    source: '프리패스 사업자계약 기본 운전자 범위',
  },
  {
    key: 'additional_driver_allowance_count', label: '추가운전 인원', value: '1인까지', // 시트 규격 글자
    source: '프리패스 기본정책 — 추가 운전자 1인',
  },
  {
    key: 'additional_driver_cost', label: '추가운전 요금', value: '5만원', // 정액·정률 겸용 글자
    source: '프리패스 기본정책 — 추가 운전자 월 5만원',
  },
  {
    key: 'commission_clawback_condition', label: '수수료 환수조건', value: '별도 약정',
    source: '공급사별 정산 약정 우선 — 기본은 별도 약정으로 명시',
  },
  {
    key: 'self_body_deductible', label: '자손 면책금', value: '30만원', // 사장님 2026-08-19
    source: '프리패스 공통값 — 계약회사 실제 가입증권과 다르면 공급사 정책에서 수정',
  },
  {
    key: 'uninsured_deductible', label: '무보험 면책금', value: '없음',
    source: '프리패스 표준은 무보험차상해 미가입이므로 면책금 없음',
  },
  {
    key: 'contract_authoring', label: '계약서 작성', value: '프리패스가 작성',
    source: '프리패스 기본정책 패키지 — 별도 지정이 없으면 프리패스가 전자계약서를 작성',
  },
  /* ── 미납 제재 ── 각 금원의 계약상 납부기한 다음 날부터 계산 */
  {
    key: 'engine_control_overdue_days', label: '시동제어 기준일', value: '3일', // 시트 규격 글자
    source: '계약서 「각 납부기한 다음 날부터 계산하여 연체 3일째 18시 미납 시 시동제어」',
  },
  {
    key: 'auto_terminate_overdue_days', label: '차량회수 기준일', value: '10일',
    source: '계약서 「10일째 미납 시 최고 후 계약 해지·회수」',
  },
  {
    key: 'deposit_overdue_rounds', label: '보증금 미납 시동제어(회차)', value: 2,
    source: '계약서 「보증금 2회차도 해당 회차 납부기한 기준」',
  },

  /* ── 돈 ── */
  {
    key: 'late_fee_rate', label: '지연손해금율(0~1)', value: 0.24,
    source: '프리패스 표준값 연 24% — 관계 법령상 허용 한도 내에서 적용',
  },
  {
    key: 'succession_allowed', label: '승계 가능여부', value: '가능', // 사장님 2026-08-19
    source: '프리패스 표준은 회사 사전승인 후 협의 — 계약회사별 가능·협의·불가를 확인해 수정',
  },
  {
    key: 'succession_fee', label: '승계수수료', value: '100만원', // 정액·정률 겸용 글자
    source: '프리패스 공급 렌터카사 평균 운영값 100만원 — 계약회사별 실제 적용금액을 확인해 수정',
  },
  {
    key: 'deposit_return_days', label: '보증금 반환기한', value: '7일',
    source: '계약서 「과태료·사고 여부 확인 후 1주일 안에 고객 지정 계좌로 반환」',
  },

  /* ── 만기 ── */
  {
    key: 'renewal_notice_days', label: '연장 사전통지기한(일)', value: 30,
    source: '계약서 「계약종료 한달(30일)전 까지는 당사의 승인을 받아야 합니다」',
  },
  {
    key: 'buyout_notice_days', label: '인수 사전통지기한(일)', value: 30,
    // 계약서에 인수 통지기한이 따로 없다. 연장과 같은 시점에 판단하므로 30일로 맞춘다.
    // 다르게 두려면 여기서 고친다 — 약관 제18조가 이 값을 그대로 참조한다.
    source: '계약서에 별도 기재 없음 — 연장 통지기한(30일)에 맞춤. 다르면 고칠 것',
  },

  /* ── 제재 ── */
  {
    key: 'accident_termination_count', label: '사고 다발 해지기준', value: '3회',
    source: '계약서 「사고 발생 시점 1년 이내 임차인 과실비율 50% 이상의 사고 3회 누적 시 계약 해지」',
  },
  {
    key: 'claim_basis', label: '청구 기준', value: '잔여 대여료',
    source: '계약서 「계약해지 정산 시 잔여 대여료 상당액을 기준으로 청구 (중도해지수수료와 중복 청구하지 않음)」',
  },

  /* ── 정비·사고 ── */
  {
    key: 'designated_garage', label: '지정 정비점', value: '지정 협력 정비공장',
    source: '서식 05항 「임대인 지정 또는 사전 합의된 정비점」 · 계약서 「임의 수리 시 전액 임차인 부담」',
  },
  {
    key: 'replacement_car_policy', label: '대차 제공', value: '불가', // 사장님 2026-08-19 표기
    // 「지원 불가」는 부정조건이다 — 비워 두면 손님이 대차되는 줄 안다.
    source: '계약서 「대차서비스 지원 불가 합니다」',
  },
  {
    key: 'gps_installed', label: 'GPS 장착', value: '장착',
    source: '계약서 특약 「GPS 장착(도난 및 연체, 연락 두절시 시동 제어)」',
  },

  /* ── 보험 ── 신규 정책은 공통값으로 시작하고, 계약회사별 실제 가입증권과 다른 값만 수정한다. */
  {
    key: 'insurer_name', label: '가입 보험사·공제조합', value: '계약 체결일 기준 가입 보험사·공제조합(차량별 상이)',
    source: '프리패스 공통 변동 문구 — 공급사가 고정 가입처를 쓰는 경우 실제 명칭으로 수정',
  },
  {
    key: 'insurance_included', label: '보험료', value: '보험료 포함', // 시트 규격 글자
    source: '프리패스 표준 렌트계약서 — 월 대여료에 보험료 포함',
  },
  {
    key: 'injury_compensation_limit', label: '대인배상', value: '무한',
    source: '프리패스 공통값 — 계약회사 실제 가입증권과 다르면 공급사 정책에서 수정',
  },
  {
    key: 'property_compensation_limit', label: '대물배상', value: '1억원', // 사장님 2026-08-19 — 영업용 기본 1억원(A4 서식 기본과 일치)
    source: '프리패스 공통값 — 계약회사 실제 가입증권과 다르면 공급사 정책에서 수정',
  },
  {
    key: 'self_body_accident', label: '자기신체사고', value: '1억원', // 사장님 2026-08-19 프리패스 기본 정책
    source: '프리패스 표준값 — 계약회사 실제 가입증권과 일치하는지 확인 후 적용',
  },
  {
    key: 'uninsured_damage', label: '무보험보상', value: '없음', // 사장님 2026-08-19 프리패스 기본 정책
    source: '프리패스 표준값 — 계약회사 실제 가입증권과 일치하는지 확인 후 적용',
  },
  {
    key: 'own_damage_compensation', label: '자차보상한도', value: '차량가액', // 시트 규격 글자
    source: '프리패스 공통값 — 계약회사 실제 자차면책 규정과 다르면 공급사 정책에서 수정',
  },
  {
    key: 'own_damage_repair_ratio', label: '자차 자기부담률', value: '20%',
    source: '프리패스 공통값 — 수리비의 20%, 계약회사 규정과 다르면 공급사 정책에서 수정',
  },
  /* 자차 면책금 하한·상한도 계약회사별 실제 가입증권·면책 규정으로 확정한다. */
  {
    key: 'own_damage_min_deductible', label: '자차 최소 면책금', value: '50만원',
    source: '프리패스 공통값 — 수리비의 20%에 적용하는 최소 금액',
  },
  {
    key: 'own_damage_max_deductible', label: '자차 최대 면책금', value: '100만원',
    source: '프리패스 공통값 — 수리비의 20%에 적용하는 최대 금액',
  },
  /* 대인·대물 면책금은 프리패스 공통값으로 시작하고 회사별 실제 면책 규정으로 수정한다. */
  {
    key: 'injury_deductible', label: '대인 면책금', value: '30만원',
    source: '프리패스 공통값 — 계약회사 실제 면책 규정과 다르면 공급사 정책에서 수정',
  },
  {
    key: 'property_deductible', label: '대물 면책금', value: '30만원',
    source: '프리패스 공통값 — 계약회사 실제 면책 규정과 다르면 공급사 정책에서 수정',
  },

  /* ── 상품 기본 ── */
  {
    key: 'maintenance_service', label: '정비 상품', value: '불포함', // 사장님 2026-08-19 표기
    source: '계약서 「정비상품 선택을 안할경우 정비 및 소모품 교체는 고객이 부담」 — 선택 안 함이 기본',
  },
  {
    key: 'annual_roadside_assistance', label: '긴급출동', value: '연간 5회', // 시트 규격 글자
    source: '프리패스 공통값 — 계약회사 실제 긴급출동 특약과 다르면 공급사 정책에서 수정',
  },

  /* ── 사장님 지정(2026-08-09) ── 계약서에 숫자가 없어 새로 정한 프리패스 표준 */
  {
    key: 'over_mileage_rate_domestic', label: '초과주행 국산(1km당)', value: '200원',
    source: '프리패스 표준(2026-08-09 지정) — 국산차 1km 초과당 200원',
  },
  {
    key: 'over_mileage_rate_imported', label: '초과주행 수입(1km당)', value: '400원',
    source: '프리패스 표준(2026-08-09 지정) — 수입차 1km 초과당 400원',
  },
  {
    key: 'impound_keep_days', label: '물품 보관기간(일)', value: 7,
    source: '프리패스 표준(2026-08-09 지정) — 약관 제22조가 참조하는 값',
  },
  {
    key: 'early_termination_rate_under1y', label: '중도해지 위약금 · 1년 미만', value: '30%', // 잔여 대여료의 30% — 겸용 글자
    source: '프리패스 표준(2026-08-09 지정) — 잔여기간 대여료의 30%',
  },
  {
    key: 'early_termination_rate_over1y', label: '중도해지 위약금 · 1년 이상', value: '20%',
    source: '프리패스 표준(2026-08-09 지정) — 잔여기간 대여료의 20%',
  },

  {
    key: 'self_damage_exclusions', label: '자차 처리 제외',
    value: '단독사고,가해자 불명,휠·타이어 단독 손상,전손,고의·관리 소홀',
    // A4 서식 04항에 이미 인쇄되던 문구다. 공급사별로 다를 수 있으나 프리패스 표준은 이것.
    source: '계약서 04항 「단독사고 · 가해자 불명(보유불명) 사고 · 휠/타이어 단독 손상 · 전손 · 고의·관리 소홀 등」',
  },

  {
    key: 'penalty_condition', label: '중도해지 위약금(표기)', value: '잔여 대여료의 30%',
    // 영업 상담에서 한마디로 말할 때 쓰는 표기. 실제 계산은 위 두 요율이 한다.
    source: '1년 미만 30% 기준 표기 — 실제 계산은 early_termination_rate_* 가 한다',
  },

  {
    key: 'impound_fee', label: '물품 보관료(1일)', value: 10000,
    // 서식은 「1일 0원」으로 자리만 잡아 둔 표시였다(실값 아님). 여기서 실값을 정한다.
    source: '프리패스 표준(2026-08-09 지정) — 1일 10,000원. 약관 제22조가 참조',
  },
];

/**
 * 이 계약에 붙는 초과 주행요금 — **국산이냐 수입이냐로 갈린다.**
 *
 * 제조사 판정은 `isDomesticMaker` 하나만 쓴다. 판정을 두 벌로 두면
 * 필터에선 국산인데 계약서엔 수입 요율이 찍힌다.
 * 값이 없으면 «없음»을 돌려준다 — 한쪽 요율로 메우지 않는다.
 */
export function overMileageRateFor(
  policy: Record<string, unknown> | null | undefined,
  maker: string,
): number | null {
  const p = policy || {};
  const key = isDomesticMaker(String(maker || ''))
    ? 'over_mileage_rate_domestic'
    : 'over_mileage_rate_imported';
  const n = policyNumber(p[key]);   // 「200원」·200 둘 다
  if (n !== null && n > 0) return n;
  /**
   * 국산·수입을 나눠 정하지 않은 공급사가 대부분이다 — 그 경우 **한 값을 둘 다에 쓴다.**
   * 실측(2026-08-12): 32개 정책 전부 `_domestic`·`_imported` 가 비어 있고
   * `over_mileage_rate_per_km` 만 채워져 있어, 계약서의 초과주행 요금이 통째로 빈칸이었다.
   * 나눠 정한 곳은 위에서 이미 걸러졌으므로 여기서 덮어쓸 일은 없다.
   */
  const flat = policyNumber(p.over_mileage_rate_per_km);
  return flat !== null && flat > 0 ? flat : null;
}

/** 시트 규격 글자(「7일」「3회」「200원」「만 26세 이상」)에서 숫자만 — 옛 숫자값도 그대로. 없음·제한없음은 null. */
export function policyNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v ?? '').replace(/,/g, '').trim();
  if (!t || /^(없음|제한없음|무제한|협의)$/.test(t)) return null;
  const m = t.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n)) return null;
  return /만원$/.test(t.replace(/\s/g, '')) ? Math.round(n * 10_000) : n;
}

/**
 * 중도해지 위약금율 — **경과 기간으로 갈린다**(1년 미만 30% / 1년 이상 20%).
 * 잔여기간 대여료에 이 율을 곱한다. 계약서에는 두 구간을 다 적어 손님이 미리 알게 한다.
 */
export function earlyTerminationRateFor(
  policy: Record<string, unknown> | null | undefined,
  elapsedMonths: number,
): number | null {
  const p = policy || {};
  const key = (Number(elapsedMonths) || 0) < 12
    ? 'early_termination_rate_under1y'
    : 'early_termination_rate_over1y';
  const n = Number(p[key]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 기본값을 정책 레코드에 얹는다. **이미 값이 있으면 덮지 않는다.** */
export function applyPolicyDefaults(policy: Record<string, unknown>): {
  next: Record<string, unknown>; filled: string[]; pending: PolicyDefault[];
} {
  const next = { ...policy };
  const filled: string[] = [];
  const pending: PolicyDefault[] = [];
  const packageAlreadyApplied = String(policy.policy_default_pack || '').trim() !== '';

  for (const d of POLICY_DEFAULTS) {
    if (d.value === null) {
      const cur = next[d.key];
      if (cur === undefined || cur === null || String(cur).trim() === '') pending.push(d);
      continue;
    }
    const cur = next[d.key];
    if (cur !== undefined && cur !== null && String(cur).trim() !== '') continue;
    // 패키지를 이미 적용한 정책의 빈칸은 공급사가 삭제·미사용으로 정한 값이다.
    // 다시 열거나 계약 payload를 만들 때 되살리지 않는다.
    if (packageAlreadyApplied) continue;
    next[d.key] = d.value;
    filled.push(d.key);
  }
  // 실제로 현재 패키지의 기본값을 하나라도 보충했을 때만 버전을 남긴다.
  // 완전 사용자 정의 정책에 패키지명을 허위로 붙이지 않고, 부분 기본 정책은 어느 버전이 섞였는지 추적한다.
  if (filled.length > 0) next.policy_default_pack = FREEPASS_POLICY_PACK;
  return { next, filled, pending };
}
