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

export function canUseDevRole(): boolean {
  if (typeof window === 'undefined') return false;
  if (process.env.NODE_ENV !== 'production') return true;
  return getSession()?.role === 'admin';
}

export function getDevRole(): Role | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(KEY);
    return v === 'agent' || v === 'provider' || v === 'admin' ? v : null;
  } catch { return null; }
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
