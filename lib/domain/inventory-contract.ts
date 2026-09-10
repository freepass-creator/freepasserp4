/**
 * 프리패스 재고 대수 계약.
 *
 * Firestore `products` 문서 하나가 등록 원자 하나다. 한 번 등록된 원자는 판매돼도
 * 삭제하지 않고 `vehicle_status=출고불가`로 남긴다. 따라서 현재 재고는 오직
 * `등록 원자 - 출고불가`로 계산한다. 가격·계약중·검수상태·저장된 `listable` 값은
 * 재고 대수에서 차를 빼는 조건이 아니다.
 */
import { isPlate } from '@/lib/domain/plate-registry';

export type InventoryAtomLike = {
  car_number?: unknown;
  _key?: unknown;
  vehicle_status?: unknown;
  listable?: unknown;
  _deleted?: unknown;
  deletedAt?: unknown;
  status?: unknown;
  status_kind?: unknown;
  provider_company_code?: unknown;
  partner_code?: unknown;
  source?: unknown;
  source_schema?: unknown;
};

export const UNAVAILABLE_INVENTORY_STATUS = '출고불가' as const;

export function inventoryStatus(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '');
}

export function isUnavailableInventoryAtom(atom: InventoryAtomLike): boolean {
  return inventoryStatus(atom.vehicle_status) === UNAVAILABLE_INVENTORY_STATUS;
}

/** 현재 재고 = 등록된 Firestore 원자 중 출고불가가 아닌 원자. */
export function isOpenInventoryAtom(atom: InventoryAtomLike): boolean {
  return !isUnavailableInventoryAtom(atom);
}

/** `listable`은 정본이 아니라 상태에서 파생되는 캐시다. */
export function expectedInventoryListable(atom: InventoryAtomLike): boolean {
  return isOpenInventoryAtom(atom);
}

/** `status_kind`도 `vehicle_status`에서만 계산하는 파생 캐시다. 빈 상태는 미완성 재고이므로 준비로 둔다. */
export function expectedInventoryStatusKind(atom: InventoryAtomLike): string {
  const status = String(atom.vehicle_status ?? '').trim();
  if (status === '즉시출고' || status === '출고가능') return '가용';
  if (status === '출고협의') return '협의';
  if (status === '상품화중' || status === '차량검수' || !status) return '준비';
  if (status === '계약중') return '선점';
  return '불가';
}

/** 레거시 삭제 표기는 자료형이 달라도 모두 계약 위반으로 잡는다. */
export function hasDeletedInventoryMarker(atom: InventoryAtomLike): boolean {
  return atom._deleted === true
    || atom._deleted === 1
    || String(atom._deleted ?? '').trim().toLowerCase() === 'true'
    || Boolean(String(atom.deletedAt ?? '').trim())
    || String(atom.status ?? '').trim().toLowerCase() === 'deleted';
}

export type InventoryCountSnapshot = {
  registered: number;
  unavailable: number;
  open: number;
  listableDrift: number;
  statusKindDrift: number;
  sourceIdentityViolations: number;
  deletedMarkerViolations: number;
  blankPlateViolations: number;
  invalidPlateViolations: number;
  duplicatePlateViolations: number;
  byStatus: Record<string, number>;
};

export function inventoryCountSnapshot(atoms: readonly InventoryAtomLike[]): InventoryCountSnapshot {
  const byStatus: Record<string, number> = {};
  let unavailable = 0;
  let listableDrift = 0;
  let statusKindDrift = 0;
  let sourceIdentityViolations = 0;
  let deletedMarkerViolations = 0;
  let blankPlateViolations = 0;
  let invalidPlateViolations = 0;
  let duplicatePlateViolations = 0;
  const plates = new Set<string>();

  for (const atom of atoms) {
    const status = inventoryStatus(atom.vehicle_status) || '(빈상태)';
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (isUnavailableInventoryAtom(atom)) unavailable++;
    if (atom.listable !== expectedInventoryListable(atom)) listableDrift++;
    if (String(atom.status_kind ?? '').trim() !== expectedInventoryStatusKind(atom)) statusKindDrift++;
    const provider = String(atom.provider_company_code ?? '').trim() || String(atom.partner_code ?? '').trim();
    const source = String(atom.source ?? '').trim() || String(atom.source_schema ?? '').trim();
    if (!provider || !source) sourceIdentityViolations++;
    // 판매차를 삭제로 처리하면 안 된다. 발견은 하되 대수 계약을 몰래 바꾸지 않는다.
    if (hasDeletedInventoryMarker(atom)) deletedMarkerViolations++;
    const plate = String(atom.car_number ?? '').replace(/\s+/g, '');
    if (!plate) blankPlateViolations++;
    else {
      // 국내 등록번호 형식만 원자 키로 인정한다. 출고불가 원자도 영구 이력이므로 예외가 아니다.
      if (!isPlate(plate)) invalidPlateViolations++;
      if (plates.has(plate)) duplicatePlateViolations++;
      else plates.add(plate);
    }
  }

  return {
    registered: atoms.length,
    unavailable,
    open: atoms.length - unavailable,
    listableDrift,
    statusKindDrift,
    sourceIdentityViolations,
    deletedMarkerViolations,
    blankPlateViolations,
    invalidPlateViolations,
    duplicatePlateViolations,
    byStatus,
  };
}

export function hasInventoryPublicationViolations(snapshot: InventoryCountSnapshot): boolean {
  return Boolean(snapshot.listableDrift
    || snapshot.statusKindDrift
    || snapshot.sourceIdentityViolations
    || snapshot.deletedMarkerViolations
    || snapshot.blankPlateViolations
    || snapshot.invalidPlateViolations
    || snapshot.duplicatePlateViolations);
}
