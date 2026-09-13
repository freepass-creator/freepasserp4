import type { FreepassAtom, RentTerm } from './supplier-adapter';

export type PublishChannel = 'ATOM' | 'F01' | 'ERP';

export type EligibilityContext = {
  supplierEnabled?: boolean;
  channelEnabled?: boolean;
};

export type EligibilityDecision = {
  eligible: boolean;
  reasons: string[];
};

const REAL_PLATE = /^\d{2,3}[가-힣]\d{4}$/;
const SELLABLE_STATUS = /^(?:출고가능|즉시출고|출고협의|배차가능|판매중|재고)$/;
const NON_SELLABLE_STATUS = /(?:출고불가|계약중|판매완료|인도완료|삭제|종료|해지)/;
const RENT_TERMS: RentTerm[] = [1, 6, 12, 24, 36, 48, 60];

export function hasStableIdentity(atom: FreepassAtom): boolean {
  const plate = String(atom.plateNumber || '').replace(/\s+/g, '');
  const vin = String(atom.vin || '').replace(/\s+/g, '');
  return REAL_PLATE.test(plate) || vin.length >= 6;
}

export function hasVehicleMeaning(atom: FreepassAtom): boolean {
  return Boolean(atom.model || atom.rawName || atom.subModel || atom.trim || atom.maker);
}

export function hasSellableRent(atom: FreepassAtom): boolean {
  return RENT_TERMS.some((term) => {
    const v = atom.rent[term];
    return typeof v === 'number' && Number.isFinite(v) && v > 0;
  });
}

export function isExplicitlySellableStatus(status: unknown): boolean {
  const s = String(status ?? '').replace(/\s+/g, '');
  if (!s || NON_SELLABLE_STATUS.test(s)) return false;
  return SELLABLE_STATUS.test(s);
}

/**
 * SSOT 수집과 판매 노출은 다른 판단이다.
 *
 * ATOM: 원천에 실제로 존재하는 차량을 보존한다. 식별키만 필수다.
 * F01/ERP: 영업자가 지금 쓸 수 있는 차량만 통과시킨다.
 *          애매한 상태를 "아마 판매 가능"으로 추정하지 않는다.
 */
export function evaluateEligibility(
  atom: FreepassAtom,
  channel: PublishChannel,
  context: EligibilityContext = {},
): EligibilityDecision {
  const reasons: string[] = [];

  if (!hasStableIdentity(atom)) reasons.push('IDENTITY_MISSING');

  if (channel === 'ATOM') {
    return { eligible: reasons.length === 0, reasons };
  }

  if (context.supplierEnabled === false) reasons.push('SUPPLIER_DISABLED');
  if (context.channelEnabled === false) reasons.push('CHANNEL_DISABLED');
  if (!hasVehicleMeaning(atom)) reasons.push('VEHICLE_MEANING_MISSING');
  if (!isExplicitlySellableStatus(atom.status)) reasons.push('STATUS_NOT_EXPLICITLY_SELLABLE');
  if (!hasSellableRent(atom)) reasons.push('RENT_MISSING');

  return { eligible: reasons.length === 0, reasons };
}

export const ELIGIBILITY_CONTRACT = Object.freeze({
  atom: '식별 가능한 실제 원천 차량은 보존한다.',
  f01: '식별 가능 + 차량 의미 있음 + 명시적 판매가능 상태 + 판매 가능한 기간요금 1개 이상 + 공급사/채널 사용중',
  erp: 'F01과 동일한 판매 가능성 계약을 사용한다. 공급사별 해석은 어댑터 앞단에서 끝낸다.',
  sellableStatuses: ['출고가능', '즉시출고', '출고협의', '배차가능', '판매중', '재고'],
  rentTerms: RENT_TERMS,
});
