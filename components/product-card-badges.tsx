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
  variant?: 'line' | 'solid' | 'quiet';
  pulse?: boolean;
};

export function badgeSpecs(product: EntityRecord, hideCredit = false, short = false, audience: Audience = 'agent'): BadgeSpec[] {
  const status = String(product.vehicle_status || '');
  const credit = creditDisplay(product);
  const rawProductType = String(product.product_type || '');
  const productType = canonProductType(rawProductType) || rawProductType;
  const specs: BadgeSpec[] = [];
  if (status && audience !== 'customer') {
    specs.push({
      key: 'st',
      label: short ? (STATUS_SHORT[status] ?? status) : status,
      tone: vehicleTone(status) as BadgeTone,
      variant: status === '계약중' ? 'solid' : undefined,
      pulse: status === '계약중',
    });
  }
  if (productType) {
    const style = productTypeStyle(productType);
    specs.push({
      key: 'pt',
      label: short ? (PRODUCT_TYPE_SHORT[productType] ?? productType) : productType,
      tone: style.tone,
      variant: style.variant,
    });
  }
  if (!hideCredit && credit) specs.push({ key: 'cd', label: credit, tone: CREDIT_TONE(credit) });
  return specs;
}

export function photoMarkSpecs(product: EntityRecord, audience: Audience = 'agent'): BadgeSpec[] {
  return badgeSpecs(product, false, true, audience).filter((spec) => spec.key === 'st' || spec.key === 'cd');
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
