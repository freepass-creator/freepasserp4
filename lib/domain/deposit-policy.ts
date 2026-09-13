import type { DepositPolicy } from './supplier-adapter';
import { isImportBrand } from './vehicle-origin';

/**
 * 손오공 보증금 SSOT.
 * 사용자 운영 규칙: 월 대여료 × 연수, 단 최대 3개월분까지만.
 */
export const SONOGONG_DEPOSIT_POLICY: DepositPolicy = Object.freeze({
  code: 'SONOGONG_RENT_X_YEARS_MAX3',
  kind: 'YEAR_MULTIPLE_CAPPED',
  label: '월 대여료 × 연수 (최대 ×3)',
  monthsPerYear: 12,
  maxMultiplier: 3,
});

const AUTOPLUS_DOMESTIC_POLICY: DepositPolicy = Object.freeze({
  code: 'AUTOPLUS_DOMESTIC_X2',
  kind: 'TERM_MULTIPLIER',
  label: '국산: 월 대여료×2',
  defaultMultiplier: 2,
});

const AUTOPLUS_IMPORT_POLICY: DepositPolicy = Object.freeze({
  code: 'AUTOPLUS_IMPORT_12_X3_18P_X6',
  kind: 'TERM_MULTIPLIER',
  label: '수입: 12개월 대여료×3 · 18개월↑ ×6',
  multiplierByTerm: Object.freeze({ 12: 3, 18: 6, 24: 6, 36: 6, 48: 6, 60: 6 }),
});

/** 제조사가 없으면 국산이라고 추정하지 않는다. */
export function resolveAutoplusDepositPolicy(maker: string): DepositPolicy | undefined {
  const normalized = String(maker ?? '').trim();
  if (!normalized) return undefined;
  return isImportBrand(normalized) ? AUTOPLUS_IMPORT_POLICY : AUTOPLUS_DOMESTIC_POLICY;
}

/** 기간별 월대여료에 곱할 보증금 배수. 알 수 없는 기간은 undefined로 둔다. */
export function depositMultiplierForTerm(policy: DepositPolicy, termMonths: number): number | undefined {
  if (!Number.isFinite(termMonths) || termMonths <= 0) return undefined;

  if (policy.kind === 'YEAR_MULTIPLE_CAPPED') {
    return Math.min(termMonths / policy.monthsPerYear, policy.maxMultiplier);
  }

  if (typeof policy.defaultMultiplier === 'number') return policy.defaultMultiplier;
  return policy.multiplierByTerm?.[termMonths];
}

/** 숫자가 필요한 화면/견적에서만 공통으로 사용한다. SSOT에는 계산 규칙 자체를 보존한다. */
export function calculateDepositFromMonthlyRent(
  policy: DepositPolicy,
  termMonths: number,
  monthlyRent: number,
): number | undefined {
  if (!Number.isFinite(monthlyRent) || monthlyRent <= 0) return undefined;
  const multiplier = depositMultiplierForTerm(policy, termMonths);
  if (multiplier === undefined) return undefined;
  return Math.round(monthlyRent * multiplier);
}
