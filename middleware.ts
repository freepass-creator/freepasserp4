import { NextResponse, type NextRequest } from 'next/server';
import { WHITELABELS, homeIsShop } from '@/lib/whitelabel';
import { isGuestPath } from '@/lib/guest-surface';

const PUBLIC_SIGN_HOST = 'sign.freepasserp.com';
/** 손님 동 표시 — 레이아웃이 읽는다(아래 머리말). `lib/whitelabel` 와 이름을 맞춘다. */
const GUEST_HEADER = 'x-fp-guest';
/**
 * 이 호스트의 첫 화면이 «가게»인가 — 판정은 표(`lib/whitelabel` `homeIsShop`)가 한다.
 *
 * ★채널이 늘어도 이 파일은 안 고친다. 표에 줄이 하나 늘 뿐이다.
 * ★★**우리 도메인을 가게로 바꾸는 스위치(`HOME_IS_SHOP`)도 거기 있다** — 여기가 아니다.
 *   미들웨어와 클라이언트 공개 판정이 «같은 함수»를 봐야 반쪽 상태(서버는 가게를 그리는데
 *   게이트가 로그인으로 튕기는 꼴)가 안 난다.
 */
const isShopHome = (host: string, pathname: string) =>
  pathname === '/' && homeIsShop(host);
const LEGACY_SIGN_ORIGIN = 'https://chakhandeal.vercel.app';
const FREEPASS_TOKEN = /^fps_[A-Za-z0-9_-]+$/;
const LEGACY_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/**
 * `sign.freepasserp.com`은 신규 프리패스 전자계약의 대표 도메인이다.
 * 착한거래가 발행한 과거 링크는 루트의 22자리 계약 ID였으므로 기존 운영 서버로 넘긴다.
 */
