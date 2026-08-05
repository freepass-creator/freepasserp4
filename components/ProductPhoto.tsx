'use client';

import { useEffect, useState, type CSSProperties, type ImgHTMLAttributes } from 'react';
import { C, FS, FW, R } from '@/components/ui';

type PlaceholderProps = {
  compact?: boolean;
  label?: string;
  style?: CSSProperties;
};

/** 상품찾기(CarFront) 아이콘을 공용 마스코트로 쓰는 차량 사진 빈 상태. */
export function ProductPhotoPlaceholder({ compact = false, label = '사진 준비중', style }: PlaceholderProps) {
  return (
    <span
      role="img"
      aria-label={label}
      style={{
        ...style,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: R * 2,
        padding: R * 2,
        boxSizing: 'border-box',
        overflow: 'hidden',
        background: C.placeholder,
        color: C.faint,
      }}
    >
      <img
        src="/icon.svg"
        alt=""
        aria-hidden
        draggable={false}
        style={{
          display: 'block',
          width: compact ? '44%' : 'min(24%, 112px)',
          maxHeight: compact ? '68%' : '112px',
          objectFit: 'contain',
          opacity: compact ? 0.72 : 0.82,
        }}
      />
      {!compact && (
        <span style={{ fontSize: FS.sub, fontWeight: FW.meta, lineHeight: 1 }}>{label}</span>
      )}
    </span>
  );
}

type ProductPhotoImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & {
  src?: string | null;
  compactPlaceholder?: boolean;
  placeholderLabel?: string;
  fallbackStyle?: CSSProperties;
};

/** URL이 비었거나 실제 이미지 로드가 실패해도 브라우저의 깨진 이미지 표시를 노출하지 않는다. */
export function ProductPhotoImage({
  src,
  compactPlaceholder = false,
  placeholderLabel,
  fallbackStyle,
  style,
  alt = '',
  ...imageProps
}: ProductPhotoImageProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <ProductPhotoPlaceholder
        compact={compactPlaceholder}
        label={placeholderLabel}
        style={{ ...style, ...fallbackStyle }}
      />
    );
  }

  return (
    <img
      {...imageProps}
      src={src}
      alt={alt}
      style={style}
      onError={() => setFailed(true)}
    />
  );
}
