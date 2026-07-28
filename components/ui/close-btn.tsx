'use client';

import React from 'react';
import { X } from 'lucide-react';
import { IconBtn } from './buttons';

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
    <IconBtn onClick={onClick} onPointerDown={onPointerDown} title={title} style={style} className={className}>
      <X size={18} strokeWidth={2.25} aria-hidden />
    </IconBtn>
  );
}
