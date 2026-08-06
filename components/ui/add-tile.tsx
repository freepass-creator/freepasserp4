'use client';

import React from 'react';
import { Plus } from 'lucide-react';
import { Dropzone } from './dropzone';
import { useIsMobile } from '@/lib/use-mobile';
import { C, FS, FW, ICON } from './tokens';

/** 점선 추가 타일 — 박스 자체가 버튼(내부 IconBtn 금지). Dropzone photo SSOT 공유.
 *  모바일: 컨트롤 규격상 '사진 추가'는 결정적 액션 → 작은 4/3 타일 대신 풀폭 아이콘+텍스트 버튼. */
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
  const mobile = useIsMobile();
  const a11y = title || label || '추가';
  if (mobile) {
    return (
      <Dropzone
        variant="photo"
        active
        title={a11y}
        disabled={disabled}
        onClick={onClick}
        style={{
          width: '100%',
          minHeight: 48,
          flexDirection: 'row',
          gap: 6,
          padding: '0 14px',
          borderColor: C.brand,
          color: C.brand,
          ...style,
        }}
      >
        <Plus size={ICON.lg} strokeWidth={2.25} aria-hidden />
        <span style={{ fontSize: FS.body, fontWeight: FW.strong, color: C.brand }}>{label || '사진 추가'}</span>
      </Dropzone>
    );
  }
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
      <Plus size={ICON.lg} strokeWidth={2.25} aria-hidden />
      {label ? <span style={{ fontSize: FS.micro, fontWeight: FW.strong, color: C.brand }}>{label}</span> : null}
    </Dropzone>
  );
}
