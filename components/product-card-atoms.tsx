'use client';
import { createContext, useContext, useState, useRef, useEffect, type CSSProperties, type ReactNode } from 'react';
import { Wallet, UserRound, Briefcase, ShieldCheck, Sparkles, Coins, type LucideIcon } from 'lucide-react';
import { type EntityRecord } from '@/lib/intake/entities';
import { creditDisplay, vehicleTone, benefitSignals, eventSignals, priceList, cheapest, priceAt, canonProductType, type Audience } from '@/lib/domain/product';
import { man, kmDisplay } from '@/lib/format';
import { C, R, NUM, Badge, EXCEL_OPT_BOX_H, EXCEL_OPT_CHIP_H, EXCEL_OPT_ROW_GAP, EXCEL_BADGE_GAP_X } from '@/components/ui';
import { CREDIT_TONE, productTypeStyle, toneText, type BadgeTone } from '@/components/ui/badges';
import { useIsMobile } from '@/lib/use-mobile';
import { useFirstPhoto } from '@/components/use-product-photos';
import { FavHeart } from '@/components/FavHeart';
import { fuelDisplay, fuelEmbeddedCc, yearDisplay, makerDisplay, isNoTrimLabel } from '@/lib/domain/vehicle-master-match';

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
 *  모바일 피드 4줄(세로 스택 · 썸네일 좌):
 *   1 차종(Title)
 *   2 옵션
 *   3 차번·연식·연료·주행·배기
 *   4 가격(+범위) · 뱃지 · 우대조건
 *────────────────────────────────────────────────────────────
 * 간단카드 ProductCard — 웹 격자용
 *────────────────────────────────────────────────────────────
 *  모바일 파인더는 ProductRowCard 피드 사용(이 카드는 웹 간단뷰).
 *  Thumb → Title → Options → Specs → Amounts → PeriodPerkBand
 */

export function CarGlyph({ size = 30 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#c4ccd8" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 13l1.6-4.2A2 2 0 0 1 8.5 7.5h7A2 2 0 0 1 17.4 8.8L19 13" /><path d="M3 13h18v3.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V13z" /><circle cx="7.5" cy="17.5" r="1.5" /><circle cx="16.5" cy="17.5" r="1.5" /></svg>;
}

// 모바일 축약 SSOT — 썸네일 마크·BadgesClip 전용(2글자). 레일 뱃지(CardRailBadges)는 풀네임.
const STATUS_SHORT: Record<string, string> = {
  즉시출고: '즉시', 출고가능: '가능', 상품화중: '준비', 출고협의: '협의', 계약중: '계약', 출고불가: '불가',
};
const PT_SHORT: Record<string, string> = {
  신차렌트: '신렌', 신차구독: '신구', 중고렌트: '중렌', 중고구독: '중구',
};

/** hover 설명 SSOT — 뱃지·혜택 공통. */
const STATUS_TIP: Record<string, string> = {
  즉시출고: '지금 바로 출고 가능한 차량입니다.',
  출고가능: '출고 가능한 상태입니다. 일정 조율 후 진행합니다.',
  상품화중: '상품화(세차·점검 등) 진행 중입니다.',
  출고협의: '출고 일정을 협의해야 합니다.',
  계약중: '계약금이 확인되어 계약 진행 중입니다.',
  출고불가: '출고 완료·판매 종료된 차량입니다.',
};
const PT_TIP: Record<string, string> = {
  신차렌트: '신차 렌트 상품입니다.',
  신차구독: '신차 구독 상품입니다.',
  중고렌트: '중고 렌트(재렌트) 상품입니다.',
  중고구독: '중고 구독 상품입니다.',
  신차: '신차 상품입니다.',
  중고: '중고 상품입니다.',
};
const CREDIT_TIP: Record<string, string> = {
  무심사: '신용·소득 심사 없이 진행 가능한 기준입니다. (소득무관)',
  소득확: '소득·신용 확인이 필요한 심사 기준입니다. (소득확인)',
};
const BENEFIT_TIP: Record<string, string> = {
  ins: '보증금을 나눠 낼 수 있습니다.',
  nd: '보증금 없이 진행 가능한 상품입니다.',
  age: '만 21세부터 운전 가능한 조건입니다.',
  exp: '운전경력 제한이 거의 없습니다. (경력무관)',
  acc: '사고 이력이 없는 차량입니다.',
};

export function badgeTip(key: string, label: string): string {
  if (key === 'st') {
    const full = STATUS_TIP[label] ? label : (Object.keys(STATUS_SHORT).find((k) => STATUS_SHORT[k] === label) || label);
    return STATUS_TIP[full] || `차량상태: ${label}`;
  }
  if (key === 'pt') {
    const full = PT_TIP[label] ? label : (Object.keys(PT_SHORT).find((k) => PT_SHORT[k] === label) || label);
    return PT_TIP[full] || `상품분류: ${label}`;
  }
  if (key === 'cd') return CREDIT_TIP[label] || `심사기준: ${label}`;
  return label;
}

export function benefitTip(key: string, label: string): string {
  if (key === 'age') {
    const n = label.replace(/[^\d]/g, '') || '21';
    return `만 ${n}세부터 운전 가능한 조건입니다.`;
  }
  return BENEFIT_TIP[key] || label;
}

/**
 * Badge 계층만(SSOT). 혜택·이벤트는 CardBenefits / CardEvents.
 * hideCredit=true → 카드 사진(리본이 담당). 상세 헤더는 credit 칩 허용.
 */
export type BadgeSpec = { key: string; label: string; tone: BadgeTone; variant?: 'line' | 'solid' | 'quiet'; pulse?: boolean };

export function badgeSpecs(p: EntityRecord, hideCredit = false, short = false, audience: Audience = 'agent'): BadgeSpec[] {
  const st = String(p.vehicle_status || '');
  const cd = creditDisplay(p);
  const ptRaw = String(p.product_type || '');
  const pt = canonProductType(ptRaw) || ptRaw;
  const out: BadgeSpec[] = [];
  // 표기순 SSOT: 차량상태 → 상품분류 → 심사기준
  if (st && audience !== 'customer') {
    out.push({
      key: 'st',
      label: short ? (STATUS_SHORT[st] ?? st) : st,
      tone: vehicleTone(st) as BadgeTone,
      variant: st === '계약중' ? 'solid' : undefined,
      pulse: st === '계약중',
    });
  }
  if (pt) {
    const pst = productTypeStyle(pt);
    out.push({ key: 'pt', label: short ? (PT_SHORT[pt] ?? pt) : pt, tone: pst.tone, variant: pst.variant });
  }
  if (!hideCredit && cd) out.push({ key: 'cd', label: cd, tone: CREDIT_TONE(cd) });
  return out;
}

/** 사진 위 PhotoMarks — 출고·심사만(스캔). 상품구분은 CardKind(본문). */
export function photoMarkSpecs(p: EntityRecord, audience: Audience = 'agent'): BadgeSpec[] {
  return badgeSpecs(p, false, true, audience).filter((s) => s.key === 'st' || s.key === 'cd');
}

/** 매물 뱃지열(웹=전체 라벨) — Badge 원자만. overlay=사진 위(세로카드). hideCredit=심사를 썸네일로 뺀 카드. audience=노출 게이팅. */
export function badges(p: EntityRecord, overlay = false, hideCredit = false, short = false, audience: Audience = 'agent'): ReactNode {
  return (<>{badgeSpecs(p, hideCredit, short, audience).map((b) => (
    <Badge key={b.key} tone={b.tone} variant={b.variant || 'line'} overlay={overlay} pulse={b.pulse} title={badgeTip(b.key, b.label)}>{b.label}</Badge>
  ))}</>);
}

/** 모바일 뱃지열 — 축약 라벨 + max개 초과분은 '+N'(뒤에). 색은 웹과 동일 tone. 심사=썸네일 오버레이라 제외. */
export function BadgesClip({ p, max = 3 }: { p: EntityRecord; max?: number }) {
  const specs = badgeSpecs(p, true, true);
  const shown = specs.slice(0, max);
  const rest = specs.length - shown.length;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: '0 0 auto' }}>
      {shown.map((b) => <Badge key={b.key} tone={b.tone} variant={b.variant || 'line'} pulse={b.pulse} title={badgeTip(b.key, b.label)}>{b.label}</Badge>)}
      {rest > 0 && <Badge tone="gray">+{rest}</Badge>}
    </span>
  );
}

