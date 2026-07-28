'use client';

import React from 'react';
import { C, R } from './tokens';

type DropzoneVariant = 'photo' | 'file' | 'sign' | 'copy';

/** dashed 존 SSOT — 1.5px · idle=C.line/C.head · active=C.brand/C.selected · radius R. */
export function Dropzone({
  variant = 'file',
  active = false,
  onClick,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
  style,
  className,
  title,
  disabled,
}: {
  variant?: DropzoneVariant;
  /** drag/강조 상태 — 테두리·배경 brand/selected. */
  active?: boolean;
  onClick?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  title?: string;
  disabled?: boolean;
}) {
  const idleBg = variant === 'copy' ? C.taupeBg : C.head;
  const pad = variant === 'sign' || variant === 'copy' ? 0 : '16px 12px';
  const s: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: pad,
    border: `1.5px dashed ${active ? C.brand : C.line}`,
    borderRadius: R,
    background: active ? C.selected : idleBg,
    boxSizing: 'border-box',
    cursor: onClick ? (disabled ? 'not-allowed' : 'pointer') : undefined,
    opacity: disabled ? 0.5 : undefined,
    transition: 'background .12s, border-color .12s',
    ...style,
  };
  const interactive = onClick != null;
  const cls = className ? `fp-press ${className}` : interactive ? 'fp-press' : className;
  if (interactive) {
    return (
      <button
        type="button"
        className={cls}
        title={title}
        aria-label={title}
        disabled={disabled}
        onClick={onClick}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{ ...s, width: '100%', font: 'inherit', color: 'inherit', textAlign: 'inherit' }}
      >
        {children}
      </button>
    );
  }
  return (
    <div
      className={cls}
      title={title}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={s}
    >
      {children}
    </div>
  );
}
