import type { EntityRecord } from '@/lib/intake/entities';
import { vehicleNameOf } from '@/lib/domain/vehicle-name';
export { withVehicleMaker } from '@/lib/domain/vehicle-name';

const text = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();
const comparable = (value: unknown): string => text(value).toLocaleLowerCase('ko').replace(/[\s\-_/·.,()]+/g, '');

/**
 * 문의 당시 차량 식별 스냅샷을 상품 모양으로 복원한다.
 * `vehicle_name === car_number`인 레거시 방은 차명을 차번으로 채운 데이터이므로 이름 snapshot으로 보지 않는다.
 */
export function roomVehicleSnapshot(
  room: EntityRecord,
  product?: EntityRecord | null,
  contract?: EntityRecord | null,
): EntityRecord | null {
  const storedName = text(room.vehicle_name);
  const plateKeys = [
    room.car_number,
    room.vehicle_number,
    contract?.car_number_snapshot,
    product?.car_number,
  ].map(comparable).filter(Boolean);
  const usableName = storedName && !plateKeys.includes(comparable(storedName)) ? storedName : '';
  const hasStructuredIdentity = [
    room.model,
    room.sub_model,
    room.variant,
    room.trim_name,
    room.trim_extra,
  ].some((value) => !!text(value));
  if (!usableName && !hasStructuredIdentity) return null;

  return {
    maker: text(room.maker) || text(contract?.maker_snapshot) || text(contract?.maker) || text(product?.maker),
    model: text(room.model),
    sub_model: text(room.sub_model),
    variant: text(room.variant),
    trim_name: text(room.trim_name),
    trim_extra: text(room.trim_extra),
    vehicle_name: usableName,
    car_number: text(room.car_number)
      || text(room.vehicle_number)
      || text(contract?.car_number_snapshot)
      || text(product?.car_number),
  };
}

/** 업무 목록용 상품 차량명 — 제조사·세부모델·트림을 빠뜨리지 않고 중복만 제거한다. */
export function productVehicleLabel(product: EntityRecord | null | undefined): string {
  return vehicleNameOf({ kind: 'product', product }, { tier: 'short', fallback: 'none' });
}

/** 계약 목록 차량명 — 계약 당시 snapshot이 정본이고, 결손 필드만 연결 상품으로 보강한다. */
export function contractVehicleLabel(
  contract: EntityRecord | null | undefined,
  product?: EntityRecord | null,
): string {
  if (!contract) return productVehicleLabel(product);
  return vehicleNameOf({ kind: 'contract', contract, product }, { tier: 'short', fallback: 'none' });
}

/** 문의방 차량명 — 문의 당시 방 snapshot → 계약 snapshot → 현재 상품 순으로 복원한다. */
export function roomVehicleLabel(
  room: EntityRecord,
  product?: EntityRecord,
  contract?: EntityRecord,
): string {
  const roomSnapshot = roomVehicleSnapshot(room, product, contract);
  if (roomSnapshot) {
    const roomName = productVehicleLabel(roomSnapshot);
    if (roomName) return roomName;
  }
  const contractName = contractVehicleLabel(contract, product);
  if (contractName) return contractName;
  return productVehicleLabel(product);
}

/** 문의 상세·헤더용 차량명 — 목록과 같은 snapshot을 쓰되 T2 전체 사양까지 복원한다. */
export function roomVehicleDetailLabel(
  room: EntityRecord,
  product?: EntityRecord | null,
  contract?: EntityRecord | null,
): string {
  const roomSnapshot = roomVehicleSnapshot(room, product, contract);
  if (roomSnapshot) {
    const roomName = vehicleNameOf(
      { kind: 'product', product: roomSnapshot },
      { tier: 'full', fallback: 'none' },
    );
    if (roomName) return roomName;
  }
  if (contract) {
    const contractName = vehicleNameOf(
      { kind: 'contract', contract, product },
      { tier: 'full', fallback: 'none' },
    );
    if (contractName) return contractName;
  }
  return vehicleNameOf(
    { kind: 'product', product },
    { tier: 'full', fallback: 'none' },
  );
}
