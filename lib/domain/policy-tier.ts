/**
 * 정책 세 층 — 「상품」 · 「영업」 · 「계약」.
 *
 * ★왜 나누나
 *   공급사마다 우리에게 맡기는 범위가 다르다.
 *     · **상품만 공급**하는 곳 — 매물·견적만 우리를 통하고 계약서는 자기가 쓴다.
 *     · **계약까지 맡기는 곳** — 계약서를 우리가 쓴다. 그러면 해지 사유·연체일수·위약금·
 *       보관료·통지기한까지 우리 정책이 들고 있어야 계약서가 완성된다.
 *
 *   한 덩어리로 두면 양쪽 다 틀어진다. 상품만 맡긴 곳에 해지 조건을 채우라 하면 못 채우고,
 *   계약까지 맡긴 곳인데 비워 두면 **빈칸 계약서가 나가거나 약관 조문이 공중에 뜬다.**
 *
 * ★그리고 «영업이 아는 것»과 «손님에게 나가는 것»이 다르다
 *   심사기준 「중신용 이상」은 영업사원이 알아야 할 값이지만 **손님 화면에 뜨면 사고다**
 *   (우리가 그 사람을 어떻게 평가했는지를 본인에게 보여주는 것). 실제로 새고 있었다.
 *   그래서 층을 나누는 동시에 항목마다 «어디까지 나가는가»를 못박는다.
 *
 * ★전자계약은 「계약」 층까지 채운 공급사에만 나간다
 *   `canIssueContract()` 가 게이트다. 빈칸 계약서를 손님에게 보내는 것보다
 *   발행이 안 되는 편이 낫다 — 서명이 끝나면 그 빈칸은 봉인되어 고치지 못한다.
 */

/** 어디까지 나가는가. 이 딱지가 없어서 심사기준이 손님 화면에 샜다. */
export type Exposure =
  | 'internal'   // 내부 전용 — 손님에게 절대 안 나간다
  | 'sales'      // 영업사원 상담용 — 말로 전하지만 계약서에는 안 실린다
  | 'quote'      // 견적서에 나간다
  | 'contract';  // 계약서·손님 서명화면에 실린다

export type PolicyLayer = 'product' | 'sales' | 'contract';

export const POLICY_LAYER_LABEL: Record<PolicyLayer, string> = {
  product: '상품 — 매물·견적에 필요한 것',
  sales: '영업 — 상담에서 영업사원이 알아야 할 것',
  contract: '계약 — 전자계약서를 쓰기 위해 필요한 것',
};

export type PolicyField = {
  key: string;
  label: string;
  layer: PolicyLayer;
  exposure: Exposure;
  /** 이 값이 없으면 뜨는 약관 조항. 계약 층은 반드시 적는다. */
  article?: string;
  /**
   * 영업 층 전용 — **이 값이 무엇을 결정하는가.**
   *
   * 영업 정책은 «가격표»다. 「1만km 상향하면 10만원」·「연령 하향하면 5.5만원」은
   * 상담에서 **월 대여료와 운전 연령을 정하는 데 쓰는 계산 입력**이지,
   * 계약이 굳은 뒤에 손님이 또 낼 돈이 아니다.
   * 결정이 끝나면 그 요율은 소임을 다하고 **결과만 계약서로 넘어간다**
   * (월 대여료 750,000원 · 운전자 연령 만 21세 이상).
   *
   * 이걸 계약서에 그대로 실으면 손님은 「이걸 따로 더 내나」로 읽는다.
   */
  decides?: string;
  why: string;
};

/* ── 층 1 · 상품 ───────────────────────────────────────────────
   상품만 공급하는 업체는 여기까지만 채우면 된다. 견적·매물 노출이 목적. */
