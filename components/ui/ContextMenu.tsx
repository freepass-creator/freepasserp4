'use client';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { C, R, FS, FW, ctrlH } from './tokens';
import { useIsMobile } from '@/lib/use-mobile';

export type CtxItem =
  | { divider: true }
  | { label: string; danger?: boolean; disabled?: boolean; onClick: () => void };

/** 웹 우클릭 메뉴 SSOT. 모바일에서는 열지 않음(롱프레스 네이티브와 충돌 방지). */
export function ContextMenu({ x, y, items, onClose }: {
  x: number; y: number; items: CtxItem[]; onClose: () => void;
}) {
  const mobile = useIsMobile();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth; const h = el.offsetHeight;
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - h - 8)),
    });
  }, [x, y, items]);

  useEffect(() => {
    if (mobile) { onClose(); return; }
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // 우클릭 오픈 직후 같은 이벤트에 닫히지 않게 한 틱 뒤 바인딩.
    const t = window.setTimeout(() => {
      window.addEventListener('scroll', close, true);
      window.addEventListener('resize', close);
      window.addEventListener('keydown', onKey);
      window.addEventListener('mousedown', onDown);
      window.addEventListener('contextmenu', close);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('contextmenu', close);
    };
  }, [onClose, mobile]);

  if (mobile || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{
        position: 'fixed', left: pos.left, top: pos.top, zIndex: 200,
        minWidth: 180, maxWidth: 260,
        background: C.taupeBg, border: `1px solid ${C.line}`, borderRadius: R,
        boxShadow: '0 10px 28px rgba(15,23,42,0.18)',
        padding: '4px 0', boxSizing: 'border-box',
      }}
    >
      {items.map((it, i) => {
        if ('divider' in it && it.divider) {
          return <div key={`d${i}`} role="separator" style={{ height: 1, background: C.line2, margin: '4px 0' }} />;
        }
        const item = it as Exclude<CtxItem, { divider: true }>;
        return (
          <button
            key={`i${i}`}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => { if (item.disabled) return; item.onClick(); onClose(); }}
            style={{
              display: 'flex', alignItems: 'center', width: '100%', boxSizing: 'border-box',
              height: ctrlH(mobile), padding: '0 14px', border: 'none', background: 'transparent',
              cursor: item.disabled ? 'default' : 'pointer',
              fontSize: FS.body, fontWeight: FW.meta, textAlign: 'left',
              color: item.disabled ? C.faint : item.danger ? C.danger : C.ink,
              opacity: item.disabled ? 0.5 : 1,
            }}
            onMouseEnter={(e) => { if (!item.disabled) e.currentTarget.style.background = C.hover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** 우클릭 좌표·대상 상태 헬퍼. */
export function useContextMenu<T>() {
  const [state, setState] = useState<{ x: number; y: number; data: T } | null>(null);
  const open = useCallback((e: React.MouseEvent, data: T) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY, data });
  }, []);
  const close = useCallback(() => setState(null), []);
  return { state, open, close };
}
