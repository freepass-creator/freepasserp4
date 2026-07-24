'use client';
import { PageStatus } from '@/components/PageStatus';
import { NAV_ICON } from '@/lib/tabbar';

/**
 * 홈 상단 상태 — "상품 찾기 N대"(현재 필터 결과 건수). 다른 목록 페이지와 동일하게 상단바에 건수 노출.
 */
export function FinderStatus({ count }: { count?: number | null }) {
  return <PageStatus icon={NAV_ICON.product} label="상품 찾기" count={count} unit="대" />;
}