export const PRODUCT_LAYER: PolicyField[] = [
  { key: 'annual_mileage', label: '약정 주행거리', layer: 'product', exposure: 'contract', article: '제23조', why: '기본 약정. 상향은 영업 층의 가격표로 정한다' },
  { key: 'basic_driver_age', label: '기본 운전자 연령', layer: 'product', exposure: 'contract', article: '제13조', why: '기본 자격. 하향은 영업 층의 가격표로 정한다. 면책금 산정 기준이기도 하다' },
  { key: 'license_period', label: '면허 경력요건', layer: 'product', exposure: 'contract', article: '제13조', why: '자격 요건' },
  { key: 'insurance_included', label: '보험 포함 여부', layer: 'product', exposure: 'contract', article: '제11조', why: '회사 가입형이냐 개인보험형이냐에 따라 보험 유지 주체가 갈린다' },
  { key: 'maintenance_service', label: '정비 상품', layer: 'product', exposure: 'contract', article: '제14조', why: '정비 범위' },
  { key: 'personal_driver_scope', label: '운전자 범위(개인)', layer: 'product', exposure: 'contract', article: '제13조', why: '범위 밖 운전 사고는 보험 전액 제외' },
  { key: 'business_driver_scope', label: '운전자 범위(사업자)', layer: 'product', exposure: 'contract', article: '제13조', why: '위와 같음' },
  { key: 'injury_compensation_limit', label: '대인배상', layer: 'product', exposure: 'contract', article: '제11조', why: '담보 한도' },
  { key: 'property_compensation_limit', label: '대물배상', layer: 'product', exposure: 'contract', article: '제11조', why: '담보 한도' },
  { key: 'self_body_accident', label: '자기신체사고', layer: 'product', exposure: 'contract', article: '제11조', why: '담보 한도' },
  { key: 'uninsured_damage', label: '무보험차상해', layer: 'product', exposure: 'contract', article: '제11조', why: '담보 한도' },
  { key: 'own_damage_compensation', label: '자차 보상', layer: 'product', exposure: 'contract', article: '제18조', why: '담보 한도' },
  { key: 'own_damage_repair_ratio', label: '자차 자기부담률', layer: 'product', exposure: 'contract', article: '제18조', why: '손님 부담분' },
  { key: 'annual_roadside_assistance', label: '긴급출동', layer: 'product', exposure: 'contract', article: '제14조', why: '연간 횟수' },
];

/* ── 층 2 · 영업 ───────────────────────────────────────────────
   영업사원이 상담에서 쓰는 **가격표**. 여기 있는 값은 «결정을 위한 계산 입력»이다.
   결정이 끝나면 요율은 소임을 다하고 **결과만 계약서로 넘어간다.**

     1만km 상향 10만원  →  월 대여료 750,000원        (계약서에는 결과만)
     연령 하향 5.5만원   →  운전자 연령 만 21세 이상   (계약서에는 결과만)

   요율을 계약서에 그대로 실으면 손님은 「이걸 따로 더 내나」로 읽는다.
   사실상 이 층이 정하는 것은 **대여료와 운전 연령** 둘이다(2026-08-09 사장님 정리). */
