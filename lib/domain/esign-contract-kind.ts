/**
 * 프리패스 표준계약서의 **인수/반납 결과 축**.
 *
 * 사장님 지정(2026-08-10): 표준계약서는 렌트 1벌 + 구독 보험포함 1벌 + 구독 보험별도 1벌 = 3벌이다.
 * 이 파일의 4개 spec은 문서 4벌이 아니라, 각 문서에서 선택한 인수/반납을 기존 필드 영역으로 펼친 결과다.
 *
 * ★왜 축으로 두나
 *   서식 3벌은 `esign-templates.ts`가 소유하고, 이 파일은 서식 안의 선택 결과만 소유한다.
 *   실제로 결과에 따라 다른 건 아래 4가지뿐이다 —
 *   문서명·당사자 호칭 / 만기 처리 / 중도해지 요율 / 보험 주체.
 *
 * ★근거
 *   `계약서양식/01. JPK_개인(개인사업자) 계약서.xlsx` 「자동차 렌탈(대여) 계약서」
 *   `계약서양식/손오공 구독 약정서(수정).xlsx` 「구독약정서」
 *   확인된 값에는 `확인됨`, 아직 모르는 값에는 `미확정` 을 달아 둔다 — 지어내지 않는다.
 */

/** 구독이냐 렌탈이냐 — 문서명·당사자 호칭이 갈린다. */
export type ContractKind = '구독' | '렌탈';
/** 만기에 차를 가져가느냐 돌려주느냐. 반납형도 **인수를 선택**할 수 있다. */
export type MaturityKind = '인수형' | '반납형';
/** 보험을 누가 드느냐. 구독에서만 갈린다(렌탈은 회사가 든다). */
export type InsuranceSide = '회사포함' | '고객직접';

export type ContractKindSpec = {
  key: string;
  label: string;
  kind: ContractKind;
  maturity: MaturityKind;
  /** 문서 제목 — 계약서 맨 위에 인쇄되는 말. */
  title: string;
  /** 당사자 호칭 — 구독은 회사/계약자, 렌탈은 임대인/임차인. */
  party: { provider: string; customer: string };
  /** 만기 처리 설명 — 손님이 읽는 문장. */
  maturityNote: string;
  /** 인수가격을 반드시 적어야 하는가. 반납형은 «인수 선택 시»에만 필요하다. */
  buyoutPriceRequired: boolean;
  /** 이 유형에서 고를 수 있는 보험 주체. 렌탈은 회사포함 하나뿐. */
  insuranceSides: InsuranceSide[];
};

/**
 * 중도해지 위약금 요율 — `잔여기간 대여료 총합 × 요율`.
 * 손오공 실측: 반납형 1년미만 30%·1년이상 20% / 인수형 1년미만 30%·1년이상 10%.
 * JPK 렌탈 실측: 1년미만 30%·1년이상 20%(반납형과 같다).
 */
export type PenaltyRate = { underOneYear: number; overOneYear: number; source: '확인됨' | '미확정' };

export const PENALTY_RATES: Record<MaturityKind, PenaltyRate> = {
  // 인수형은 만기에 차가 손님 것이 되므로 회사 손실이 작다 → 1년 이상 요율이 낮다.
  인수형: { underOneYear: 0.30, overOneYear: 0.10, source: '확인됨' },
  반납형: { underOneYear: 0.30, overOneYear: 0.20, source: '확인됨' },
};

/** 지연손해금 — 「지급명령 송달일까지 / 그 다음 날부터」 2단. 회사마다 다르다. */
export type LateInterest = { beforeService: number; afterService: number; source: '확인됨' | '미확정' };
export const LATE_INTEREST_DEFAULT: LateInterest = { beforeService: 0.05, afterService: 0.12, source: '확인됨' };