export function middleware(request: NextRequest) {
  const host = String(request.headers.get('host') || '').split(':')[0].toLowerCase();

  /*
   * ★★채널 도메인의 **첫 화면은 상품**이다(사장님 2026-09-05 「유니오토모빌의 그 상품 페이지잖아.
   *   거길 들어가서 영업자는 로그인을 하는 거야. 그냥 그 주소로 들어가면 상품부터,
   *   회사가 뭘 팔고 있는지 그냥 다 보이는 거라고」).
   *
   *   지금까지 `/` 는 무조건 `/login` 으로 튕겼다. 그래서 손님이 uniautofreepass.com 을 열면
   *   **로그인 화면부터 만났다** — 상품을 보러 온 사람에게 문부터 잠근 셈이다.
   *
   * ★`redirect` 가 아니라 **`rewrite`** 다. 주소창이 `uniautofreepass.com` 그대로 남아야
   *   그 회사 사이트로 보인다. `/shop` 이 붙으면 「어디 시스템에 얹힌 것」처럼 읽힌다.
   * ★영업자는 같은 주소에서 `/login` 으로 들어가 로그인한다 — 현관도 이미 채널 이름이다.
   * ⚠ 브라우저 주소는 `/` 그대로라 클라이언트 인증 게이트가 `/` 를 본다 —
   *   `lib/public-access` 가 채널 호스트의 `/` 를 공개로 연다. 둘이 짝이라 한쪽만 고치면 튕긴다.
   */
  /*
   * ⚠⚠ **손님 표시(`x-fp-guest`)를 «여기서도» 붙인다**(2026-09-09).
   *   안 붙이면 루트 레이아웃이 호스트로만 판정한다. 채널 도메인은 그래도 맞지만,
   *   **우리 도메인을 가게로 켜는 순간**(`HOME_IS_SHOP`) 겉은 우리 가게인데 메타·JSON-LD 는
   *   업무동 것(「장기렌터카 영업지원 플랫폼」)이 실려 나간다 — 2026-09-06 에 `/uniauto` 에서
   *   똑같이 샜던 그 사고다. 표시를 붙이면 레이아웃이 손님 판정(`resolveGuestWhitelabel`)을 탄다.
   * ★채널 도메인에도 붙는다 — 거기도 손님 화면이라 붙는 편이 정확하다(지금과 결과가 같다).
   */
  if (isShopHome(host, request.nextUrl.pathname)) {
    const target = request.nextUrl.clone();
    target.pathname = '/shop';
    const headers = new Headers(request.headers);
    headers.set(GUEST_HEADER, '1');
    return NextResponse.rewrite(target, { request: { headers } });
  }

  /*
   * ★★**손님 동 표시** — 루트 레이아웃이 「지금이 손님 화면인가」를 알아야 한다(2026-09-06).
   *
   * 사장님 「프리패스 erp 점 컴에서 원래 상세 페이지가 조회되거나 그러면 안 되는데」.
   * 화면 글자는 채널로 고쳤는데 **레이아웃의 메타·JSON-LD 가 여전히 우리 것**이었다 —
   * `/uniauto` 소스를 열면 `프리패스모빌리티 주식회사` · 「장기렌터카 영업지원 플랫폼」이 나왔다.
   * 레이아웃은 라우트를 모르므로(호스트만 본다) 여기서 한 줄 붙여 준다.
   * ⚠ 업무동에는 안 붙인다 — 콕핏은 우리 화면이라 예전 그대로여야 한다.
   */
  /*
   * ★★**채널 주소(`freepasserp.com/<회사명>`) → 가게 화면.** 표에 `sitePath` 가 적힌 채널이면 `/shop` 으로
   *   «다시 쓴다»(주소창은 그대로 `/uniauto`).
   *
   * ★★★사장님 2026-09-06 「유니오토도 **하나의 영업채널**이고, 내가 이거를 **홍길동 영업채널 걸로
   *   하나 파줘** 그럼 **바로 파줘야** 되는 거야」.
   *   ⇒ 그러려면 채널을 하나 더 파는 일이 **표에 한 줄**이어야 한다. 여태는 채널마다
   *     `app/(shop)/uniauto/page.tsx` 같은 **라우트 파일을 손으로 만들어야** 했고, 도면에도
   *     등록해야 했다 — 「바로」가 안 되는 꼴이었다. 그 파일을 걷고 이 한 줄로 옮겼다.
   * ★`/shop` 은 이미 `?wl=` 로 채널을 입는다(미리보기 규칙) — 새 화면을 만들지 않는다.
   *   머리(제목·og·robots noindex)도 `/shop` 이 그대로 만든다.
   * ★도메인이 붙으면 호스트 판정이 «먼저» 이긴다 — 다만 이 길은 **닫지 않는다**(이미 나간 링크가 여기다).
   */
  const channel = WHITELABELS.find((w) => !!w.sitePath && request.nextUrl.pathname === w.sitePath);
  if (channel) {
    const target = request.nextUrl.clone();
    target.pathname = '/shop';
    target.searchParams.set('wl', channel.key);
    const headers = new Headers(request.headers);
    headers.set(GUEST_HEADER, '1');
    return NextResponse.rewrite(target, { request: { headers } });
  }

  if (isGuestPath(request.nextUrl.pathname)) {
    const headers = new Headers(request.headers);
    headers.set(GUEST_HEADER, '1');
    return NextResponse.next({ request: { headers } });
  }

  if (host !== PUBLIC_SIGN_HOST) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const rootToken = pathname.match(/^\/([^/]+)\/?$/)?.[1] || '';

  // 전자계약 전용 도메인의 첫 화면은 ERP 홈이 아니라 계약 발송센터다.
  // 공개 고객 링크와 관리자 작성 화면을 같은 도메인에서 독립적으로 사용할 수 있게 한다.
  if (pathname === '/') {
    const target = request.nextUrl.clone();
    target.pathname = '/esign';
    return NextResponse.redirect(target, 307);
  }

  if (FREEPASS_TOKEN.test(rootToken)) {
    const target = request.nextUrl.clone();
    target.pathname = `/sign/${rootToken}`;
    return NextResponse.rewrite(target);
  }

  const nestedToken = pathname.match(/^\/sign\/(fps_[A-Za-z0-9_-]+)\/?$/)?.[1] || '';
  if (nestedToken) {
    const target = request.nextUrl.clone();
    target.pathname = `/${nestedToken}`;
    return NextResponse.redirect(target, 308);
  }

  if (LEGACY_TOKEN.test(rootToken)) {
    return NextResponse.redirect(`${LEGACY_SIGN_ORIGIN}/${rootToken}${search}`, 307);
  }

  if (pathname === '/sign' && request.nextUrl.searchParams.get('c')) {
    return NextResponse.redirect(`${LEGACY_SIGN_ORIGIN}${pathname}${search}`, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
