/**
 * **손님이 보는 면인가** — ERP 크롬(상단바·하단 탭바)을 걷어낼지 정하는 한 곳.
 *
 * 왜 모았나. 2026-09-04 까지 이 명단이 `TopBar` 와 `AppTabBar` **두 곳에 따로** 적혀 있었다.
 * 손님 동을 `/shop` 으로 가르자마자 두 곳 다 그 주소를 몰라서, 손님 화면 위에 업무동 남색
 * 상단바가 그대로 얹혔다. 한 곳을 고치고 다른 곳을 빠뜨리면 「폰에서는 멀쩡한데 웹에서만
 * 우리 정체가 뜨는」 꼴이 되는데, 그건 화이트라벨에서 제일 나쁜 종류의 사고다.
 *
 * ⚠ `isPublicPath`(lib/public-access)와 **다른 물음**이라 합치지 않는다.
 *   저건 「로그인 없이 들어올 수 있나」(인증·RTDB 게이트)이고, 이건 「우리 껍데기를 벗을까」다.
 *   `/terms`·`/privacy` 는 로그인 없이 열려야 하지만 업무동 안에서도 열리므로 크롬을 벗지 않는다.
 */

/** 손님 면의 주소 앞머리. 새 손님 라우트를 만들면 **여기 한 줄**만 더한다. */
const GUEST_PREFIXES = ['/shop', '/catalog', '/q/', '/sign/'] as const;

export function isGuestSurface(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return GUEST_PREFIXES.some((p) => (
    p.endsWith('/') ? pathname === p.slice(0, -1) || pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)
  ));
}