export const SALES_LAYER: PolicyField[] = [
  // ① 대여료를 결정하는 것
  { key: 'mileage_upcharge_per_10000km', label: '1만km 상향 요금', layer: 'sales', exposure: 'sales', decides: '월 대여료', why: '약정 주행거리를 올릴 때의 가산액. 2만km 65만 / 3만km 75만 — 확정되면 월 대여료에 녹는다' },
  { key: 'age_lowering_cost', label: '연령 하향 요금', layer: 'sales', exposure: 'sales', decides: '월 대여료 · 운전자 연령', why: '하향을 선택하면 대여료가 오르고 연령이 내려간다' },
  { key: 'additional_driver_cost', label: '추가운전자 요금', layer: 'sales', exposure: 'sales', decides: '월 대여료', why: '지정 인원만큼 대여료에 얹힌다' },
  { key: 'delivery_fee', label: '탁송비', layer: 'sales', exposure: 'quote', decides: '초기 비용', why: '금액이 확정되면 견적·계약서로' },

  // ② 운전 연령·자격을 결정하는 것
  { key: 'driver_age_lowering', label: '연령 하향 가능 범위', layer: 'sales', exposure: 'sales', decides: '운전자 연령', why: '만 21세까지 내릴 수 있다는 «선택지». 결정되면 계약서에는 굳은 연령만' },
  { key: 'driver_age_upper_limit', label: '연령 상한', layer: 'sales', exposure: 'sales', decides: '운전자 연령', why: '자격 판정' },
  { key: 'additional_driver_allowance_count', label: '추가운전자 허용 수', layer: 'sales', exposure: 'contract', article: '제13조', decides: '등록 가능 인원', why: '몇 명까지 등록 가능한가 — 이건 계약 내내 적용되므로 계약서에도 실린다' },

  // ③ 납부 방식을 결정하는 것
  { key: 'deposit_installment', label: '보증금 분납 가능 회차', layer: 'sales', exposure: 'sales', decides: '보증금 납부 방식', why: '선택지. 계약서에는 «3회 분납»처럼 굳은 값만' },
  { key: 'rental_card_payment', label: '대여료카드', layer: 'sales', exposure: 'sales', decides: '대여료 납부 방식·카드 수수료', why: '결제 수단' },
  { key: 'deposit_card_payment', label: '보증카드', layer: 'sales', exposure: 'sales', decides: '보증금 납부 방식', why: '결제 수단' },
  { key: 'payment_method', label: '결제방식', layer: 'sales', exposure: 'contract', article: '제6조', decides: '대여료 납부 방식', why: 'CMS·카드 등' },
  { key: 'payment_timing', label: '대여료 납부 조건', layer: 'sales', exposure: 'contract', article: '제6조', decides: '대여료 납부 시점', why: '선불·후불은 결제수단과 별개인 계약조건. 정책 기본값을 가져오되 계약 건별로 확정한다' },

  // ④ 승인 여부를 결정하는 것 — 손님에게 절대 안 나간다
  { key: 'screening_criteria', label: '심사조건', layer: 'sales', exposure: 'internal', decides: '계약 승인 여부', why: '⚠ **계약서에는 안 실린다**(exposure=internal 이 그걸 지킨다). 손님 «화면»에는 2026-09-05 부터 실린다 — 사장님 「심사 조건은 계속 띄워요」. 단 원문이 아니라 creditDisplay 가 셋(무심사/신용조회/소득확인)으로 접은 값이다' },
  { key: 'disqualification_conditions', label: '불가조건', layer: 'sales', exposure: 'internal', decides: '계약 가능 여부(상담)', why: '⚠ 내부 상담 기준(「3년 이내 음주이력」). 손님 화면·계약서에 실리지 않는다' },
  { key: 'sales_notes', label: '특이사항(영업)', layer: 'sales', exposure: 'internal', decides: '영업 상담 안내', why: '영업자가 알아야 할 그 밖의 조건. 손님 화면·계약서에 실리지 않는다' },
  { key: 'policy_extra_terms', label: '기타사항(계약서)', layer: 'contract', exposure: 'contract', decides: '계약서 특약', why: '표에 없는 계약조건 — 계약서 특약 칸에 그대로 실린다(사장님 2026-08-20). 손님이 서명 전에 읽는 글이다' },
  { key: 'credit_grade', label: '신용등급', layer: 'sales', exposure: 'internal', decides: '계약 승인 여부', why: '⚠ 위와 같음' },

  // ⑤ 상담 안내 — 결정도 적용도 아닌 것
  { key: 'contracts_per_customer_limit', label: '1인당 계약 대수', layer: 'sales', exposure: 'sales', decides: '둘째 대 계약 가능 여부', why: '첫 대는 되고 둘째 대가 막히는 자리라 상담 초반에 걸러야 한다. 계약서 조항이 아니라 영업 기준이다' },
  { key: 'rental_region', label: '대여지역', layer: 'sales', exposure: 'sales', why: '상품 안내. 이 계약의 조건이 아니라 계약서에 싣지 않는다' },
  { key: 'commission_clawback_condition', label: '수수료 환수조건', layer: 'sales', exposure: 'internal', why: '⚠ 우리와 공급사 사이의 약정. 손님과 무관하다' },
];

/* ── 층 3 · 계약 ───────────────────────────────────────────────
   **전자계약을 우리가 쓰는 공급사만** 채운다.
   목록은 임의로 정한 것이 아니라 «약관이 계약서를 참조하는 자리»다 —
   비면 그 조문이 아무것도 정하지 못한다. */
