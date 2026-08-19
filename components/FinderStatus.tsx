'use client';
import { PageStatus } from '@/components/PageStatus';
import { NAV_ICON, NAV_LABEL } from '@/lib/tabbar';

/**
 * 상품찾기 상단 건수 — PageStatus 「검색 M」자리.
 *   조건 없음: 상품찾기 1,234대
 *   조건 있음: 상품찾기 1,234대 · 검색 56대
 */
export function FinderStatus({
  total,
  found,
  searching,
}: {
  total?: number | null;
  found?: number | null;
  searching?: boolean;
}) {
  const ready = total != null;
  return (
    <PageStatus
      icon={NAV_ICON.product}
      label={NAV_LABEL.product}
      count={ready ? total : null}
      unit="대"
      secondaryLabel={ready && searching ? '검색' : undefined}
      secondaryCount={ready && searching ? found : undefined}
    />
  );
}
