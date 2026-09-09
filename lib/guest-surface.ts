/**
 * **ERP 껍데기를 어디까지 걷나** — 상단바·하단 홈바를 벗을지 정하는 한 곳.
 *
 * 왜 모았나. 2026-09-04 까지 이 명단이 `TopBar` 와 `AppTabBar` **두 곳에 따로** 적혀 있었다.
 * 손님 동을 `/shop` 으로 가르자마자 두 곳 다 그 주소를 몰라서, 손님 화면 위에 업무동 남색
 * 상단바가 그대로 얹혔다. 한 곳을 고치고 다른 곳을 빠뜨리면 「폰에서는 멀쩡한데 웹에서만
 * 우리 정체가 뜨는」 꼴이 되는데, 그건 화이트라벨에서 제일 나쁜 종류의 사고다.
 *
 * ⚠ `isPublicPath`(lib/public-access)와 **다른 물음**이라 합치지 않는다.
 *   저건 「로그인 없이 들어올 수 있나」(인증·RTDB 게이트)이고, 이건 「우리 껍데기를 벗을까」다.
 *   `/terms`·`/privacy` 는 로그인 없이 열려야 하지만 업무동 안에서도 열리므로 크롬을 벗지 않는다.
 *
 * ★★2026-09-06 — 「벗는다」가 **한 가지가 아니게** 됐다. 물음이 둘로 갈린다.
 *     ㉠ 상단바를 벗나  ㉡ 하단 홈바를 벗나
 *   손님 면은 둘 다 벗지만, **제 머리를 가진 업무 면**(견적)은 상단만 벗고 하단은 **얹는다**.
 *   사장님 2026-09-06 「하단에다가 상품 찾기·조회·견적을 넣어주는 게 낫지 않나 … 견적 버튼을
 *   하나 만들어 줘봐」 — 견적은 손님 화면이 아니라 **영업자가 매일 여는 업무 화면**이고,
 *   그러면 다른 탭으로 오갈 길이 있어야 한다.
 *   ⇒ 견적의 «얼굴»(자체 CSS·제 머리·견적↔원가 스위치)은 그대로 두고, «다니는 길»만 단다.
 *     9/6 「완전 별도 페이지」는 얼굴 얘기였고 이건 길 얘기라, 둘은 부딪히지 않는다.
 */

/** 손님 면 — 상단바·하단 홈바를 **둘 다** 벗는다. 새 손님 라우트는 여기 한 줄. */
const GUEST_PREFIXES = ['/shop', '/uniauto', '/catalog', '/q/', '/sign/',
  /**
   * ★★**정산 콕핏은 «완전 별도 페이지»다** — 사장님 2026-09-09
   *   「그리고 정산페이지도 별도 페이지로 만든다니까??? **프리패스랑 안 붙이고**」
   *
   *   손님 면이라서가 아니라 «제 얼굴을 통째로 가져서»다 — 제 머리·제 탭(접수·요약·찾기·넘길것)이 있어
   *   ERP 상단바를 얹으면 머리가 둘이 되고, 하단 홈바를 얹으면 탭이 두 줄이 된다.
   *   ⚠ 그렇다고 로그인이 없는 건 아니다 — 진짜 문(`/settlement/board`)은 관리자만 들어간다.
   *     «껍데기를 벗는 것»과 «로그인 없이 여는 것»은 다른 물음이다(이 파일 머리글).
   */
  '/settlement/board'] as const;

/**
 * 제 머리를 가진 업무 면 — **상단바만** 벗는다(하단 홈바는 얹는다).
 * 화면이 자기 헤더를 이미 그리고 있어 ERP 상단바를 얹으면 머리가 둘이 된다.
 */
const OWN_HEADER_PREFIXES = ['/estimate'] as const;

function matches(list: readonly string[], pathname: string): boolean {
  return list.some((p) => (
    p.endsWith('/') ? pathname === p.slice(0, -1) || pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)
  ));
}

/** 손님이 보는 면인가 — 브랜드·크롬을 통째로 걷는 판정. */
export function isGuestSurface(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return matches(GUEST_PREFIXES, pathname);
}

/** 상단바를 감출까 — 손님 면 + 제 머리를 가진 업무 면. */
export function hidesTopBar(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return matches(GUEST_PREFIXES, pathname) || matches(OWN_HEADER_PREFIXES, pathname);
}

/** 하단 홈바를 감출까 — **손님 면만**. 업무 면은 제 머리를 가졌어도 홈바로 오간다. */
export function hidesTabBar(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return matches(GUEST_PREFIXES, pathname);
}
