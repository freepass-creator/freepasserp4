'use client';
import { useEffect, useState, type MouseEvent } from 'react';
import { Star } from 'lucide-react';
import { C, R, IconBtn, ctrlH, SH } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { isFav, toggleFav, subscribeInterest, type InterestSnap } from '@/lib/product-interest';
import type { EntityRecord } from '@/lib/intake/entities';
import { toast } from '@/components/Toaster';

/** 찜 — 상세 공용(+웹 가로카드 thumb). 모바일 목록 썸네일에는 안 씀. stopPropagation으로 카드 Link와 충돌 없음. */
export function FavHeart({ p, size = 16, onPhoto = false, compact = false }: {
  p: EntityRecord | InterestSnap; size?: number; onPhoto?: boolean; compact?: boolean;
}) {
  const mobile = useIsMobile();
  const code = 'product_code' in p || '_key' in p
    ? String((p as EntityRecord).product_code || (p as EntityRecord)._key || '')
    : (p as InterestSnap).code;
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(isFav(code));
    return subscribeInterest(() => setOn(isFav(code)));
  }, [code]);

  // 터치 ≥ ctrlH. compact/onPhoto도 모바일은 md(40) 유지(타깃 축소 금지).
  const h = mobile
    ? ctrlH(true)
    : compact ? 24 : onPhoto ? 30 : 32;
  const click = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = toggleFav(p);
    setOn(next);
    toast(next ? '관심에 추가' : '관심 해제', next ? 'ok' : 'info');
  };

  // 사진 위 = 연한 반투명 원반(사진 훼손 최소). 그 외 = 솔리드 버튼.
  const bg = onPhoto
    ? (on ? `color-mix(in srgb, ${C.inverse} 82%, transparent)` : `color-mix(in srgb, ${C.inverse} 55%, transparent)`)
    : (on ? C.selected : C.taupeBg);
  const border = onPhoto
    ? (on ? C.brand : `color-mix(in srgb, ${C.inverse} 65%, transparent)`)
    : (on ? C.brand : C.line);

  return (
    <IconBtn
      title={on ? '관심 매물 (해제)' : '관심'}
      active={on}
      haptic="select"
      onClick={click}
      style={{
        height: h, width: h, borderRadius: R,
        border: `1px solid ${border}`,
        background: bg,
        color: on ? C.brand : C.mute,
        boxShadow: onPhoto ? SH.cardRest : undefined,
        backdropFilter: onPhoto ? 'blur(6px)' : undefined,
        WebkitBackdropFilter: onPhoto ? 'blur(6px)' : undefined,
      }}
    >
      <Star size={size} strokeWidth={2.2} fill={on ? C.brand : 'none'} />
    </IconBtn>
  );
}
