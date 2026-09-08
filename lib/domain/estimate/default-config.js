// ★견적 원가 기본값 — `C:\dev\sonogong-estimator/src/firebase/settings.js` 의 DEFAULT_CONFIG 를
//   **firebase 없이** 옮긴 것이다. 원본은 RTDB 를 물고 있어 그대로는 못 가져온다(설계서 §11 순서 3).
//   ⚠ 값은 한 글자도 안 바꿨다. 뺀 것은 «공지(notice)» 블록뿐 — 그건 화면 기능이라 견적 계산과 무관하다.
//   ⚠ 관리자 「원가」 탭이 붙기 전까지는 이 값이 그대로 쓰인다.
//     marginRate 10% 는 설계서 §2·§10 — 「위험한 쪽이 기본값이면 안 된다」로 1% 폴백을 걷어낸 값이다.
import { FINANCE, ADJUST, BENEFIT, RESIDUAL_TABLE, PRICE_RANGE, POLICY, SETTING } from './data/cost-config.js';

export const DEFAULT_CONFIG = {
  interestRate: { rent: 0.065, sub: 0.065 }, // 프리패스 조달금리 6.5% (설계서 §2)
  marginRate: { rent: 0.10, sub: 0.10 },     // 프리패스 수익률 10% 공통 (설계서 §2·§10 — 1% 위험 폴백 제거)
  loanRatio: SETTING.loanRatio,              // 대출비율 80% (H15=0.2)
  depositRatio: FINANCE.depositRatio,        // 보증금율 10% (F3) — 비율식일 때만 씀
  // 보증금 산정 — 월납 배수 (2년 ×2 / 3년 ×3 / 4·5년은 3년값). 렌트도 구독과 동일하게 통일.
  depositMode: { rent: 'payMultiple', sub: 'payMultiple' },
  acquireResidualRate: SETTING.acquireResidualRate, // 인수형 잔가 = 구입원가 × 10% (H16)
  adjust: ADJUST,                       // 차량 상태 보정 (주행·연식·사고)
  benefit: BENEFIT,                     // 선납·보증금 금융인정
  residualTable: RESIDUAL_TABLE,        // 잔존등급 기준표 (만기인수가용)
  gradeCount: 3,
  // 차량가 업금액 — 정률 20% 로 통일 (엑셀 렌트 원값은 정액 150만)
  markup: { rent: { rate: 0.20 }, sub: { rate: 0.20 } },
  priceRange: PRICE_RANGE,              // 취급 범위
  acqTaxRate: { ...POLICY.acqTaxRate }, // 취득세율 (자동/법정)
  cartaxRate: { rent: [...POLICY.cartaxRate.rent], sub: [...POLICY.cartaxRate.sub] }, // 자동차세 cc단가 (법정)
  // ★ 운영비 세팅값 (관리자) — 손오공 엑셀 견적기 기준
  setting: {
    bondRate: SETTING.bondRate,                  // 공채율 (도시철도/지역개발채권 할인손실)
    regFee: 150000,                              // 등록비 = 번호판·인지·등록대행 (공채는 bondRate 별도). 프리패스 추가분, 관리자 조정.
    insYear: SETTING.insYear, selfRate: SETTING.selfRate, // 보험·자차충당(렌트)
    gpsMonthly: SETTING.gpsMonthly, maintMonthly: SETTING.maintMonthly,
    parkingMonthly: SETTING.parkingMonthly,       // 주차장+관리
    // 영업수당율(원가 버퍼) — 5% 로 통일. 엑셀 렌트 원값 0.04.
    //   ⚠ 영업자 실지급(차량가 × 3%, format.js commissionOf)과 다른 값이다. 섞지 말 것.
    salesFeeRate: { rent: 0.05, sub: 0.05 },
  },
};
