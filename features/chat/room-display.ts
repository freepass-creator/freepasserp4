import type { EntityRecord } from '@/lib/intake/entities';
import { isHiddenFromCatalog, vehicleName } from '@/lib/domain/product';

export type ProductLookup = {
  byId: Map<string, EntityRecord>;
  byCar: Map<string, EntityRecord>;
};

const roomKey = (record: EntityRecord) => `${String(record.product_code)}|${String(record.agent_code)}`;

export function buildContractIndex(contracts: EntityRecord[], cancelled: boolean): Map<string, EntityRecord> {
  const index = new Map<string, EntityRecord>();
  for (const contract of contracts) {
    const isCancelled = contract.contract_status === '계약취소';
    if (isCancelled !== cancelled) continue;
    const key = roomKey(contract);
    if (!index.has(key)) index.set(key, contract);
  }
  return index;
}

export function contractForRoom(index: Map<string, EntityRecord>, room: EntityRecord): EntityRecord | undefined {
  return index.get(roomKey(room));
}

export function buildProductLookup(products: EntityRecord[]): ProductLookup {
  const byId = new Map<string, EntityRecord>();
  const byCar = new Map<string, EntityRecord>();
  for (const product of products) {
    const code = String(product.product_code || '');
    const key = String(product._key || '');
    // erp3 방은 상품의 RTDB 키를 product_uid로 들고 있다(erp3 조인: p._key === room.product_uid).
    // erp4는 상품을 product_code로 리키잉하므로 원본 키(product_uid)도 같이 색인해야 예전 문의가 차를 찾는다.
    const uid = String(product.product_uid || '');
    const car = String(product.car_number || '');
    if (code) byId.set(code, product);
    if (key && !byId.has(key)) byId.set(key, product);
    if (uid && !byId.has(uid)) byId.set(uid, product);
    if (car) byCar.set(car, product);
  }
  return { byId, byCar };
}

function productForRoom(lookup: ProductLookup, room: EntityRecord): EntityRecord | undefined {
  const car = String(room.car_number || '');
  return lookup.byId.get(String(room.product_code))
    || lookup.byId.get(String(room.product_uid))
    || lookup.byId.get(String(room.product_id))
    || (car ? lookup.byCar.get(car) : undefined);
}

export function roomTitle(
  room: EntityRecord,
  products: ProductLookup,
  deletedProducts: ProductLookup,
  contracts: EntityRecord[],
  activeContract?: EntityRecord,
): string {
  const storedName = String(room.vehicle_name || '').trim();
  if (storedName) return storedName;
  const car = String(room.car_number || '').trim();
  const product = productForRoom(products, room);
  if (product) {
    const name = vehicleName(product);
    // 출고불가 = 삭제가 아니라 살아있는 차 → 상태를 그대로 알린다.
    if (name) return isHiddenFromCatalog(product) ? `${name} (출고불가)` : name;
  }
  const productCode = String(room.product_code || '');
  const contract = productCode
    ? activeContract
      || contracts.find((candidate) => String(candidate.product_code) === productCode && String(candidate.contract_status || '') !== '계약취소')
      || contracts.find((candidate) => String(candidate.product_code) === productCode)
    : undefined;
  if (contract) {
    const snapshot = [contract.maker_snapshot, contract.sub_model_snapshot].filter(Boolean).join(' ').trim();
    if (snapshot) return snapshot;
    const snapshotCar = String(contract.car_number_snapshot || '').trim();
    if (snapshotCar) return snapshotCar;
  }
  const deleted = productForRoom(deletedProducts, room);
  if (deleted) {
    const name = vehicleName(deleted);
    if (name) return car ? `${name} (삭제)` : name;
  }
  // 삭제 단정 금지 — 출고불가·중복정리·카탈로그 미로드 등 "살아있는데 조회만 안 되는" 경우가 있다.
  // 차량번호는 끝까지 보존하고, 삭제로 확인된 건(위 deletedProducts)만 삭제로 표기.
  return car || '차량 조회불가';
}

export function providerForRoom(room: EntityRecord, products: ProductLookup): { code: string; name: string } {
  const code = String(room.provider_company_code || '').trim();
  const product = productForRoom(products, room);
  const name = String(product?.provider_name || product?.provider_name_full || room.provider_name || '').trim();
  return { code, name: name || code };
}
