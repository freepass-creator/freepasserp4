import type { EntityRecord } from '@/lib/intake/entities';
import { vehicleName } from '@/lib/domain/product';

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
    const car = String(product.car_number || '');
    if (code) byId.set(code, product);
    if (key && !byId.has(key)) byId.set(key, product);
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
    if (name) return name;
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
  return car ? `${car} (삭제된 차량)` : '삭제된 차량';
}

export function providerForRoom(room: EntityRecord, products: ProductLookup): { code: string; name: string } {
  const code = String(room.provider_company_code || '').trim();
  const product = productForRoom(products, room);
  const name = String(product?.provider_name || product?.provider_name_full || room.provider_name || '').trim();
  return { code, name: name || code };
}