export const CONTRACT_LAYER: PolicyField[] = [
  { key: 'payment_due_date', label: '월 납부일', layer: 'contract', exposure: 'contract', article: '제6조', why: '직원이 매 계약마다 입력하지 않고 계약회사 정책에서 확정한다' },
  /* ── 위반 시 무는 돈(패널티) ──
     약정을 지키지 못했을 때 «더 내는» 것들이다. 상품을 고를 때 정하는 가격이 아니라
     계약을 어겼을 때 붙는 것이므로, 영업 층 가격표와 섞으면 안 된다. */
  { key: 'over_mileage_rate_domestic', label: '초과 주행요금 · 국산(1km당)', layer: 'contract', exposure: 'contract', article: '제23조', why: '약정을 넘겨 달린 거리에 붙는다. 1만km 상향(가격표)과 다른 값' },
  { key: 'over_mileage_rate_imported', label: '초과 주행요금 · 수입(1km당)', layer: 'contract', exposure: 'contract', article: '제23조', why: '수입은 국산보다 높다 — 한 칸으로 두면 수입차에 국산 요율이 찍힌다' },
  /*
   * 중도해지 위약금은 **경과 기간으로 갈린다**(1년 미만 30% / 1년 이상 20%).
   * 드롭다운 penalty_condition 하나로 두면 어느 구간인지 못 적어 계약서가 거짓말을 한다.
   * → 요율 두 칸만 계약 층에 둔다. penalty_condition 은 영업 상담 표기로 남긴다.
   */
  /**
   * 승계 — 해지와 **다른 길**이다. 해지는 위약금을 물고 끝내고, 승계는 남은 기간을 새 임차인이
   * 이어받는다. 손님이 낼 돈이 전혀 다르므로 한 칸으로 뭉치면 상담에서 못 답한다.
   * 계약서에는 가능여부와 수수료를 함께 표시하고, 약관 제8조·제10조가 승인·정산 근거를 잇는다.
   */
  { key: 'succession_allowed', label: '승계 가능여부', layer: 'contract', exposure: 'contract', article: '제8조·제10조', why: '회사의 사전승인 아래 승계가 가능한지 회사별로 정한다' },
  { key: 'succession_fee', label: '승계수수료(원)', layer: 'contract', exposure: 'contract', article: '제8조·제10조', why: '승계 승인·심사·계약변경 업무에 적용하는 회사별 금액' },
  { key: 'early_termination_rate_under1y', label: '중도해지 위약금 · 1년 미만(0~1)', layer: 'contract', exposure: 'contract', article: '제8조', why: '잔여기간 대여료 × 이 율' },
  { key: 'early_termination_rate_over1y', label: '중도해지 위약금 · 1년 이상(0~1)', layer: 'contract', exposure: 'contract', article: '제8조', why: '경과가 길수록 낮아진다' },
  { key: 'late_fee_rate', label: '지연손해금율', layer: 'contract', exposure: 'contract', article: '제25조', why: '연체 이자율' },
  { key: 'impound_fee', label: '물품 보관료', layer: 'contract', exposure: 'contract', article: '제22조', why: '안 찾아가면 보증금에서 공제된다' },

  // 돌려주고 보관하는 기한
  { key: 'deposit_return_days', label: '보증금 반환기한(일)', layer: 'contract', exposure: 'contract', article: '제6조', why: '언제까지 돌려주는가' },
  { key: 'impound_keep_days', label: '물품 보관기간(일)', layer: 'contract', exposure: 'contract', article: '제22조', why: '이 기간 뒤 폐기·매각할 수 있다' },

  // 제재 — 손님이 차를 잃거나 계약이 끊기는 조건
  { key: 'engine_control_overdue_days', label: '운행제한(시동제어) 기준일', layer: 'contract', exposure: 'contract', article: '제24조', why: '각 납부기한 다음 날부터 며칠째 미납이면 시동제어할 수 있는가' },
  { key: 'auto_terminate_overdue_days', label: '차량회수·해지 기준일', layer: 'contract', exposure: 'contract', article: '제7조·제24조', why: '며칠 밀리면 계약이 끊기고 차를 회수하는가' },
  { key: 'deposit_overdue_rounds', label: '보증금 미납 시동제어(회차)', layer: 'contract', exposure: 'contract', article: '제6조·제24조', why: '대상 회차를 정하고 실제 연체는 해당 회차 납부기한 다음 날부터 센다' },
  { key: 'accident_termination_count', label: '사고 다발 시 계약해지 기준', layer: 'contract', exposure: 'contract', article: '제7조', why: '사고일 기준 직전 1년 내 과실 50% 이상 사고가 총 3회면 해지할 수 있다' },
  { key: 'claim_basis', label: '청구 기준', layer: 'contract', exposure: 'contract', article: '제7조·제8조', why: '잔여 대여료냐 중도해지수수료냐 — 중복 청구하지 않는다' },

  // 만기 — 실권이 걸린 기한
  { key: 'renewal_notice_days', label: '연장 사전통지기한(일)', layer: 'contract', exposure: 'contract', article: '제10조', why: '넘기면 연장하지 않는 것으로 본다' },
  { key: 'buyout_notice_days', label: '인수 사전통지기한(일)', layer: 'contract', exposure: 'contract', article: '제26조', why: '넘기면 인수하지 않는 것으로 본다' },

  // 계약서에 실명이 박히는 것
  // 보험사 «대표번호»는 정책값이 아니다 - 매년 바뀌므로 저장해 두면 낡은 번호가 계약서에 박힌다.
  // 기존 JPK 계약서도 「※ 보험사는 변경될 수 있습니다」로 못박아 두었다.
  // 계약서에는 체결일 기준 보험사명만 싣고, 사고 신고는 회사 대표번호로 받는다(2026-08-10).
  { key: 'insurer_name', label: '가입 보험사·공제조합(계약 체결일 기준)', layer: 'contract', exposure: 'contract', article: '제11조', why: '현재 가입처·사고 접수처' },
  { key: 'designated_garage', label: '지정 정비점', layer: 'contract', exposure: 'contract', article: '제14조·제17조', why: '임의 수리 시 보험 처리 불가' },
  { key: 'self_damage_exclusions', label: '자차 처리 제외', layer: 'contract', exposure: 'contract', article: '제18조', why: '가입 공제·보험 상품별로 상이하다' },
  { key: 'replacement_car_policy', label: '대차 정책', layer: 'contract', exposure: 'contract', article: '제5조·제20조', why: '미가입 시 미제공 등' },
  { key: 'gps_installed', label: 'GPS 장착', layer: 'contract', exposure: 'contract', article: '제24조', why: '위치 수집 고지' },
];

