'use client';

import React from 'react';
import { C, FS, R } from './tokens';

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      marginTop: 12,
      padding: 20,
      textAlign: 'center',
      color: C.faint,
      border: `1px solid ${C.line}`,
      borderRadius: R,
      background: C.taupeBg,
      fontSize: FS.body,
    }}>
      {children}
    </div>
  );
}

export function Loading({
  label = '불러오는 중…',
  minHeight = '100%',
}: {
  label?: React.ReactNode;
  minHeight?: string | number;
}) {
  return (
    <div style={{
      minHeight,
      flex: 1,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      padding: '40px 16px',
      boxSizing: 'border-box',
    }}>
      <span
        aria-label="로딩"
        role="status"
        style={{
          width: 26,
          height: 26,
          border: `3px solid ${C.line}`,
          borderTopColor: C.brand,
          borderRadius: '50%',
          animation: 'fp-spin 0.7s linear infinite',
        }}
      />
      {label != null && label !== '' && <span style={{ fontSize: FS.sub, color: C.faint }}>{label}</span>}
    </div>
  );
}

export function CenterNote({
  children,
  minHeight = '100%',
}: {
  children: React.ReactNode;
  minHeight?: string | number;
}) {
  return (
    <div style={{
      minHeight,
      flex: 1,
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: C.faint,
      fontSize: FS.body,
      textAlign: 'center',
      padding: '40px 16px',
      boxSizing: 'border-box',
    }}>
      {children}
    </div>
  );
}

export type MessageVariant = 'info' | 'success' | 'warning' | 'danger';

export function Message({
  variant = 'info',
  children,
}: {
  variant?: MessageVariant;
  children: React.ReactNode;
}) {
  const palette: Record<MessageVariant, { bg: string; border: string; color: string }> = {
    info: { bg: 'var(--blue-bg)', border: 'var(--blue-border)', color: 'var(--blue-text)' },
    success: { bg: 'var(--green-bg)', border: 'var(--green-border)', color: 'var(--green-text)' },
    warning: { bg: 'var(--orange-bg)', border: 'var(--orange-border)', color: 'var(--orange-text)' },
    danger: { bg: 'var(--red-bg)', border: 'var(--red-border)', color: 'var(--red-text)' },
  };
  const p = palette[variant];
  return (
    <div style={{
      marginTop: 12,
      padding: '12px 14px',
      borderRadius: R,
      border: `1px solid ${p.border}`,
      background: p.bg,
      color: p.color,
      fontSize: FS.body,
      lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}