// 차량번호 = 모노 텍스트 · 살짝 두껍게(뱃지·칩 금지). 카드·상세 공통.
export function Plate({ p }: { p: EntityRecord }) {
  if (!p.car_number) return null;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color: C.ink, fontFamily: NUM,
      letterSpacing: '-0.2px', whiteSpace: 'nowrap', flex: '0 0 auto',
    }}>{String(p.car_number)}</span>
  );
}

// 신원 원자(SSOT) = 제조사·세부모델(주) / 파워트레인·세부트림(연장). 카드·상세 공유.
export function idParts(p: EntityRecord): { idMain: string; idExt: string } {
  const trim = String(p.trim_name || '').trim();
  const extra = String(p.trim_extra || '').trim();
  return {
    idMain: [makerDisplay(p.maker) || p.maker, p.sub_model || p.model].filter(Boolean).join(' ') || String(p.car_number || '차량'),
    idExt: [p.variant, trim && !isNoTrimLabel(trim) ? trim : '', extra].filter(Boolean).join(' '),
  };
}
// 모바일 신원 = 제조사 빼고 세부모델·파워트레인·세부트림·추가표기만 쭉(좁은 폭, 짤리면 클립). 옵션은 카드에서 뒤에 이어붙임.
export function idMobile(p: EntityRecord): string {
  const trim = String(p.trim_name || '').trim();
  const extra = String(p.trim_extra || '').trim();
  return [p.sub_model || p.model, p.variant, trim && !isNoTrimLabel(trim) ? trim : '', extra].filter(Boolean).join(' ') || String(p.car_number || '차량');
}

// 신원 = 차번칩 + 제조사·세부모델(주) + 파워트레인·세부트림(연장, 연한).
// CardTitle / idParts 가 SSOT. Identity 레거시 컴포넌트는 제거됨.

// 스펙 = 신원에 없는 원자 전부: 연식·주행·연료·구동·배기량·인승·외장/내장색·차종.
export function specLine(p: EntityRecord): string {
  const year = yearDisplay(p.year);
  const fuel = fuelDisplay(p.fuel_type);
  const cc = Number(p.engine_cc) || fuelEmbeddedCc(p.fuel_type);
  return [
    year,
    kmDisplay(p.mileage),
    fuel,
    p.drive_type && String(p.drive_type),
    cc > 0 && `${cc.toLocaleString()}cc`,
    p.seats && `${p.seats}인승`,
    p.ext_color && `외장 ${p.ext_color}`,
    p.int_color && String(p.int_color) !== '-' && `내장 ${p.int_color}`,
    p.vehicle_class && String(p.vehicle_class),
  ].filter(Boolean).join(' · ');
}

