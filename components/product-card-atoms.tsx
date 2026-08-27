'use client';
import { type CSSProperties } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { eventSignals, type Audience } from '@/lib/domain/product';
import { C, R, NUM, Badge, FW, FS, ICON, SCRIM } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { useFirstPhoto } from '@/components/use-product-photos';
import { FavHeart } from '@/components/FavHeart';
import { ProductStateMarks } from '@/components/ProductStateMarks';
import { ProductPhotoImage } from '@/components/ProductPhoto';
import { yearDisplay } from '@/lib/domain/vehicle-master-match';
import { kmDisplay } from '@/lib/format';
import { fuelDisplay } from '@/lib/domain/vehicle-master-match';
export { productOptions, OptionChips, OptionsInline } from '@/components/product-card-options';
import {
  badgeTip, badgeSpecs, photoMarkSpecs, LOWER_BADGE_KEYS, LOWER_BADGE_KEYS_MOBILE,
  type BadgeSpec,
} from '@/components/product-card-badges';
import { toneAccent, type BadgeTone } from '@/components/ui/badges';
export {
  CarGlyph, badgeTip, benefitTip, badgeSpecs, photoMarkSpecs, badges, BadgesClip, LOWER_BADGE_KEYS, LOWER_BADGE_KEYS_MOBILE,
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
export { CardKind, CardRailBadges } from '@/components/product-card-badge-view';

/**
 * ═══════════════════════════════════════════════════════════
 * 매물 카드 슬롯 SSOT
 * ═══════════════════════════════════════════════════════════
 * ★ 상세카드(ProductRowCard)를 먼저 정의·고정. 간단카드는 이후 파생.
 *
 * 공통 원칙
 *  · CORE(없을 수 없는 필터) = 항상 자리 / OPT(있을 수도) = 해당 시만
 *  · Badge = 상품구분·출고·심사 / 스펙 = 텍스트 / 혜택·이벤트 = MetaIcon
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

function fmtCardYear(p: EntityRecord): string {
  return yearDisplay(p.year) || '';
}

/** CardSpecs — 객관 스펙 한 줄.
 *  기본 = 차량번호 · 연식 · 연료 · 주행 · 배기량. 없으면 `-`.
 *  plateYear = 모바일 목록용 — **차번 · 연식 · 주행 · 연료**(사장님 2026-08-22 「상품목록에 차량번호 연식
 *    주행거리 연료까지는 보여줘야 한다고, 지금 연식만 있잖아」. 1행에서 세부트림을 뺀 만큼 이 줄이 차를 설명한다).
 *  차번 = 운영자만(손님 숨김). 텍스트만 · 살짝 두껍게.
 */
export function CardSpecs({ p, dense, audience = 'agent', plateYear, listing }: {
  p: EntityRecord; dense?: boolean; audience?: Audience; plateYear?: boolean; listing?: boolean;
}) {
  const showPlateSlot = audience !== 'customer';
  const plate = String(p.car_number || '').trim();
  const year = fmtCardYear(p);
  const fs = FS.cap;
  /**
   * 목록 줄 = 연식 · 주행 · **연료**. 연료가 빠져 있던 것을 되살린다
   * (사장님 2026-08-20 「주행거리 뒤에 연료 안 나온다」 — `listing` 변형이 2026-08-19 들어오면서 잘렸다).
   * 연료는 차를 고를 때 «주행거리 다음»으로 먼저 걸러 보는 값이라 한 줄에 같이 있어야 한다.
   */
  const body = plateYear
    ? [year, kmDisplay(p.mileage), fuelDisplay(p.fuel_type) || String(p.fuel_type || '').trim()].filter(Boolean).join(' · ')
    : listing
      ? [year, kmDisplay(p.mileage), fuelDisplay(p.fuel_type) || String(p.fuel_type || '').trim()].filter(Boolean).join(' · ')
      : specLineCard(p);
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
 *  · coreBadges(간단카드): 우하 가로 출고·상품·심사 = 상세와 동일 Badge + frosted 반투명
 *  · heart — 웹 목록 빠른 찜. 모바일 목록은 숨김(상세 FavHeart만).
 */
export function CardThumb({ p, audience = 'agent', fill, w, h, heart = false, marks = true, coreBadges = false }: {
  p: EntityRecord; audience?: Audience; fill?: boolean; w?: number; h?: number;
  heart?: boolean; marks?: boolean; coreBadges?: boolean;
}) {
  const mobile = useIsMobile();
  const photo = useFirstPhoto(p, 480);
  const promos = eventSignals(p);
  const showHeart = heart && audience !== 'customer';
  const pad = fill ? 6 : 5;
  const promoFs = fill ? (mobile ? FS.cap : FS.micro) : FS.micro;
  // 모바일 목록 피드 썸네일(w=56, !fill) = 긴 스크롤. blur는 스크롤 합성비용이 커서 반투명 단색으로 대체.
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

  /*
   * 사진 우하 바 = **하단 뱃지**. 차례는 `LOWER_BADGE_KEYS` 가 정한다 — 심사가 맨 앞이다.
   * 모바일은 심사 하나만 세운다(상품구분·차량상태는 상세에서 본다).
   * ⚠ `hideCredit` 을 켜면 심사 자체가 안 만들어진다 — 그래서 false 로 부른다.
   */
  const coreSpecs = coreBadges
    ? (() => {
        const by = new Map(badgeSpecs(p, false, false, audience).map((s) => [s.key, s]));
        const order = mobile ? LOWER_BADGE_KEYS_MOBILE : LOWER_BADGE_KEYS;
        return order.map((k) => by.get(k)).filter(Boolean) as BadgeSpec[];
      })()
    : [];

  type Mark = { key: string; label: string; kind: 'promo' | 'mark'; tone?: BadgeTone; variant?: BadgeSpec['variant'] };
  const left: Mark[] = [];
  if (!coreBadges) {
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

  const promoRight = coreBadges ? promos.slice(0, 2) : [];
  const hasCore = coreSpecs.length > 0;

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
    <div style={box}>
      <ProductPhotoImage
        src={photo}
        alt=""
        loading="lazy"
        decoding="async"
        compactPlaceholder
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
      />

      {/* frosted Badge 가독용 — 옅은 하단만 */}
      {hasCore && (
        <div aria-hidden style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: '28%', zIndex: 1,
          background: `linear-gradient(to top, ${SCRIM.light} 0%, transparent 100%)`,
          pointerEvents: 'none',
        }} />
      )}

      {/*
        CORE 3(출고·상품·심사) = **한 덩어리 다크 글래스 바**.
        흰 뱃지 세 장을 사진 위에 띄우면 스티커 붙인 것처럼 보인다(사장님 2026-08-20 「좀 촌스럽지 않게」).
        떠 있는 물체를 3개에서 1개로 줄이고, 값 사이는 얇은 세로선으로만 나눈다 —
        사진 위 글자는 «어두운 유리 + 흰 글자»가 가장 조용하고 어떤 차 색에도 안 묻는다.
        색 정보는 버리지 않는다: 차량상태만 앞에 **작은 색점**으로 남긴다(초록=출고가능·주황=계약중…).
      */}
      {hasCore && (
        <div
          className={coreSpecs.some((x) => x.pulse) ? 'fp-badge-pulse' : undefined}
          style={{
            position: 'absolute', bottom: pad, right: pad, zIndex: 2,
            display: 'inline-flex', alignItems: 'center', height: 22,
            padding: '0 8px', borderRadius: R, maxWidth: '92%', overflow: 'hidden',
            background: listThumb ? SCRIM.heavy : SCRIM.light,
            border: `1px solid color-mix(in srgb, ${C.inverse} 16%, transparent)`,
            backdropFilter: listThumb ? undefined : 'blur(8px)',
            WebkitBackdropFilter: listThumb ? undefined : 'blur(8px)',
            color: C.inverse, fontSize: FS.micro, fontWeight: FW.strong,
            letterSpacing: '-0.01em', whiteSpace: 'nowrap', lineHeight: 1,
          }}
        >
          {coreSpecs.map((s, i) => (
            <span key={s.key} title={badgeTip(s.key, s.label)} style={{ display: 'inline-flex', alignItems: 'center' }}>
              {i > 0 && (
                <span aria-hidden style={{
                  width: 1, height: 9, margin: '0 7px', flex: '0 0 auto',
                  background: `color-mix(in srgb, ${C.inverse} 30%, transparent)`,
                }} />
              )}
              {s.key === 'st' && (
                <span aria-hidden style={{
                  width: 5, height: 5, borderRadius: '50%', marginRight: 5, flex: '0 0 auto',
                  background: toneAccent(s.tone),
                }} />
              )}
              {s.label}
            </span>
          ))}
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

      {promoRight.length > 0 && (
        <div style={{
          position: 'absolute', top: pad, right: showHeart ? (fill ? 36 : 32) : pad, zIndex: 2,
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3,
          maxWidth: '42%',
        }}>
          {promoRight.map((e) => promoChip(e.label, e.key))}
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
