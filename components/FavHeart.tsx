'use client';
import { useEffect, useState, type MouseEvent } from 'react';
import { Star } from 'lucide-react';
import { haptic } from '@/lib/haptics';
import { C, R } from '@/components/ui';
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

  const h = compact
    ? (mobile ? 28 : 24)
    : onPhoto ? (mobile ? 34 : 30) : (mobile ? 40 : 32);
  const click = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    haptic.select();
    const next = toggleFav(p);
    setOn(next);
    toast(next ? '관심에 추가' : '관심 해제', next ? 'ok' : 'info');
  };

  // 사진 위 = 연한 반투명 원반(사진 훼손 최소). 그 외 = 솔리드 버튼.
  const bg = onPhoto
    ? (on ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.55)')
    : (on ? C.selected : C.taupeBg);
  const border = onPhoto
    ? (on ? C.brand : 'rgba(255,255,255,0.65)')
    : (on ? C.brand : C.line);

  return (
    <button type="button" className="fp-press" onClick={click} title={on ? '관심 매물 (해제)' : '관심'} aria-label={on ? '관심 해제' : '관심'} aria-pressed={on}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        height: h, width: h, boxSizing: 'border-box', padding: 0, borderRadius: R,
        border: `1px solid ${border}`,
        background: bg,
        color: on ? C.brand : (onPhoto ? 'rgba(55,65,81,0.85)' : C.mute),
        cursor: 'pointer',
        boxShadow: onPhoto ? '0 1px 3px rgba(15,23,42,0.18)' : undefined,
        backdropFilter: onPhoto ? 'blur(6px)' : undefined,
        WebkitBackdropFilter: onPhoto ? 'blur(6px)' : undefined,
      }}>
      <Star size={size} strokeWidth={on ? 2.2 : 2} fill={on ? C.brand : 'none'} />
    </button>
  );
}
