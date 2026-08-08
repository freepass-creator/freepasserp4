'use client';
import { useEffect, useState } from 'react';
import { History, MessageCircle } from 'lucide-react';
import type { EntityRecord } from '@/lib/intake/entities';
import { listRecent, subscribeInterest } from '@/lib/product-interest';
import { useInquiredCodes } from '@/lib/inquiry-marks';
import { C, R, ICON, SH, ctrlH } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';

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

export function ProductStateMarks({ p, size = ICON.md, onPhoto = false, compact = false }: {
  p: EntityRecord;
  size?: number;
  /** 사진 위 — 반투명 판(별표와 같은 문법). 아니면 솔리드. */
  onPhoto?: boolean;
  compact?: boolean;
}) {
  const mobile = useIsMobile();
  const code = String(p.product_code || p._key || '');
  const inquired = useInquiredCodes().has(code);
  const recent = useRecentCodes().has(code);
  // 아무 상태도 아니면 자리 자체를 만들지 않는다 — «회색 비활성 아이콘»을 늘어놓지 않는다.
  if (!code || (!inquired && !recent)) return null;

  // ★치수·모양은 **별표(FavHeart)와 같은 계산**을 쓴다. 별표는 둥근 사각(R)인데 여기만 원이면
  //   같은 줄에서 규격이 갈린다 — 표시와 토글은 «누를 수 있느냐»로만 달라야 한다.
  const h = mobile ? ctrlH(true) : compact ? ctrlH(false, 'sm') : ctrlH(false);

  /**
   * 둘 다 «켜진» 표시다 — 뜬 것 자체가 그 상태라는 뜻이므로 흐리게 그리지 않는다
   * (2026-08-08 지적: 봤으면 봤다고 보여야 한다). 다른 건 무게뿐이다.
   *   문의중  브랜드색 + 옅은 후광 — 지금 살아 있는 딜
   *   봤음    또렷한 잉크색 + 선택 배경 — 사실의 기록
   */
  const mark = (key: string, title: string, Icon: typeof History, kind: 'inq' | 'seen') => (
    <span
      key={key}
      title={title}
      aria-label={title}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        height: h, width: h, borderRadius: R, flex: '0 0 auto', boxSizing: 'border-box',
        border: `1px solid ${kind === 'inq' ? C.brand : onPhoto ? `color-mix(in srgb, ${C.inverse} 70%, transparent)` : C.line}`,
        background: onPhoto
          ? `color-mix(in srgb, ${C.inverse} 72%, transparent)`
          : (kind === 'inq' ? C.selected : C.head),
        color: kind === 'inq' ? C.brand : C.ink,
        boxShadow: kind === 'inq'
          ? `0 0 0 3px color-mix(in srgb, ${C.brand} 20%, transparent)`
          : (onPhoto ? SH.cardRest : undefined),
        backdropFilter: onPhoto ? 'blur(6px)' : undefined,
        WebkitBackdropFilter: onPhoto ? 'blur(6px)' : undefined,
        pointerEvents: 'none', // 표시일 뿐 — 누르는 건 별표 하나
      }}
    >
      <Icon size={size} strokeWidth={2.4} />
    </span>
  );

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {inquired ? mark('inq', '문의중 — 이 차로 대화가 오갔습니다', MessageCircle, 'inq') : null}
      {recent ? mark('recent', '본 매물', History, 'seen') : null}
    </span>
  );
}
