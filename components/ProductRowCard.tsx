'use client';
import { memo } from 'react';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { C, R_CARD, SH } from '@/components/ui';
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
 * 모바일 피드 4줄(세로 · 썸네일 좌) — 영업 스캔. 옵션·뱃지·연료/주행은 /m:
 *   1 차량명 (+⋯)
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

/** full = 두 칸을 통째로 쓰는 줄(옵션). 우측 칸을 비워 두면 옵션이 절반 폭에서 잘린다. */
function Cell({ right, full, children }: { right?: boolean; full?: boolean; children?: ReactNode }) {
  return (
    <div style={{
      minWidth: 0,
      ...(full ? { gridColumn: '1 / -1' } : null),
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
      // 웹 한 줄도 «카드»다 — 격자 카드와 같은 모서리를 쓴다(모바일 줄은 붙어 흐르므로 0 유지).
      borderRadius: R_CARD,
      padding: '10px 12px',
      border: `1px solid ${C.line}`,
      boxShadow: SH.cardRest,
      textDecoration: 'none', color: 'inherit',
    } satisfies CSSProperties}>
      {/* 관심(별)은 **상품 상세에서만** 단다(사장님 2026-08-20 「상세보기 화면에도 관심 버튼은 상세페이지서만」).
          모바일 목록은 이미 그렇게 돼 있었는데 웹 한 줄만 예외로 남아 있었다 —
          목록은 «훑는» 자리라 손가락·마우스가 지나가는 길에 별이 눌리고, 훑는 중엔 관심 여부를 정할 일도 없다. */}
      <CardThumb p={p} w={88} marks={false} />

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

        {/* 옵션 = 한 줄 전체. 차명 옆 뱃지 칸까지 내려와 «꽉 채운다»
            (사장님 2026-08-20 「2열은 옵션으로 꽉 채우는 거로」) — 옵션은 길이가 제각각이라
            절반 폭에 두면 대부분 …로 잘려 정작 무엇이 붙었는지 못 읽는다. */}
        <Cell full><OptionChips p={p} clamp /></Cell>

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
  const cardStyle = {
    display: 'flex', gap: 12, alignItems: 'stretch',
    borderRadius: 0,
    padding: '10px 12px',
    borderBottom: `1px solid ${C.line2}`,
    textDecoration: 'none', color: 'inherit',
  } satisfies CSSProperties;
  const linkedContentStyle = {
    ...cardStyle,
    border: 'none', borderRadius: 0,
    width: '100%', minWidth: 0, boxSizing: 'border-box',
  } satisfies CSSProperties;

  return (
    <div className="fp-card fp-card-row" style={{ ...cardStyle, position: 'relative' }}>
      <Link href={href} onClick={() => haptic.nav()} style={linkedContentStyle}>
        {/* 목록(웹·모바일) = 찜 없음. 관심 등록은 상품 상세에서만. */}
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
          {/* 1 차량명 — 메뉴는 Link sibling이어야 중첩 interactive element가 아니다. */}
          <div style={{ position: 'relative', minWidth: 0, paddingRight: 22 }}>
            <CardTitle p={p} narrow />
          </div>

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

          {/* 4 우대 */}
          <CardPerkLine p={p} inline />
        </PricePeekRoot>
      </Link>
      <ProductMoreMenu p={p} align="top" />
    </div>
  );
}