function fmtCardYear(p: EntityRecord): string {
  return yearDisplay(p.year) || '-';
}
function fmtCardFuel(p: EntityRecord): string {
  return fuelDisplay(p.fuel_type) || '-';
}
function fmtCardKm(p: EntityRecord): string {
  return kmDisplay(p.mileage) || '-';
}
function fmtCardCc(p: EntityRecord): string {
  const n = Number(p.engine_cc) || fuelEmbeddedCc(p.fuel_type);
  if (!Number.isFinite(n) || n <= 0) return '-';
  return `${n.toLocaleString()}cc`;
}

/** 카드 스펙 슬롯 — 연식·연료·주행·배기. 없으면 `-` (자리 고정). */
export function specLineCard(p: EntityRecord): string {
  return [fmtCardYear(p), fmtCardFuel(p), fmtCardKm(p), fmtCardCc(p)].join(' · ');
}

/** 카드 타이틀 문자열. mobileNarrow=제조사 생략. */
export function cardTitle(p: EntityRecord, mobileNarrow = false): string {
  if (mobileNarrow) return idMobile(p);
  const { idMain, idExt } = idParts(p);
  return [idMain, idExt].filter(Boolean).join(' ');
}

/** CardTitle — 본문 1행. 한 줄 넘치면 … (호버=전체). */
export function CardTitle({ p, narrow, size }: { p: EntityRecord; narrow?: boolean; size?: number }) {
  const fs = size ?? (narrow ? 14 : 14);
  const text = cardTitle(p, !!narrow);
  return (
    <div
      title={text}
      style={{
        fontSize: fs, fontWeight: narrow ? 700 : 800, color: C.ink, lineHeight: 1.35,
        minWidth: 0, width: '100%',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}
    >{text}</div>
  );
}

/** CardKind — 상품구분. 신차/중고·렌트/구독 축으로 톤·variant. */
export function CardKind({ p }: { p: EntityRecord }) {
  const pt = canonProductType(p.product_type) || String(p.product_type || '');
  if (!pt) return null;
  const st = productTypeStyle(pt);
  return <Badge tone={st.tone} variant={st.variant} title={badgeTip('pt', pt)}>{pt}</Badge>;
}

/**
 * CardRailBadges — 상세·간단 공통 CORE.
 * 라벨 = 풀네임(대개 3~4글자: 즉시출고·신차렌트·소득확). 축약(신렌·즉시)은 썸네일 마크·BadgesClip만.
 * dense = 좁은 폭 레이아웃만 (라벨은 동일).
 */
export function CardRailBadges({ p, audience = 'agent', dense }: {
  p: EntityRecord; audience?: Audience; dense?: boolean;
}) {
  const order = ['st', 'pt', 'cd'] as const;
  const byKey = new Map(badgeSpecs(p, false, false, audience).map((s) => [s.key, s]));
  const specs = order.map((k) => byKey.get(k)).filter(Boolean) as BadgeSpec[];
  if (!specs.length) return null;
  return (
    <div style={{
      display: 'flex', flexWrap: 'nowrap', gap: 4,
      justifyContent: 'flex-end', alignItems: 'center',
      flex: '0 0 auto', overflow: 'hidden', maxWidth: dense ? 200 : 280,
    }}>
      {specs.map((s) => (
        <Badge
          key={s.key}
          tone={s.tone}
          variant={s.variant || 'line'}
          pulse={s.pulse}
          title={badgeTip(s.key, s.label)}
        >{s.label}</Badge>
      ))}
    </div>
  );
}

/** MetaIcon — 혜택용. iconColor로 아이콘만 색(혜택 신호). */
export function MetaIcon({ icon: Icon, text, size = 12, strong, iconColor, title }: {
  icon: LucideIcon; text: string; size?: number; strong?: boolean; iconColor?: string; title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, flex: '0 0 auto', whiteSpace: 'nowrap',
        fontWeight: strong ? 600 : 400, color: strong ? C.ink : undefined,
        cursor: title ? 'help' : undefined,
      }}
    >
      <Icon size={size} strokeWidth={2.2} aria-hidden style={{ color: iconColor || C.faint, flex: '0 0 auto' }} />
      <span>{text}</span>
    </span>
  );
}

function benefitIcon(key: string): LucideIcon {
  if (key === 'ins') return Coins;
  if (key === 'nd') return Wallet;
  if (key === 'age') return UserRound;
  if (key === 'exp') return Briefcase;
  if (key === 'acc') return ShieldCheck;
  return Sparkles;
}

/** 혜택 아이콘 색 — 뱃지 tone과 맞춤(혜택이라 살짝 색). */
function benefitIconColor(key: string): string {
  if (key === 'ins') return toneText('teal');
  if (key === 'nd') return toneText('purple');
  if (key === 'age') return toneText('teal');
  if (key === 'exp') return toneText('purple');
  if (key === 'acc') return toneText('green');
  return C.brand;
}

