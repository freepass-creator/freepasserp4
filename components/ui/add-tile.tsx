'use client';

import React from 'react';
import { Plus } from 'lucide-react';
import { Dropzone } from './dropzone';
import { C, FS, FW } from './tokens';

/** 점선 추가 타일 — 박스 자체가 버튼(내부 IconBtn 금지). Dropzone photo SSOT 공유. */
export function AddTile({
  aspect = '4/3',
  onClick,
  label,
  disabled,
  title,
  style,
}: {
  aspect?: string;
  onClick?: () => void;
  label?: string;
  disabled?: boolean;
  title?: string;
  style?: React.CSSProperties;
}) {
  const a11y = title || label || '추가';
  return (
    <Dropzone
      variant="photo"
      active
      title={a11y}
      disabled={disabled}
      onClick={onClick}
      style={{
        aspectRatio: aspect,
        width: '100%',
        padding: 0,
        borderColor: C.brand,
        color: C.brand,
        ...style,
      }}
    >
      <Plus size={18} strokeWidth={2.25} aria-hidden />
      {label ? <span style={{ fontSize: FS.micro, fontWeight: FW.strong, color: C.brand }}>{label}</span> : null}
    </Dropzone>
  );
}
