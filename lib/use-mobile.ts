'use client';
import { useSyncExternalStore } from 'react';

// 모바일 여부 — 2열→1열, 상단바→하단바 등 반응형 스위치. 웹·모바일 양립.
// useSyncExternalStore: 첫 렌더에서 실제 폭을 동기 확정 → 마운트 후 setState 재렌더로 인한
// 데스크톱→모바일 레이아웃 점프/깜빡임(FOUC) 제거. 서버 스냅샷=데스크톱 가정.
function subscribe(cb: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}

export function useIsMobile(bp = 760): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== 'undefined' ? window.innerWidth < bp : false),
    () => false,
  );
}