function metaRow(dense: boolean, _mobile: boolean, strong?: boolean, clamp?: boolean, inline?: boolean): CSSProperties {
  // 카드 메타 = 웹/모바일 동일 치수
  const fs = dense ? 11 : 11.5;
  return {
    display: 'flex', alignItems: 'center', gap: dense ? 8 : 10,
    flexWrap: clamp || inline ? 'nowrap' : 'wrap',
    overflow: clamp || inline ? 'hidden' : undefined,
    fontSize: fs, color: strong ? C.ink : C.mute, lineHeight: 1.35, minWidth: 0,
    width: inline ? undefined : (clamp ? '100%' : undefined),
    flex: inline ? '0 1 auto' : undefined,
  };
}

/** CardSpecs — 객관 스펙 한 줄.
 *  차량번호 · 연식 · 연료 · 주행 · 배기량. 없으면 `-`.
 *  차번 = 운영자만(손님 숨김). 텍스트만 · 살짝 두껍게.
 */
export function CardSpecs({ p, dense, audience = 'agent' }: {
  p: EntityRecord; dense?: boolean; audience?: Audience;
}) {
  const s = specLineCard(p);
  const showPlateSlot = audience !== 'customer';
  const plate = String(p.car_number || '').trim();
  const fs = dense ? 11 : 11.5;
  const tip = [
    showPlateSlot && plate ? plate : '',
    specLine(p),
  ].filter(Boolean).join(' · ');
  return (
    <div title={tip || undefined} style={{
      fontSize: fs, color: C.mute, lineHeight: 1.45,
      minWidth: 0, width: '100%',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {showPlateSlot && (
        <>
          <span style={{
            fontWeight: 700, color: C.ink, fontFamily: NUM,
            letterSpacing: '-0.2px', fontVariantNumeric: 'tabular-nums',
          }}>{plate || '-'}</span>
          <span style={{ color: C.faint }}> · </span>
        </>
      )}
      <span>{s}</span>
    </div>
  );
}

/** CardBenefits — 조건(분납·무보증·연령·경력·무사고).
 *  clamp=한 줄 말줄임 · inline=상태 뱃지 뒤에 이어붙임(width 100% 금지). */
export function CardBenefits({ p, dense, clamp, inline }: {
  p: EntityRecord; dense?: boolean; clamp?: boolean; inline?: boolean;
}) {
  const items = benefitSignals(p);
  if (!items.length) {
    return (
      <div style={{
        fontSize: dense ? 11 : 11.5,
        color: C.faint, lineHeight: 1.35,
        flex: inline ? '0 0 auto' : undefined,
        whiteSpace: inline ? 'nowrap' : undefined,
      }}>조건없음</div>
    );
  }
  const ico = dense ? 12 : 13;
  return (
    <div style={metaRow(!!dense, false, true, clamp, inline)}>
      {items.map((s) => (
        <MetaIcon
          key={s.key}
          icon={benefitIcon(s.key)}
          text={s.label}
          size={ico}
          strong
          iconColor={benefitIconColor(s.key)}
          title={benefitTip(s.key, s.label)}
        />
      ))}
    </div>
  );
}

/** CardEvents — 한시 프로모. clamp=한 줄 · inline=뱃지 열에 이어붙임. */
export function CardEvents({ p, dense, clamp, inline }: {
  p: EntityRecord; dense?: boolean; clamp?: boolean; inline?: boolean;
}) {
  const items = eventSignals(p);
  if (!items.length) return null;
  const ico = dense ? 11 : 12;
  return (
    <div style={{ ...metaRow(!!dense, false, true, clamp, inline), color: C.brand }}>
      {items.map((s) => (
        <MetaIcon
          key={s.key}
          icon={Sparkles}
          text={s.label}
          size={ico}
          strong
          iconColor={C.brand}
          title={`이벤트: ${s.label}`}
        />
      ))}
    </div>
  );
}

/** 상세 4행 좌 · 간단 기간옆 — 조건. 없으면 조건없음.
 *  inline = 기간칩과 같은 wrap 흐름(width 100% 금지 → 60개월 옆으로 붙음).
 */
export function CardPerkLine({ p, dense, inline }: {
  p: EntityRecord; dense?: boolean; inline?: boolean;
}) {
  const bens = benefitSignals(p);
  const fs = dense ? 11 : 11.5;
  if (!bens.length) {
    return (
      <div style={{
        fontSize: fs, color: C.faint, lineHeight: 1.35,
        minWidth: 0,
        width: inline ? undefined : '100%',
        flex: inline ? '0 0 auto' : undefined,
        whiteSpace: inline ? 'nowrap' : undefined,
      }}>조건없음</div>
    );
  }
  const ico = dense ? 12 : 13;
  return (
    <div style={{
      ...metaRow(!!dense, false, true, !inline),
      ...(inline ? { width: undefined, flex: '0 1 auto', overflow: 'hidden' } : null),
    }}>
      {bens.map((s) => (
        <MetaIcon
          key={s.key}
          icon={benefitIcon(s.key)}
          text={s.label}
          size={ico}
          strong
          iconColor={benefitIconColor(s.key)}
          title={benefitTip(s.key, s.label)}
        />
      ))}
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
  const glyph = fill ? (mobile ? 40 : 36) : 24;
  const pad = fill ? 6 : 5;
  const promoFs = fill ? (mobile ? 11 : 10.5) : (mobile ? 10.5 : 9.5);

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

  // 간단 = CORE 3 동일 취급. 우하 가로(출고→상품→심사).
  const coreSpecs = coreBadges
    ? (() => {
        const by = new Map(badgeSpecs(p, false, false, audience).map((s) => [s.key, s]));
        return (['st', 'pt', 'cd'] as const).map((k) => by.get(k)).filter(Boolean) as BadgeSpec[];
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
        fontSize: promoFs, fontWeight: 700, letterSpacing: '-0.02em',
        lineHeight: 1,
        color: '#fff',
        background: 'rgba(15,23,42,0.42)',
        border: '1px solid rgba(255,255,255,0.18)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        padding: '0 7px',
        borderRadius: R,
      }}
    >{label}</span>
  );

  return (
    <div style={box}>
      {photo
        ? <img src={photo} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} />
        : <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CarGlyph size={glyph} /></span>}

      {/* frosted Badge 가독용 — 옅은 하단만 */}
      {hasCore && (
        <div aria-hidden style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: '28%', zIndex: 1,
          background: 'linear-gradient(to top, rgba(15,23,42,0.22) 0%, transparent 100%)',
          pointerEvents: 'none',
        }} />
      )}

      {hasCore && (
        <div style={{
          position: 'absolute', bottom: pad, right: pad, zIndex: 2,
          display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 3,
          maxWidth: '92%', overflow: 'hidden',
        }}>
          {coreSpecs.map((s) => (
            <Badge
              key={s.key}
              tone={s.tone}
              variant={s.variant || 'line'}
              frosted
              pulse={s.pulse}
              title={badgeTip(s.key, s.label)}
            >{s.label}</Badge>
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

      {showHeart && (
        <span style={{ position: 'absolute', top: pad, right: pad, zIndex: 2 }}>
          <FavHeart p={p} size={fill ? 16 : 13} onPhoto />
        </span>
      )}
    </div>
  );
}

// 선택옵션 원자. 카드 = 텍스트처럼 읽히되 박스만 · 넘치면 2개+…
// 웹·모바일 동일. 엑셀(lines=2)만 칸 안 2줄 wrap.
const OPT_CHIP_MAX = 2;

export function productOptions(p: EntityRecord): string[] {
  return String(p.options || '').split(/[,/]/).map((s) => s.trim()).filter(Boolean);
}

/** 선택옵션 칩 — 텍스트 톤 + 박스. 웹·모바일 동일.
 *  카드: 한 줄, 넘치면 2개+… (호버=전체). lines=2 → 엑셀 칸 2줄.
 *  상세: expand — 전부 wrap(잘림 없음).
 */
export function OptionChips({ p, clamp, lines = 1, expand }: {
  p: EntityRecord; clamp?: boolean; lines?: 1 | 2; expand?: boolean;
}) {
  const opts = productOptions(p);
  const rowRef = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  const wrap2 = lines >= 2;

  useEffect(() => {
    if (expand) return;
    const el = rowRef.current;
    if (!el) return;
    const check = () => {
      if (wrap2) setClipped(el.scrollHeight > el.clientHeight + 1);
      else setClipped(el.scrollWidth > el.clientWidth + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [opts.join('\0'), clamp, wrap2, expand]);

  if (!opts.length) {
    return (
      <div style={{
        fontSize: 11, color: C.faint, lineHeight: 1.45,
        minWidth: 0, width: '100%',
      }}>옵션미입력</div>
    );
  }
  if (expand) {
    const chip: CSSProperties = {
      fontSize: 12.5, color: C.mute, background: C.head, borderRadius: R,
      padding: '2px 8px', whiteSpace: 'nowrap',
    };
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, minWidth: 0, width: '100%' }}>
        {opts.map((o, i) => <span key={i} style={chip}>{o}</span>)}
      </div>
    );
  }
  const over = opts.length > OPT_CHIP_MAX;
  const shown = over ? opts.slice(0, OPT_CHIP_MAX) : opts;
  const tip = opts.join(' · ');
  const more = over || clipped;
  // 카드 = 텍스트처럼(11) · 박스만. 엑셀 = 칸 높이 맞춤.
  const optChip: CSSProperties = wrap2 ? {
    fontSize: 12, color: C.mute, background: C.head, borderRadius: 3,
    padding: '0 5px', height: EXCEL_OPT_CHIP_H,
    display: 'inline-flex', alignItems: 'center',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    maxWidth: '100%', minWidth: 0, flex: '0 0 auto', boxSizing: 'border-box',
  } : {
    fontSize: 11, color: C.mute, background: C.head, borderRadius: 3,
    padding: '1px 5px',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    maxWidth: 140, minWidth: 0, flex: '0 1 auto', boxSizing: 'border-box',
  };
  if (wrap2) {
    return (
      <div title={tip} style={{ display: 'flex', alignItems: 'flex-start', gap: 4, minWidth: 0, width: '100%' }}>
        <div ref={rowRef} style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', alignContent: 'flex-start',
          columnGap: EXCEL_BADGE_GAP_X, rowGap: EXCEL_OPT_ROW_GAP, minWidth: 0, flex: '1 1 auto',
          maxHeight: EXCEL_OPT_BOX_H, overflow: 'hidden',
        }}>
          {shown.map((o, i) => <span key={i} style={optChip}>{o}</span>)}
        </div>
        {more && (
          <span style={{
            flex: '0 0 auto', fontSize: 11, fontWeight: 700,
            color: C.faint, paddingInline: 2, letterSpacing: '0.04em', lineHeight: 1.2, marginTop: 2,
          }}>…</span>
        )}
      </div>
    );
  }
  return (
    <div title={tip} style={{
      display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, width: '100%',
      flexWrap: 'nowrap', overflow: 'hidden',
    }}>
      <div ref={rowRef} style={{
        display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: '1 1 auto',
        flexWrap: 'nowrap', overflow: 'hidden',
      }}>
        {shown.map((o, i) => <span key={i} style={optChip}>{o}</span>)}
      </div>
      {more && (
        <span style={{
          flex: '0 0 auto', fontSize: 11, fontWeight: 700,
          color: C.faint, paddingInline: 2, letterSpacing: '0.04em', lineHeight: 1,
        }}>…</span>
      )}
    </div>
  );
}

/** @deprecated 카드는 OptionChips SSOT. 호환용 래퍼. */
export function OptionsInline({ p }: { p: EntityRecord }) {
  return <OptionChips p={p} clamp />;
}

// 가격 앵커 SSOT
//  · 상세 4줄 우측: Badges / PriceMonth / PriceRentDep / PeriodChips
//  · PriceAmounts = Month+RentDep 한 줄(간단카드)
//  · PricePeekRoot = peek 공유 + 그리드/플렉스 래퍼

type PricePeek = {
  p: EntityRecord;
  all: ReturnType<typeof priceList>;
  cheap: ReturnType<typeof cheapest>;
  focus: NonNullable<ReturnType<typeof cheapest>> | null;
  peekM: number | null;
  setPeekM: (m: number | null) => void;
  peeking: boolean;
  mobile: boolean;
};

const PricePeekCtx = createContext<PricePeek | null>(null);

function usePricePeek(): PricePeek {
  const ctx = useContext(PricePeekCtx);
  if (!ctx) throw new Error('PriceAmounts/PeriodChips는 PricePeekRoot 안에서 써야 합니다');
  return ctx;
}

/** 상세카드용 — Amounts·Chips가 떨어져 있어도 hover peek 공유.
 *  focusMonth = 필터에서 고른 운영개월(1개일 때). 없으면 최저가. */
export function PricePeekRoot({ p, focusMonth, children, style }: {
  p: EntityRecord; focusMonth?: number; children: ReactNode; style?: CSSProperties;
}) {
  const mobile = useIsMobile();
  const [peekM, setPeekM] = useState<number | null>(null);
  const all = priceList(p);
  const cheap = cheapest(p);
  const filtered = focusMonth && focusMonth > 0 ? priceAt(p, focusMonth) : null;
  const preview = !mobile && peekM != null ? priceAt(p, peekM) : null;
  const value: PricePeek = {
    p, all, cheap,
    focus: preview || filtered || cheap,
    peekM, setPeekM,
    peeking: preview != null,
    mobile,
  };
  // style.display가 있으면(그리드) flex 기본값 덮어씀
  const base: CSSProperties = style?.display
    ? { flex: 1, minWidth: 0 }
    : { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 };
  return (
    <PricePeekCtx.Provider value={value}>
      <div style={{ ...base, ...style }} onMouseLeave={() => setPeekM(null)}>
        {children}
      </div>
    </PricePeekCtx.Provider>
  );
}

/** 기간 라벨 (우측 2행). peek = 색만 은은히. */
export function PriceMonth({ align = 'end' }: { align?: 'start' | 'end' }) {
  const { focus, peeking } = usePricePeek();
  const end = align === 'end';
  if (!focus) return <span style={{ fontSize: 11, color: C.faint }}>—</span>;
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 700,
      color: peeking ? C.ink : C.mute,
      textAlign: end ? 'right' : undefined,
      whiteSpace: 'nowrap',
      transition: 'color 0.12s ease',
    }}>{focus.m}개월</span>
  );
}

