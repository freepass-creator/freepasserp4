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

/**
 * 인승을 «선택 축»으로 쓸지.
 * 레이·모닝 승용은 밴과 세부모델이 갈라진 뒤라 인승 옵션이 아님(공급사 명시 없으면 인승 안 씀).
 * 카니발·팰리처럼 같은 세부모델 안 7/9 선택은 축이다.
 */
export function seatAxisMatters(entry: { model?: string; sub_model?: string; variants?: MasterVariant[] } | null | undefined): boolean {
  if (!entry || !variantSeatsDiffer(entry.variants)) return false;
  const model = String(entry.model || '');
  const sub = String(entry.sub_model || '');
  if ((model === '레이' || model === '모닝') && !/\s밴$/.test(sub)) return false;
  return true;
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
