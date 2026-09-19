/**
 * 손님 공개면 — Auth·RTDB 세션 게이트 우회용.
 * /shop · /q · /catalog · /sign 은 로그인 없이 매물·서명 조회 가능해야 함.
 */
import { WHITELABELS, homeIsShop } from '@/lib/whitelabel';

export const PUBLIC_PATH_PREFIXES = ['/q/', '/sign/'] as const;

/** 로그인 없이 열리는 단일 경로. 접두 프리픽스와 별도.
 *
 * ERP4 MAIN(2026-09-19)은 상품 조회·검색 공개면만 메인으로 둔다.
 * 과거 업무 화면인 /finder와 원가설정 /estimate/cost는 공개 목록에 두지 않는다.
 * /estimate는 독립 견적 화면으로서 정확히 그 경로만 공개하며, 하위 /estimate/cost까지
 * prefix로 함께 열리지 않게 PUBLIC_EXACT는 반드시 exact match로 판정한다.
 */
const PUBLIC_EXACT = [
  '/welrix', '/sonogong', '/terms', '/privacy', '/estimate',
] as const;

/**
 * 지금 보고 있는 주소의 «첫 화면»이 가게인가 — 브라우저에서만 답한다.
 * 서버에서는 각 층의 서버 껍데기가 `headers()` 로 이미 판정하므로 여기서 알 필요가 없다.
 *
 * ★★**미들웨어와 «같은 함수»를 본다**(`homeIsShop`). 전에는 두 곳이 각자 계산해서,
 *   한쪽만 고치면 **서버는 가게를 그리는데 이 게이트가 로그인으로 튕기는** 반쪽 상태가 났다.
 *   그래서 우리 도메인을 가게로 켜는 스위치(`HOME_IS_SHOP`)도 저절로 양쪽에 같이 걸린다.
 */
function homeIsShopHere(): boolean {
  if (typeof window === 'undefined') return false;
  try { return homeIsShop(window.location.host); } catch { return false; }
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
   * ★채널 «전용 주소» — 도메인을 붙이기 전에 손에 쥘 링크다.
   *   여기를 안 열면 손님이 그 주소에서 **로그인으로 튕긴다** — 손님은 로그인이라는 게 있는 줄도 모른다.
   *   (사장님 2026-09-05 「유니오토 전용 그 페이지를 좀 주면 좋겠다」)
   *
   * ★★★**주소를 손으로 적지 않는다 — 표(`WHITELABELS`)를 읽는다**(2026-09-06).
   *   사장님 「홍길동 영업채널 걸로 하나 파줘 그럼 **바로 파줘야** 되는 거야」.
   *   ⚠ 실측으로 잡았다 — 표에 채널 한 줄을 더하고 그 주소를 열었더니 **서버는 채널 이름으로 그렸는데
   *     클라이언트 게이트가 «로그인»으로 튕겼다.** 이 줄이 `/uniauto` 만 알고 있었기 때문이다.
   *     채널마다 여기를 또 고쳐야 하면 그건 「바로」가 아니다.
   */
  if (WHITELABELS.some((w) => !!w.sitePath && (pathname === w.sitePath || pathname.startsWith(`${w.sitePath}/`)))) return true;
  /*
   * ★★채널 주소의 **첫 화면**(사장님 2026-09-05 「그냥 그 주소로 들어가면 상품부터,
   *   회사가 뭘 팔고 있는지 그냥 다 보이는 거라고」).
   *   `uniautofreepass.com/` 은 미들웨어가 `/shop` 으로 rewrite 하지만 **브라우저 주소는 `/` 그대로**라,
   *   여기서 `/` 를 공개로 안 열면 손님이 첫 화면에서 로그인으로 튕긴다 — 그 손님은 거기서 끝이다.
   * ⚠ 우리 도메인(freepasserp.com)의 `/` 는 예전 그대로 로그인이다. 채널 호스트일 때만 연다.
   */
  if (pathname === '/' && homeIsShopHere()) return true;
  if (PUBLIC_EXACT.some((p) => pathname === p)) return true;
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
