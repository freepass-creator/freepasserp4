'use client';
import { memo } from 'react';
import Link from 'next/link';
import { type EntityRecord } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { C, R_CARD, SH } from '@/components/ui';
import {
  CardTitle, CardSpecs, CardThumb,
  OptionChips,
  PricePeekRoot, PriceAmounts, PeriodPerkBand,
} from '@/components/product-card-atoms';
import { type Audience } from '@/lib/domain/product';

/**
 * 간단카드 SSOT — 웹 격자 훑기
 *
 *   1 Thumb  2:1
 *   2 Title
 *   3 Options
 *   4 Specs
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
        <CardTitle p={p} />
        <OptionChips p={p} clamp />
        <CardSpecs p={p} audience={audience} dense listing />

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
