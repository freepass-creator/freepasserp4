/**
 * 앱 로컬 설정 SSOT — 테마·햅틱 등. localStorage.
 * 페이지는 get/set만, DOM 적용은 applyTheme / PrefsBoot.
 */
'use client';

export type ThemePref = 'light' | 'dark' | 'system';

const THEME_KEY = 'fp4_theme';
const HAPTIC_KEY = 'fp4_haptic';
const EVT = 'fp:prefs';

function read(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, v: string) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, v); } catch { /* */ }
  window.dispatchEvent(new CustomEvent(EVT));
}

export function getThemePref(): ThemePref {
  const v = read(THEME_KEY);
  return v === 'dark' || v === 'system' || v === 'light' ? v : 'light';
}

export function setThemePref(t: ThemePref) {
  write(THEME_KEY, t);
  applyTheme(t);
}

/** 실제 다크 여부(시스템 해석 포함) */
export function resolvedDark(t: ThemePref = getThemePref()): boolean {
  if (t === 'dark') return true;
  if (t === 'light') return false;
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(t: ThemePref = getThemePref()) {
  if (typeof document === 'undefined') return;
  const dark = resolvedDark(t);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // PWA·브라우저 크롬 색
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0f1419' : '#1B2A4A');
}

export function getHapticOn(): boolean {
  const v = read(HAPTIC_KEY);
  return v !== '0'; // 기본 켜짐
}

export function setHapticOn(on: boolean) {
  write(HAPTIC_KEY, on ? '1' : '0');
}

// 자동 로그아웃(유휴 분). 0 = 끔(기본). 허용값만.
const IDLE_KEY = 'fp4_idle_min';
const IDLE_ALLOWED = [0, 10, 30, 60];
export function getIdleMinutes(): number {
  const v = Number(read(IDLE_KEY));
  return IDLE_ALLOWED.includes(v) ? v : 0;
}
export function setIdleMinutes(m: number) {
  write(IDLE_KEY, String(IDLE_ALLOWED.includes(m) ? m : 0));
}

export function subscribePrefs(cb: () => void) {
  if (typeof window === 'undefined') return () => {};
  const on = () => cb();
  window.addEventListener(EVT, on);
  return () => window.removeEventListener(EVT, on);
}
