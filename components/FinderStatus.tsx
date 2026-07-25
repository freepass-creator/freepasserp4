'use client';
import { PageStatus } from '@/components/PageStatus';
import { NAV_ICON, NAV_LABEL } from '@/lib/tabbar';

/**
 * 홈 상단 상태 — NAV_LABEL.product + 필터 결과 건수. 다른 목록과 동일하게 상단바에 노출.
 */
export function FinderStatus({ count }: { count?: number | null }) {
  return <PageStatus icon={NAV_ICON.product} label={NAV_LABEL.product} count={count} unit="대" />;
}