export const ALL_POLICY_FIELDS = [...PRODUCT_LAYER, ...SALES_LAYER, ...CONTRACT_LAYER];

export type PolicyReadinessStatus = '판매조건 부족' | '계약조건 부족' | '완료';

/** 판매 시트와 상품 선택에 필요한 최소 정책. 내부 심사·계약 약관은 포함하지 않는다. */
export const SALES_READY_FIELDS: PolicyField[] = [
  PRODUCT_LAYER.find((field) => field.key === 'annual_mileage')!,
  PRODUCT_LAYER.find((field) => field.key === 'basic_driver_age')!,
  PRODUCT_LAYER.find((field) => field.key === 'license_period')!,
  SALES_LAYER.find((field) => field.key === 'driver_age_lowering')!,
  SALES_LAYER.find((field) => field.key === 'deposit_installment')!,
  SALES_LAYER.find((field) => field.key === 'rental_region')!,
  SALES_LAYER.find((field) => field.key === 'delivery_fee')!,
];

export function policyReadiness(
  policy: Record<string, unknown> | null | undefined,
  partner?: Record<string, unknown> | null,
): {
  status: PolicyReadinessStatus;
  salesMissing: PolicyField[];
  contractMissing: PolicyField[];
  contractRequired: boolean;
} {
  const record = policy || {};
  const salesRequired = [...SALES_READY_FIELDS];
  const lowering = String(record.driver_age_lowering || '').trim();
  if (lowering && !/불가|없음|미운영/.test(lowering)) {
    const cost = SALES_LAYER.find((field) => field.key === 'age_lowering_cost');
    if (cost) salesRequired.push(cost);
  }
  const salesMissing = salesRequired.filter((field) => !has(record, field.key));
  const contractRequired = contractLayerOf(record, partner) === 'contract';
  const issue = contractRequired ? canIssueContract(record, partner) : null;
  const contractMissing = issue?.missing || [];
  return {
    status: salesMissing.length ? '판매조건 부족' : contractRequired && !issue?.ok ? '계약조건 부족' : '완료',
    salesMissing,
    contractMissing,
    contractRequired,
  };
}

/**
 * 전자계약에 실제로 표시되는 상품·보험 고정값.
 * `CONTRACT_LAYER`만 검사하면 담보가 빈 보험포함 계약도 발행될 수 있으므로 별도 게이트로 둔다.
 * 보장이 없거나 면책금이 없으면 빈칸 대신 반드시 「미가입」·「없음」으로 확정한다.
 */
const ISSUE_BASE_FIELDS: PolicyField[] = [
  ...PRODUCT_LAYER.filter((field) => [
    'annual_mileage', 'basic_driver_age', 'license_period', 'insurance_included',
    'maintenance_service', 'personal_driver_scope', 'business_driver_scope',
  ].includes(field.key)),
  ...SALES_LAYER.filter((field) => field.key === 'payment_method'),
];

