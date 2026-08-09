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
  { key: 'annual_mileage', label: '약정 주행거리', layer: 'product', exposure: 'contract', article: '제15조', why: '기본 약정. 상향은 영업 층의 가격표로 정한다' },
  { key: 'basic_driver_age', label: '기본 운전자 연령', layer: 'product', exposure: 'contract', article: '제5조', why: '기본 자격. 하향은 영업 층의 가격표로 정한다. 면책금 산정 기준이기도 하다' },
  { key: 'license_period', label: '면허 경력요건', layer: 'product', exposure: 'contract', article: '제5조', why: '자격 요건' },
  { key: 'insurance_included', label: '보험 포함 여부', layer: 'product', exposure: 'contract', article: '제9조', why: '회사 가입형이냐 개인보험형이냐 — 약관 제9조의2 적용이 갈린다' },
  { key: 'maintenance_service', label: '정비 상품', layer: 'product', exposure: 'contract', article: '제7조', why: '정비 범위' },
  { key: 'personal_driver_scope', label: '운전자 범위(개인)', layer: 'product', exposure: 'contract', article: '제5조', why: '범위 밖 운전 사고는 보험 전액 제외' },
  { key: 'business_driver_scope', label: '운전자 범위(사업자)', layer: 'product', exposure: 'contract', article: '제5조', why: '위와 같음' },
  { key: 'injury_compensation_limit', label: '대인배상', layer: 'product', exposure: 'contract', article: '제9조', why: '담보 한도' },
  { key: 'property_compensation_limit', label: '대물배상', layer: 'product', exposure: 'contract', article: '제9조', why: '담보 한도' },
  { key: 'self_body_accident', label: '자기신체사고', layer: 'product', exposure: 'contract', article: '제9조', why: '담보 한도' },
  { key: 'uninsured_damage', label: '무보험차상해', layer: 'product', exposure: 'contract', article: '제9조', why: '담보 한도' },
  { key: 'own_damage_compensation', label: '자차 보상', layer: 'product', exposure: 'contract', article: '제9조', why: '담보 한도' },
  { key: 'own_damage_repair_ratio', label: '자차 자기부담률', layer: 'product', exposure: 'contract', article: '제9조', why: '손님 부담분' },
  { key: 'annual_roadside_assistance', label: '긴급출동', layer: 'product', exposure: 'contract', article: '제7조', why: '연간 횟수' },
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
  { key: 'additional_driver_allowance_count', label: '추가운전자 허용 수', layer: 'sales', exposure: 'contract', article: '제5조', decides: '등록 가능 인원', why: '몇 명까지 등록 가능한가 — 이건 계약 내내 적용되므로 계약서에도 실린다' },

  // ③ 납부 방식을 결정하는 것
  { key: 'deposit_installment', label: '보증금 분납 가능 회차', layer: 'sales', exposure: 'sales', decides: '보증금 납부 방식', why: '선택지. 계약서에는 «3회 분납»처럼 굳은 값만' },
  { key: 'deposit_card_payment', label: '보증카드', layer: 'sales', exposure: 'sales', decides: '보증금 납부 방식', why: '결제 수단' },
  { key: 'payment_method', label: '결제방식', layer: 'sales', exposure: 'contract', article: '제3조', decides: '대여료 납부 방식', why: 'CMS·카드 등' },

  // ④ 승인 여부를 결정하는 것 — 손님에게 절대 안 나간다
  { key: 'screening_criteria', label: '심사기준', layer: 'sales', exposure: 'internal', decides: '계약 승인 여부', why: '⚠ 내부 심사 기준. 손님 화면·계약서에 절대 실리지 않는다 — 우리가 그 사람을 어떻게 평가했는지다' },
  { key: 'credit_grade', label: '신용등급', layer: 'sales', exposure: 'internal', decides: '계약 승인 여부', why: '⚠ 위와 같음' },

  // ⑤ 상담 안내 — 결정도 적용도 아닌 것
  { key: 'rental_region', label: '대여지역', layer: 'sales', exposure: 'sales', why: '상품 안내. 이 계약의 조건이 아니라 계약서에 싣지 않는다' },
  { key: 'commission_clawback_condition', label: '수수료 환수조건', layer: 'sales', exposure: 'internal', why: '⚠ 우리와 공급사 사이의 약정. 손님과 무관하다' },
];

/* ── 층 3 · 계약 ───────────────────────────────────────────────
   **전자계약을 우리가 쓰는 공급사만** 채운다.
   목록은 임의로 정한 것이 아니라 «약관이 계약서를 참조하는 자리»다 —
   비면 그 조문이 아무것도 정하지 못한다. */