/** 대여료·보증금 (우측 3행). peek = 색만 은은히 · 크기·굵기 고정. */
export function PriceRentDep({ align = 'end' }: { align?: 'start' | 'end' }) {
  const { focus, peeking } = usePricePeek();
  const end = align === 'end';
  if (!focus) {
    return <span style={{ fontSize: 11, color: C.faint, fontWeight: 700 }}>가격문의</span>;
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
      justifyContent: end ? 'flex-end' : 'flex-start', minWidth: 0,
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3 }}>
        <span style={{ fontSize: 10, fontWeight: 400, color: peeking ? C.mute : C.faint, transition: 'color 0.12s ease' }}>월</span>
        <span style={{
          fontSize: 18, fontWeight: 800, fontFamily: NUM, letterSpacing: '-0.02em',
          color: peeking ? C.brand : C.ink, transition: 'color 0.12s ease',
        }}>{man(focus.rent)}</span>
      </span>
      <span style={{
        fontSize: 11, fontWeight: 500,
        color: peeking ? C.mute : C.faint, transition: 'color 0.12s ease',
      }}>
        {focus.deposit > 0 ? `보증 ${man(focus.deposit)}` : '무보증'}
      </span>
    </div>
  );
}

/** 기간 → 대여료 → 보증금 한 줄(상세 우측 · 간단).
 *  peek = 색만 은은히 · 크기/굵기 고정. 웹·모바일 동일 치수.
 */
