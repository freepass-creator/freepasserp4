'use client';
import { memo } from 'react';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { C, R, SH } from '@/components/ui';
import {
  CardTitle, CardSpecs, CardPerkLine, CardThumb, CardRailBadges,
  PricePeekRoot, PriceAmounts, PeriodChips, PeriodRange, OptionChips,
} from '@/components/product-card-atoms';

/**
 * 상세카드 SSOT
 *
 * 웹 4×2:
 *   1 차명              | 뱃지
 *   2 옵션/옵션미입력   | (빈 슬롯)
 *   3 스펙(+차번)       | 기간·대여료·보증금
 *   4 조건              | 기간칩
 *
 * 모바일 피드 4줄(세로 · 썸네일 좌) — 영업 스캔. 옵션·뱃지·연료/주행은 /m:
 *   1 차량명
 *   2 차량번호 · 연식
 *   3 대여료 · 보증금 · 최저~최대 운영기간
 *   4 우대조건
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
  const href = `/m/${encodeURIComponent(String(p.product_code || p._key))}`;
  return (
    <Link href={href} onClick={() => haptic.nav()} className="fp-card" style={{
      display: 'flex', gap: 14, alignItems: 'stretch',
      borderRadius: R,
      padding: '10px 12px',
      border: `1px solid ${C.line}`,
      boxShadow: SH.cardRest,
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
            <CardTitle p={p} />
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
 * 모바일 4줄 — 영업 스캔: 차명 / 차번·연식 / 대여·보증·기간범위 / 우대.
 * 출고·상품·심사·연료·주행·옵션 = /m.
 */
function MobileRow({ p, focusMonth }: { p: EntityRecord; focusMonth?: number }) {
  const href = `/m/${encodeURIComponent(String(p.product_code || p._key))}`;
  return (
    /* ★리듬은 당근 목록과 같다(사장님 2026-08-30 「상품카드목록은 느낌만 다듬고」) —
         **큰 썸네일 · 좌우 16 · 줄 사이 숨통**. 줄 구성(4줄)과 담는 내용은 그대로다.
         전에는 썸네일 56 · 여백 10/12 라 «표의 한 줄»처럼 빽빽했다. 폰에서 차를 «고르는» 화면은
         사진이 먼저 읽혀야 한다 — 56 은 무슨 차인지 분간이 안 되는 크기였다. */
    <Link href={href} onClick={() => haptic.nav()} className="fp-card fp-card-row" style={{
      display: 'flex', gap: 14, alignItems: 'stretch',
      borderRadius: 0,
      padding: '14px 16px',
      borderBottom: `1px solid ${C.line2}`,
      textDecoration: 'none', color: 'inherit',
    } satisfies CSSProperties}>
      {/* 모바일 목록 = 찜 없음(썸네일 버튼은 상세에서만). 웹 가로카드는 heart 유지. */}
      <CardThumb p={p} w={88} marks={false} />

      <PricePeekRoot p={p} focusMonth={focusMonth} style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        flex: '1 1 auto',
        minWidth: 0,
        alignSelf: 'stretch',
        justifyContent: 'center',
      }}>
        <CardTitle p={p} />

        {/* 2 차량번호 · 연식 */}
        <CardSpecs p={p} plateYear />

        {/* 3 대여료 · 보증금 · 최저~최대 운영기간
            PeriodRange 칩(h20) + 큰 금액 ascent로 행2↔3이 ~1px 넓어 보임 → 행 전체 -1 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, lineHeight: 1.2,
          minWidth: 0, width: '100%', overflow: 'hidden',
          marginTop: -1,
        }}>
          <div style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
            <PriceAmounts align="start" />
          </div>
          <PeriodRange />
        </div>

        {/* 4 심사기준 우선 · 우대 — 모바일 영업 스캔 순서 */}
        <CardPerkLine p={p} inline withCredit />
      </PricePeekRoot>
    </Link>
  );
}
