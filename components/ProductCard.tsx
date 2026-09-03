'use client';
import { memo } from 'react';
import Link from 'next/link';
import { type EntityRecord } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { C, R_CARD, SH, SCRIM } from '@/components/ui';
import {
  CardTitle, CardSpecs, CardThumb, SignalMarks, CardPerkLine, PeriodChips,
  OptionChips,
  PricePeekRoot, PriceAmounts,
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
      {/* 간단보기의 즉시 판단 신호는 사진 하단 우측: 출고상태·상품구분만. 심사는 조건 줄 첫 자리로 분리한다. */}
      <div style={{ position: 'relative', flex: '0 0 auto' }}>
        <CardThumb p={p} audience={audience} fill />
        <div aria-hidden style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: '30%',
          background: `linear-gradient(to top, ${SCRIM.heavy}, transparent)`, pointerEvents: 'none',
        }} />
        <div style={{ position: 'absolute', right: 8, bottom: 7, zIndex: 1, minWidth: 0 }}>
          <SignalMarks p={p} audience={audience} keys={['st', 'pt']} dense onPhoto />
        </div>
      </div>

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
          <PeriodChips align="start" clamp />
          <CardPerkLine p={p} dense withCredit />
        </PricePeekRoot>
      </div>
    </Link>
  );
});
