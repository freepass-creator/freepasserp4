'use client';
import type { CSSProperties, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { NavBack, C } from '@/components/ui';
import { isTabRoute } from '@/lib/tabbar';
import { useIsMobile } from '@/lib/use-mobile';

/**
 * 모바일 하단 독 — 액션만.
 *   [이전(비스탭)] [grow 액션]
 * 검색·정렬·필터는 PageToolBar→BottomSheet (여기 아님).
 */
export const DOCK = {
  padX: 12,
  padY: 8,
  gap: 8,
} as const;

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: DOCK.gap,
  minWidth: 0,
  width: '100%',
  boxSizing: 'border-box',
};

const sideStyle: CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
};

export function MobileDockShell({
  children,
  className,
  zIndex = 45,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  zIndex?: number;
  ariaLabel?: string;
}) {
  return (
    <div
      className={className ? `fp-dock-bar ${className}` : 'fp-dock-bar'}
      aria-label={ariaLabel}
      style={{
        position: 'fixed', left: 0, right: 0,
        bottom: 'var(--fp-tabbar-h, 0px)',
        zIndex,
        boxSizing: 'border-box',
        padding: '0 var(--fp-bar-pad-x)',
        paddingBottom: 'var(--fp-dock-safe, env(safe-area-inset-bottom, 0px))',
        background: C.taupeBg,
        borderTop: `1px solid ${C.line}`,
        boxShadow: '0 -3px 14px rgba(15,23,42,0.07)',
      }}
    >
      <div style={{ height: 'var(--fp-bar-h)', boxSizing: 'border-box', display: 'flex', alignItems: 'center' }}>
        {children}
      </div>
    </div>
  );
}

export function MobileDockSlots({
  main,
  mid,
  end,
  leading,
}: {
  main: ReactNode;
  mid?: ReactNode;
  end?: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <div style={barStyle}>
      {leading}
      <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center' }}>
        {main}
      </div>
      {mid != null ? <div style={sideStyle}>{mid}</div> : null}
      {end != null ? <div style={sideStyle}>{end}</div> : null}
    </div>
  );
}

/** 목록 하단 독 = 이전 + 페이지 액션(등록·저장…). 정렬·필터 없음. */
export function MobileListDock({ actions }: { actions?: ReactNode }) {
  const mobile = useIsMobile();
  const path = usePathname();
  const onTabRoot = mobile && isTabRoute(path);
  if (onTabRoot && actions == null) return null;
  return (
    <MobileDockShell ariaLabel={onTabRoot ? '액션' : '이전 · 액션'} className="fp-list-dock">
      <MobileDockSlots
        leading={onTabRoot ? undefined : <NavBack kind="history" />}
        main={
          actions
            ? <div style={{ display: 'flex', gap: DOCK.gap, justifyContent: 'flex-end', width: '100%', minWidth: 0 }}>{actions}</div>
            : null
        }
      />
    </MobileDockShell>
  );
}

/** @deprecated BottomSheet FilterSheet 사용. 호환 별칭. */
export { FilterSheet as MobileFilterSheet } from '@/components/BottomSheet';
