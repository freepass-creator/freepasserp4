'use client';

import type { ReactNode } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import { creditDisplay, vehicleTone, canonProductType, type Audience } from '@/lib/domain/product';
import { C, Badge } from '@/components/ui';
import { CREDIT_TONE, productTypeStyle, type BadgeTone } from '@/components/ui/badges';

export function CarGlyph({ size = 30 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={C.faint} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 13l1.6-4.2A2 2 0 0 1 8.5 7.5h7A2 2 0 0 1 17.4 8.8L19 13" /><path d="M3 13h18v3.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V13z" /><circle cx="7.5" cy="17.5" r="1.5" /><circle cx="16.5" cy="17.5" r="1.5" /></svg>;
}

const STATUS_SHORT: Record<string, string> = {
  즉시출고: '즉시', 출고가능: '가능', 상품화중: '준비', 출고협의: '협의', 계약중: '계약', 출고불가: '불가',
};
const PRODUCT_TYPE_SHORT: Record<string, string> = {
  신차렌트: '신렌', 신차구독: '신구', 중고렌트: '중렌', 중고구독: '중구',
};
const STATUS_TIP: Record<string, string> = {
  즉시출고: '지금 바로 출고 가능한 차량입니다.',
  출고가능: '출고 가능한 상태입니다. 일정 조율 후 진행합니다.',
  상품화중: '상품화(세차·점검 등) 진행 중입니다.',
  출고협의: '출고 일정을 협의해야 합니다.',
  계약중: '계약금이 확인되어 계약 진행 중입니다.',
  출고불가: '출고 완료·판매 종료된 차량입니다.',
};
const PRODUCT_TYPE_TIP: Record<string, string> = {
  신차렌트: '신차 렌트 상품입니다.',
  신차구독: '신차 구독 상품입니다.',
  중고렌트: '중고 렌트(재렌트) 상품입니다.',
  중고구독: '중고 구독 상품입니다.',
  신차: '신차 상품입니다.',
  중고: '중고 상품입니다.',
};
const CREDIT_TIP: Record<string, string> = {
  무심사: '신용·소득 심사 없이 진행 가능한 기준입니다. (소득무관)',
  소득확인: '소득·신용 확인이 필요한 심사 기준입니다. (소득확인)',
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
    const full = STATUS_TIP[label] ? label : (Object.keys(STATUS_SHORT).find((status) => STATUS_SHORT[status] === label) || label);
    return STATUS_TIP[full] || `차량상태: ${label}`;
  }
  if (key === 'pt') {
    const full = PRODUCT_TYPE_TIP[label] ? label : (Object.keys(PRODUCT_TYPE_SHORT).find((type) => PRODUCT_TYPE_SHORT[type] === label) || label);
    return PRODUCT_TYPE_TIP[full] || `상품분류: ${label}`;
  }
  if (key === 'cd') return CREDIT_TIP[label] || `심사기준: ${label}`;
  return label;
}

export function benefitTip(key: string, label: string): string {
  if (key === 'age') {
    const age = label.replace(/[^\d]/g, '') || '21';
    return `만 ${age}세부터 운전 가능한 조건입니다.`;
  }
  return BENEFIT_TIP[key] || label;
}

export type BadgeSpec = {
  key: string;
  label: string;
  tone: BadgeTone;
  variant?: 'line' | 'solid' | 'quiet' | 'perk';
  pulse?: boolean;
};

