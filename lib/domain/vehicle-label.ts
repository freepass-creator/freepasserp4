import type { EntityRecord } from '@/lib/intake/entities';
import { makerDisplay } from '@/lib/domain/vehicle-master-match';

function text(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function comparable(value: string): string {
  return value.toLocaleLowerCase('ko').replace(/[\s\-_/·.,()]+/g, '');
}

/** 제조사가 이미 포함된 레거시 차량명에는 다시 붙이지 않는다. */
export function withVehicleMaker(makerRaw: unknown, nameRaw: unknown): string {
  const maker = text(makerDisplay(makerRaw) || makerRaw);
  const name = text(nameRaw);
  if (!maker) return name;
  if (!name) return maker;
  const makerKey = comparable(maker);
  const nameKey = comparable(name);
  return nameKey.includes(makerKey) ? name : `${maker} ${name}`;
}

function appendIfMissing(baseRaw: unknown, suffixRaw: unknown): string {
  const base = text(baseRaw);
  const suffix = text(suffixRaw);
  if (!base) return suffix;
  if (!suffix) return base;
  return comparable(base).includes(comparable(suffix)) ? base : `${base} ${suffix}`;
}

/** 업무 목록용 상품 차량명 — 제조사·세부모델·트림을 빠뜨리지 않고 중복만 제거한다. */
export function productVehicleLabel(product: EntityRecord | null | undefined): string {
  if (!product) return '';
  const structured = appendIfMissing(text(product.sub_model) || text(product.model), product.trim_name);
  const legacyFull = text(product.vehicle_name);
  // 레거시 full name이 구조화 필드보다 더 구체적이면(엔진·트림 포함) 축약하지 않는다.
  const name = comparable(legacyFull).length > comparable(structured).length ? legacyFull : (structured || legacyFull);
  return withVehicleMaker(product.maker, name);
}

/** 계약 스냅샷 차량명 — 상품이 있으면 현재/삭제 상품의 정정된 차량명을 우선한다. */
export function contractVehicleLabel(
  contract: EntityRecord | null | undefined,
  product?: EntityRecord | null,
): string {
  if (!contract && !product) return '';
  const productName = productVehicleLabel(product);
  if (productName) return withVehicleMaker(product?.maker || contract?.maker_snapshot, productName);
  if (!contract) return '';
  const snapshot = text(contract.vehicle_name_snapshot)
    || text(contract.vehicle_name)
    || text(contract.sub_model_snapshot)
    || text(contract.model_snapshot);
  return withVehicleMaker(contract.maker_snapshot, snapshot);
}

/** 문의방 차량명 — 상품 → 계약 스냅샷 → 방 스냅샷 순으로 복원한다. */
export function roomVehicleLabel(
  room: EntityRecord,
  product?: EntityRecord,
  contract?: EntityRecord,
): string {
  const productName = productVehicleLabel(product);
  if (productName) return withVehicleMaker(product?.maker || contract?.maker_snapshot || room.maker, productName);
  const contractName = contractVehicleLabel(contract);
  if (contractName) return contractName;
  const roomName = text(room.vehicle_name) || text(room.sub_model) || text(room.model);
  return withVehicleMaker(room.maker, appendIfMissing(roomName, room.trim_name));
}
