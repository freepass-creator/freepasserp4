// ============================================================
// 손오공 견적기 — 원가/수익 조건 (엑셀 "손오공_견적기_원본.xlsx" 이식)
// 채널: rent(렌트) / sub(구독)   ·   유형: return(반납형) / acquire(인수형)
// 이 값들은 엑셀 H열 상수 + 시트 차이를 그대로 옮긴 것. 관리자가 조정 가능.
// ============================================================

// 공통 금융 조건 (엑셀 F열)
export const FINANCE = {
  interestRate: 0.06,   // 이자율 (F7)
  marginRate: 0.20,     // 수익률 (F8)
  loanRatio: 0.80,      // 대출금 비율 = 1 - 선납20% (H15) — 회사금융 원가구조(엑셀), 고객선납과 별개
  depositRatio: 0.10,   // 기본 보증금 10% (세팅값) — 견적기 기본 시드, 영업자 견적별 조정
  vat: 0.10,            // 부가세
};

// 잔존율 기본 매트릭스 (A/B/C 직군) — 세부모델 잔존율 미등록 시 폴백
// 행: 약정개월(24/36/48/60) → 차량가 대비 잔존 비율
// 기본 그룹: 국산=B군, 수입=C군. ★ 값은 관리자 잔존등급 기준표에서 세팅(여기는 폴백 기본).
export const RESIDUAL_TABLE = {
  24: { A: 0.75, B: 0.70, C: 0.60 },
  36: { A: 0.65, B: 0.60, C: 0.45 },
  48: { A: 0.55, B: 0.50, C: 0.37 },
  60: { A: 0.45, B: 0.40, C: 0.30 },
};

// 차량가 업금액 — 차량가에 따라 차등 (팀장 운용 기준, 2026-06-22 확정).
//   3,000만원 미만 → +100만 / 3,000만~5,000만 → +150만 (취급범위 1천초과~5천이하).
//   ※ 경계: max=29,990,000(2,999만)까지 100만 → 그랜저 등 정확히 3,000만은 150만 band.
//     (markupFor는 price<=max 매칭. 차값은 만원 단위라 2,999만↔3,000만 사이 dead zone 없음)
export const MARKUP_DEFAULT = [
  { max: 29990000, add: 1000000 },   // 3,000만원 미만 → +100만
  { max: 50000000, add: 1500000 },   // 3,000만~5,000만 → +150만 (초과는 마지막 구간 폴백)
];
// 취급 범위 — 1천만원 초과 ~ 5천만원 이하만 견적
export const PRICE_RANGE = { min: 10000000, max: 50000000 };

// ★ 원가모델 (웰릭스 견적기 수준 풀세트, 중고차 기준)
//   총원가 = 취득원가(차량가합계+취득세+등록비+1차탁송) + 운영비(이자+보험+수리+자동차세+정기검사+정비+GPS+영업수당)
//   대여료 = 총원가 × (1+수익률) ÷ 개월 × (1+VAT)   (★ 잔존가 안 뺌)
// ── 세팅값(관리자가 정함) ──
// ★ 손오공 엑셀 견적기 그대로 (검증 완료)
export const SETTING = {
  interestRate: 0.06,     // 금리 6%
  loanRatio: 0.80,        // 대출금 = 차량가 × 80%
  loanTermMonths: 48,     // 이자 = 48개월 총이자 × min(약정,48)/48 (4년 캡)
  marginRate: 0.20,       // 수익률 20%
  bondRate: 0.003,        // 공채 = 구입원가 × 0.3%
  insYear: 800000,        // 자동차보험 (연) — 렌트만 (대인·대물·자손)
  selfRate: 0.012,        // 자차충당율 — 렌트만 (자차수선, 엑셀 H22=1.2%)
  gpsMonthly: 10000,      // GPS (월)
  maintMonthly: 10000,    // 정비비 (월) — 구독/렌트인수 1만, 렌트반납 5천 (채널별 CHANNEL.maintPerMonth)
  ewPerYear: 80000,       // EW 연장보증 (연) — 렌트 반납만
  salesFeeCap: 2200000,   // 영업수당 상한 220만 (엑셀 MIN(...,2.2M))
  parkingMonthly: 35000,  // 주차장+관리 (월)
  salesFeeRate: 0.04,     // 영업수당율 (차량가 × 4%, 1회)
  // 인수형 차량잔가율 — 엑셀 렌트_인수형/구독_인수형 H16 (D16 = D14 × 0.1).
  // ⚠ 보증금과 무관하다. 인수형 원가소계에도 들어가지 않고, 견적서 "만기 인수가" 표기에만 쓰인다.
  acquireResidualRate: 0.10,
  // 등록비 = 번호판·인지·등록대행 (공채는 bondRate 별도, 중복 아님). 엔진 연결됨 —
  //   기본 0 = 손오공 엑셀 정합(회귀). 프리패스 운영값은 settings.js DEFAULT_CONFIG.setting.regFee.
  regFee: 0,
  // 미사용 슬롯 — 탁송·정기검사·기타초기비는 간접비로 보아 직접비 원가에 넣지 않는다 (2026-09-05 대표).
  etcInitRate: 0, deliveryFee: 0, inspectionFee: 0,
};
// 하위호환 별칭 (구 코드 참조)
export const EXCEL_COST = { etcInitRate: 0, insYear: SETTING.insYear, selfRate: 0, cartaxSub: 0, cartaxRent: 0, yearInterest: 0 };

