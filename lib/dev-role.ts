'use client';
import type { Role } from '@/lib/domain/deal';
import { getSession } from '@/lib/auth-session';

/**
 * 테스트 모드 — 로그인한 채로 **화면만** 다른 역할로 본다.
 *
 * 역할별 화면(영업자=내 대화 / 공급사·관리자=문의 목록 / 손님=대여료만)이 갈리면서
 * 확인하려면 계정 셋을 번갈아 로그인해야 했다. 그 왕복을 없애는 개발 스위치다.
 *
 * ★**화면만 바뀐다. 권한은 안 바뀐다.**
 *   서버 규칙(RTDB)은 로그인한 uid 의 실제 역할로 판단하므로, 공급사로 바꿔 봐도
 *   관리자 데이터가 읽히지 않는다(그 반대도 마찬가지). 즉 **배치·동선 확인용**이지
 *   권한 시험용이 아니다 — 권한은 실제 계정으로 봐야 한다.
 *
 * ★아무나 못 켠다: 개발 서버이거나, 실제 세션이 관리자일 때만.
 * ★켜져 있으면 화면 구석에 «테스트» 표시가 뜬다 — 모르고 남겨 두면 없는 버그를 쫓게 된다.
 */
const KEY = 'fp4_dev_role';

/**
 * ⚠ 2026-08-09 — **화면에서 내렸다**(사장님 지시).
 *
 * 개발 서버라는 이유만으로 늘 떠 있어서, 실제 화면을 볼 때마다 좌하단에 테스트 딱지가
 * 걸렸다. 역할 확인은 실제 계정으로 로그인해서 보는 것이 맞다 —
 * 이 스위치는 «화면만» 바꾸므로 권한 확인에는 쓸 수도 없었다.
 *
 * 되살리려면 여기서 `true` 를 돌려주면 된다. 기능 자체는 남겨 둔다.
 */
export function canUseDevRole(): boolean {
  return false;
}

/**
 * 이미 골라 둔 테스트 역할이 있으면 «지우고» 없는 것으로 본다.
 * 스위치만 숨기면 localStorage 에 남은 값 때문에 계속 그 역할 화면이 보인다 —
 * 스위치가 없으니 되돌릴 방법도 없어진다.
 */
export function getDevRole(): Role | null {
  if (typeof window === 'undefined') return null;
  try {
    if (localStorage.getItem(KEY)) localStorage.removeItem(KEY);
  } catch { /* noop */ }
  return null;
}

export function setDevRole(role: Role | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (role) localStorage.setItem(KEY, role);
    else localStorage.removeItem(KEY);
  } catch { /* noop */ }
  // 역할이 바뀌면 화면이 통째로 달라진다 — 방·안읽음·뱃지까지 같이 다시 읽게 알린다.
  window.dispatchEvent(new CustomEvent('fp:role', { detail: role || getSession()?.role || 'agent' }));
  window.dispatchEvent(new Event('fp:session'));
  window.dispatchEvent(new Event('fp:unread'));
}