const ISSUE_INSURANCE_FIELDS: PolicyField[] = [
  { key: 'injury_compensation_limit', label: '대인 보상한도', layer: 'product', exposure: 'contract', article: '제11조', why: '계약회사별 실제 담보' },
  { key: 'injury_deductible', label: '대인 면책금', layer: 'product', exposure: 'contract', article: '제11조', why: '없으면 「없음」으로 명시' },
  { key: 'property_compensation_limit', label: '대물 보상한도', layer: 'product', exposure: 'contract', article: '제11조', why: '계약회사별 실제 담보' },
  { key: 'property_deductible', label: '대물 면책금', layer: 'product', exposure: 'contract', article: '제11조', why: '없으면 「없음」으로 명시' },
  { key: 'self_body_accident', label: '자손 보상한도', layer: 'product', exposure: 'contract', article: '제11조', why: '미가입이면 「미가입」으로 명시' },
  { key: 'self_body_deductible', label: '자손 면책금', layer: 'product', exposure: 'contract', article: '제11조', why: '없으면 「없음」으로 명시' },
  { key: 'uninsured_damage', label: '무보험 보상한도', layer: 'product', exposure: 'contract', article: '제11조', why: '미가입이면 「미가입」으로 명시' },
  { key: 'uninsured_deductible', label: '무보험 면책금', layer: 'product', exposure: 'contract', article: '제11조', why: '없으면 「없음」으로 명시' },
  { key: 'own_damage_compensation', label: '자차 보상', layer: 'product', exposure: 'contract', article: '제18조', why: '미가입이면 「미가입」으로 명시' },
  { key: 'annual_roadside_assistance', label: '긴급출동', layer: 'product', exposure: 'contract', article: '제14조', why: '미제공이면 「미제공」으로 명시' },
];

const ISSUE_OWN_DAMAGE_FIELDS: PolicyField[] = [
  { key: 'own_damage_repair_ratio', label: '자차 자기부담률', layer: 'product', exposure: 'contract', article: '제18조', why: '자차 가입 시 실제 자기부담률' },
  { key: 'own_damage_min_deductible', label: '자차 최소 면책금', layer: 'product', exposure: 'contract', article: '제18조', why: '자차 가입 시 부담 하한' },
  { key: 'own_damage_max_deductible', label: '자차 최대 면책금', layer: 'product', exposure: 'contract', article: '제18조', why: '자차 가입 시 부담 상한' },
];

const has = (p: Record<string, unknown>, k: string) => {
  const v = p?.[k];
  return v !== undefined && v !== null && String(v).trim() !== '';
};

/**
 * 회사 보험형 완료본에는 체결일 당시 실제 가입처가 찍혀야 한다.
 * 기본 안내문·대시·미정 같은 값은 보험사명이 아니므로 발행 단계에서 막는다.
 */
export function isUsableInsurerName(value: unknown): boolean {
  const name = String(value ?? '').trim();
  if (!name) return false;
  // 공급사 정책 읽기·값 규격에서 이미 "값 없음"으로 취급하는 표현과 같은 기준을 쓴다.
  // 공백·영문 대소문자만 바꿔 발행 게이트를 우회하면 안 된다.
  const normalized = name.replace(/\s+/g, '').toLowerCase();
  return !new Set([
    '-', '—', '?', '없음', '해당없음', '미정', '미입력', '미기재', '미가입',
    '공급사기재', '입력요망', '기재요망', '추후기재', 'n/a', 'na',
    '계약체결일기준가입보험사·공제조합(차량별상이)',
  ]).has(normalized);
}

/**
 * 이 공급사 계약서를 «누가 쓰는가».
 *
 * 화면 라벨은 「계약서 작성 — 공급사가 작성 / 프리패스가 작성」이다.
 * 앞서 「정책 단계(상품·영업·계약)」로 불렀는데 뜻이 안 전해졌다 —
 * 층 이름은 설계 용어이고, 화면에서 정해야 하는 것은 **누가 쓰느냐** 하나다.
 *
 * 값이 없으면 «공급사가 쓴다»로 본다 — 안 정해진 곳에 계약을 태우지 않는다.
 */
export function policyLayerOf(policy: Record<string, unknown> | null | undefined): PolicyLayer {
  const v = String(policy?.contract_authoring ?? policy?.policy_layer ?? '').trim();
  if (v === '프리패스가 작성' || v === 'contract' || v === '계약') return 'contract';
  if (v === 'sales' || v === '영업') return 'sales';
  return 'product';
}

/**
 * 계약서 사용 여부의 신규 SSOT는 파트너사다.
 * 기존 공급사는 파트너 값이 아직 없으므로 정책의 contract_authoring을 읽어 무중단 호환한다.
 */
export function contractLayerOf(
  policy: Record<string, unknown> | null | undefined,
  partner?: Record<string, unknown> | null,
): PolicyLayer {
  const enabled = String(partner?.esign_contract_enabled ?? '').trim();
  if (enabled === '사용' || enabled === 'yes' || enabled === 'true') return 'contract';
  if (enabled === '미사용' || enabled === 'no' || enabled === 'false') return 'product';
  return policyLayerOf(policy);
}