// 세금·정책 기본값 (엑셀 하드코딩 → 관리자 노출)
export const POLICY = {
  acqTaxRate: { rent: 0.04, sub: 0.07 },              // 취득세율 (영업용 4% / 비영업용 7%)
  bondRate: 0.003,                                    // 공채 (구입원가 × 0.3% = 3%×10%)
  ewPerYear: 80000,                                   // EW (렌트 반납형만, 원/년)
  // 자동차세 cc단가 (원/cc·년) — 경계 cc는 고정, 단가만 노출
  cartaxRate: { rent: [18, 19, 24], sub: [104, 182, 260] },
};

// 채널별 조건
export const CHANNEL = {
  rent: {
    label: '렌트',
    extraVehicleCost: 1500000,    // 차량가합계 가산 (엑셀 신버전 +150만)
    acqTaxRate: 0.04,             // 취득세율 — 영업용 4% (H19)
    // 자동차세: 영업용 — 엑셀 IF(cc<=1600,18, IF(cc<2500,19, 24))
    cartaxBrackets: [
      { maxCc: 1600, perCc: 18 },
      { maxCc: 2499, perCc: 19 },
      { maxCc: Infinity, perCc: 24 },
    ],
    // 비용 항목 토글 (렌트는 보험·자차 포함)
    items: {
      insurance: true,   // 보험료 80만/년 (H21)
      selfIns: true,     // 자차 price*1.2%/년 (H22)
      gps: true, maint: true, etcMgmt: true, salesFee: true,
      productization: true,
    },
    insurancePerYear: 800000,     // 보험료/년 (H21)
    selfInsRate: 0.012,           // 자차 비율/년 (H22)
    // 정비비/월 — 반납 5,000 / 인수 10,000 (엑셀 시트별 차이)
    maintPerMonth: { return: 5000, acquire: 10000 },
    // EW/년 — 반납형만 (인수형은 EW 없음)
    ewPerYear: { return: 80000, acquire: 0 },
  },
  sub: {
    label: '구독',
    extraVehicleCost: 1500000,    // 차량가합계 가산 (엑셀 신버전 +150만)
    acqTaxRate: 0.07,             // 취득세율 — 비영업용 7% (H19)
    // 자동차세: 비영업용 — 엑셀 IF(cc<=1000,104, IF(cc<1600,182, 260))
    cartaxBrackets: [
      { maxCc: 1000, perCc: 104 },
      { maxCc: 1599, perCc: 182 },
      { maxCc: Infinity, perCc: 260 },
    ],
    // 구독은 보험·자차·EW 제외
    items: {
      insurance: false, selfIns: false,
      gps: true, maint: true, etcMgmt: true, salesFee: true,
      productization: false,
    },
    maintPerMonth: { return: 10000, acquire: 10000 }, // 정비비/월 (구독 H23=10,000)
    ewPerYear: { return: 0, acquire: 0 },
  },
};

// 채널 공통 고정비 (월/년 단가)
export const FIXED = {
  gpsPerMonth: 10000,     // GPS 월 1만 (H24/H22)
  etcMgmtPerMonth: 35000, // 기타관리/주차관리 월 3.5만 (H26/H24)
  salesFeeRate: 0.04,     // 영업수당 차량가의 4% (H27/H25)
  salesFeeCap: 2200000,   // 영업수당 상한 220만
  productizationCost: 300000, // 상품화(중고 30만) — 기본 0, 옵션
};

