'use client';

import React from 'react';
import { useIsMobile } from '@/lib/use-mobile';
import { C, FS, FW, R } from './tokens';

/* 공통 상세 드로어 — 모든 목록 상세가 이 하나 재사용. ↑↓ 이동 · URL 동기화 · ↗전체화면. */
export function Drawer({ title, meta, onClose, children, footer, width = 560, onPrev, onNext, expandHref }: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  onPrev?: () => void;
  onNext?: () => void;
  expandHref?: string;
}) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown' && onNext) { e.preventDefault(); onNext(); }
      else if (e.key === 'ArrowUp' && onPrev) { e.preventDefault(); onPrev(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  const navBtn: React.CSSProperties = {
    border: `1px solid ${C.line}`,
    background: C.taupeBg,
    borderRadius: R,
    width: 40,
    height: 40,
    cursor: 'pointer',
    color: C.mute,
    fontSize: FS.body,
    lineHeight: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.32)', zIndex: 90, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: width, height: '100vh', background: C.taupeBg, boxShadow: '-10px 0 32px rgba(0,0,0,0.16)', display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${C.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: `1px solid ${C.line}`, background: C.head }}>
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <h2 style={{ fontSize: FS.title, fontWeight: FW.title, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h2>
            {meta && <span style={{ fontSize: FS.sub, color: C.mute }}>{meta}</span>}
          </div>
          <span style={{ flex: 1 }} />
          {(onPrev || onNext) && <div style={{ display: 'flex', gap: 4 }} title="↑/↓ 이전·다음">
            <button onClick={onPrev} disabled={!onPrev} style={navBtn}>↑</button>
            <button onClick={onNext} disabled={!onNext} style={navBtn}>↓</button>
          </div>}
          {expandHref && <a href={expandHref} title="전체화면" style={{ ...navBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>↗</a>}
          <button onClick={onClose} style={{ ...navBtn, fontSize: 18, border: 'none', background: 'none' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>{children}</div>
        {footer && <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '11px 16px', borderTop: `1px solid ${C.line}`, background: C.bg, flexWrap: 'wrap' }}>{footer}</div>}
      </div>
    </div>
  );
}

/* 중앙 모달 — 확인/경고/단일 액션용. */
export function Modal({ title, meta, onClose, children, footer, width = 720 }: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  const mobile = useIsMobile();
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 90, display: 'flex', alignItems: mobile ? 'stretch' : 'flex-start', justifyContent: 'center', padding: mobile ? 0 : '6vh 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: mobile ? '100%' : width, minHeight: mobile ? '100dvh' : undefined, background: C.taupeBg, borderRadius: mobile ? 0 : R, boxShadow: mobile ? 'none' : '0 16px 48px rgba(0,0,0,0.22)', overflow: 'hidden', border: mobile ? 'none' : `1px solid ${C.line}`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '13px 18px', borderBottom: `1px solid ${C.line}`, background: C.head, position: mobile ? 'sticky' : undefined, top: 0, zIndex: 1 }}>
          <h2 style={{ fontSize: FS.title, fontWeight: FW.title }}>{title}</h2>
          {meta && <span style={{ fontSize: FS.sub, color: C.mute }}>{meta}</span>}
          <span style={{ flex: 1 }} />
          <button onClick={onClose} aria-label="닫기" style={{ border: 'none', background: 'none', fontSize: 19, cursor: 'pointer', color: C.faint, lineHeight: 1, padding: 10, margin: '-10px -8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
        <div style={{ padding: '16px 18px', flex: mobile ? 1 : undefined, overflowY: mobile ? 'auto' : undefined }}>{children}</div>
        {footer && <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 18px', borderTop: `1px solid ${C.line}`, background: C.bg, flexWrap: 'wrap', position: mobile ? 'sticky' : undefined, bottom: 0 }}>{footer}</div>}
      </div>
    </div>
  );
}