/** 계약작성 회사 선택에 노출할 공급사인가. 파트너 미설정 레거시는 계약 정책으로 복원한다. */
export function partnerUsesFreepassContract(
  partner: Record<string, unknown> | null | undefined,
  policies: Record<string, unknown>[] = [],
): boolean {
  const enabled = String(partner?.esign_contract_enabled ?? '').trim();
  if (enabled === '사용' || enabled === 'yes' || enabled === 'true') return true;
  if (enabled === '미사용' || enabled === 'no' || enabled === 'false') return false;
  return policies.some((policy) => policyLayerOf(policy) === 'contract');
}

/**
 * 전자계약을 발행할 수 있는가.
 * 계약 층이 아니거나 필수 항목이 비면 막는다 — 서명 뒤에는 봉인되어 고치지 못한다.
 */
export function canIssueContract(
  policy: Record<string, unknown> | null | undefined,
  partner?: Record<string, unknown> | null,
): {
  ok: boolean; layer: PolicyLayer; missing: PolicyField[]; reason: string;
} {
  const layer = contractLayerOf(policy, partner);
  if (layer !== 'contract') {
    return { ok: false, layer, missing: [], reason: '파트너사에서 프리패스 전자계약을 사용하지 않도록 설정했습니다.' };
  }
  const p = policy || {};
  const companyInsurance = !/별도|개인/.test(String(p.insurance_included || '').trim());
  const ownDamageCovered = companyInsurance && !/미가입|없음/.test(String(p.own_damage_compensation || '').trim());
  // 자차 처리 제외·지정 정비점은 공통 약관 문구를 쓰지만, 회사 보험형의 가입 보험사명은
  // 체결일 사실이라 기본 안내문으로 대체할 수 없다.
  const NOT_ASKED = new Set(['self_damage_exclusions', 'designated_garage', 'deposit_overdue_rounds']);
  const required = [
    // 개인 직접가입형은 회사의 가입 보험사명이 계약 사실이 아니므로 요구하거나 인쇄하지 않는다.
    ...CONTRACT_LAYER.filter((f) => !NOT_ASKED.has(f.key) && (companyInsurance || f.key !== 'insurer_name')),
    ...ISSUE_BASE_FIELDS,
    ...(companyInsurance ? ISSUE_INSURANCE_FIELDS : []),
    ...(ownDamageCovered ? ISSUE_OWN_DAMAGE_FIELDS : []),
  ];
  const missing = required.filter((f, index) => {
    if (required.findIndex((candidate) => candidate.key === f.key) !== index) return false;
    if (f.key === 'insurer_name') return !isUsableInsurerName(p.insurer_name);
    return !has(p, f.key);
  });
  return {
    ok: missing.length === 0,
    layer,
    missing,
    reason: missing.length ? `계약 정책에 ${missing.length}개 항목이 비어 있습니다.` : '',
  };
}

/** 손님에게 나가면 안 되는 값. 화면·계약서를 만들 때 이걸로 거른다. */
export function isCustomerFacing(key: string): boolean {
  const f = ALL_POLICY_FIELDS.find((x) => x.key === key);
  return !!f && (f.exposure === 'contract' || f.exposure === 'quote');
}

/**
 * 상품상세 「자세히보기」를 **아직 열지 않는다**(2026-08-09 사장님 판단).
 *
 * 계약 조건을 상품 고르는 자리에 미리 펼치는 것은 방향은 맞지만, 지금은 이르다.
 * 정책이 다 채워지지 않은 공급사가 대부분이라, 반쯤 찬 조건이 먼저 나가면
 * **「이 업체는 조건이 부실하다」로 읽힌다.** 채울 시간을 준 뒤 켠다.
 *
 * 켤 때는 이 값만 `true` 로 바꾼다 — 호출부는 손대지 않는다.
 */
export const CONTRACT_TERMS_DETAIL_OPEN = false;

/** 상품상세 계약 조건을 볼 수 있는 사람. 손님에게는 아직 열지 않는다. */
export type DetailViewer = 'agent' | 'provider' | 'admin' | 'customer';
const DETAIL_ALLOWED: DetailViewer[] = ['agent', 'admin'];