export function badgeSpecs(product: EntityRecord, hideCredit = false, short = false, audience: Audience = 'agent'): BadgeSpec[] {
  const status = String(product.vehicle_status || '');
  const credit = creditDisplay(product);
  const rawProductType = String(product.product_type || '');
  const productType = canonProductType(rawProductType) || rawProductType;
  /**
   * ★**세 갈래를 «모양»으로 가른다**(사장님 2026-08-22 「뱃지가 계약중처럼 각 3가지 구분이 각각에 따라 좀 달라야 하는데
   *   지금 다 동일하지 — 개선해줘」). 전에는 셋 다 테두리(line)라 색만 달랐고, 색은 톤이 비슷하면 한 덩어리로 읽힌다.
   *
   *   ① 출고상태(st) = **채운 면(solid)** — 지금 살 수 있나. 셋 중 제일 먼저 봐야 하는 값이라 제일 세게.
   *   ② 상품구분(pt) = **테두리(line)** — 어떤 상품인가. 분류라 중간 세기.
   *   ③ 심사(cd)     = **연한 면(quiet)** — 조건. 참고값이라 제일 약하게.
   *
   * 세기가 «급함»의 차례와 같아서, 색을 못 가려도 모양만으로 어느 갈래인지 알 수 있다.
   * 계약중만 pulse 를 유지한다 — 그건 «지금 움직이는 건»이라 상태 안에서 한 번 더 갈린다.
   */
  const specs: BadgeSpec[] = [];
  if (status && audience !== 'customer') {
    specs.push({
      key: 'st',
      label: short ? (STATUS_SHORT[status] ?? status) : status,
      tone: vehicleTone(status) as BadgeTone,
      variant: 'solid',
      pulse: status === '계약중',
    });
  }
  if (productType) {
    specs.push({
      key: 'pt',
      label: short ? (PRODUCT_TYPE_SHORT[productType] ?? productType) : productType,
      // 구독을 solid 로 세우던 규칙은 뺐다 — solid 는 이제 «상태»의 문법이다. 구독은 톤(색)으로 갈린다.
      tone: productTypeStyle(productType).tone,
      variant: 'line',
    });
  }
  if (!hideCredit && credit) specs.push({ key: 'cd', label: credit, tone: CREDIT_TONE(credit), variant: 'quiet' });
  return specs;
}

/**
 * ★**머리에 서는 뱃지는 「출고상태 + 상품구분」 둘뿐**
 *   (사장님 2026-08-23 「무심사/소득확인 이거는 아래 하단에 조건으로 보내자 — 계약조건이니까.
 *    위에는 출고상태랑 상품구분 뱃지만 두자」).
 *
 *   심사(cd = 무심사·소득확인)는 «지금 살 수 있나»가 아니라 «어떤 조건인가»다. 상세 「계약조건」 섹션이 든다.
 *   그동안 목록 카드·상세 머리·요약줄 **세 곳이 각각** `['st','pt','cd']` 를 적고 있어서
 *   한 곳만 고치면 나머지가 그대로 남았다(2026-08-23 실측: 상세만 고쳤더니 목록에 그대로 떴다).
 *   그래서 차례를 여기 한 곳에서 정한다 — 쓰는 쪽은 이 상수를 읽는다.
 */
export const HEAD_BADGE_KEYS = ['st', 'pt'] as const;

export function photoMarkSpecs(product: EntityRecord, audience: Audience = 'agent'): BadgeSpec[] {
  // 사진 위 마크도 같은 규칙 — 심사는 안 올린다.
  return badgeSpecs(product, true, true, audience).filter((spec) => spec.key === 'st');
}

/** hideStatus = 차량상태를 다른 곳(작업화면 상단 요약바)이 이미 들고 있을 때. 같은 배지를 두 번 찍지 않는다. */
export function badges(product: EntityRecord, overlay = false, hideCredit = false, short = false, audience: Audience = 'agent', opts?: { hideStatus?: boolean }): ReactNode {
  return (<>{badgeSpecs(product, hideCredit, short, audience).filter((spec) => !(opts?.hideStatus && spec.key === 'st')).map((spec) => (
    <Badge key={spec.key} tone={spec.tone} variant={spec.variant || 'line'} overlay={overlay} pulse={spec.pulse} title={badgeTip(spec.key, spec.label)}>{spec.label}</Badge>
  ))}</>);
}

export function BadgesClip({ p, max = 3 }: { p: EntityRecord; max?: number }) {
  const specs = badgeSpecs(p, true, true);
  const shown = specs.slice(0, max);
  const remaining = specs.length - shown.length;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: '0 0 auto' }}>
      {shown.map((spec) => <Badge key={spec.key} tone={spec.tone} variant={spec.variant || 'line'} pulse={spec.pulse} title={badgeTip(spec.key, spec.label)}>{spec.label}</Badge>)}
      {remaining > 0 && <Badge tone="gray">+{remaining}</Badge>}
    </span>
  );
}
