'use client';

import React from 'react';
import { X } from 'lucide-react';
import { IconBtn } from './buttons';
import { ICON } from './tokens';

/** 닫기(×) 1규격 — lucide X. */
export function CloseBtn({
  onClick,
  title = '닫기',
  style,
  className,
  onPointerDown,
}: {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  style?: React.CSSProperties;
  className?: string;
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <IconBtn haptic="back" onClick={onClick} onPointerDown={onPointerDown} title={title} style={style} className={className}>
      <X size={ICON.lg} strokeWidth={2.25} aria-hidden />
    </IconBtn>
  );
}
