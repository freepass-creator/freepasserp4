'use client';
import { type CSSProperties } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { type Audience } from '@/lib/domain/product';
import { C, R, NUM, FW, FS, ICON } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { useFirstPhoto } from '@/components/use-product-photos';
import { FavHeart } from '@/components/FavHeart';
import { ProductStateMarks } from '@/components/ProductStateMarks';
import { ProductPhotoImage } from '@/components/ProductPhoto';
export { productOptions, OptionChips, OptionsInline } from '@/components/product-card-options';
export {
  CarGlyph, badgeTip, benefitTip, badgeSpecs,
  type BadgeSpec,
} from '@/components/product-card-badges';
export { PriceMini, PriceFare } from '@/components/product-card-fares';
export {
  MetaIcon, CardBenefits, CardEvents, CardPerkLine,
} from '@/components/product-card-perks';
import { CardBenefits, CardEvents } from '@/components/product-card-perks';
export {
  PricePeekRoot, PriceMonth, PriceRentDep, PriceAmounts,
  PeriodRange, PeriodChips, PeriodPerkBand, PriceHero,
} from '@/components/product-card-pricing';
import {
  specLine, specLineCard,
} from '@/components/product-card-identity';
export {
  idParts, idMobile, specLine, specLineCard, cardTitle, plateSpecLine,
} from '@/components/product-card-identity';
export { Plate, CardTitle } from '@/components/product-card-identity-view';
export { CardRailBadges, SignalMarks } from '@/components/product-card-badge-view';

/**
 * ═══════════════════════════════════════════════════════════
 * 매물 카드 슬롯 SSOT
 * ═══════════════════════════════════════════════════════════
 * ★ 상세카드(ProductRowCard)를 먼저 정의·고정. 간단카드는 이후 파생.
 *
 * 공통 원칙
 *  · CORE(없을 수 없는 필터) = 항상 자리 / OPT(있을 수도) = 해당 시만
 *  · 상품구분·출고·심사 = **MetaIcon(아이콘+글자)** — SignalMarks 가 든다 / 스펙 = 텍스트 / 혜택·이벤트 = MetaIcon
 *  · 대여료·기간 외에는 상자형 뱃지를 쓰지 않는다. 사진 위에는 간단보기의 SignalMarks만 우하에 둔다.
 *  · 전기간 요금표 = /m 만 · 카드 스펙 = 차번·연식·연료·주행·배기(없으면 -)
 *  · 가격 표기순 = 기간 → 대여료 → 보증금
 *  · 웹 상세(가로) = PeriodChips로 기간 나열(hover peek) · 웹 간단 = 칩+조건
 *  · 모바일 = 기간칩 나열 금지. 앵커 + PeriodRange(`[최단] ~ [최장]` 칩). 전기간=/m
 *  · 카드 폰트·Badge·기간칩 = 웹/모바일 동일 치수
 *
 * ────────────────────────────────────────────────────────────
 * ★ 상세카드 ProductRowCard — PRIMARY SSOT
 * ────────────────────────────────────────────────────────────
 *  웹 4×2:
 *   1 차명 ─────────────── Badges
 *   2 옵션/옵션미입력 ──── (빈 슬롯)
 *   3 Specs(+차번) ─────── PriceAmounts
 *   4 PerkLine ─────────── PeriodChips
 *
 *  모바일 피드 4줄(세로 스택 · 썸네일 좌) — 영업 스캔. 옵션·뱃지·연료/주행=/m:
 *   1 차량명(+⋯)
 *   2 차량번호 · 연식
 *   3 대여료 · 보증금 · 최저~최대 운영기간
 *   4 우대조건
 *────────────────────────────────────────────────────────────
 * 간단카드 ProductCard — 웹 격자용
 *────────────────────────────────────────────────────────────
 *  모바일 파인더는 ProductRowCard 피드 사용(이 카드는 웹 간단뷰).
 *  Thumb → Title → Options → Specs → Amounts → PeriodPerkBand
 */

