import { getSession } from '@/lib/auth-session';

/**
 * **이 손님은 누구 손님인가** — 손님 화면이 「누구에게 전화」를 정하는 한 곳.
 *
 * 사장님 2026-09-05 「로그인을 안 하면 대표번호고」.
 *
 * 순서가 셋이고, 순서 자체가 규칙이다.
 *   ① 주소의 `?a=`      — 영업자가 손님에게 «보낸» 링크. 제일 세다. 보낸 사람이 곧 담당이다.
 *   ② 기억해 둔 `?a=`   — 그 손님이 전에 그 링크로 들어왔었다. 목록·상세를 오가도 담당이 안 바뀐다.
 *   ③ **로그인한 나**    — 링크로 온 게 아니라 «영업자가 직접» 열어 본 것이다. 그러면 내 손님이다.
 *   넷째는 없다 — 아무것도 없으면 담당이 «없는» 것이고, 화면은 대표번호로 떨어진다.
 *
 * ★③이 있어야 하는 이유. 영업자가 로그인한 채로 그냥 가게를 열어 보면, 주소에 `?a=` 가 없어서
 *   **자기 매물을 보면서도 담당이 자기가 아니었다.** 그 상태로 주소창을 복사해 손님에게 보내면
 *   그 손님은 대표번호로 떨어진다 — 영업자가 제 손님을 잃는다.
 * ★★로그인 안 한 사람(= 손님)은 여기서 언제나 빈 문자열이다. 손님 화면에 로그인은 필요 없고,
 *   `getSession` 은 저장된 세션이 없으면 그냥 null 이다.
 * ⚠ 서버에서는 부르지 않는다(localStorage 를 읽는다). 화면이 뜬 뒤 클라이언트에서만 정한다.
 */
export const ATTR_KEY = 'fp4_attr';

export function resolveAttr(params: URLSearchParams): string {
  if (typeof window === 'undefined') return '';
  const fromUrl = String(params.get('a') || '').trim();
  if (fromUrl) {
    // 한 번 들어온 귀속은 기억한다 — 손님이 목록·상세를 오가도 담당자가 안 바뀐다.
    try { localStorage.setItem(ATTR_KEY, fromUrl); } catch { /* 저장 못 해도 이번 방문은 산다 */ }
    return fromUrl;
  }
  try {
    const remembered = String(localStorage.getItem(ATTR_KEY) || '').trim();
    if (remembered) return remembered;
  } catch { /* 못 읽어도 아래로 내려간다 */ }
  // 로그인해서 «직접» 열어 본 영업자 — 이 화면은 그 사람 것이다.
  try { return String(getSession()?.user_code || '').trim(); } catch { return ''; }
}