export function PriceAmounts({ align = 'start' }: {
  align?: 'start' | 'end' | 'center';
}) {
  const { focus, peeking } = usePricePeek();
  const end = align === 'end';
  const center = align === 'center';
  if (!focus) {
    return <span style={{ fontSize: 11, color: C.faint, fontWeight: 700 }}>가격문의</span>;
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 8,
      flexWrap: 'nowrap', overflow: 'hidden', minWidth: 0, maxWidth: '100%',
      justifyContent: end ? 'flex-end' : center ? 'center' : 'flex-start',
    }}>
      <span style={{
        fontSize: 11, fontWeight: 700,
        color: peeking ? C.ink : C.mute, whiteSpace: 'nowrap',
        transition: 'color 0.12s ease',
      }}>{focus.m}개월</span>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3, whiteSpace: 'nowrap' }}>
        <span style={{
          fontSize: 10, fontWeight: 400,
          color: peeking ? C.mute : C.faint, transition: 'color 0.12s ease',
        }}>월</span>
        <span style={{
          fontSize: 15, fontWeight: 800, fontFamily: NUM, letterSpacing: '-0.02em',
          color: peeking ? C.brand : C.ink, transition: 'color 0.12s ease',
        }}>{man(focus.rent)}</span>
      </span>
      <span style={{
        fontSize: 11, fontWeight: 500,
        color: peeking ? C.mute : C.faint, whiteSpace: 'nowrap',
        transition: 'color 0.12s ease',
      }}>
        {focus.deposit > 0 ? `보증 ${man(focus.deposit)}` : '무보증'}
      </span>
    </div>
  );
}

