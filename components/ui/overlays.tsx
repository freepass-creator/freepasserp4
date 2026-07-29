'use client';

import React from 'react';
import { useIsMobile } from '@/lib/use-mobile';
import { CloseBtn } from './close-btn';
import { C, FS, FW, R, SH, SCRIM } from './tokens';
import { useEnterExit } from './use-enter-exit';

const EXIT_MS = 220;

/* 공통 상세 드로어 — 모든 목록 상세가 이 하나 재사용. ↑↓ 이동 · URL 동기화 · ↗전체화면. */
export function Drawer({
  open = true,
  title, meta, onClose, children, footer, width = 560, onPrev, onNext, expandHref,
}: {
  /** false면 퇴장 애니 후 언마운트. 기본 true(조건부 렌더 호환). */
  open?: boolean;
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
  const { mounted, leaving } = useEnterExit(open, EXIT_MS);

  React.useEffect(() => {
    if (!mounted || leaving) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown' && onNext) { e.preventDefault(); onNext(); }
      else if (e.key === 'ArrowUp' && onPrev) { e.preventDefault(); onPrev(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, leaving, onClose, onPrev, onNext]);

  if (!mounted) return null;

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
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: SCRIM.light, zIndex: 90,
        display: 'flex', justifyContent: 'flex-end',
        opacity: leaving ? 0 : 1,
        transition: 'opacity .22s ease',
        animation: leaving ? undefined : 'scrimIn .22s ease',
        pointerEvents: leaving ? 'none' : 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: width, height: '100vh',
          background: C.taupeBg, boxShadow: SH.menu,
          display: 'flex', flexDirection: 'column',
          borderLeft: `1px solid ${C.line}`,
          animation: leaving ? 'drawerOut .22s ease forwards' : 'drawerIn .22s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: `1px solid ${C.line}`, background: C.head }}>
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <h2 style={{ fontSize: FS.title, fontWeight: FW.title, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h2>
            {meta && <span style={{ fontSize: FS.sub, color: C.mute }}>{meta}</span>}
          </div>
          <span style={{ flex: 1 }} />
          {(onPrev || onNext) && <div style={{ display: 'flex', gap: 4 }} title="↑/↓ 이전·다음">
            <button type="button" onClick={onPrev} disabled={!onPrev} style={navBtn}>↑</button>
            <button type="button" onClick={onNext} disabled={!onNext} style={navBtn}>↓</button>
          </div>}
          {expandHref && <a href={expandHref} title="전체화면" style={{ ...navBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>↗</a>}
          <CloseBtn onClick={onClose} style={{ border: 'none', background: 'none', boxShadow: 'none' }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>{children}</div>
        {footer && <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '11px 16px', borderTop: `1px solid ${C.line}`, background: C.bg, flexWrap: 'wrap' }}>{footer}</div>}
      </div>
    </div>
  );
}

/* 중앙 모달 — 확인/경고/단일 액션용. 모바일=슬라이드업 · 웹=페이드. */
export function Modal({
  open = true,
  title, meta, onClose, children, footer, width = 720,
}: {
  open?: boolean;
  title: React.ReactNode;
  meta?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  const mobile = useIsMobile();
  const { mounted, leaving } = useEnterExit(open, EXIT_MS);
  if (!mounted) return null;

  const panelAnim = mobile
    ? (leaving ? 'sheetDown .22s ease forwards' : 'sheetUp .22s ease')
    : (leaving ? 'modalOut .22s ease forwards' : 'modalIn .22s ease');

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: SCRIM.heavy, zIndex: 90,
        display: 'flex',
        alignItems: mobile ? 'flex-end' : 'flex-start',
        justifyContent: 'center',
        padding: mobile ? 0 : '6vh 16px',
        overflowY: mobile ? 'hidden' : 'auto',
        opacity: leaving ? 0 : 1,
        transition: 'opacity .22s ease',
        animation: leaving ? undefined : 'scrimIn .22s ease',
        pointerEvents: leaving ? 'none' : 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: mobile ? '100%' : width,
          minHeight: mobile ? '100dvh' : undefined,
          background: C.taupeBg,
          borderRadius: mobile ? 0 : R,
          boxShadow: mobile ? 'none' : SH.modal,
          overflow: 'hidden',
          border: mobile ? 'none' : `1px solid ${C.line}`,
          display: 'flex', flexDirection: 'column',
          animation: panelAnim,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '13px 18px', borderBottom: `1px solid ${C.line}`, background: C.head, position: mobile ? 'sticky' : undefined, top: 0, zIndex: 1 }}>
          <h2 style={{ fontSize: FS.title, fontWeight: FW.title }}>{title}</h2>
          {meta && <span style={{ fontSize: FS.sub, color: C.mute }}>{meta}</span>}
          <span style={{ flex: 1 }} />
          <CloseBtn onClick={onClose} style={{ border: 'none', background: 'none', boxShadow: 'none', color: C.faint, margin: '-10px -8px' }} />
        </div>
        <div style={{ padding: '16px 18px', flex: mobile ? 1 : undefined, overflowY: mobile ? 'auto' : undefined }}>{children}</div>
        {footer && <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 18px', borderTop: `1px solid ${C.line}`, background: C.bg, flexWrap: 'wrap', position: mobile ? 'sticky' : undefined, bottom: 0 }}>{footer}</div>}
      </div>
    </div>
  );
}
