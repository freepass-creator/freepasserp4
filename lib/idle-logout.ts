'use client';
/**
 * 유휴 자동 로그아웃 — 설정한 시간 동안 활동 없으면 logout + /login.
 *  로그인 상태에서만 AuthProvider가 start/stop. 활동(마우스·키·터치·스크롤) 시 타이머 리셋.
 *  설정값 0분 = 끔(기본). prefs 변경 시 자동 재무장.
 */
import { getIdleMinutes, subscribePrefs } from '@/lib/prefs';

const ACTIVITY = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
let timer: ReturnType<typeof setTimeout> | null = null;
let cleanup: (() => void) | null = null;

function arm() {
  if (timer) { clearTimeout(timer); timer = null; }
  const min = getIdleMinutes();
  if (!min) return; // 끔
  timer = setTimeout(() => {
    void (async () => {
      try { const { logout } = await import('@/lib/firebase/auth'); await logout(); } catch { /* noop */ }
      if (typeof window !== 'undefined') window.location.href = '/login';
    })();
  }, min * 60 * 1000);
}

export function startIdleLogout() {
  if (typeof window === 'undefined') return;
  stopIdleLogout();
  const onActivity = () => arm();
  ACTIVITY.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
  const offPref = subscribePrefs(arm); // 유휴시간 바꾸면 즉시 재무장
  arm();
  cleanup = () => {
    ACTIVITY.forEach((e) => window.removeEventListener(e, onActivity));
    offPref();
    if (timer) { clearTimeout(timer); timer = null; }
  };
}

export function stopIdleLogout() {
  if (cleanup) { cleanup(); cleanup = null; }
  if (timer) { clearTimeout(timer); timer = null; }
}
