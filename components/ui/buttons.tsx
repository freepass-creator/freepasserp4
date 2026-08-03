'use client';

import React from 'react';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic as hapticApi } from '@/lib/haptics';
import { C, FW, R, ctrlFs, ctrlH, SH } from './tokens';

export type BtnHaptic = false | 'tap' | 'nav' | 'select' | 'back' | 'impact' | 'success' | 'error';

function fireHaptic(kind: BtnHaptic) {
  if (!kind) return;
  hapticApi[kind]();
}

/** 결정적 액션의 아이콘+텍스트 조합 SSOT. 선택칩·아이콘-only 툴에는 사용하지 않는다. */
export function ButtonLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
      {icon}
      <span>{children}</span>
    </span>
  );
}

export function Btn({ children, mobileIcon, onClick, variant = 'solid', size = 'md', disabled, href, style, full, type = 'button', className, title, haptic = 'tap', 'aria-label': ariaLabel, 'aria-pressed': ariaPressed, 'data-active': dataActive }: {
  children: React.ReactNode;
  /**
   * 모바일 아이콘 only — 화이트리스트(뒤로·닫기·메뉴·검색·필터·정렬·공유·더보기·새로고침)만.
   * 그 외 결정적 액션은 children 라벨(아이콘+텍스트) 필수. MOBILE_REDESIGN.md 컨트롤 규격.
   */
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
  /** 내장 햅틱. false=끄기. 핸들러 안 수동 haptic.* 금지(이중발동). */
  haptic?: BtnHaptic;
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
  const handleClick = onClick
    ? () => { fireHaptic(haptic); onClick(); }
    : (haptic ? () => { fireHaptic(haptic); } : undefined);
  return href
    ? <a href={href} data-clickable="" onClick={handleClick} className={cls} style={s} {...a11y}>{iconOnly ? mobileIcon : children}</a>
    : <button type={type} onClick={handleClick} disabled={disabled} className={cls} style={s} {...a11y}>{iconOnly ? mobileIcon : children}</button>;
}

/** 정사각 아이콘 버튼 — CTRL.md. style로 셸·특수 배치 1:1 오버라이드 가능. */
export function IconBtn({ children, onClick, onPointerDown, title, active, disabled, style, className, haptic = 'tap' }: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  title?: string;
  active?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
  /** 내장 햅틱. false=끄기. 핸들러 안 수동 haptic.* 금지(이중발동). */
  haptic?: BtnHaptic;
}) {
  const mobile = useIsMobile();
  const h = ctrlH(mobile);
  return (
    <button
      type="button"
      className={className ? `fp-press ${className}` : 'fp-press'}
      onClick={(e) => { fireHaptic(haptic); onClick?.(e); }}
      onPointerDown={onPointerDown}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active || undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        height: h, width: h, boxSizing: 'border-box', padding: 0, borderRadius: R,
        border: `1px solid ${active ? C.brand : C.line}`,
        background: active ? C.brand : C.taupeBg, color: active ? C.taupeBg : C.mute,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
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
    // 컨테이너 테두리 1px×2가 더해져 총 h+2 가 되면 옆에 선 Btn(h)과 위·아래로 1px씩 어긋난다.
    //  높이를 h로 고정하고 border를 그 안으로 넣는다.
    <div style={{ display: 'flex', height: h, boxSizing: 'border-box', border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden', width: showLabel ? '100%' : undefined }}>
      {options.map((o, i) => {
        const on = value === o.key;
        return (
          <button key={o.key} type="button" className="fp-press" onClick={() => onChange(o.key)} title={o.label} aria-label={o.label} aria-pressed={on}
            style={{
              height: '100%',
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
