import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_SIGN_HOST = 'sign.freepasserp.com';
const LEGACY_SIGN_ORIGIN = 'https://chakhandeal.vercel.app';
const FREEPASS_TOKEN = /^fps_[A-Za-z0-9_-]+$/;
const LEGACY_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/**
 * `sign.freepasserp.com`은 신규 프리패스 전자계약의 대표 도메인이다.
 * 착한거래가 발행한 과거 링크는 루트의 22자리 계약 ID였으므로 기존 운영 서버로 넘긴다.
 */
export function middleware(request: NextRequest) {
  const host = String(request.headers.get('host') || '').split(':')[0].toLowerCase();
  if (host !== PUBLIC_SIGN_HOST) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const rootToken = pathname.match(/^\/([^/]+)\/?$/)?.[1] || '';

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
