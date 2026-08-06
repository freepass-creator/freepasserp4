'use client';

import { CarFront } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type ImgHTMLAttributes } from 'react';
import { C, FS, FW, R } from '@/components/ui';

type PlaceholderProps = {
  compact?: boolean;
  label?: string;
  style?: CSSProperties;
};

/**
 * 상품찾기(CarFront) 아이콘을 공용 마스코트로 쓰는 차량 사진 빈 상태.
 *
 * 글리프를 «직접» 그린다 — `/icon.svg` 를 쓰면 그 파일에 박힌 `rect fill=#1B2A4A rx=96`
 * 배경판까지 따라와 사진 자리에 짙은 라운드 사각형이 얹힌다. 그 배경판은 파비콘·PWA
 * 아이콘에는 필요하므로(app/layout.tsx · app/manifest.ts · scripts/build-icons.mjs)
 * 파일에서 뺄 수 없다. 여기서만 배경 없는 글리프를 쓴다.
 *
 * 색은 부모의 `color`(C.faint)를 currentColor 로 물려받아 톤이 저절로 맞는다.
 */
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
      <CarFront
        aria-hidden
        strokeWidth={1.5}
        style={{
          display: 'block',
          width: compact ? '44%' : 'min(24%, 112px)',
          height: 'auto',
          maxHeight: compact ? '68%' : '112px',
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