/**
 * 상품상세 「자세히보기」에 띄울 계약 조건.
 *
 * 계약 정책을 채운 공급사는 **상품을 고르는 자리에서 이미** 패널티·위약금·해지 조건을
 * 보여줄 수 있다. 계약서를 열어야 알 수 있던 것을 앞당겨 보이는 것이라,
 * 채운 업체가 «더 투명한 상품»이 된다.
 *
 * ⚠ 지금은 **영업자·관리자에게만**, 그리고 `CONTRACT_TERMS_DETAIL_OPEN` 이 켜져야 나간다.
 *   손님에게 먼저 나가면 정책이 덜 찬 공급사가 손해를 본다.
 *   공급사 자신에게도 안 띄운다 — 자기 정책은 정책관리에서 본다.
 *
 * 내부 전용(심사기준·신용등급·수수료 환수)은 어느 경우에도 섞이지 않는다 — `exposure` 로 거른다.
 * 값이 빈 항목은 내보내지 않는다. 「—」로 채우면 «조건이 없다»로 읽힌다.
 */
export function contractTermsForDetail(
  policy: Record<string, unknown> | null | undefined,
  { viewer = 'customer' }: { viewer?: DetailViewer } = {},
): { group: string; label: string; value: string; article?: string; why: string }[] {
  if (!CONTRACT_TERMS_DETAIL_OPEN) return [];
  if (!DETAIL_ALLOWED.includes(viewer)) return [];
  if (policyLayerOf(policy) !== 'contract') return [];
  const p = policy || {};

  const GROUP: Record<string, string> = {
    over_mileage_rate_domestic: '위반 시 부담',
    over_mileage_rate_imported: '위반 시 부담',
    early_termination_rate_under1y: '위반 시 부담',
    early_termination_rate_over1y: '위반 시 부담',
    succession_allowed: '계약 변경',
    succession_fee: '계약 변경',
    late_fee_rate: '위반 시 부담',
    impound_fee: '위반 시 부담',
    deposit_return_days: '반환·보관',
    claim_basis: '미납 제재',
    engine_control_overdue_days: '미납 제재',
    auto_terminate_overdue_days: '미납 제재',
    deposit_overdue_rounds: '미납 제재',
    accident_termination_count: '제재',
    renewal_notice_days: '만기',
    buyout_notice_days: '만기',
    impound_keep_days: '반환·보관',
    insurer_name: '사고·정비',
    designated_garage: '사고·정비',
    self_damage_exclusions: '사고·정비',
    replacement_car_policy: '사고·정비',
    gps_installed: '차량관리',
  };

  const SUFFIX: Record<string, string> = {
    deposit_return_days: '일 이내',
    impound_keep_days: '일',
    engine_control_overdue_days: '일 연체 시 시동제어',
    auto_terminate_overdue_days: '일 연체 시 해지·회수',
    deposit_overdue_rounds: '회차 미납 시 즉시 시동제어',
    renewal_notice_days: '일 전까지',
    buyout_notice_days: '일 전까지',
    accident_termination_count: '회 (1년 내 과실 50% 이상)',
    over_mileage_rate_domestic: '원 / 1km (국산)',
    over_mileage_rate_imported: '원 / 1km (수입)',
    succession_fee: '원',
  };

  // 묶음 순서를 못박는다 — 정의 순서대로 두면 같은 묶음이 화면에서 두 번 갈라진다.
  const ORDER = ['위반 시 부담', '계약 변경', '미납 제재', '제재', '만기', '반환·보관', '사고·정비', '차량관리', '기타'];

  return CONTRACT_LAYER
    .filter((f) => f.exposure === 'contract' && has(p, f.key))
    .map((f) => ({
      group: GROUP[f.key] || '기타',
      label: f.label,
      value: `${String(p[f.key]).trim()}${SUFFIX[f.key] ? SUFFIX[f.key] : ''}`,
      article: f.article,
      why: f.why,
    }))
    .sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group));
}

/**
 * 영업사원이 상담에서 쓰는 «가격표» — 무엇을 결정하는지와 함께.
 * 손님에게 그대로 보여주는 것이 아니다(`exposure` 가 `sales`·`internal` 인 것이 섞여 있다).
 */
export function salesLevers(policy: Record<string, unknown> | null | undefined): {
  label: string; value: string; decides: string; internal: boolean;
}[] {
  const p = policy || {};
  return SALES_LAYER
    .filter((f) => f.decides && has(p, f.key))
    .map((f) => ({
      label: f.label,
      value: String(p[f.key]).trim(),
      decides: f.decides as string,
      internal: f.exposure === 'internal',
    }));
}
