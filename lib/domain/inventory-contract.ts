/**
 * 프리패스 재고 대수 계약.
 *
 * Firestore `products` 문서 하나가 등록 원자 하나다. 한 번 등록된 원자는 판매돼도
 * 삭제하지 않고 `vehicle_status=출고불가`로 남긴다. 따라서 현재 재고는 오직
 * `등록 원자 - 출고불가`로 계산한다. 가격·계약중·검수상태·저장된 `listable` 값은
 * 재고 대수에서 차를 빼는 조건이 아니다.
 */
import { sonokongDepositRuleText } from './sales-published-tabs';
import { isPlate } from '@/lib/domain/plate-registry';

export type InventoryAtomLike = {
  car_number?: unknown;
  price?: unknown;
  deposit_note?: unknown;
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
  product_type?: unknown;
  sonokong_classification?: unknown;
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
  depositRuleViolations: number;
  byStatus: Record<string, number>;
};

/**
 * 한 원자의 구독/픽업 보증금 규격 위반 여부 — 규칙 글자를 싣고도 계산된 숫자를 남겼는가.
 * ★규칙·글자 정본은 `sales-published-tabs.sonokongDepositRuleText()` 다. 여기서는 «숫자가 남았는지»만 본다
 *   (글자 내용을 여기서 다시 적으면 문장이 두 곳에 생긴다 — 그래서 존재 여부만 본다).
 */
export function hasDepositRuleViolation(atom: InventoryAtomLike): boolean {
  /**
   * ★**「규칙 계산식」일 때만 본다.** 실측 2026-09-17 — 처음엔 `deposit_note` 가 «있으면» 위반으로 봤더니
   *   RP004 3대(note=「무보증」)가 걸렸다. 「무보증」은 원천이 «말로 준 값»이고 우리 계산식이 아니다 —
   *   성격이 다른 것을 같은 규격으로 묶으면 멀쩡한 차가 발행을 막는다.
   *   (그 3대는 「무보증」인데 보증금 숫자가 있는 «원천 모순»이라 따로 볼 일이다 — 여기서 삼키지 않는다.)
   */
  if (String(atom.deposit_note ?? '').trim() !== sonokongDepositRuleText()) return false;
  const classification = atom.sonokong_classification as { product_type?: unknown } | undefined;
  if (String(classification?.product_type ?? atom.product_type ?? '').trim() === '중고렌트') return false;
  const price = atom.price;
  if (!price || typeof price !== 'object') return false;
  return Object.values(price as Record<string, { deposit?: unknown }>)
    .some((term) => Number(term?.deposit) > 0);
}

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
  let depositRuleViolations = 0;
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
    /**
     * ★★**구독/픽업 보증금은 «숫자로 계산해 박지 않는다» — 규칙 글자로 싣는다.**
     *   사장님 2026-09-17 「손오공 보증금 ssot에 제대로 반영 안된거 같음」·「규칙 글자로」·
     *   「ssot에 박아서 누가 업데이트하더라도 바뀌게끔」.
     *   ⇒ 규격을 «발행 문지기»에 박는다. 누가 어떤 도구로 계산값을 다시 박아도, 그 원자로는
     *     F01·F86 발행이 멈춘다(두 발행기가 이 한 문지기를 본다).
     *   판정: `deposit_note`(규칙 글자)가 있는 원자에 `price[기간].deposit > 0` 이 남아 있으면 위반이다.
     *     판매시트는 보증금 칸이 «빌 때만» 규칙 글자를 쓰므로, 숫자가 남으면 규칙 글자가 영영 안 보인다.
     *   손오공 중고렌트는 ERP RENT_* 보증금 숫자가 정본이며 이 규칙 검사 대상이 아니다.
     *   ⚠ 규칙 글자가 «없는» 공급사는 숫자 보증금이 정상이다(원천이 금액으로 준다) — 건드리지 않는다.
     */
    if (hasDepositRuleViolation(atom)) depositRuleViolations++;
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
    depositRuleViolations,
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
    || snapshot.duplicatePlateViolations
    || snapshot.depositRuleViolations);
}
