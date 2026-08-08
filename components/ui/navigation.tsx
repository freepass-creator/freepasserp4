'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, List } from 'lucide-react';
import { useIsMobile } from '@/lib/use-mobile';
import { Btn, IconBtn } from './buttons';
import { C, SH } from './tokens';

export function NavBack({
  kind = 'history',
  onClick,
  showLabel = false,
}: {
  kind?: 'history' | 'list';
  onClick?: () => void;
  /** 모바일도 아이콘+텍스트(업무 swap 독 등). 기본=모바일 아이콘만. */
  showLabel?: boolean;
}) {
  const router = useRouter();
  const mobile = useIsMobile();
  const go = () => {
    if (kind === 'list') {
      onClick?.();
      return;
    }
    if (onClick) {
      onClick();
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/');
  };
  const label = kind === 'list' ? '목록' : '이전';
  const icon = kind === 'list'
    ? <List size={mobile ? 18 : 16} strokeWidth={2.25} aria-hidden />
    : <ChevronLeft size={mobile ? 18 : 16} strokeWidth={2.25} aria-hidden />;
  // 목록(list)은 모바일서 항상 아이콘+라벨(호출부 backShowLabel 의존 제거 → 전 페이지 자동 통일).
  // 이전(history)은 범용 back이라 아이콘only 유지(showLabel 주면 라벨).
  if (mobile && !showLabel && kind !== 'list') {
    return <IconBtn haptic="back" title={label} onClick={go}>{icon}</IconBtn>;
  }
  return (
    <Btn variant="ghost" size="sm" title={label} haptic="back" onClick={go}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {icon}
        {label}
      </span>
    </Btn>
  );
}

export function BottomNav({
  actions,
  maxWidth = 1480,
  padX = 20,
  backKind = 'history',
  onBack,
  embedded,
  zIndex = 45,
  backShowLabel = false,
}: {
  actions?: React.ReactNode;
  maxWidth?: number;
  padX?: number;
  backKind?: 'history' | 'list';
  onBack?: () => void;
  embedded?: boolean;
  zIndex?: number;
  /** 모바일 목록/이전에도 텍스트 라벨(swap 독). */
  backShowLabel?: boolean;
}) {
  const mobile = useIsMobile();
  React.useEffect(() => {
    if (embedded) return;
    const el = document.querySelector('.fp-main-pad') as HTMLElement | null;
    if (el) document.documentElement.style.setProperty('--sbw', `${Math.max(0, el.offsetWidth - el.clientWidth)}px`);
  }, [embedded]);
  const row: React.CSSProperties = mobile || embedded
    ? {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 'var(--fp-bar-h)',
        boxSizing: 'border-box',
        padding: '0 var(--fp-bar-pad-x)',
        width: '100%',
      }
    : {
        maxWidth,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 'var(--fp-bar-h)',
        boxSizing: 'border-box',
        padding: `0 ${padX}px`,
      };
  const inner = (
    <div style={row}>
      <NavBack kind={backKind} onClick={onBack} showLabel={backShowLabel} />
      {actions != null && (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          {actions}
        </div>
      )}
    </div>
  );
  if (embedded) return inner;
  return (
    <div style={{
      position: 'fixed',
      left: 0,
      right: 0,
      bottom: 'var(--fp-tabbar-h, 0px)',
      zIndex,
      boxSizing: 'border-box',
      paddingRight: 'var(--sbw, 0px)',
      background: C.taupeBg,
      borderTop: `1px solid ${C.line}`,
      boxShadow: SH.dock,
      paddingBottom: 'var(--fp-dock-safe, env(safe-area-inset-bottom))',
    }}>
      {inner}
    </div>
  );
}