export const CONTRACT_KINDS: ContractKindSpec[] = [
  {
    key: 'sub_buyout',
    label: '구독 인수형',
    kind: '구독',
    maturity: '인수형',
    title: '자동차 구독 계약서',
    party: { provider: '회사', customer: '계약자' },
    maturityNote: '계약 만기에 약정한 인수가격으로 차량을 인수합니다.',
    buyoutPriceRequired: true,
    insuranceSides: ['회사포함', '고객직접'],
  },
  {
    key: 'sub_return',
    label: '구독 반납형(인수선택)',
    kind: '구독',
    maturity: '반납형',
    title: '자동차 구독 계약서',
    party: { provider: '회사', customer: '계약자' },
    maturityNote: '계약 만기에 차량을 반납합니다. 원하시면 인수도 선택할 수 있습니다.',
    buyoutPriceRequired: false,
    insuranceSides: ['회사포함', '고객직접'],
  },
  {
    key: 'rent_buyout',
    label: '렌탈 인수형',
    kind: '렌탈',
    maturity: '인수형',
    title: '자동차 렌탈(대여) 계약서',
    party: { provider: '임대인', customer: '임차인(계약자)' },
    maturityNote: '계약 만기에 약정한 인수가격으로 차량을 인수합니다.',
    buyoutPriceRequired: true,
    // 렌탈은 회사가 영업용 보험을 든다(JPK 계약서 §3 「회사는 대여 차량의 소유주로서 … 영업용 자동차 보험」).
    insuranceSides: ['회사포함'],
  },
  {
    key: 'rent_return',
    label: '렌탈 반납형(인수선택)',
    kind: '렌탈',
    maturity: '반납형',
    title: '자동차 렌탈(대여) 계약서',
    party: { provider: '임대인', customer: '임차인(계약자)' },
    maturityNote: '계약 만기에 차량을 반납합니다. 자격 충족 시 인수도 선택할 수 있습니다.',
    buyoutPriceRequired: false,
    insuranceSides: ['회사포함'],
  },
];

export function findContractKind(key: string): ContractKindSpec | null {
  return CONTRACT_KINDS.find((k) => k.key === String(key ?? '').trim()) || null;
}

/** 이 유형에서 그 보험 주체를 쓸 수 있는가 — 렌탈에 «고객직접»을 붙이면 계약서가 틀린다. */
export function allowsInsuranceSide(spec: ContractKindSpec, side: InsuranceSide): boolean {
  return spec.insuranceSides.includes(side);
}

/**
 * 보험 묶음을 계약서에 실을지 판정.
 *
 * ★«고객직접»이면 우리 정책의 보험 한도를 **보여주면 안 된다.**
 *   회사가 안 든 보험을 든 것처럼 읽힌다 — 값이 비어서 안 보이는 것보다 위험하다.
 *   손오공 구독이 실제로 이 경우다(「자동차 보험 미가입 상품… 고객이 직접 보험사를 선정하여 가입」).
 */
export function showsInsuranceLimits(side: InsuranceSide): boolean {
  return side === '회사포함';
}

/** 고객직접일 때 보험 칸에 대신 넣을 문구. */
export const CUSTOMER_INSURANCE_NOTE =
  '이 상품은 회사가 자동차보험에 가입하지 않습니다. 고객이 직접 보험사를 선정해 가입하고, '
  + '회사를 질권자로 설정한 뒤 가입증명서를 제출해야 합니다.';

/** 중도해지 위약금 — 잔여 대여료 총합 × 요율. 경과기간으로 요율이 갈린다. */
export function penaltyAmount(
  maturity: MaturityKind,
  remainingRentTotal: number,
  elapsedMonths: number,
): { rate: number; amount: number } {
  const table = PENALTY_RATES[maturity];
  const rate = elapsedMonths < 12 ? table.underOneYear : table.overOneYear;
  const base = Number(remainingRentTotal);
  const amount = Number.isFinite(base) && base > 0 ? Math.round(base * rate) : 0;
  return { rate, amount };
}
