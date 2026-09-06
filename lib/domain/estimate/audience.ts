/**
 * 견적을 **누가 보나** — 한 곳(SSOT).
 *
 * ★사장님 2026-09-06 「견적기는 영업자가 보낸 게 아니고 일단 **공급사들이 보는** 거고,
 *   영업자랑 손님이 보는 거는 원가 정보 빠진 거 좋은 거야」 →
 *   이어서 「일단 **메뉴 자체를 관리자랑 공급사만** 보게 해요. **아직 해당 없어**」.
 *
 *   ⇒ 지금은 **관리자·공급사만**이다. 영업자용 «원가 뺀 화면»은 **아직 만들지 않는다** —
 *     안 쓰는 분기를 미리 넣어 두면 다음 사람이 그걸 규격으로 안다.
 *     필요해지면 그때 이 파일에 물음을 하나 더 둔다(「원가를 보여 주나」).
 *
 * ★막는 곳이 셋이다. 하나만 막으면 막은 게 아니다.
 *     ㉠ 하단 홈바 탭      `lib/tabbar` appTabsFor
 *     ㉡ 웹 전체메뉴       `components/TopBar` GROUPS
 *     ㉢ 페이지·API 자체   `/estimate`·`/estimate/cost`·`/api/estimate/cost`
 *   메뉴에서만 숨기면 주소를 아는 사람은 그냥 들어온다. 원가·마진이 보이는 화면이라 그러면 안 된다.
 */

/** 견적·원가 화면을 볼 수 있는 역할. */
const ESTIMATE_ROLES = new Set<string>(['admin', 'provider']);

/**
 * 이 사람이 견적을 보나.
 * ⚠ 모르는 역할·비로그인은 **아니다**(닫는 쪽이 기본값). 「모르면 열어 준다」로 두면
 *   역할이 하나 늘 때마다 원가가 새는 길이 하나 늘어난다.
 */
export function canSeeEstimate(role: string | null | undefined): boolean {
  return ESTIMATE_ROLES.has(String(role ?? ''));
}
