import type { MasterVariant } from '@/lib/domain/vehicle-master-types';

/** 마스터 파워트레인 라벨은 JSON의 원문을 그대로 사용한다. */
export function masterVariantLabel(
  variant: Pick<MasterVariant, 'label'> | null | undefined,
): string {
  return String(variant?.label ?? '').trim();
}

/** 세대 내 파워트레인이 둘 이상의 인승 값으로 갈리는지 판정한다. */
export function variantSeatsDiffer(variants: MasterVariant[] | null | undefined): boolean {
  const seats = new Set<number>();
  for (const variant of variants || []) {
    if (variant.seat != null && variant.seat > 0) seats.add(variant.seat);
  }
  return seats.size > 1;
}

/** 인승은 세대 내에서 갈릴 때만, 구동은 기본 라벨에 없을 때만 보강한다. */
export function masterVariantOptionLabel(
  variant: MasterVariant,
  variants: MasterVariant[],
): string {
  const base = masterVariantLabel(variant);
  const parts = [base];
  if (variantSeatsDiffer(variants) && variant.seat != null && variant.seat > 0) {
    parts.push(`${variant.seat}인승`);
  }
  const drivetrain = String(variant.drivetrain || '').trim();
  if (drivetrain && !base.includes(drivetrain)) parts.push(drivetrain);
  return parts.filter(Boolean).join(' · ');
}

/** "(세부등급 없음)" 등은 실제 저장 가능한 트림으로 취급하지 않는다. */
export function isNoTrimLabel(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!normalized) return true;
  return normalized === '(세부등급없음)'
    || normalized === '세부등급없음'
    || normalized === '없음'
    || normalized === '미선택'
    || normalized === '-'
    || normalized === '—';
}

export function realMasterTrims(list: string[] | null | undefined): string[] {
  return (list || []).filter((trim) => !isNoTrimLabel(trim));
}
