'use client';

import React from 'react';
import { useIsMobile } from '@/lib/use-mobile';
import { C, FW, R, ctrlFs, ctrlH, SH } from './tokens';

export function Btn({ children, mobileIcon, onClick, variant = 'solid', size = 'md', disabled, href, style, full, type = 'button', className, title, 'aria-label': ariaLabel, 'aria-pressed': ariaPressed, 'data-active': dataActive }: {
  children: React.ReactNode;
  /** 모바일 표면 액션을 아이콘 전용으로 축약한다. 웹은 children 텍스트를 유지한다. */
  mobileIcon?: React.ReactNode;
  onClick?: () => void;
  variant?: 'solid' | 'ghost' | 'danger' | 'bare';
  size?: 'sm' | 'md';
  disabled?: boolean;
  href?: string;
  style?: React.CSSProperties;
  full?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  'data-active'?: string;
}) {
  const mobile = useIsMobile();
  const h = ctrlH(mobile, size);
  const fs = ctrlFs(mobile, size);
  const bare = variant === 'bare';
  const iconOnly = mobile && mobileIcon != null;
  const pad = mobile ? '0 18px' : (size === 'sm' ? '0 11px' : '0 14px');
  const s: React.CSSProperties = bare ? {
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
    border: 'none', background: 'none', boxShadow: 'none', padding: 0, margin: 0,
    borderRadius: 0, font: 'inherit', color: 'inherit',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    pointerEvents: disabled ? 'none' : 'auto',
    ...(full ? { width: '100%' } : null),
    ...style,
  } : {
    height: h, boxSizing: 'border-box', padding: pad, borderRadius: R,
    fontWeight: FW.strong, fontSize: fs, letterSpacing: '-0.01em', lineHeight: 1,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
    border: `1px solid ${disabled ? C.line : variant === 'solid' ? C.brand : variant === 'danger' ? 'var(--red-border)' : C.line}`,
    background: variant === 'solid' ? (disabled ? C.line : C.brand) : C.taupeBg,
    color: variant === 'solid' ? C.taupeBg : variant === 'danger' ? 'var(--red-text)' : C.ink,
    boxShadow: disabled ? 'none' : SH.cardRest,
    textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap',
    transition: 'filter .12s ease, box-shadow .12s ease',
    pointerEvents: disabled ? 'none' : 'auto',
    ...(iconOnly ? { width: h, minWidth: h, padding: 0, flex: `0 0 ${h}px` } : full ? { width: '100%' } : null),
    ...style,
  };
  const cls = className ? `fp-press ${className}` : 'fp-press';
  const childLabel = typeof children === 'string' || typeof children === 'number' ? String(children) : undefined;
  const accessibleLabel = ariaLabel || title || (iconOnly ? childLabel : undefined);
  const a11y = {
    ...(title ? { title } : null),
    ...(accessibleLabel ? { 'aria-label': accessibleLabel } : null),
    ...(ariaPressed != null ? { 'aria-pressed': ariaPressed } : null),
    ...(dataActive != null ? { 'data-active': dataActive } : null),
  };
  return href
    ? <a href={href} data-clickable="" onClick={onClick} className={cls} style={s} {...a11y}>{iconOnly ? mobileIcon : children}</a>
    : <button type={type} onClick={onClick} disabled={disabled} className={cls} style={s} {...a11y}>{iconOnly ? mobileIcon : children}</button>;
}

/** 정사각 아이콘 버튼 — CTRL.md. style로 셸·특수 배치 1:1 오버라이드 가능. */
export function IconBtn({ children, onClick, onPointerDown, title, active, disabled, style, className }: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  title?: string;
  active?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
}) {
  const mobile = useIsMobile();
  const h = ctrlH(mobile);
  return (
    <button type="button" className={className ? `fp-press ${className}` : 'fp-press'} onClick={onClick} onPointerDown={onPointerDown} disabled={disabled} title={title} aria-label={title} aria-pressed={active || undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        height: h, width: h, boxSizing: 'border-box', padding: 0, borderRadius: R,
        border: `1px solid ${active ? C.brand : C.line}`,
        background: active ? C.brand : C.taupeBg, color: active ? C.taupeBg : C.mute,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        ...style,
      }}>
      {children}
    </button>
  );
}

/** 아이콘 세그먼트 — CTRL.md. showLabel=true면 아이콘+텍스트(업무 swap 등). */
export function IconSeg<T extends string>({ value, onChange, options, showLabel = false }: {
  value: T;
  onChange: (k: T) => void;
  options: { key: T; label: string; icon: React.ReactNode }[];
  /** 텍스트 라벨 노출(공간 여유 있는 전환 세그먼트용). 기본=아이콘만. */
  showLabel?: boolean;
}) {
  const mobile = useIsMobile();
  const h = ctrlH(mobile);
  const fs = ctrlFs(mobile);
  return (
    <div style={{ display: 'flex', border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden', width: showLabel ? '100%' : undefined }}>
      {options.map((o, i) => {
        const on = value === o.key;
        return (
          <button key={o.key} type="button" className="fp-press" onClick={() => onChange(o.key)} title={o.label} aria-label={o.label} aria-pressed={on}
            style={{
              height: h,
              ...(showLabel
                ? { flex: '1 1 0', minWidth: 0, padding: '0 10px', gap: 5 }
                : { width: h, padding: 0 }),
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', border: 'none', borderLeft: i ? `1px solid ${C.line}` : 'none',
              background: on ? C.brand : C.taupeBg, color: on ? C.taupeBg : C.mute,
              fontSize: fs, fontWeight: FW.strong, whiteSpace: 'nowrap',
            }}>
            {o.icon}
            {showLabel ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
