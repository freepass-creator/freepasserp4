'use client';

import type { EntityRecord } from '@/lib/intake/entities';
import { canonProductType, type Audience } from '@/lib/domain/product';
import { Badge, FS } from '@/components/ui';
import { productTypeStyle } from '@/components/ui/badges';
import {
  badgeTip, badgeSpecs, type BadgeSpec,
} from '@/components/product-card-badges';

export function CardKind({ p }: { p: EntityRecord }) {
  const productType = canonProductType(p.product_type) || String(p.product_type || '');
  if (!productType) return null;
  const style = productTypeStyle(productType);
  return <Badge tone={style.tone} variant={style.variant} title={badgeTip('pt', productType)}>{productType}</Badge>;
}

export function CardRailBadges({ p, audience = 'agent', dense, align = 'end' }: {
  p: EntityRecord;
  audience?: Audience;
  dense?: boolean;
  align?: 'start' | 'end';
}) {
  const order = ['st', 'pt', 'cd'] as const;
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
          shape={spec.shape}
          pulse={spec.pulse}
          size={FS.sub}
          title={badgeTip(spec.key, spec.label)}
        >{spec.label}</Badge>
      ))}
    </div>
  );
}
