import { NextResponse, type NextRequest } from 'next/server';
import { hasBrand, resolveWhitelabel } from '@/lib/whitelabel';

const PUBLIC_SIGN_HOST = 'sign.freepasserp.com';
/**
 * 채널 도메인의 첫 화면인가 — 표(`lib/whitelabel`)를 그대로 본다.
 * ★채널이 늘어도 이 파일은 안 고친다. 표에 줄이 하나 늘 뿐이다.
 */
const isShopHome = (host: string, pathname: string) =>
  pathname === '/' && hasBrand(resolveWhitelabel(host));
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
  if (isShopHome(host, request.nextUrl.pathname)) {
    const target = request.nextUrl.clone();
    target.pathname = '/shop';
    return NextResponse.rewrite(target);
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