/** CardSpecs — 객관 스펙 한 줄.
 *  plateYear/listing = 목록 — 연식 · 주행 · 연료 · 배기량 · 구동(`specAtoms`).
 *  차번 = 운영자만(손님 숨김). 텍스트만 · 살짝 두껍게.
 */
export function CardSpecs({ p, dense, audience = 'agent', plateYear, listing }: {
  p: EntityRecord; dense?: boolean; audience?: Audience; plateYear?: boolean; listing?: boolean;
}) {
  const showPlateSlot = audience !== 'customer';
  const plate = String(p.car_number || '').trim();
  const fs = FS.cap;
  const body = specLineCard(p);
  const tip = [
    showPlateSlot && plate ? plate : '',
    plateYear || listing ? body : specLine(p),
  ].filter(Boolean).join(' · ');
  return (
    <div title={tip || undefined} style={{
      fontSize: fs, color: C.mute, lineHeight: 1.2,
      minWidth: 0, width: '100%',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {showPlateSlot && plate ? (
        <>
          <span style={{
            fontWeight: FW.strong, color: C.ink, fontFamily: NUM,
            letterSpacing: '-0.2px', fontVariantNumeric: 'tabular-nums',
          }}>{plate}</span>
          {body ? <span style={{ color: C.faint }}> · </span> : null}
        </>
      ) : null}
      <span>{body || (!plate ? '-' : '')}</span>
    </div>
  );
}

/** 본문 메타 — 스펙(필수) 위, 혜택·이벤트(비필수) 아래. 가격은 카드에서 Specs 다음에. */
export function CardFacts({ p, dense }: { p: EntityRecord; audience?: Audience; dense?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: dense ? 3 : 5, minWidth: 0 }}>
      <CardSpecs p={p} dense={dense} />
      <CardBenefits p={p} dense={dense} />
      <CardEvents p={p} dense={dense} />
    </div>
  );
}

/**
 * CardThumb — 썸네일 SSOT.
 *  · 상품 신호·프로모는 사진 위에 올리지 않는다. 대여료·기간 외의 상자형 뱃지를 없앤
 *    목록 규격에 맞춰, 신호는 본문의 SignalMarks(아이콘+글자)와 우대조건 줄에만 둔다.
 *  · heart — 웹 목록 빠른 찜. 모바일 목록은 숨김(상세 FavHeart만).
 */
export function CardThumb({ p, audience = 'agent', fill, w, h, heart = false }: {
  p: EntityRecord; audience?: Audience; fill?: boolean; w?: number; h?: number;
  heart?: boolean;
}) {
  const mobile = useIsMobile();
  const photo = useFirstPhoto(p, 480);
  const showHeart = heart && audience !== 'customer';
  const pad = fill ? 6 : 5;

  // fill(간단) — 5열·넓은 카드 기준. 2:1 = 존재 신호 + 답답하지 않은 높이(~120px@240).
  const box: CSSProperties = fill
    ? { position: 'relative', aspectRatio: '2 / 1', background: C.placeholder, overflow: 'hidden' }
    : {
      position: 'relative', width: w, flex: `0 0 ${w}px`,
      ...(h != null
        ? { height: h, alignSelf: 'auto' as const, minHeight: h }
        : { alignSelf: 'stretch' as const, minHeight: mobile ? 56 : 72 }),
      borderRadius: R, background: C.placeholder, overflow: 'hidden',
    };

  return (
    <div style={box}>
      <ProductPhotoImage
        src={photo}
        alt=""
        loading="lazy"
        decoding="async"
        compactPlaceholder
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
      />
      {/* 우상단 = 관심(별표, 누르는 것) + 상태 표시(문의중·최근, 못 누르는 것).
          표시를 별표 왼쪽에 붙여 «누르는 자리»는 언제나 맨 오른쪽 하나로 고정한다. */}
      {showHeart && (
        <span style={{ position: 'absolute', top: pad, right: pad, zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <ProductStateMarks p={p} onPhoto size={ICON.sm} />
          <FavHeart p={p} size={fill ? ICON.md : ICON.sm} onPhoto />
        </span>
      )}
    </div>
  );
}