// 연료 — 표시용. 세금은 연료로 갈리지 않는다.
//
// ⚠ 2026-08-06: 손오공 엑셀과 완전히 동일하게 맞추기로 하여 **연료별 특례를 전부 껐다.**
//   엑셀에는 EV 규칙이 아예 없고 자동차세를 배기량 단가로만 계산한다
//   (구독 IF(cc<=1000,104,IF(cc<1600,182,260)) · 렌트 IF(cc<=1600,18,IF(cc<2500,19,24))).
//   따라서 EV 도 배기량으로 계산된다 — 배기량 0 을 입력하면 자동차세도 0 이 된다.
//   실제 지방세법과는 다르다(전기차는 비영업용 13만·영업용 2만대). 엑셀 정합을 우선한 결정.
//
// taxYearFlat: 자동차세 정액(연). null = cc 기반 일반 과세.
// quoteCc: 견적 산출용 배기량 고정값. 전기차는 배기량이 없어 이 값으로 계산한다.
//   ★ 2026-08-06 손오공 강팀장 회신 — "전기차는 배기량을 1,000cc로 견적산출".
//   엔진이 강제하므로 영업자가 무엇을 입력해도 EV 는 1,000cc 로 계산된다(입력 실수 방지).
// acqTaxCredit / bondExempt: **현재 엔진이 읽지 않는다.** 선언만 두면 "적용되는 줄" 오해하므로 0/false 로 통일.
export const FUEL = {
  gasoline: { label: '가솔린', taxYearFlat: null, quoteCc: null, acqTaxCredit: 0, bondExempt: false },
  diesel:   { label: '디젤',   taxYearFlat: null, quoteCc: null, acqTaxCredit: 0, bondExempt: false },
  lpg:      { label: 'LPG',    taxYearFlat: null, quoteCc: null, acqTaxCredit: 0, bondExempt: false },
  hybrid:   { label: '하이브리드', taxYearFlat: null, quoteCc: null, acqTaxCredit: 0, bondExempt: false },
  ev:       { label: '전기',   taxYearFlat: null, quoteCc: 1000, acqTaxCredit: 0, bondExempt: false },
};

// ============================================================
// 차량 상태 보정 — ERP 동적 평가 (같은 차종도 주행·연식·사고로 차등)
// 관리자가 /sonogong/config 에서 가중치 조정 (ADJUST 가 기본값)
// ============================================================
export const ADJUST = {
  baselineAge: 5,        // 기준 차령 5년. 연 2만km와 함께 5년·10만km를 표준으로 사용
  kmPerYear: 20000,      // 연식 대비 기대 주행거리 (연 2만km)
  mileagePer10k: 0.005,  // 기대 초과 주행 1만km당 잔존율 -0.5%p
  agePerYear: 0.02,      // 기준연식 대비 1년당 잔존율 ±2%p (신형 메리트 / 노후 차감, 연식 비례)
  // 사고이력 보정계수 (잔존율 ×)
  accident: { none: 1.00, simple: 0.97, frame: 0.90, total: 0.70 },
  maxResidualCut: 0.20,  // 보정 상한 (±20%p) — 과도 방지
};

// 초기비용 금융인정 — 보증금·선납 구분 없이, 회사로 먼저 들어온 자금(초기비용)을
// 회사가 굴려 얻는 금융이익을 고객에게 얼마나 인정(환원)해줄지의 단일 연율.
//   월 차감 = (보증금 + 선납) × creditRate / 12   (기준 0 — 들어온 전액 인정)
// (엑셀엔 없는 보정. 엑셀 원가는 그대로, 최종 월납입금에서만 차감 → "초기비용 내면 손해" 방지)
export const BENEFIT = {
  creditRate: 0,   // 초기비용 금융인정율 — 엑셀엔 없음(0). 선납은 D33으로 월납에서 직접 차감되므로
                   // 별도 환원 없이 0 = 손오공 엑셀과 일치. (관리자가 >0 주면 추가 환원 가능)
};

// 하위호환 별칭 (기존 참조)
export const AGE = { penaltyPerYear: ADJUST.agePerYear };
export const ACCIDENT_FACTOR = ADJUST.accident;
export const MILEAGE = { kmPerYear: ADJUST.kmPerYear, penaltyPer10k: ADJUST.mileagePer10k };
