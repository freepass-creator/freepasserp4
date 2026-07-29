'use client';
import {
  createContext, createElement, useContext, useEffect, useState, useCallback,
  type ReactNode,
} from 'react';
import { useSyncExternalStore } from 'react';

/** SSR 힌트 — 쿠키 fp_m / CH. null = 모름 → 데스크톱 가정. */
const SsrMobileCtx = createContext<boolean | null>(null);

/**
 * 서버 힌트 + 클라이언트에서 실폭으로 보정.
 * 탭 이동 시 자식이 리마운트돼도 컨텍스트가 null/데스크톱에 고정되지 않게 함.
 */
export function MobileBpProvider({
  ssrMobile,
  children,
}: {
  ssrMobile: boolean | null;
  children: ReactNode;
}) {
  const [hint, setHint] = useState(ssrMobile);
  useEffect(() => { setHint(ssrMobile); }, [ssrMobile]);
  useEffect(() => {
    const sync = () => setHint(window.innerWidth < MOBILE_BP);
    sync();
    const mq = window.matchMedia(`(max-width: ${MOBILE_BP - 1}px)`);
    mq.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    return () => {
      mq.removeEventListener('change', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);
  return createElement(SsrMobileCtx.Provider, { value: hint }, children);
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
 * 훅 밖(effect·핸들러)에서 즉시 모바일 여부 — 부트스크립트가 세팅한 data-fp-m 우선(마운트 시점도 신뢰).
 * useIsMobile의 첫 렌더 SSR힌트가 데스크톱으로 어긋나는 타이밍 이슈를 피할 때 사용.
 */
export function isMobileViewport(bp = MOBILE_BP): boolean {
  return readWidthMobile(bp);
}

/**
 * 모바일 여부 — 웹·모바일 양립 스위치.
 * useSyncExternalStore만 사용(클라 즉시 실폭).
 * ⚠ mounted 게이트 금지 — 탭(문의·계약·재고) 이동마다 리마운트 시
 *   한 프레임 웹 격자(WorkPage)가 깜빡이던 원인.
 * 첫 로드 FOUC는 html.fp-pending-m + MobileBoot가 담당.
 */
export function useIsMobile(bp = MOBILE_BP): boolean {
  const ssrHint = useContext(SsrMobileCtx);
  const getServer = useCallback(
    () => (ssrHint != null ? ssrHint : false),
    [ssrHint],
  );
  return useSyncExternalStore(
    subscribe,
    () => readWidthMobile(bp),
    getServer,
  );
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
    const clear = () => document.documentElement.classList.remove('fp-pending-m');
    // 훅=실폭 일치(=교정 렌더 커밋 완료) 확인 후, 한 프레임 더 그린 뒤 해제.
    // 단일 rAF는 교정 뷰가 페인트되기 전 마스크가 벗겨져 SSR힌트(모바일 카드) 잔상이 새는 창이 있음 → 이중 rAF.
    let raf2 = 0;
    const id = requestAnimationFrame(() => {
      if (mobile === actual) raf2 = requestAnimationFrame(clear);
    });
    const t = window.setTimeout(clear, 320); // 불일치 고착 방지용 failsafe
    return () => { cancelAnimationFrame(id); if (raf2) cancelAnimationFrame(raf2); window.clearTimeout(t); };
  }, [mobile]);
  return null;
}
