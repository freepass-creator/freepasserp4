// 계약 유지율(손바뀜) 기반 신용등급별 위험원가.
//   같은 차라도 저신용은 계약이 자주 깨져 손바뀜 → 매번 상품화·재영업·공실 비용 발생.
//   → 리스크를 "마진"이 아니라 "원가"로 반영한다 (수익률은 업계선으로 고정).
//   위약금(보증금 일부)이 부분 상쇄하나, 평균적으로 보증금을 많이 못 받아 회수도 제한적.
//
//   손바뀜 횟수 ≈ 1/유지율 − 1  (유지율 30% → 약 2.33회, 75% → 0.33회, 97% → ~0)
//   손바뀜 원가 = 횟수 × 회당 순비용(상품화 + 왕복탁송 + 영업수수료 + 휴차공실)
//   ★ 회당 평균 200~250만 (대표 2026-09-05): 상품화50+왕복탁송50=100 + 영업수수료(대여료×48×3%) + 휴차 1개월.

// 신용등급별 계약 유지율 (프리패스 상품 = 저신용 픽업구독 → 평균 30%)
export const RETENTION = {
  고신용: 0.97, 정상: 0.97,      // ~0회 (거의 안 부러짐)
  중신용: 0.75,                  // 손바뀜 0.33회 (대표 2026-09-05 확정 75%)
  저신용: 0.30, 무신용: 0.30,    // 4년에 손바뀜 2.33회 (년 ~1회)
};

// 회당 손바뀜 비용 — 관리자 조정.
//   영업수수료는 프리패스 수수료표 기준 = 총 대여료(48개월) × 3%. 대여료 비례라 동적.
export const TURNOVER = {
  productization: 500000,    // 회당 상품화(재정비·클리닝) 정액 ~50만
  deliveryRoundTrip: 500000, // 왕복 탁송료(회수+재배치) ~50만 — 상품화와 합쳐 회당 ~100만
  feeRateOfRent: 0.03,       // 영업수수료 = 총 대여료(48개월) × 3% (프리패스 수수료표)
  vacancyMonths: 1,          // 휴차 공실 (개월) — 재계약까지 평균 1개월 대여료 손실
};

export const expectedTurnovers = (retention) => Math.max(0, 1 / (retention || 0.30) - 1);

// 신용등급 → 손바뀜 원가 가산액(원).
//   회당 = 상품화 + 왕복탁송 + 영업수수료(총대여료×3%, 매번 재지급) + 휴차(vacancyMonths × 월대여료)
//   monthlyRent(월 대여료)·term 넘기면 대여료 비례로 반영(안 넘기면 영업수수료·휴차 0).
export function turnoverCost(credit, opts = {}) {
  const R = opts.retention ?? RETENTION[credit] ?? 0.30;
  const c = { ...TURNOVER, ...opts };
  const rent = opts.monthlyRent || 0, term = opts.term || 48;
  const salesFee = rent * term * c.feeRateOfRent;   // 손바뀜마다 영업수수료 재지급 (대여료×기간×3%)
  const vacancy = rent * c.vacancyMonths;           // 휴차 공실 손실 (1개월)
  const perTurnover = c.productization + c.deliveryRoundTrip + salesFee + vacancy; // 회당 ~200~250만
  return expectedTurnovers(R) * perTurnover;
}
