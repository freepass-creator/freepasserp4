'use client';
import { type CSSProperties } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { eventSignals, type Audience } from '@/lib/domain/product';
import { C, R, NUM, Badge, FW, FS, ICON, SCRIM } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { useFirstPhoto } from '@/components/use-product-photos';
import { useInView } from '@/lib/use-in-view';
import { FavHeart } from '@/components/FavHeart';
import { ProductStateMarks } from '@/components/ProductStateMarks';
import { ProductPhotoImage } from '@/components/ProductPhoto';
export { productOptions, OptionChips, OptionsInline } from '@/components/product-card-options';
import {
  badgeTip, badgeSpecs, photoMarkSpecs,
  type BadgeSpec,
} from '@/components/product-card-badges';
import type { BadgeTone } from '@/components/ui/badges';
export {
  CarGlyph, badgeTip, benefitTip, badgeSpecs, photoMarkSpecs, badges, BadgesClip,
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
import { SignalMarks } from '@/components/product-card-badge-view';

/**
 * ═══════════════════════════════════════════════════════════
 * 매물 카드 슬롯 SSOT
 * ═══════════════════════════════════════════════════════════
 * ★ 상세카드(ProductRowCard)를 먼저 정의·고정. 간단카드는 이후 파생.
 *
 * 공통 원칙
 *  · CORE(없을 수 없는 필터) = 항상 자리 / OPT(있을 수도) = 해당 시만
 *  · 상품구분·출고·심사 = **MetaIcon(아이콘+글자)** — SignalMarks 가 든다 / 스펙 = 텍스트 / 혜택·이벤트 = MetaIcon
 *    (사진 위 좌상단 마크만 Badge frosted — 바탕이 사진이라 상자가 있어야 읽힌다)
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
 * CardThumb — 썸네일 뱃지 SSOT.
 *  · 기본: 좌측 한 줄 최대 2(프로모 우선 → marks 출고·심사)
 *  · `coreBadges`(간단카드·목록 카드) = **사진 우하**에 출고상태·상품구분.
 *    ★정본 = `docs/DESIGN_CONFIRMED_LIST_CARD.md` §2 「뱃지 = 상태·상품구분. **사진 우하**」.
 *    ★모양은 **아이콘 + 글자**(SignalMarks) — 낱개 «박스 뱃지» 아님(2026-08-28 「박스 뱃지 쓰지 말고」).
 *      다만 **한 덩어리 유리바**를 그릇으로 두른다: 같은 문서가 「사진 위 한 덩어리 유리바는 그대로 —
 *      낱개 상자가 아니라 사진 위 가독을 위한 그릇이다」라고 못 박았다. 사진 바탕에서는 글자가 안 읽힌다.
 *    ⚠ 2026-08-31 에 이 자리를 본문으로 «내렸다가» 되돌렸다(사장님 2026-09-04
 *      「간단 웹에서는 출고가능·중고렌트는 썸네일 우측 하단에 들어가기로 했잖아」). 자리를 옮기지 마라.
 *  · heart — 웹 목록 빠른 찜. 모바일 목록은 숨김(상세 FavHeart만).
 */
export function CardThumb({ p, audience = 'agent', fill, w, h, heart = false, marks = true, coreBadges = false }: {
  p: EntityRecord; audience?: Audience; fill?: boolean; w?: number; h?: number;
  heart?: boolean; marks?: boolean; coreBadges?: boolean;
}) {
  const mobile = useIsMobile();
  /**
   * ★목록 썸네일은 **화면에 가까워졌을 때만** 서버 해석을 시작한다(useInView).
   *   직접 사진은 그대로 즉시 — 끄는 건 링크 해석(/api/extract-photos)뿐이다.
   *   전에는 카드 100장이 마운트되자마자 100건이 큐(동시 6)에 들어가 꼬리가 길었다.
   */
  const { ref: viewRef, inView } = useInView<HTMLDivElement>();
  const photo = useFirstPhoto(p, 480, inView);
  const promos = eventSignals(p);
  const showHeart = heart && audience !== 'customer';
  const pad = fill ? 6 : 5;
  const promoFs = fill ? (mobile ? FS.cap : FS.micro) : FS.micro;
  // 모바일 목록 피드 썸네일(w=68, !fill) = 긴 스크롤. blur는 스크롤 합성비용이 커서 반투명 단색으로 대체.
  // 상세(웹 가로카드)·간단(fill) 카드는 blur 유지.
  const listThumb = mobile && !fill;

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

  type Mark = { key: string; label: string; kind: 'promo' | 'mark'; tone?: BadgeTone; variant?: BadgeSpec['variant'] };
  // 사진 위 표시는 좌상단 둘까지 — 프로모 먼저, 남으면 출고상태 마크.
  const left: Mark[] = [];
  {
    const head = marks ? photoMarkSpecs(p, audience) : [];
    for (const e of promos) {
      if (left.length >= 2) break;
      left.push({ key: e.key, label: e.label, kind: 'promo' });
    }
    for (const s of head) {
      if (left.length >= 2) break;
      left.push({ key: s.key, label: s.label, kind: 'mark', tone: s.tone, variant: s.variant });
    }
  }

  const promoChip = (label: string, key: string) => (
    <span
      key={key}
      title={label}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        height: fill ? 18 : 16, boxSizing: 'border-box',
        fontSize: promoFs, fontWeight: FW.strong, letterSpacing: '-0.02em',
        lineHeight: 1,
        color: C.inverse,
        // 목록 썸네일 = blur 없이 가독 유지되게 더 진한 단색 / 그밖엔 기존 frosted(blur+옅은 톤).
        background: listThumb ? SCRIM.heavy : SCRIM.light,
        border: `1px solid color-mix(in srgb, ${C.inverse} 18%, transparent)`,
        backdropFilter: listThumb ? undefined : 'blur(6px)',
        WebkitBackdropFilter: listThumb ? undefined : 'blur(6px)',
        padding: '0 7px',
        borderRadius: R,
      }}
    >{label}</span>
  );

  return (
    <div ref={viewRef} style={box}>
      <ProductPhotoImage
        src={photo}
        alt=""
        loading="lazy"
        decoding="async"
        compactPlaceholder
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
      />

      {/* ★사진 우하 = 출고상태 · 상품구분. **낱개 칩 둘**(사장님 2026-09-04 「박스를 달리해서
          텍스트에 딱 붙여 두 개로」). 한 그릇에 담으면 둘이 한 덩어리 문장처럼 읽힌다 — 다른 갈래다.
          칩 안은 흰 글자·흰 그림(.fp-onphoto) — 사진 밝기가 제각각이라 톤색은 안 읽힌다. */}
      {coreBadges && (
        <div className="fp-onphoto" style={{
          position: 'absolute', bottom: pad, right: pad, zIndex: 2,
          maxWidth: '92%', minWidth: 0, display: 'inline-flex', alignItems: 'center',
        }}>
          <SignalMarks p={p} audience={audience} dense chip />
        </div>
      )}

      {left.length > 0 && (
        <div style={{
          position: 'absolute', top: pad, left: pad, zIndex: 2,
          display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 4,
          maxWidth: showHeart ? 'calc(100% - 44px)' : '90%',
          overflow: 'hidden',
        }}>
          {left.map((m) => m.kind === 'promo' ? (
            promoChip(m.label, m.key)
          ) : (
            <Badge key={m.key} tone={m.tone || 'gray'} variant={m.variant || 'line'} frosted title={badgeTip(m.key, m.label)}>{m.label}</Badge>
          ))}
        </div>
      )}

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
