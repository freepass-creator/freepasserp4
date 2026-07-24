/**
 * 손님 공개면 — Auth·RTDB 세션 게이트 우회용.
 * /q · /catalog · /sign 은 로그인 없이 매물·서명 조회 가능해야 함.
 */
export const PUBLIC_PATH_PREFIXES = ['/q/', '/sign/'] as const;

/** 로그인 없이 열리는 단일 경로(임베드 견적/구독 앱 등). 접두 프리픽스와 별도. */
const PUBLIC_EXACT = ['/welrix', '/sonogong'] as const;

export function isPublicPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  // /m = 모바일 미리보기 프레임 호스트(안의 iframe이 자체 인증) → 로그아웃해도 최상위 창이 /login으로 안 튕겨야 프레임 유지.
  //  /m/{code}(실제 모바일 상세)는 앱콘텐츠라 제외 — exact 매칭만.
  if (pathname === '/m') return true;
  if (pathname === '/catalog' || pathname.startsWith('/catalog/')) return true;
  if (PUBLIC_EXACT.some((p) => pathname === p || pathname.startsWith(p + '/'))) return true;
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
