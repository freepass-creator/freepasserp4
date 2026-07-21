/**
 * 손님 공개면 — Auth·RTDB 세션 게이트 우회용.
 * /q · /catalog · /sign 은 로그인 없이 매물·서명 조회 가능해야 함.
 */
export const PUBLIC_PATH_PREFIXES = ['/q/', '/sign/'] as const;

export function isPublicPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (pathname === '/catalog' || pathname.startsWith('/catalog/')) return true;
  return PUBLIC_PATH_PREFIXES.some((p) => pathname === p.slice(0, -1) || pathname.startsWith(p));
}

let forced = false;
/** AuthProvider·공개 페이지에서 true. */
export function setPublicAccess(on: boolean) { forced = on; }

/** getStore RTDB 공개 읽기 허용 여부. */
export function isPublicAccess(): boolean {
  if (forced) return true;
  if (typeof window === 'undefined') return false;
  return isPublicPath(window.location.pathname);
}
