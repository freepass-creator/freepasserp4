'use client';

import React from 'react';
import { useIsMobile } from '@/lib/use-mobile';
import { C, FS, FW, NUM, ctrlH, ctrlPadX } from './tokens';

// 패널 헤더 — CTRL.md 높이(웹32/모바일40).
// minHeight 잠금 = flex 기본 min-height:auto 가 자식 Btn/칩에 밀려 헤더가 커지는 것 방지(견적기 옆 상담패널 정렬).
export function PaneHead({ title, count, right }: {
  title: React.ReactNode;
  count?: React.ReactNode;
  right?: React.ReactNode;
}) {
  const mobile = useIsMobile();
  const h = ctrlH(mobile);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      height: h, minHeight: h, maxHeight: h, flex: `0 0 ${h}px`,
      padding: `0 ${ctrlPadX(mobile)}px`,
      borderBottom: `1px solid ${C.line}`, background: C.taupeBg,
      boxSizing: 'border-box', overflow: 'hidden',
    }}>
      <span style={{ fontSize: mobile ? FS.title : FS.body, fontWeight: FW.title, color: C.ink, whiteSpace: 'nowrap', letterSpacing: mobile ? '-0.01em' : 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
      {count != null && count !== '' && <span style={{ fontSize: mobile ? FS.sub : FS.cap, color: C.faint, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', flex: '0 0 auto' }}>{count}</span>}
      {right != null && <><span style={{ flex: 1, minWidth: 0 }} />{right}</>}
    </div>
  );
}

export function PaneBody({ children, pad = false }: { children: React.ReactNode; pad?: boolean }) {
  return (
    <div
      className="fp-pane-scroll"
      style={{
        flex: 1, overflowY: 'auto', minHeight: 0,
        ...(pad ? {
          padding: '12px', // 좌우 = 바·독·목록행과 동일(12) — 화면 간 좌측 정렬 일치
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxSizing: 'border-box',
        } : {}),
      }}
    >
      {children}
    </div>
  );
}

export function CardGrid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginTop: 18 }}>{children}</div>;
}

// 위·아래 분할 패널 — 드래그로 상하 비율 조정(계약패널 밑 첨부서류 등). storageKey로 비율 유지.
export function VSplit({ top, bottom, initial = 0.6, min = 0.15, max = 0.85, storageKey }: {
  top: React.ReactNode;
  bottom: React.ReactNode;
  initial?: number;
  /** 위 패널 최소 비율(기본 0.15). */
  min?: number;
  /** 위 패널 최대 비율(기본 0.85). 상담첨부 등 위칸 제한에 사용. */
  max?: number;
  storageKey?: string;
}) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const clamp = (n: number) => Math.min(hi, Math.max(lo, n));
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [ratio, setRatio] = React.useState(() => clamp(initial));
  const dragging = React.useRef(false);
  React.useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;
    const s = localStorage.getItem(storageKey);
    const n = s ? Number(s) : NaN;
    if (Number.isFinite(n)) setRatio(clamp(n));
  }, [storageKey, lo, hi]);
  React.useEffect(() => {
    const move = (cy: number) => {
      if (!dragging.current || !ref.current) return;
      const r = ref.current.getBoundingClientRect();
      setRatio(clamp((cy - r.top) / r.height));
    };
    const mm = (e: MouseEvent) => move(e.clientY);
    const tm = (e: TouchEvent) => { if (e.touches[0]) move(e.touches[0].clientY); };
    const up = () => {
      if (dragging.current && storageKey) localStorage.setItem(storageKey, String(ratio));
      dragging.current = false;
    };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', tm);
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', tm);
      window.removeEventListener('touchend', up);
    };
  }, [ratio, storageKey, lo, hi]);
  const start = (e: React.SyntheticEvent) => { dragging.current = true; e.preventDefault(); };
  const pane = (f: number): React.CSSProperties => ({ flex: `${f} 1 0`, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' });
  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={pane(ratio)}>{top}</div>
      <div onMouseDown={start} onTouchStart={start} style={{ flex: '0 0 9px', height: 9, cursor: 'row-resize', background: C.head, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }}>
        <div style={{ width: 34, height: 3, borderRadius: 999, background: C.line2 }} />
      </div>
      <div style={pane(1 - ratio)}>{bottom}</div>
    </div>
  );
}
