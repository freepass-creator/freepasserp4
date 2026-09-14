export type Erp4ProductLock = {
  vehicle_status: '계약중' | '출고불가';
  locked_by_contract: string;
};

export const erp4LockPlateKey = (plate: unknown): string => `plate:${String(plate ?? '').replace(/\s+/g, '')}`;
export const erp4LockProviderPlateKey = (provider: unknown, plate: unknown): string =>
  `provider:${String(provider ?? '').trim().toUpperCase()}|${erp4LockPlateKey(plate)}`;

/** ERP3 계약 엔진의 실제 락만 ERP5 상품의 운영 상태로 투영한다. */
export function applyErp4ProductLock(
  product: Record<string, unknown>,
  documentId: string,
  locks: ReadonlyMap<string, Erp4ProductLock>,
): Record<string, unknown> {
  const productCode = String(product.product_code || documentId).trim();
  const provider = String(product.provider_company_code || product.partner_code || '').trim();
  const plate = String(product.car_number || '').trim();
  const lock = locks.get(productCode)
    || locks.get(documentId)
    || (provider && plate ? locks.get(erp4LockProviderPlateKey(provider, plate)) : undefined)
    // 같은 실차가 공급사/문서키를 달리해 중복돼도 계약락은 모든 원자에 fail-closed 적용한다.
    || (plate ? locks.get(erp4LockPlateKey(plate)) : undefined);
  if (!lock) return product;
  return {
    ...product,
    ...lock,
    // 기존 ERP4 화면·커넥터가 읽는 상태 별칭도 같은 운영 락에서 파생한다.
    status: lock.vehicle_status,
    ...(lock.vehicle_status === '출고불가' ? { listable: false } : {}),
  };
}
