/**
 * ★★잔존가 = **구매가격 + 1~5년 잔존가격(금액)** 다섯 점 — 그 사이는 «달마다 고르게» 나눈다.
 *
 * 사장님 2026-09-11 「국산이든 수입이든 **구매가격과 1~5년 잔존가격**을 알면 되는 거야.
 *   그러면 기간별 대여료는 나오지」 · 「기간별로 얼마 얼마 얼마를 넣으면 **그 월별에도 잔가가
 *   쫙 스프레드** 되게 되어 있어야 해 … 보이지는 않지만」 · 「그래서 **1년 6개월**도 잔존가를
 *   알 수 있어야 하는 거임」.
 *
 * ⇒ 0개월 = 구매가격, 12·24·36·48·60개월 = 적은 금액. 한 해 안에서는 **곧게**(월 균등) 잇는다.
 *   18개월 = (1년 + 2년) ÷ 2. 60개월을 넘으면 마지막 해의 기울기로 늘리고 0 밑으로는 안 간다.
 *
 * ⚠ 금액을 «고치지 않는다» — 2년이 1년보다 크게 적혀 있어도 그대로 잇는다. 이상한 값을 조용히
 *   매끈하게 만들면 적은 사람이 틀린 줄 모른다. 막을 일이면 화면이 말한다.
 * ⚠ 엔진(`calc.js`)은 «잔가율 × 밑값»으로 잔가를 센다. 그래서 금액을 율로 바꿀 때 나누는 값은
 *   **엔진이 곱하는 그 밑값**이어야 적은 금액이 그대로 선다(`monthlyRates` 의 `base`).
 */

/** 잔존가를 적는 자리 — 1~5년. */
export const ANCHOR_MONTHS = [12, 24, 36, 48, 60] as const;
export const MAX_MONTH = 60;

/**
 * 달마다의 잔존가(원) — 배열 자리 = 개월(0 … 60). `[0]` 은 구매가격이다.
 * 빠진 해가 있으면 앞뒤로 적힌 점 사이를 곧게 잇는다(앞이 없으면 구매가격, 뒤가 없으면 앞 값 유지).
 */
export function residualSchedule(purchase: number, anchors: Partial<Record<number, number>>): number[] {
  const pts: [number, number][] = [[0, Math.max(0, Number(purchase) || 0)]];
  for (const m of ANCHOR_MONTHS) {
    const v = anchors[m];
    if (v != null && Number.isFinite(Number(v))) pts.push([m, Math.max(0, Number(v))]);
  }
  const out: number[] = [];
  for (let m = 0; m <= MAX_MONTH; m++) {
    let k = 0;
    while (k + 1 < pts.length && pts[k + 1][0] < m) k++;
    const [m0, v0] = pts[k];
    const next = pts[k + 1];
    if (m === m0 || !next) { out.push(v0); continue; }
    const [m1, v1] = next;
    out.push(v0 + (v1 - v0) * (m - m0) / (m1 - m0));
  }
  return out;
}

/** 아무 달의 잔존가 — 60개월 넘으면 마지막 해 기울기로 늘린다(0 밑으로는 안 간다). */
export function residualAt(schedule: number[], month: number): number {
  const m = Math.max(0, Number(month) || 0);
  if (m <= MAX_MONTH) {
    const lo = Math.floor(m); const hi = Math.ceil(m);
    return lo === hi ? schedule[lo] : schedule[lo] + (schedule[hi] - schedule[lo]) * (m - lo);
  }
  const slope = (schedule[MAX_MONTH] - schedule[MAX_MONTH - 12]) / 12;
  return Math.max(0, schedule[MAX_MONTH] + slope * (m - MAX_MONTH));
}

/**
 * 엔진에 넘길 잔가율 — `{ 1: 율, 2: 율, … 60: 율 }`. 엔진은 약정 개월을 열쇠로 찾으므로
 * 18개월 약정도 제 잔가를 받는다. `base` 는 **엔진이 잔가율을 곱하는 값**이다.
 */
export function monthlyRates(schedule: number[], base: number): Record<number, number> {
  const out: Record<number, number> = {};
  if (!(base > 0)) return out;
  for (let m = 1; m <= MAX_MONTH; m++) out[m] = schedule[m] / base;
  return out;
}
