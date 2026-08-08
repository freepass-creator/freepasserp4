'use client';
import { useEffect, useState } from 'react';
import { History, MessageCircle } from 'lucide-react';
import type { EntityRecord } from '@/lib/intake/entities';
import { listRecent, subscribeInterest } from '@/lib/product-interest';
import { useInquiredCodes } from '@/lib/inquiry-marks';
import { C, R, ICON, SH } from '@/components/ui';

/**
 * 매물 상태 표시 — **읽기 전용**. 별표(관심) 옆에 선다.
 *
 * 관심은 «누르는 것»(별표)이고, 최근·문의는 «표시»다(2026-08-08 사장님).
 * 그래서 여기 것들은 절대 누를 수 없다 — 누를 수 있는 게 셋이 나란히 있으면
 * 무엇이 토글이고 무엇이 상태인지 매번 헷갈린다.
 *
 *   문의중  말풍선 + 옅은 후광 — 이 차로 이미 이야기가 오갔다(가장 중요한 신호라 강조)
 *   최근    시계 — 방금 본 차
 */
function useRecentCodes(): Set<string> {
  const [codes, setCodes] = useState<Set<string>>(new Set());
  useEffect(() => {
    const refresh = () => setCodes(new Set(listRecent().map((x) => x.code)));
    refresh();
    return subscribeInterest(refresh);
  }, []);
  return codes;
}

export function ProductStateMarks({ p, onPhoto = false, size = ICON.sm }: {
  p: EntityRecord;
  /** 사진 위 — 반투명 원반(하트와 같은 문법). 아니면 옅은 칩. */
  onPhoto?: boolean;
  size?: number;
}) {
  const code = String(p.product_code || p._key || '');
  const inquired = useInquiredCodes().has(code);
  const recent = useRecentCodes().has(code);
  if (!code || (!inquired && !recent)) return null;

  const disc = (key: string, title: string, Icon: typeof History, glow: boolean) => {
    const box = onPhoto ? Math.round(size * 1.9) : Math.round(size * 1.7);
    return (
      <span
        key={key}
        title={title}
        aria-label={title}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: box, height: box, borderRadius: '50%', flex: '0 0 auto',
          background: onPhoto ? `color-mix(in srgb, ${C.inverse} 62%, transparent)` : C.head,
          border: `1px solid ${glow ? C.brand : onPhoto ? `color-mix(in srgb, ${C.inverse} 65%, transparent)` : C.line}`,
          color: glow ? C.brand : C.mute,
          // «후광» — 문의중만. 상태 표시가 셋 다 튀면 아무것도 안 튄다.
          boxShadow: glow ? `0 0 0 3px color-mix(in srgb, ${C.brand} 22%, transparent)` : onPhoto ? SH.cardRest : undefined,
          backdropFilter: onPhoto ? 'blur(6px)' : undefined,
          WebkitBackdropFilter: onPhoto ? 'blur(6px)' : undefined,
          pointerEvents: 'none', // 표시일 뿐 — 누르는 건 별표 하나
        }}
      >
        <Icon size={size} strokeWidth={2.2} />
      </span>
    );
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: R }}>
      {inquired ? disc('inq', '문의중 — 이 차로 대화가 오갔습니다', MessageCircle, true) : null}
      {recent ? disc('recent', '최근 본 매물', History, false) : null}
    </span>
  );
}
