/**
 * **그 줄이 «어느 달에 실리나» — 정산원장·공급사시트·영업채널시트가 «같이 보는» 한 함수.**
 *
 * ★사장님 2026-09-04 「정산원장에 잘 반영해서 그거 기반으로 각자 시트에 뿌려질수 있도록 해주고」.
 *
 * ★★★**같은 달을 세 규칙으로 세고 있었다.**
 * ```
 * 정산원장     monthOf     박힌 청구월 > 인도월 + (회차−1)      publish-settlement-month 안에만 있었다
 * 정산서(종이)  billingMonthIn  박힌 청구월 > 실납입/부러진 회차   settlement-stage
 * 공급사·채널시트 billMonth    «박힌 값만» — 계산은 아예 안 했다
 * ```
 *   ⇒ 실측 2026-09-04 — 2026-09 원장에는 다섯 공급사가 서 있는데 시트는 «0곳»이었다.
 *     같은 달을 두 규칙으로 세면 «어느 숫자도 못 믿는다»(CLAUDE.md 「대수는 한 곳에서 센다」).
 *
 * ★**여기 담은 것은 «원장의 규칙»이다.** 원장이 뿌리는 쪽이라 원장이 기준이 된다.
 *   시트 셋이 이 함수를 같이 본다 — 원장에 뜬 줄이 그대로 각 시트에 간다.
 * ⚠ 종이(정산서)는 아직 `billingMonthIn` 을 본다. 그 둘을 합치는 것은 «이미 나간 청구서»를
 *   흔드는 일이라 사람 확인이 먼저다 — `check-settlement-sync` 가 그 차이를 드러낸다.
 */

const S = (v: unknown) => String(v ?? '').trim();
const p2 = (n: number) => String(n).padStart(2, '0');

/** `2026-08-04` → Date. 형식이 아니면 null. */
export const dateOf = (v: unknown): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(v));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
export const ymOf = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;

/** 「2회 분납」 → 2. 글에 회차가 없으면 1(일시납). */
export const roundsOf = (k: unknown) => { const m = /(\d)\s*회/.exec(S(k)); const n = m ? Number(m[1]) : 1; return n >= 2 ? n : 1; };

/**
 * 그 줄이 실릴 달.
 *
 * ★**박힌 청구월이 이긴다.** 사람이 정한 달을 계산이 덮으면 이미 나간 종이가 시트와 갈린다.
 * ★분납은 «끝나야» 청구한다(사장님 2026-09-01 「분납완료시점에서 청구」) — 인도월 + (회차−1).
 * ⚠ 인도일로 «빗장»을 걸지 않는다. 2026-09-02 에 그것으로 8월 인도 2회분납 9줄이
 *   「8월 청구」로 계산됐는데 8월은 이미 닫혀 갈 데가 없어졌다. 박힌 줄이 이미 막아 준다.
 */
export function settlementMonthOf(r: { billMonth?: unknown; receivedAt?: unknown; deliveredAt?: unknown; payKind?: unknown }): string {
  const written = S(r.billMonth);
  if (written) return written;
  const n = roundsOf(r.payKind);
  /**
   * ★★**분납은 «접수일»에서 센다** — 사장님 2026-09-04
   *   「접수일 기준으로 분납 계산해서 분납완료되는 날이 청구월이 되는거야」.
   *   ⚠ 여태 인도일에서 셌다. 분납은 접수 때 부터 회차가 도는 것이라 인도일로 세면
   *     인도가 늦어진 만큼 청구가 통째로 밀린다.
   * ★일시납은 그대로 «인도월»이다 — 인도되면 바로 전액 청구한다(FEE_TIMING).
   */
  if (n >= 2) {
    const rc = dateOf(r.receivedAt);
    if (!rc) return '';
    return ymOf(new Date(rc.getFullYear(), rc.getMonth() + (n - 1), rc.getDate()));
  }
  const d = dateOf(r.deliveredAt);
  return d ? ymOf(d) : '';
}