/** 기간칩 공통 스타일 — 웹·모바일 동일(PeriodChips / PeriodRange). */
function periodChipStyle(on: boolean): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    height: 20, boxSizing: 'border-box',
    padding: '0 6px', borderRadius: 3,
    fontSize: 9.5, fontWeight: 700, lineHeight: 1,
    letterSpacing: '-0.01em', whiteSpace: 'nowrap',
    color: on ? '#fff' : C.mute,
    background: on ? C.brand : C.head,
    flex: '0 0 auto',
  };
}

/** 모바일 — 최단~최장 기간칩 2개 + 물결. 칩 나열 금지. */
export function PeriodRange() {
  const { all, focus, cheap } = usePricePeek();
  if (all.length < 2) return null;
  const months = all.map((x) => x.m);
  const lo = Math.min(...months);
  const hi = Math.max(...months);
  if (lo === hi) return null;
  const activeM = focus?.m ?? cheap?.m ?? null;
  const tip = (m: number) => {
    const pr = all.find((x) => x.m === m);
    if (!pr) return `${m}개월`;
    return `${pr.m}개월 · 월 ${man(pr.rent)} · ${pr.deposit > 0 ? `보증 ${man(pr.deposit)}` : '무보증'}`;
  };
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      flex: '0 0 auto', whiteSpace: 'nowrap',
    }} aria-label={`${lo}~${hi}개월`}>
      <span data-period-chip title={tip(lo)} style={periodChipStyle(activeM === lo)}>
        {lo}개월
      </span>
      <span style={{
        fontSize: 9.5, fontWeight: 700, color: C.faint,
        lineHeight: 1, flex: '0 0 auto',
      }}>~</span>
      <span data-period-chip title={tip(hi)} style={periodChipStyle(activeM === hi)}>
        {hi}개월
      </span>
    </div>
  );
}

/** 기간 칩 — 상세 우측 · 간단 가격 아래.
 *  clamp = 부모 폭 100%. 넘치면 줄바꿈(칩 중간 잘림 금지).
 *  after = 같은 wrap에 끼움(조건 등) → 줄바꿈된 칩 옆으로 붙음.
 */
export function PeriodChips({ align = 'start', clamp, after }: {
  align?: 'start' | 'end'; clamp?: boolean; after?: ReactNode;
}) {
  const { all, cheap, peekM, setPeekM, peeking, mobile } = usePricePeek();
  const end = align === 'end';
  const h = 20;
  if (!all.length && !after) return <div style={{ minHeight: h }} aria-hidden />;
  return (
    <div style={{
      display: 'flex', gap: 3, flexWrap: 'wrap',
      justifyContent: end ? 'flex-end' : 'flex-start',
      alignItems: 'center',
      minHeight: h,
      maxWidth: clamp ? '100%' : undefined,
      width: clamp ? '100%' : undefined,
    }}>
      {all.map((pr) => {
        const on = peeking ? pr.m === peekM : pr.m === cheap!.m;
        return (
          <span
            key={pr.m}
            data-period-chip
            onMouseEnter={() => { if (!mobile) setPeekM(pr.m); }}
            title={`${pr.m}개월 · 월 ${man(pr.rent)} · ${pr.deposit > 0 ? `보증 ${man(pr.deposit)}` : '무보증'}`}
            style={{ ...periodChipStyle(on), cursor: mobile ? undefined : 'pointer' }}
          >{pr.m}개월</span>
        );
      })}
      {after != null && (
        <div style={{ flex: '0 0 auto', marginLeft: 6, minWidth: 0 }}>
          {after}
        </div>
      )}
    </div>
  );
}

/**
 * 간단카드 — 기간 + 조건.
 *  · 웹: 조건 = 맨 마지막 줄(기간 아래). 기간 2줄이면 조건이 그 줄에 한 칸 양보.
 *  · 모바일: 기간칩 나열 금지 → 조건만.
 */
