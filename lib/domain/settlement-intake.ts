/**
 * 정산 접수에서 화면·API가 같이 지켜야 하는 작은 불변식.
 *
 * 금액 계산은 정산 엔진의 일이고, 여기는 입력을 같은 뜻으로 정규화한다.
 * 순수 함수만 두어 Firestore나 화면 없이 회귀검사할 수 있게 한다.
 */

const S = (v: unknown) => String(v ?? '').trim();
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const YM = /^(\d{4})-(\d{2})$/;

/** `24_2만`, `24개월`, `24`를 모두 계약기간 24개월로 읽는다. */
export function intakeTermMonths(value: unknown): number {
  const m = /^(\d{1,3})(?:\D|$)/.exec(S(value));
  const n = m ? Number(m[1]) : 0;
  return Number.isInteger(n) && n >= 1 && n <= 120 ? n : 0;
}

/** 실제 달만 허용한다. `2026-99`처럼 모양만 맞는 값은 막는다. */
export function isValidBillingMonth(value: unknown): boolean {
  const m = YM.exec(S(value));
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
}

/** 윤년까지 포함해 실제 날짜인지 확인한다. */
export function isValidSettlementDay(value: unknown): boolean {
  const m = DAY.exec(S(value));
  if (!m) return false;
  const [year, month, day] = m.slice(1).map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function localSettlementDay(now = new Date()): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
}

export function billingMonthFromDay(day: unknown): string {
  return isValidSettlementDay(day) ? S(day).slice(0, 7) : '';
}

/**
 * 인도완료는 인도일·청구월과 한 덩어리다.
 * 켜면 빈 값을 오늘로 채우고, 끄면 접수 목록으로 돌아오도록 셋을 함께 비운다.
 */
export function deliveryTransitionPatch(
  on: boolean,
  current: { deliveredAt?: unknown; billMonth?: unknown } = {},
  today = localSettlementDay(),
): { delivered: boolean; deliveredAt: string; billMonth: string } {
  if (!on) return { delivered: false, deliveredAt: '', billMonth: '' };
  const deliveredAt = isValidSettlementDay(current.deliveredAt) ? S(current.deliveredAt) : today;
  const billMonth = isValidBillingMonth(current.billMonth)
    ? S(current.billMonth)
    : billingMonthFromDay(deliveredAt);
  return { delivered: true, deliveredAt, billMonth };
}

/** 세 필드 중 하나만 고쳐도 저장 직전의 전체 인도 상태를 다시 맞춘다. */
export function withDeliveryInvariant(
  patch: Record<string, unknown>,
  current: Record<string, unknown> = {},
  today = localSettlementDay(),
): Record<string, unknown> {
  const keys = ['delivered', 'deliveredAt', 'billMonth'];
  if (!keys.some((key) => Object.prototype.hasOwnProperty.call(patch, key))) return { ...patch };
  const merged = { ...current, ...patch };
  const deliveredWasSpecified = Object.prototype.hasOwnProperty.call(patch, 'delivered');
  const delivered = deliveredWasSpecified
    ? patch.delivered === true
    : current.delivered === true;
  return {
    ...patch,
    ...deliveryTransitionPatch(delivered, merged, today),
  };
}

/** 인도완료가 아닌데 인도일·청구월을 함께 쓰려는 모순을 찾는다. */
export function hasDeliveryContradiction(
  patch: Record<string, unknown>,
  current: Record<string, unknown> = {},
): boolean {
  const delivered = Object.prototype.hasOwnProperty.call(patch, 'delivered')
    ? patch.delivered === true
    : current.delivered === true;
  return !delivered && (!!S(patch.deliveredAt) || !!S(patch.billMonth));
}

const plateKey = (v: unknown) => S(v).replace(/\s/g, '');

/** 늦게 도착한 이전 차량 응답이 현재 선택을 덮지 못하게 한다. */
export function sameSettlementCar(expectedPlate: unknown, responsePlate: unknown): boolean {
  const expected = plateKey(expectedPlate);
  return !!expected && expected === plateKey(responsePlate);
}
