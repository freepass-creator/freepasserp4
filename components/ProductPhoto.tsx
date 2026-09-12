'use client';

import NextImage from 'next/image';
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
  /**
   * **크기·포맷을 줄여서 받는다** — 부모가 «자리를 이미 쥐고 있을 때»만 켠다.
   *
   * 사장님 2026-09-09 「기존 페이지도 … **그것도 엄청 느리잖아 사진 때문에.
   * 기존 페이지에 현재 거처럼 빠르게 해줄 수 있나?**」
   *
   * ★★**가게(`ShopPhoto`)가 쓰는 그 방법 그대로다** — 화면 폭에 맞는 크기만 내려받고
   *   (`sizes` → srcset), AVIF/WebP 로 바꿔 받는다. 업무동 목록은 원본을 그대로 받아
   *   CSS 로만 줄여 그리고 있었다(한 장 1MB 넘는 사진이 카드 수만큼).
   * ⚠ **부모가 `position:relative` + 크기/비율을 쥐고 있어야 한다**(`fill` 로 채우므로).
   *   자리가 없는 곳에서 켜면 사진이 **높이 0** 으로 사라진다 — 그래서 기본은 꺼짐이다.
   * ⚠ 최적화가 «안 되는» 주소가 있다 — 외부 절대주소는 Next 화이트리스트에 걸린다.
   *   그런 주소는 조용히 원본 `<img>` 로 떨어진다(안 보이는 것보다 느린 편이 낫다).
   *   ★우리 사진은 대부분 `/api/img?url=…` 프록시라 «동일 오리진 상대주소»다 — 다 태워진다.
   */
  optimize?: boolean;
  /** 이 사진이 화면에서 «몇 px» 로 그려지나 — 빠뜨리면 Next 가 제일 큰 것을 보낸다. */
  sizes?: string;
};

/** URL이 비었거나 실제 이미지 로드가 실패해도 브라우저의 깨진 이미지 표시를 노출하지 않는다. */
export function ProductPhotoImage({
  src,
  compactPlaceholder = false,
  placeholderLabel,
  fallbackStyle,
  style,
  alt = '',
  optimize = false,
  sizes,
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

  /*
   * ★**화면 밖 사진은 스크롤할 때 받는다** — 목록은 카드가 수십 장이라, 안 그러면
   *   첫 화면을 그리는 동안 브라우저가 «보이지도 않는» 사진 수십 장을 같이 받는다.
   * ⚠ 부르는 쪽이 `loading` 을 준 경우는 그 뜻을 존중한다(첫 장을 먼저 받는 자리가 있다).
   */
  const load = imageProps.loading ?? 'lazy';
  const decode = imageProps.decoding ?? 'async';

  /* 동일 오리진 상대주소만 최적화한다 — 외부 절대주소는 Next 화이트리스트에 걸려 «안 뜨는» 꼴이 된다. */
  if (optimize && /^\/(?!\/)/.test(src)) {
    return (
      <NextImage
        src={src}
        alt={alt}
        fill
        sizes={sizes || '(max-width: 760px) 50vw, 320px'}
        style={style}
        loading={load}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <img
      {...imageProps}
      src={src}
      alt={alt}
      style={style}
      loading={load}
      decoding={decode}
      onError={() => setFailed(true)}
    />
  );
}
