/**
 * **정산 주기 — 이 세 날짜가 정본이다.**
 *
 * 사장님 2026-08-27
 *   「10일」 · 「청구서를 보통 공급사는 3일정도에 청구할거야」
 *
 * ```
 * 말일    마감      그 달 인도분을 닫는다. 아직 안 끝난 달은 «누락»이 아니다
 * 3일     청구      다음 달 3일쯤 청구서가 나간다
 * 10일    결제      다음 달 10일까지 받는다  ← 종이에 찍히는 날
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
/** 결제일 — 다음 달 며칠. ★「기한」이라 부르지 않는다 — 밀린 사람한테 쓰는 말이다. */
export const DUE_DAY = 10;
/**
 * ★**영업채널에 «주는» 날은 따로다 — 다음 달 15일**(사장님 2026-09-03 「영업채널은 9월 15일 지급예정」).
 *   받아서 주는 구조라 «받는 날(10일)»이 «주는 날(15일)»보다 앞서야 한다.
 *   ⚠ 두 날을 한 값으로 쓰면 아직 안 들어온 돈을 주기로 적게 된다.
 */
export const PAY_DAY = 15;

const YM = /^(\d{4})-(\d{2})$/;

/** 정산월 `2026-08` → 그 달 몫을 청구하는 날 `2026-09-03` */
export function billDate(month: string): Date | null {
  const x = YM.exec(String(month ?? '').trim());
  return x ? new Date(Number(x[1]), Number(x[2]), BILL_DAY) : null;
}

/** 정산월 `2026-08` → 결제일 `2026-09-10` */
export function dueDate(month: string): Date | null {
  const x = YM.exec(String(month ?? '').trim());
  return x ? new Date(Number(x[1]), Number(x[2]), DUE_DAY) : null;
}

/**
 * ★★**공급사마다 «주는 날»이 다른 경우가 있다** — 사장님 2026-09-03
 *   「하허호보니까 오플 지급일이 달라서 따로 정리해놨어」 · 오토플러스는 **익월 25일**.
 *
 *   ⚠ 그래서 하허호 정산서는 «한 장이 아니다» — 09/15 몫과 09/25 몫이 섞이면
 *     종이에 찍힌 날이 절반은 틀린 말이 된다. 갈라서 낸다.
 *   ★날짜는 여기 «한 곳»에서만 갈린다. 스크립트마다 따로 적으면 또 어긋난다.
 */
export const PAY_DAY_BY_SUPPLIER: Record<string, number> = { 오토플러스: 25 };

/** 그 공급사에게 주는 날은 며칠인가 — 표에 없으면 기본 15일. */
export const payDayOf = (supplier?: string): number => {
  const s = String(supplier ?? '').trim();
  return (s && Object.entries(PAY_DAY_BY_SUPPLIER).find(([k]) => s.includes(k))?.[1]) || PAY_DAY;
};

/** 정산월 `2026-08` → 영업채널 지급 예정일 `2026-09-15` (공급사를 주면 그쪽 날) */
export function payDate(month: string, supplier?: string): Date | null {
  const x = YM.exec(String(month ?? '').trim());
  return x ? new Date(Number(x[1]), Number(x[2]), payDayOf(supplier)) : null;
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
