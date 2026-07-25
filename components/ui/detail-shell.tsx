'use client';

import React from 'react';
import { useAppBar } from '@/lib/appbar';
import { useIsMobile } from '@/lib/use-mobile';
import { BottomNav, NavBack } from './navigation';
import { C, FS, FW } from './tokens';

export function DetailShell({
  title,
  meta,
  onBack,
  actions,
  fixed,
  maxWidth = 1000,
  children,
}: {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  onBack?: () => void;
  actions?: React.ReactNode;
  fixed?: boolean;
  maxWidth?: number;
  children: React.ReactNode;
}) {
  const mobile = useIsMobile();
  useAppBar(fixed ? null : { back: onBack, backKind: 'history', title, actions }, [fixed, mobile, onBack, actions, title]);
  if (!fixed) {
    return (
      <div style={{ maxWidth, margin: '0 auto', padding: mobile ? '10px 12px 80px' : '14px 16px 48px' }}>
        {title != null && <h1 style={{ fontSize: FS.page, fontWeight: FW.title, letterSpacing: '-0.02em', margin: '2px 0 14px' }}>{title}</h1>}
        {children}
      </div>
    );
  }
  const back = onBack ? <NavBack kind="list" onClick={onBack} /> : null;
  return (
    <div style={{ position: 'fixed', top: 'var(--topbar-h)', left: 0, right: 0, bottom: 0, zIndex: 60, background: 'var(--bg-page)', overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div style={{ maxWidth, margin: '0 auto', padding: mobile ? '0 12px 76px' : '0 16px 48px' }}>
        {mobile ? (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '12px 2px 4px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: FS.page, fontWeight: FW.title, letterSpacing: '-0.02em' }}>{title}</span>
            {meta && <span style={{ fontSize: FS.sub, color: C.faint }}>{meta}</span>}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', flexWrap: 'wrap', position: 'sticky', top: 0, background: 'var(--bg-page)', zIndex: 10 }}>
            {back}
            <span style={{ fontSize: FS.page, fontWeight: FW.title, letterSpacing: '-0.02em', marginLeft: 6 }}>{title}</span>
            {meta && <span style={{ fontSize: FS.sub, color: C.faint }}>{meta}</span>}
            <span style={{ flex: 1 }} />
            {actions}
          </div>
        )}
        {children}
      </div>
      {mobile && onBack && (
        <div style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 70,
          background: C.taupeBg,
          borderTop: `1px solid ${C.line}`,
          boxShadow: '0 -2px 12px rgba(15,23,42,0.06)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          <BottomNav embedded backKind="list" onBack={onBack} actions={actions} />
        </div>
      )}
    </div>
  );
}
