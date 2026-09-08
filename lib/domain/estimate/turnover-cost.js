// 계약 유지율(손바뀜) 기반 신용등급별 위험원가.
//   같은 차라도 저신용은 계약이 자주 깨져 손바뀜 → 매번 상품화·재영업·공실 비용 발생.
//   → 리스크를 "마진"이 아니라 "원가"로 반영한다 (수익률은 업계선으로 고정).
//   위약금(보증금 일부)이 부분 상쇄하나, 평균적으로 보증금을 많이 못 받아 회수도 제한적.
//
//   손바뀜 횟수 ≈ 1/유지율 − 1  (유지율 30% → 약 2.33회, 75% → 0.33회, 97% → ~0)
//   손바뀜 원가 = 횟수 × 회당 순비용(상품화 + 왕복탁송 + 영업수수료 + 휴차공실 − 위약금)
//   ★위약금으로는 회당 비용의 «일부»만 막힌다 — 저신용 4년 아반떼 실측(2026-09-06):
//     회당 253만인데 두 달 치 보증금 125만을 «다 떼도» 50%, 회수율 10%면 5%다.
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
  // 회당 «받는» 돈 — 중도해지 위약금 = **월납 × 보증금 개월 수 × 회수율**.
  //   ★보증금은 정액이 아니라 «월납 몇 달 치»다(사장님 2026-09-06 「보통 요즘에 저신용 보증금은
  //     한 두 달 치를 받거든?」). 정액으로 두면 비싼 차에서 보증금이 실제보다 작아진다.
  //   ★회수율이 신용을 탄다 — 「사실상 위약금이 발생돼도 **저신용은 거의 못 받거든**」.
  //     보증금은 미납 대여료·수리비 상계로 먼저 빠지고, 남는 것만 위약금이 된다.
  //   ⚠ 회당 순비용은 0 밑으로 안 내려간다 — 위약금이 비용보다 크다고 원가가 «음수»가 되지는 않는다.
  //   ⚠ 여기 rent 는 공급가(VAT 제외)다. 실무 보증금은 VAT 포함 월납 기준이라 약 10% 작게 잡힌다 —
  //     보수적인 쪽이므로 그대로 둔다.
  depositMonths: 0,        // 보증금 = 월납 × 이 값 (0 = 상쇄 없음)
  penaltyRecoveryRate: 0,  // 그중 실제로 위약금으로 떼는 비율 (0~1)
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
  const gross = c.productization + c.deliveryRoundTrip + salesFee + vacancy;      // 회당 ~200~250만
  const penalty = rent * (c.depositMonths || 0) * (c.penaltyRecoveryRate || 0);   // 보증금에서 떼는 몫
  const perTurnover = Math.max(0, gross - penalty);                               // 그만큼 상쇄
  return expectedTurnovers(R) * perTurnover;
}
