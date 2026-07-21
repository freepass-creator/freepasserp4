'use client';
// 햅틱 — 모바일 네이티브 촉감. navigator.vibrate 래퍼(미지원·SSR·데스크톱 무해 no-op).
//   설정(fp4_haptic) 꺼짐이면 no-op.
import { getHapticOn } from '@/lib/prefs';

function buzz(pattern: number | number[]): void {
  if (typeof window === 'undefined') return;
  if (!getHapticOn()) return;
  try {
    const nav = window.navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
    nav.vibrate?.(pattern);
  } catch { /* 미지원 무시 */ }
}

export const haptic = {
  tap: () => buzz(9),          // 일반 탭(버튼·행)
  select: () => buzz(14),      // 선택·토글·초기화
  nav: () => buzz(6),          // 화면 전환(탭바·이동)
  back: () => buzz(7),         // 뒤로·시트 닫기(버튼·제스처)
  success: () => buzz([12, 30, 18]), // 적용·완료
  error: () => buzz([28, 40, 28]),
  impact: () => buzz(20),      // 강조(삭제·확정)
};