export const CONTRACT_LAYER: PolicyField[] = [
  /* ── 위반 시 무는 돈(패널티) ──
     약정을 지키지 못했을 때 «더 내는» 것들이다. 상품을 고를 때 정하는 가격이 아니라
     계약을 어겼을 때 붙는 것이므로, 영업 층 가격표와 섞으면 안 된다. */
  { key: 'over_mileage_rate_per_km', label: '초과 주행요금(1km당)', layer: 'contract', exposure: 'contract', article: '제15조', why: '약정을 넘겨 달린 거리에 붙는다. 1만km 상향(가격표)과 다른 값' },
  { key: 'penalty_condition', label: '중도해지 위약금', layer: 'contract', exposure: 'contract', article: '제14조', why: '중간에 끊을 때 무는 돈' },
  { key: 'late_fee_rate', label: '지연손해금율', layer: 'contract', exposure: 'contract', article: '제3조', why: '연체 이자율' },
  { key: 'impound_fee', label: '물품 보관료', layer: 'contract', exposure: 'contract', article: '제13조', why: '안 찾아가면 보증금에서 공제된다' },

  // 돌려주고 보관하는 기한
  { key: 'deposit_return_days', label: '보증금 반환기한(일)', layer: 'contract', exposure: 'contract', article: '제4조', why: '언제까지 돌려주는가' },
  { key: 'impound_keep_days', label: '물품 보관기간(일)', layer: 'contract', exposure: 'contract', article: '제13조', why: '이 기간 뒤 폐기·매각할 수 있다' },

  // 제재 — 손님이 차를 잃거나 계약이 끊기는 조건
  { key: 'engine_control_overdue_days', label: '운행제한(시동제어) 기준일', layer: 'contract', exposure: 'contract', article: '제11조①', why: '대여료 청구일로부터 며칠 밀리면 시동이 잠기는가' },
  { key: 'auto_terminate_overdue_days', label: '차량회수·해지 기준일', layer: 'contract', exposure: 'contract', article: '제11조②', why: '며칠 밀리면 계약이 끊기고 차를 회수하는가' },
  { key: 'deposit_overdue_rounds', label: '보증금 미납 시동제어(회차)', layer: 'contract', exposure: 'contract', article: '제4조·제11조②', why: '보증금 분납은 날짜가 아니라 회차로 센다 — 대여료 연체와 갈래가 다르다' },
  { key: 'accident_termination_count', label: '1년 이내 사고 누적(N회)', layer: 'contract', exposure: 'contract', article: '제11조', why: '과실 50% 이상 몇 회면 해지되는가' },
  { key: 'claim_basis', label: '청구 기준', layer: 'contract', exposure: 'contract', article: '제11조·제14조', why: '잔여 대여료냐 중도해지수수료냐 — 중복 청구하지 않는다' },

  // 만기 — 실권이 걸린 기한
  { key: 'renewal_notice_days', label: '연장 사전통지기한(일)', layer: 'contract', exposure: 'contract', article: '제2조', why: '넘기면 연장하지 않는 것으로 본다' },
  { key: 'buyout_notice_days', label: '인수 사전통지기한(일)', layer: 'contract', exposure: 'contract', article: '제17조', why: '넘기면 인수하지 않는 것으로 본다' },

  // 계약서에 실명이 박히는 것
  { key: 'insurer_name', label: '보험사', layer: 'contract', exposure: 'contract', article: '제9조', why: '사고 접수처' },
  { key: 'insurer_phone', label: '보험사 연락처', layer: 'contract', exposure: 'contract', article: '제9조', why: '사고 접수처' },
  { key: 'designated_garage', label: '지정 정비점', layer: 'contract', exposure: 'contract', article: '제7조·제9조', why: '임의 수리 시 보험 처리 불가' },
  { key: 'self_damage_exclusions', label: '자차 처리 제외', layer: 'contract', exposure: 'contract', article: '제9조', why: '가입 공제·보험 상품별로 상이하다' },
  { key: 'replacement_car_policy', label: '대차 정책', layer: 'contract', exposure: 'contract', article: '제7조', why: '미가입 시 미제공 등' },
  { key: 'gps_installed', label: 'GPS 장착', layer: 'contract', exposure: 'contract', article: '제10조', why: '위치 수집 고지' },
];

export const ALL_POLICY_FIELDS = [...PRODUCT_LAYER, ...SALES_LAYER, ...CONTRACT_LAYER];

const has = (p: Record<string, unknown>, k: string) => {
  const v = p?.[k];
  return v !== undefined && v !== null && String(v).trim() !== '';
};

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
 * 전자계약을 발행할 수 있는가.
 * 계약 층이 아니거나 필수 항목이 비면 막는다 — 서명 뒤에는 봉인되어 고치지 못한다.
 */
export function canIssueContract(policy: Record<string, unknown> | null | undefined): {
  ok: boolean; layer: PolicyLayer; missing: PolicyField[]; reason: string;
} {
  const layer = policyLayerOf(policy);
  if (layer !== 'contract') {
    return { ok: false, layer, missing: [], reason: '이 공급사는 상품만 공급합니다 — 계약서는 공급사가 직접 작성합니다.' };
  }
  const missing = CONTRACT_LAYER.filter((f) => !has(policy || {}, f.key));
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
    over_mileage_rate_per_km: '위반 시 부담',
    penalty_condition: '위반 시 부담',
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
    insurer_phone: '사고·정비',
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
    over_mileage_rate_per_km: '원 / 1km',
  };

  // 묶음 순서를 못박는다 — 정의 순서대로 두면 같은 묶음이 화면에서 두 번 갈라진다.
  const ORDER = ['위반 시 부담', '미납 제재', '제재', '만기', '반환·보관', '사고·정비', '차량관리', '기타'];

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
