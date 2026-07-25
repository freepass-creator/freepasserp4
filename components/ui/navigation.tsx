'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, List } from 'lucide-react';
import { haptic } from '@/lib/haptics';
import { useIsMobile } from '@/lib/use-mobile';
import { Btn } from './buttons';
import { C } from './tokens';

export function NavBack({
  kind = 'history',
  onClick,
}: {
  kind?: 'history' | 'list';
  onClick?: () => void;
}) {
  const router = useRouter();
  const mobile = useIsMobile();
  const go = () => {
    haptic.back();
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
  return (
    <Btn variant="ghost" onClick={go}>
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
}: {
  actions?: React.ReactNode;
  maxWidth?: number;
  padX?: number;
  backKind?: 'history' | 'list';
  onBack?: () => void;
  embedded?: boolean;
  zIndex?: number;
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
      <NavBack kind={backKind} onClick={onBack} />
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
      boxShadow: '0 -3px 14px rgba(15,23,42,0.07)',
      paddingBottom: 'var(--fp-dock-safe, env(safe-area-inset-bottom))',
    }}>
      {inner}
    </div>
  );
}
