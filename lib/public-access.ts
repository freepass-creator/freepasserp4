/**
 * 손님 공개면 — Auth·RTDB 세션 게이트 우회용.
 * /shop · /q · /catalog · /sign 은 로그인 없이 매물·서명 조회 가능해야 함.
 */
import { hasBrand, resolveWhitelabel } from '@/lib/whitelabel';

export const PUBLIC_PATH_PREFIXES = ['/q/', '/sign/'] as const;

/** 로그인 없이 열리는 단일 경로(임베드 견적/구독 앱 등). 접두 프리픽스와 별도.
 *  /terms·/privacy 는 가입 화면에서 동의하기 전에 읽어야 하므로 반드시 비로그인 통과. */
const PUBLIC_EXACT = ['/welrix', '/sonogong', '/terms', '/privacy'] as const;

/**
 * 지금 보고 있는 주소가 «채널 도메인»인가 — 브라우저에서만 답한다.
 * 서버에서는 각 층의 서버 껍데기가 `headers()` 로 이미 판정하므로 여기서 알 필요가 없다.
 */
function isBrandedHost(): boolean {
  if (typeof window === 'undefined') return false;
  try { return hasBrand(resolveWhitelabel(window.location.host)); } catch { return false; }
}

export function isPublicPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  // /m = 모바일 미리보기 프레임 호스트(안의 iframe이 자체 인증) → 로그아웃해도 최상위 창이 /login으로 안 튕겨야 프레임 유지.
  //  /m/{code}(실제 모바일 상세)는 앱콘텐츠라 제외 — exact 매칭만.
  if (pathname === '/m') return true;
  if (pathname === '/catalog' || pathname.startsWith('/catalog/')) return true;
  /*
   * 가게(손님 동) — 채널 도메인으로 들어오는 손님은 «로그인이라는 것이 있는 줄도 모른다».
   * 여기 등록을 빠뜨리면 화면이 통째로 로그인으로 튕긴다(2026-09-04 실측 — 동을 가르자마자 났다).
   */
  if (pathname === '/shop' || pathname.startsWith('/shop/')) return true;
  /*
   * ★채널 «전용 주소» — 도메인을 붙이기 전에 손에 쥘 링크다(`app/(shop)/uniauto`).
   *   여기를 안 열면 손님이 그 주소에서 **로그인으로 튕긴다** — 손님은 로그인이라는 게 있는 줄도 모른다.
   *   (사장님 2026-09-05 「유니오토 전용 그 페이지를 좀 주면 좋겠다」)
   */
  if (pathname === '/uniauto' || pathname.startsWith('/uniauto/')) return true;
  /*
   * ★★채널 주소의 **첫 화면**(사장님 2026-09-05 「그냥 그 주소로 들어가면 상품부터,
   *   회사가 뭘 팔고 있는지 그냥 다 보이는 거라고」).
   *   `uniautofreepass.com/` 은 미들웨어가 `/shop` 으로 rewrite 하지만 **브라우저 주소는 `/` 그대로**라,
   *   여기서 `/` 를 공개로 안 열면 손님이 첫 화면에서 로그인으로 튕긴다 — 그 손님은 거기서 끝이다.
   * ⚠ 우리 도메인(freepasserp.com)의 `/` 는 예전 그대로 로그인이다. 채널 호스트일 때만 연다.
   */
  if (pathname === '/' && isBrandedHost()) return true;
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
