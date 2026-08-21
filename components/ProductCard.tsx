'use client';
import { memo } from 'react';
import Link from 'next/link';
import { type EntityRecord } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { C, R_CARD, SH } from '@/components/ui';
import {
  CardTitle, CardSpecs, CardThumb,
  PricePeekRoot, PriceAmounts, PeriodPerkBand,
} from '@/components/product-card-atoms';
import { ProductMoreMenu } from '@/components/ProductMoreMenu';
import { type Audience } from '@/lib/domain/product';

/**
 * 간단카드 SSOT — 웹 격자 훑기
 *
 * ⚠ **옵션 칩은 넣지 않는다**(사장님 2026-08-20 「간단보기에서는 옵션 칩 뺐었는데」).
 *   간단카드는 «훑는» 카드다 — 차·연식·주행·연료·요금까지가 훑는 값이고,
 *   옵션은 그중 하나를 골라 들어간 다음에 보는 값이라 상세가 든다.
 *   칩이 붙으면 카드마다 높이가 들쭉날쭉해져 격자가 어긋나는 문제도 있었다.
 *
 *   1 Thumb  2:1
 *   2 Title
 *   3 Specs
 *   5 Amounts     앵커 1개(필터/최저)
 *   6·7 웹=기간칩+조건 / 모바일=조건만(기간 나열 금지)
 *
 * 모바일 파인더 피드는 ProductRowCard 4줄 사용.
 */
export const ProductCard = memo(function ProductCard({ p, audience = 'agent', href, focusMonth }: {
  p: EntityRecord; audience?: Audience; href?: string;
  focusMonth?: number;
}) {
  const mobile = useIsMobile();
  const to = href ?? `/m/${encodeURIComponent(String(p.product_code || p._key))}`;
  const gap = mobile ? 5 : 6; // = ProductRowCard rowGap SSOT

  return (
    <Link href={to} onClick={() => haptic.nav()}
      className="fp-card"
      style={{
        display: 'flex', flexDirection: 'column', borderRadius: R_CARD, overflow: 'hidden',
        textDecoration: 'none', color: 'inherit',
        border: `1px solid ${C.line}`,
        boxShadow: SH.cardRest,
      }}>
      {/* 1 — CORE 뱃지 3 = thumb 우하 */}
      <CardThumb p={p} audience={audience} fill marks={false} coreBadges />

      <div style={{
        padding: mobile ? '10px 12px' : '10px 12px',
        display: 'flex', flexDirection: 'column', gap, flex: 1, minWidth: 0,
      }}>
        <div style={{ position: 'relative', minWidth: 0, paddingRight: audience !== 'customer' && mobile ? 22 : 0 }}>
          <CardTitle p={p} />
          {audience !== 'customer' && <ProductMoreMenu p={p} />}
        </div>
        <CardSpecs p={p} audience={audience} dense listing />

        {/* 기간칩 + 조건줄 — 2026-08-19 305caf4(전자계약 재편) 커밋에서 통째로 빠져 있던 것을 되살림.
            카드에서 «기간별로 얼마인지»가 사라지면 앵커 한 값만 남아 훑는 뜻이 없다
            (사장님 2026-08-20 「대여료는 기간별로 다 보여줘야지, 어디갔어」). focusMonth 도 같이 끊겨 있었다. */}
        <PricePeekRoot p={p} focusMonth={focusMonth} style={{
          display: 'flex', flexDirection: 'column', alignItems: 'stretch',
          gap, minWidth: 0, width: '100%', flex: '0 0 auto',
        }}>
          <PriceAmounts align="start" />
          <PeriodPerkBand p={p} dense gap={gap} />
        </PricePeekRoot>
      </div>
    </Link>
  );
});
