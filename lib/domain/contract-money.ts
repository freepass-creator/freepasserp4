/** 계약·정산에 사용할 월대여료는 누락되거나 0원일 수 없다. */
export function requirePositiveRentAmount(raw: unknown, context: string): number {
  const amount = typeof raw === 'string'
    ? Number(raw.replace(/[^0-9.-]/g, ''))
    : Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${context}: 월대여료가 없거나 0원입니다. 상품 가격을 먼저 등록해 주세요.`);
  }
  return amount;
}
