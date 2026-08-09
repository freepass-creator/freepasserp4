import type { MasterVariant } from '@/lib/domain/vehicle-master-types';
import { isForbiddenAsTrim } from '@/lib/domain/vehicle-field-guards';

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

/** 인승·구동은 고른 마스터 variant 노드 필드를 **이름에 풀어 쓴다**(발명 아님). */
export function masterVariantOptionLabel(
  variant: MasterVariant,
  variants: MasterVariant[],
  entry?: { model?: string; sub_model?: string; variants?: MasterVariant[] } | null,
): string {
  const base = masterVariantLabel(variant);
  const parts: string[] = [];
  if (base) parts.push(base);
  const seatOk = entry ? seatAxisMatters(entry) : variantSeatsDiffer(variants);
  // 노드에 seat 가 있을 때만 — 마스터 조합에 이미 있는 인승
  if (seatOk && variant.seat != null && variant.seat > 0) {
    const tok = `${variant.seat}인승`;
    if (!base.replace(/\s/g, '').includes(tok.replace(/\s/g, ''))) parts.push(tok);
  }
  const driveChoices = [...new Set(
    (variants || [])
      .map((v) => String(v.drivetrain || '').trim())
      .filter(Boolean)
      .map((d) => {
        const u = d.toUpperCase().replace(/\s/g, '');
        if (/4WD|AWD|4MATIC|XDRIVE|콰트로|4모션|사륜|4륜/.test(u)) return '4WD';
        if (/2WD|RWD|FWD|전륜|후륜|이륜/.test(u)) return '2WD';
        return d;
      }),
  )];
  // 노드에 drivetrain 이 있을 때만 — 마스터 조합에 이미 있는 구동
  if (driveChoices.length >= 2) {
    const raw = String(variant.drivetrain || '').trim();
    if (raw) {
      const u = raw.toUpperCase().replace(/\s/g, '');
      const canon = /4WD|AWD|4MATIC|XDRIVE|콰트로|4모션|사륜|4륜/.test(u) ? '4WD'
        : /2WD|RWD|FWD|전륜|후륜|이륜/.test(u) ? '2WD'
          : raw;
      const blob = parts.join('').replace(/\s/g, '').toUpperCase();
      const covered = blob.includes(u)
        || (canon === '4WD' && /AWD|4WD|4MATIC|XDRIVE|콰트로|4모션|사륜/.test(blob))
        || (canon === '2WD' && /2WD|RWD|FWD|전륜|후륜/.test(blob));
      if (!covered) parts.push(raw);
    }
  }
  return parts.filter(Boolean).join(' ');
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
  return (list || []).filter((trim) => !isNoTrimLabel(trim) && !isForbiddenAsTrim(trim));
}
