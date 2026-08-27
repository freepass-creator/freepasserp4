'use client';

import type { EntityRecord } from '@/lib/intake/entities';
import { canonProductType, type Audience } from '@/lib/domain/product';
import { Badge, FS } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { productTypeStyle } from '@/components/ui/badges';
import {
  badgeTip, badgeSpecs, type BadgeSpec, LOWER_BADGE_KEYS, LOWER_BADGE_KEYS_MOBILE,
} from '@/components/product-card-badges';

export function CardKind({ p }: { p: EntityRecord }) {
  const productType = canonProductType(p.product_type) || String(p.product_type || '');
  if (!productType) return null;
  const style = productTypeStyle(productType);
  return <Badge tone={style.tone} variant={style.variant} title={badgeTip('pt', productType)}>{productType}</Badge>;
}

/**
 * ★**뱃지는 언제나 «이름 바로 뒤»에 붙는다**(사장님 2026-08-23 「뱃지가 어떤 건 우측정렬 어떤 건 차종 뒤에 붙고 ·
 *   중구난방인데 규격 통일 좀」).
 *
 *   전에는 부르는 쪽마다 자리를 정했다 — 웹 행은 별도 칸에 우측정렬(`align='end'`),
 *   모바일 행은 차명 옆(`align='start'`). 같은 뱃지가 화면마다 다른 데 서니 눈이 매번 다시 찾는다.
 *   **기본을 «이름 뒤(start)»로 못 박는다** — 뱃지는 그 차를 설명하는 말이라 이름에 붙어 있어야 한다.
 *   표(엑셀보기)처럼 «칸이 정해진 자리»만 `align="end"` 를 명시해서 쓴다.
 */
export function CardRailBadges({ p, audience = 'agent', dense, align = 'start' }: {
  p: EntityRecord;
  audience?: Audience;
  dense?: boolean;
  align?: 'start' | 'end';
}) {
  /*
   * 차례는 product-card-badges 가 정한다 — 여기서 따로 적으면 또 갈린다(전에 세 곳이 각각 적어 어긋났다).
   * 목록 행은 **하단 뱃지** 규격이라 심사가 맨 앞이고, 모바일에서는 심사만 남는다.
   */
  const mobile = useIsMobile();
  const order = mobile ? LOWER_BADGE_KEYS_MOBILE : LOWER_BADGE_KEYS;
  const byKey = new Map(badgeSpecs(p, false, false, audience).map((spec) => [spec.key, spec]));
  const specs = order.map((key) => byKey.get(key)).filter(Boolean) as BadgeSpec[];
  if (!specs.length) return null;
  return (
    <div style={{
      display: 'flex', flexWrap: 'nowrap', gap: 4,
      justifyContent: align === 'start' ? 'flex-start' : 'flex-end', alignItems: 'center',
      flex: '0 0 auto', overflow: 'hidden', maxWidth: dense ? 200 : 280,
    }}>
      {specs.map((spec) => (
        <Badge
          key={spec.key}
          tone={spec.tone}
          variant={spec.variant || 'line'}
          pulse={spec.pulse}
          size={FS.sub}
          title={badgeTip(spec.key, spec.label)}
        >{spec.label}</Badge>
      ))}
    </div>
  );
}
