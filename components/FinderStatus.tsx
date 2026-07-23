'use client';
import { PageStatus } from '@/components/PageStatus';
import { NAV_ICON } from '@/lib/tabbar';

/**
 * 홈 상단 상태 — 타이틀만("상품 찾기"). 상단바엔 건수 표기 안 함(사용자 결정).
 *   건수는 목록 상단 '총 N대'에만 노출.
 */
export function FinderStatus() {
  return <PageStatus icon={NAV_ICON.product} label="상품 찾기" />;
}
