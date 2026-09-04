'use client';
import { memo } from 'react';
import Link from 'next/link';
import { type EntityRecord } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { C, R_CARD, SH } from '@/components/ui';
import {
  CardTitle, CardSpecs, CardThumb, SignalMarks,
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
      {/* 1 — 사진만. CORE 셋은 아래 본문 첫 줄이 든다. */}
      <CardThumb p={p} audience={audience} fill marks={false} />

      <div style={{
        padding: mobile ? '10px 12px' : '10px 12px',
        display: 'flex', flexDirection: 'column', gap, flex: 1, minWidth: 0,
      }}>
        {/* ★출고가능 · 픽업구독 · 무심사 = **아이콘 + 글자**(사장님 2026-08-30 · 2026-08-28 「박스 뱃지 쓰지 말고
            아이콘 텍스트로, 모든 곳에서」). 사진 위에 두면 바탕 때문에 안 읽혀서 상자를 씌우게 되므로 본문에 둔다.
            ★자리는 **이름 «바로 뒤»**다(사장님 2026-08-23 「뱃지가 어떤 건 우측정렬 어떤 건 차종 뒤에 붙고,
            중구난방인데 규격 통일 좀」 → product-card-badge-view 가 「이름 뒤」로 못 박았다).
            한때 이름 «위»에 뒀다가 되돌렸다 — 뱃지는 그 차를 설명하는 말이라 이름보다 먼저 오면 안 된다. */}
        <CardTitle p={p} />
        <SignalMarks p={p} audience={audience} keys={['st', 'pt', 'cd']} dense />
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
