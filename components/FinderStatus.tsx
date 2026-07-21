'use client';
import { PageStatus } from '@/components/PageStatus';
import { NAV_ICON } from '@/lib/tabbar';

/**
 * 홈 상단 상태 — PageStatus SSOT.
 *   기본: 상품 N대
 *   검색·필터 시: 상품 N대 · 검색 M대
 */
export function FinderStatus({
  total, matched, narrowed,
}: {
  total: number;
  matched: number;
  narrowed: boolean;
}) {
  return (
    <PageStatus
      icon={NAV_ICON.product}
      label="상품"
      count={total}
      unit="대"
      secondaryLabel={narrowed ? '검색' : undefined}
      secondaryCount={narrowed ? matched : undefined}
      secondaryUnit="대"
    />
  );
}
