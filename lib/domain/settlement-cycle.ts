/**
 * **정산 주기 — 이 세 날짜가 정본이다.**
 *
 * 사장님 2026-08-27
 *   「10일」 · 「청구서를 보통 공급사는 3일정도에 청구할거야」
 *
 * ```
 * 말일    마감      그 달 인도분을 닫는다. 아직 안 끝난 달은 «누락»이 아니다
 * 3일     청구      다음 달 3일쯤 청구서가 나간다
 * 10일    입금      다음 달 10일까지 받는다  ← 종이에 찍히는 기한
 * ```
 *
 * ★**여기 말고 다른 데 날짜를 적지 마라.** 종이(정산서)와 알림(할 일)이 같은 숫자를
 *   봐야 한다. 한쪽만 고치면 「10일까지」라고 보내 놓고 15일에야 독촉하게 된다.
 *
 * ⚠ 주말·공휴일 보정은 «하지 않는다». 앞당길지 미룰지는 상대와의 «약속»이라
 *   코드가 정할 일이 아니다. 정해지면 이 파일 한 곳을 고친다.
 */

/** 청구서가 나가는 날 — 다음 달 며칠 */
export const BILL_DAY = 3;
/** 입금 기한 — 다음 달 며칠 */
export const DUE_DAY = 10;

const YM = /^(\d{4})-(\d{2})$/;

/** 정산월 `2026-08` → 그 달 몫을 청구하는 날 `2026-09-03` */
export function billDate(month: string): Date | null {
  const x = YM.exec(String(month ?? '').trim());
  return x ? new Date(Number(x[1]), Number(x[2]), BILL_DAY) : null;
}

/** 정산월 `2026-08` → 입금 기한 `2026-09-10` */
export function dueDate(month: string): Date | null {
  const x = YM.exec(String(month ?? '').trim());
  return x ? new Date(Number(x[1]), Number(x[2]), DUE_DAY) : null;
}

/**
 * 오늘 기준으로 그 달 정산이 «어디쯤» 와 있나.
 *
 * ★알림도 정산서도 이 하나를 본다.
 */
export function cyclePhase(month: string, now: Date): '마감전' | '청구전' | '입금전' | '지남' {
  const bill = billDate(month);
  const due = dueDate(month);
  if (!bill || !due) return '마감전';
  const x = YM.exec(month)!;
  const closed = new Date(Number(x[1]), Number(x[2]), 1);   // 다음 달 1일 = 마감 끝
  if (now < closed) return '마감전';
  if (now < bill) return '청구전';
  if (now <= due) return '입금전';
  return '지남';
}
