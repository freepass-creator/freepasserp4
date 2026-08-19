'use client';
import { PageStatus } from '@/components/PageStatus';
import { NAV_ICON, NAV_LABEL } from '@/lib/tabbar';

/**
 * 상품찾기 상단 — 페이지명 + 총대수, 조건 있으면 「N대 중 M대」.
 */
export function FinderStatus({
  total,
  found,
}: {
  total?: number | null;
  found?: number | null;
}) {
  const ready = total != null;
  return (
    <PageStatus
      icon={NAV_ICON.product}
      label={NAV_LABEL.product}
      count={ready ? total : null}
      unit="대"
      found={ready && found != null && found !== total ? found : null}
    />
  );
}