export function PeriodPerkBand({ p, dense, gap = 6 }: {
  p: EntityRecord; dense?: boolean; gap?: number;
}) {
  const { all, mobile } = usePricePeek();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [yieldSlot, setYieldSlot] = useState(false);

  useEffect(() => {
    if (mobile) return;
    const el = wrapRef.current;
    if (!el) return;
    const check = () => {
      const chips = el.querySelectorAll<HTMLElement>('[data-period-chip]');
      if (chips.length < 2) {
        setYieldSlot(false);
        return;
      }
      const top = chips[0].offsetTop;
      let wrapped = false;
      for (let i = 1; i < chips.length; i++) {
        if (chips[i].offsetTop > top + 2) { wrapped = true; break; }
      }
      setYieldSlot(wrapped);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [all.map((x) => x.m).join(','), mobile]);

  const perk = <CardPerkLine p={p} dense={dense} inline={!mobile && yieldSlot} />;

  // 모바일 = 앵커 가격(PriceAmounts)만 위에 두고, 여기선 조건만
  if (mobile) {
    return (
      <div style={{ flex: '0 0 auto', minWidth: 0, width: '100%' }}>
        {perk}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: yieldSlot ? 0 : gap,
      minWidth: 0, width: '100%', flex: '0 0 auto',
    }}>
      <div ref={wrapRef} style={{ minWidth: 0, width: '100%' }}>
        <PeriodChips
          align="start"
          clamp
          after={yieldSlot ? perk : undefined}
        />
      </div>
      {!yieldSlot && (
        <div style={{ flex: '0 0 auto', minWidth: 0, width: '100%' }}>
          {perk}
        </div>
      )}
    </div>
  );
}

/** 간단카드용 — Amounts만(기간칩은 PeriodPerkBand/웹 전용). */
export function PriceHero({ p, align = 'start', focusMonth }: {
  p: EntityRecord; align?: 'start' | 'end'; focusMonth?: number;
}) {
  const end = align === 'end';
  return (
    <PricePeekRoot p={p} focusMonth={focusMonth} style={{
      gap: 5,
      alignItems: end ? 'flex-end' : 'stretch',
      flex: '0 0 auto',
    }}>
      <PriceAmounts align={align} />
    </PricePeekRoot>
  );
}

/**
 * 기간 요금 원자 — 비조밀(간단카드 칩 등). 대여/보증 한 줄.
 */
export function PriceMini({ m, rent, deposit = 0, on = false }: {
  m: number; rent: number; deposit?: number; on?: boolean; compact?: boolean;
}) {
  const mobile = useIsMobile();
  const tip = `${m}개월 · 월 ${man(rent)} · ${deposit > 0 ? `보증 ${man(deposit)}` : '무보증'}`;
  return (
    <div
      title={tip}
      style={{
        boxSizing: 'border-box', flex: '0 0 auto',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center',
        gap: 2, padding: mobile ? '6px 9px' : '5px 8px',
        borderRadius: R,
        background: on ? C.selected : C.head,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: mobile ? 11 : 10, fontWeight: 700, color: on ? C.brand : C.mute, lineHeight: 1.1 }}>{m}개월</span>
      <span style={{
        fontSize: on ? (mobile ? 13 : 12.5) : (mobile ? 12 : 11.5),
        fontFamily: NUM, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1,
        color: on ? C.brand : C.ink,
      }}>
        <span style={{ fontSize: mobile ? 10.5 : 9.5, fontFamily: 'inherit', fontWeight: 600, color: C.faint }}>월 </span>
        {man(rent)}
      </span>
      <span style={{ fontSize: mobile ? 10.5 : 9.5, fontFamily: NUM, fontWeight: 600, color: C.faint, lineHeight: 1.1 }}>
        보증 {deposit > 0 ? man(deposit) : '없음'}
      </span>
    </div>
  );
}

/**
 * 상세카드 요금 — 기간별 가격 원자 배열.
 * 표가 아니라 각 원자에서 "월 대여료 / 보증금"을 바로 읽는다.
 */
function PriceFareCards({ all, focusM }: { all: { m: number; rent: number; deposit: number }[]; focusM: number }) {
  return (
    <div
      aria-label="기간별 대여료·보증금"
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'stretch',
        gap: 4, width: '100%',
      }}
    >
      {all.map((pr) => (
        <PriceMini
          key={pr.m}
          m={pr.m}
          rent={pr.rent}
          deposit={pr.deposit}
          on={pr.m === focusM}
          compact
        />
      ))}
    </div>
  );
}

/**
 * 요금 스트립 SSOT.
 * · compact(상세카드) = 기간별 가격 원자 배열
 * · 기본 = PriceMini 칩 나열
 */
export function PriceFare({ p, focusMonth, compact = false }: { p: EntityRecord; focusMonth?: number; compact?: boolean }) {
  const mobile = useIsMobile();
  const all = priceList(p);
  const focus = focusMonth && focusMonth > 0 ? priceAt(p, focusMonth) : cheapest(p);
  if (!all.length || !focus) {
    return <span style={{ fontSize: mobile ? 12.5 : 11, color: C.faint }}>가격문의</span>;
  }
  if (compact) return <PriceFareCards all={all} focusM={focus.m} />;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 5, width: '100%' }}>
      {all.map((pr) => (
        <PriceMini key={pr.m} m={pr.m} rent={pr.rent} deposit={pr.deposit} on={pr.m === focus.m} />
      ))}
    </div>
  );
}
