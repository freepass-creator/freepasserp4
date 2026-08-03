import type { EntityRecord } from '@/lib/intake/entities';
import { stripProductCost } from '@/lib/firebase/rtdb-products';

export type ProductBridgeActor = {
  role: 'agent' | 'provider' | 'admin';
  companyCode: string;
};

type RecordValue = Record<string, unknown>;

const clean = (value: unknown) => String(value ?? '').trim();
const plateOf = (record: RecordValue) => clean(
  record.car_number || record.car_number_snapshot || record.vehicle_number,
).replace(/\s/g, '');

export type ProductBridgeReferences = {
  productKeys: Set<string>;
  plates: Set<string>;
};

/** 계약·문의가 가리키는 상품키/차번만 추출한다. 원문 레코드나 고객 PII는 반환하지 않는다. */
export function collectProductBridgeReferences(
  collections: Array<Record<string, RecordValue>>,
): ProductBridgeReferences {
  const productKeys = new Set<string>();
  const plates = new Set<string>();
  for (const collection of collections) {
    for (const record of Object.values(collection || {})) {
      if (!record || typeof record !== 'object') continue;
      for (const value of [record.product_code, record.product_uid, record.product_id]) {
        const key = clean(value);
        if (key) productKeys.add(key);
      }
      const plate = plateOf(record);
      if (plate) plates.add(plate);
    }
  }
  return { productKeys, plates };
}

/**
 * 응답은 활성 v3 재고와 계약·문의가 참조하는 삭제 이력만 포함한다.
 * 5천여 삭제 레코드를 매 화면마다 전달하지 않으면서 chat/contract의 과거 차량명 복원은 유지한다.
 */
export function selectLegacyProductsForBridge(
  products: Record<string, EntityRecord>,
  references: ProductBridgeReferences,
): Record<string, EntityRecord> {
  return Object.fromEntries(Object.entries(products).filter(([childKey, product]) => {
    if (!product || typeof product !== 'object') return false;
    const active = product._deleted !== true
      && !product.deletedAt
      && clean(product.status) !== 'deleted';
    if (active) return true;
    const keys = [childKey, product.product_code, product.product_uid, product._key]
      .map(clean)
      .filter(Boolean);
    return keys.some((key) => references.productKeys.has(key))
      || references.plates.has(plateOf(product));
  }));
}

/**
 * v3 products 원문을 서버 밖으로 내보내기 직전 역할별로 투영한다.
 * 관리자는 원문, 공급사는 자기 회사 원문, 영업자와 타 공급사 매물은 공개 원자만 반환한다.
 */
export function projectLegacyProductForActor(
  product: EntityRecord,
  actor: ProductBridgeActor,
): EntityRecord {
  if (actor.role === 'admin') return product;
  const owner = String(product.provider_company_code || '').trim();
  if (actor.role === 'provider' && actor.companyCode && owner === actor.companyCode) return product;
  return stripProductCost(product);
}

export function projectLegacyProductsForActor(
  products: Record<string, EntityRecord>,
  actor: ProductBridgeActor,
): Record<string, EntityRecord> {
  return Object.fromEntries(
    Object.entries(products).map(([key, product]) => [key, projectLegacyProductForActor(product, actor)]),
  );
}
