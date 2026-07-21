'use client';
import {
  createContext, createElement, useContext, useEffect, useState, useCallback,
  type ReactNode,
} from 'react';
import { useSyncExternalStore } from 'react';

/** SSR 힌트 — 쿠키 fp_m / CH. null = 모름 → 데스크톱 가정. */
const SsrMobileCtx = createContext<boolean | null>(null);

export function MobileBpProvider({
  ssrMobile,
  children,
}: {
  ssrMobile: boolean | null;
  children: ReactNode;
}) {
  return createElement(SsrMobileCtx.Provider, { value: ssrMobile }, children);
}

export const MOBILE_BP = 760;

function subscribe(cb: () => void) {
  if (typeof window === 'undefined') return () => {};
  const mq = window.matchMedia(`(max-width: ${MOBILE_BP - 1}px)`);
  const on = () => cb();
  mq.addEventListener('change', on);
  window.addEventListener('resize', on);
  return () => {
    mq.removeEventListener('change', on);
    window.removeEventListener('resize', on);
  };
}

function readWidthMobile(bp = MOBILE_BP): boolean {
  if (typeof window === 'undefined') return false;
  const tip = document.documentElement.dataset.fpM;
  if (bp === MOBILE_BP) {
    if (tip === '1') return true;
    if (tip === '0') return false;
  }
  return window.innerWidth < bp;
}

/**
 * 모바일 여부 — 웹·모바일 양립 스위치.
 * 마운트 전 = SSR 힌트만(서버·첫 클라 동일 → hydration 일치).
 * 마운트 후 = 실제 폭. 모바일 새로고침 웹격자 깜빡임은 MobileBoot pending이 막음.
 */
export function useIsMobile(bp = MOBILE_BP): boolean {
  const ssrHint = useContext(SsrMobileCtx);
  const getServer = useCallback(
    () => (ssrHint != null ? ssrHint : false),
    [ssrHint],
  );
  const live = useSyncExternalStore(
    subscribe,
    () => readWidthMobile(bp),
    getServer,
  );
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted ? live : getServer();
}

/** 실제 폭과 훅이 맞을 때만 pending 해제 — 하이드레이션 직후 웹 칸 깜빡임 방지 */
export function MobileBoot() {
  const mobile = useIsMobile();
  useEffect(() => {
    const actual = window.innerWidth < MOBILE_BP;
    try {
      document.documentElement.dataset.fpM = actual ? '1' : '0';
      document.cookie = `fp_m=${actual ? '1' : '0'};path=/;max-age=31536000;SameSite=Lax`;
    } catch { /* */ }
    if (mobile !== actual) return;
    // 페인트 한 프레임 뒤에 표시(아직 웹 DOM이면 한 프레임 더 숨김)
    const id = requestAnimationFrame(() => {
      document.documentElement.classList.remove('fp-pending-m');
    });
    return () => cancelAnimationFrame(id);
  }, [mobile]);
  return null;
}
