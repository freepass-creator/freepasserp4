'use client';
import { memo } from 'react';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { C, R } from '@/components/ui';
import {
  CardTitle, CardSpecs, CardPerkLine, CardThumb, CardRailBadges,
  PricePeekRoot, PriceAmounts, PeriodChips, PeriodRange, OptionChips,
} from '@/components/product-card-atoms';
import { ProductMoreMenu } from '@/components/ProductMoreMenu';

/**
 * 상세카드 SSOT
 *
 * 웹 4×2:
 *   1 차명              | 뱃지
 *   2 옵션/옵션미입력   | (빈 슬롯)
 *   3 스펙(+차번)       | 기간·대여료·보증금
 *   4 조건              | 기간칩
 *
 * 모바일 피드 4줄(세로 · 썸네일 좌):
 *   1 차종
 *   2 옵션
 *   3 차번·연식·연료·주행·배기
 *   4 가격(+범위) · 뱃지 · 우대조건
 */
export const ProductRowCard = memo(function ProductRowCard({ p, focusMonth }: { p: EntityRecord; focusMonth?: number }) {
  const mobile = useIsMobile();
  return mobile
    ? <MobileRow p={p} focusMonth={focusMonth} />
    : <WebRow p={p} focusMonth={focusMonth} />;
});

function Cell({ right, children }: { right?: boolean; children?: ReactNode }) {
  return (
    <div style={{
      minWidth: 0,
      display: 'flex', alignItems: 'center',
      justifyContent: right ? 'flex-end' : 'flex-start',
      minHeight: 22,
    }}>
      {children ?? null}
    </div>
  );
}

/** 웹 — 조건 | 기간칩 */
function PerkPeriodRow({ p }: { p: EntityRecord }) {
  return (
    <div style={{
      gridColumn: '1 / -1',
      display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start',
      gap: 8, minWidth: 0, width: '100%',
    }}>
      <div style={{ flex: '1 1 96px', minWidth: 0 }}>
        <CardPerkLine p={p} dense={false} />
      </div>
      <div style={{ flex: '2 1 168px', minWidth: 0, maxWidth: '100%' }}>
        <PeriodChips align="end" clamp />
      </div>
    </div>
  );
}

function WebRow({ p, focusMonth }: { p: EntityRecord; focusMonth?: number }) {
  const href = `/m/${encodeURIComponent(String(p.product_code))}`;
  return (
    <Link href={href} className="fp-card" style={{
      display: 'flex', gap: 14, alignItems: 'stretch',
      borderRadius: R,
      padding: '10px 12px',
      border: `1px solid ${C.line}`,
      boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
      textDecoration: 'none', color: 'inherit',
    } satisfies CSSProperties}>
      <CardThumb p={p} w={88} marks={false} heart />

      <PricePeekRoot p={p} focusMonth={focusMonth} style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gridTemplateRows: 'repeat(4, auto)',
        columnGap: 16,
        rowGap: 6,
        alignItems: 'center',
        flex: '1 1 auto',
        minWidth: 0,
        alignSelf: 'stretch',
      }}>
        <Cell>
          <div style={{ position: 'relative', minWidth: 0, width: '100%' }}>
            <CardTitle p={p} size={15} />
          </div>
        </Cell>
        <Cell right><CardRailBadges p={p} /></Cell>

        <Cell><OptionChips p={p} clamp /></Cell>
        <Cell right />

        <Cell><CardSpecs p={p} /></Cell>
        <Cell right><PriceAmounts align="end" /></Cell>

        <PerkPeriodRow p={p} />
      </PricePeekRoot>
    </Link>
  );
}

/**
 * 모바일 4줄 — 기간칩 없음.
 * 4행은 가격이 주인공, 범위·뱃지·우대는 같은 슬롯에 묶음.
 */
function MobileRow({ p, focusMonth }: { p: EntityRecord; focusMonth?: number }) {
  const href = `/m/${encodeURIComponent(String(p.product_code))}`;
  return (
    <Link href={href} className="fp-card fp-card-row" style={{
      display: 'flex', gap: 12, alignItems: 'stretch',
      borderRadius: 0,
      padding: '10px 12px',
      borderBottom: `1px solid ${C.line2}`,
      textDecoration: 'none', color: 'inherit',
    } satisfies CSSProperties}>
      {/* 모바일 목록 = 찜 없음(썸네일 버튼은 상세에서만). 웹 가로카드는 heart 유지. */}
      <CardThumb p={p} w={56} marks={false} />

      <PricePeekRoot p={p} focusMonth={focusMonth} style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        flex: '1 1 auto',
        minWidth: 0,
        alignSelf: 'stretch',
        justifyContent: 'center',
      }}>
        {/* 1 뱃지 레일(맨위) + ⋯ 메뉴 — ⋯는 차명 안 따라다니고 카드 최상단 우측에 고정 */}
        <div style={{ position: 'relative', minWidth: 0, paddingRight: 22 }}>
          <CardRailBadges p={p} align="start" />
          <ProductMoreMenu p={p} />
        </div>

        {/* 2 차명 */}
        <CardTitle p={p} size={15} narrow />

        {/* 3 스펙 (모바일 카드 간결화 — 옵션 OptionChips 제거) */}
        <CardSpecs p={p} />

        {/* 4 가격 · [최단]~[최장] 기간 · 우대(혜택) */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 4,
          minWidth: 0, width: '100%',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            minWidth: 0, width: '100%', overflow: 'hidden',
          }}>
            <div style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
              <PriceAmounts align="start" />
            </div>
            <PeriodRange />
          </div>
          <CardPerkLine p={p} inline />
        </div>
      </PricePeekRoot>
    </Link>
  );
}
