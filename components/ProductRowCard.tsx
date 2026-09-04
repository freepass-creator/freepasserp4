'use client';
import { memo } from 'react';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { C, R, SH, FW } from '@/components/ui';
import {
  CardTitle, CardSpecs, CardPerkLine, CardThumb, CardRailBadges,
  PricePeekRoot, PriceAmounts, PeriodChips, PeriodRange, OptionChips,
} from '@/components/product-card-atoms';

/**
 * 상세카드 SSOT
 *
 * 웹 4×2:
 *   1 차명              | 출고·상품 (아이콘+글자 · 심사는 4행 조건 줄)
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
        {/* withCredit = 「무심사」도 이 줄에 선다(모바일 행과 같은 규칙). 심사는 «지금 살 수 있나»가 아니라
            «어떤 조건인가»라 머리가 아니라 조건 줄이 든다(사장님 2026-08-23). 전에는 웹만 꺼져 있어
            같은 값이 폰에는 보이고 웹에는 안 보였다. */}
        <CardPerkLine p={p} dense={false} withCredit />
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
      {/* 사진 위에는 신호를 안 올린다 — 아이콘+글자는 사진 바탕에서 안 읽힌다(a466b0aa). */}
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
        {/* ★1행 우측 = 출고상태·상품구분 **아이콘+글자**(CardRailBadges → SignalMarks).
            2026-08-31 커서 커밋 d930f89d 가 이걸 지우고 썸네일 우하 «박스 뱃지»로 되돌렸고
            (사장님 2026-08-28·08-30 「박스 뱃지 쓰지 말고 아이콘 텍스트로, 모든 곳에서」를 거스른다),
            PR #10 머지가 두 쪽을 섞으면서 결국 «아무것도 없는» 상태가 됐다. 원래 규격으로 되돌린다.
            ⚠ check-design-locked 가 이 줄의 존재를 «1곳»으로 못 박고 있다 — 지우면 게이트가 잡는다. */}
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
    /* ★밀도 = **업무용**이다(사장님 2026-08-30 「완전 B2C는 아니니까 정보가 조금 더 많이 보이는 게 좋거든 ·
         상하 간격을 쪼끔씩 더 좁히고 · 사진은 좌우로 조금 더 줄여도」).
         · 사진은 «있는지·어떤 모델인지»만 보이면 된다 → 68. (56 은 분간이 안 됐고, 88 은 한 화면에서
           행 수를 잡아먹었다. 그 사이에서 멈춘다.)
         · 좌우 12 = 상단바 여백(--fp-bar-pad-x)과 «같은 세로선». 16 이면 머리 제목과 목록 글이 어긋난다.
         · 상하 9 · 줄사이 4 — 한 화면에 한 행이라도 더. 줄 구성(4줄)과 담는 내용은 그대로다. */
    <Link href={href} onClick={() => haptic.nav()} className="fp-card fp-card-row" style={{
      display: 'flex', gap: 10, alignItems: 'stretch',
      borderRadius: 0,
      padding: '9px 12px',
      borderBottom: `1px solid ${C.line2}`,
      textDecoration: 'none', color: 'inherit',
    } satisfies CSSProperties}>
      {/* 모바일 목록 = 찜 없음(썸네일 버튼은 상세에서만). 웹 가로카드는 heart 유지. */}
      <CardThumb p={p} w={68} marks={false} />

      <PricePeekRoot p={p} focusMonth={focusMonth} style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        flex: '1 1 auto',
        minWidth: 0,
        alignSelf: 'stretch',
        justifyContent: 'center',
      }}>
        {/* 1 차량명 = 이 행의 «머리». 금액(FW.head)과 같은 무게로 세워야 눈이 여기부터 읽는다 —
            650 이면 바로 아래 금액이 더 굵어서 이름이 부제처럼 밀린다. */}
        <CardTitle p={p} weight={FW.head} />

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
