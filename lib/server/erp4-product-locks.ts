import 'server-only';

import { firebaseAdminDatabase } from '@/lib/server/firebase-admin';
import {
  erp4LockPlateKey,
  erp4LockProviderPlateKey,
  type Erp4ProductLock,
} from '@/lib/domain/erp4-product-lock';
export { applyErp4ProductLock } from '@/lib/domain/erp4-product-lock';

/**
 * ERP4 유지기간의 계약 엔진 락만 읽는다.
 * ERP3 상품의 차명·가격·공급사 상태는 절대 합치지 않고, 실제 lock owner가 있는 두 상태만 인정한다.
 */
export async function readErp4ProductLocks(): Promise<Map<string, Erp4ProductLock>> {
  const snapshot = await firebaseAdminDatabase().ref('v4/products').get();
  const locks = new Map<string, Erp4ProductLock>();
  const put = (key: string, lock: Erp4ProductLock) => {
    if (!key) return;
    const previous = locks.get(key);
    if (previous && (previous.locked_by_contract !== lock.locked_by_contract
      || previous.vehicle_status !== lock.vehicle_status)) {
      throw new Error(`ERP4 계약락 충돌: ${key}`);
    }
    locks.set(key, lock);
  };
  for (const [documentId, value] of Object.entries((snapshot.val() || {}) as Record<string, Record<string, unknown>>)) {
    const data = value || {};
    const owner = String(data.locked_by_contract || '').trim();
    const status = String(data.vehicle_status || '').trim();
    if (!owner || (status !== '계약중' && status !== '출고불가')) continue;
    const lock = { vehicle_status: status, locked_by_contract: owner } as Erp4ProductLock;
    put(documentId, lock);
    const productCode = String(data.product_code || '').trim();
    put(productCode, lock);
    const plate = String(data.car_number || '').replace(/\s+/g, '');
    const provider = String(data.provider_company_code || data.partner_code || '').trim();
    if (plate) {
      put(erp4LockPlateKey(plate), lock);
      if (provider) put(erp4LockProviderPlateKey(provider, plate), lock);
    }
  }
  return locks;
}
