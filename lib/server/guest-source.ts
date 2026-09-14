import { firestoreAdminRef } from '@/lib/server/firestore-ref-shim';
import { erp5LegacyProductReadAllowed, erp5ProductReadEnabled, readActiveErp5Products } from '@/lib/server/erp5-admin';
import { projectErp5ProductForErp4 } from '@/lib/domain/erp5-product-ssot';
import { applyErp4ProductLock, readErp4ProductLocks } from '@/lib/server/erp4-product-locks';

/**
 * 손님 화면용 서버 캐시. 절체 전에는 ERP3 유지본을, 절체 후에는 ERP5 활성 상품과
 * ERP3 계약 락만 읽는다. 화면은 어느 경우에도 Google Sheets를 직접 읽지 않는다.
 */
type Rec = Record<string, unknown>;
type Snap = { at: number; products: Record<string, Rec>; policies: Record<string, Rec> };

const TTL_MS = 60_000;
let snap: Snap | null = null;
let inflight: Promise<Snap> | null = null;

async function read(): Promise<Snap> {
  const db = firestoreAdminRef();
  if (!erp5ProductReadEnabled()) {
    if (!erp5LegacyProductReadAllowed()) throw new Error('ERP3 상품 유지 읽기가 승인되지 않았습니다.');
    const [products, policies] = await Promise.all([db.ref('v4/products').get(), db.ref('policies').get()]);
    return {
      at: Date.now(),
      products: (products.val() || {}) as Record<string, Rec>,
      policies: (policies.val() || {}) as Record<string, Rec>,
    };
  }
  const [active, locks, q] = await Promise.all([
    readActiveErp5Products(),
    readErp4ProductLocks(),
    db.ref('policies').get(),
  ]);
  const products: Record<string, Rec> = {};
  for (const item of active.products) {
    const projected = applyErp4ProductLock(
      projectErp5ProductForErp4(item.data, item.id),
      item.id,
      locks,
    );
    const key = String(projected.product_code || item.id);
    products[key] = projected;
  }
  return {
    at: Date.now(),
    products,
    policies: (q.val() || {}) as Record<string, Rec>,
  };
}

/** 재고 + 정책을 60초 보관하고 동시 요청은 한 번의 원천 읽기로 합친다. */
export async function guestSource(): Promise<Snap> {
  if (snap && Date.now() - snap.at < TTL_MS) return snap;
  if (inflight) return inflight;
  inflight = read()
    .then((s) => { snap = s; return s; })
    .finally(() => { inflight = null; });
  return inflight;
}
