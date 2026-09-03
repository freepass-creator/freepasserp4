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
        {/* ★출고가능 · 픽업구독 · 무심사 = **아이콘 + 글자**(사장님 2026-08-30 「웹화면에서도 …
            카드목록에 아이콘+텍스트 형태로」 · 2026-08-28 「박스 뱃지 쓰지 말고 … 모든 곳에서 그렇게 하자」).

            ⚠ 간단카드만 그 전환에서 빠져 있었다 — 다른 카드는 SignalMarks(아이콘+글자)를 타는데
              여기만 «사진 위 박스 뱃지»(CardThumb coreBadges)라는 다른 길이었다. 길을 하나로 합친다.
            ★사진에서 «내려» 본문 첫 줄로 세운다. 아이콘+글자는 바탕이 사진이면 못 읽는다 —
              그래서 사진 위에 두려면 결국 상자를 씌워야 하고, 그러면 다시 박스 뱃지가 된다.
              읽는 차례도 이게 맞다: 이름 바로 위에서 «지금 살 수 있나»가 먼저 걸러진다. */}
        <SignalMarks p={p} audience={audience} keys={['st', 'pt', 'cd']} dense />
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
