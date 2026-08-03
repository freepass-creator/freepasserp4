import type { EntityRecord } from '@/lib/intake/entities';
import { sheetConflictFingerprint } from '@/lib/domain/sheet-conflict-resolution';
import {
  PENDING_IDENTITY_DRIFT_CATEGORY,
  PENDING_SIGNATURE_CATEGORY,
  UNOWNED_DELETED_CATEGORY,
  type SheetIdentityReviewCategory,
} from '@/lib/domain/sheet-identity-conflict-review';

export const SAME_VEHICLE_RESTORE_REVIEW = 'same_vehicle_restore_review';
export const DIFFERENT_VEHICLE_CREATE_REVIEW = 'different_vehicle_create_review';
export const SAME_VEHICLE_KEEP_OLD_PENDING_ID = 'same_vehicle_keep_old_pending_id';
export const DIFFERENT_VEHICLE_KEEP_NEW_PENDING_ID = 'different_vehicle_keep_new_pending_id';
export const SAME_VEHICLE_ACCEPT_ATOM_UPDATE = 'same_vehicle_accept_atom_update';
export const DIFFERENT_VEHICLE_ALLOCATE_NEW_PENDING_ID = 'different_vehicle_allocate_new_pending_id';
export const EXCLUDE_SHEET_ROW = 'exclude_sheet_row';

export type SheetIdentityDecisionCategory = SheetIdentityReviewCategory;
export type SheetIdentityDecisionValue =
  | typeof SAME_VEHICLE_RESTORE_REVIEW
  | typeof DIFFERENT_VEHICLE_CREATE_REVIEW
  | typeof SAME_VEHICLE_KEEP_OLD_PENDING_ID
  | typeof DIFFERENT_VEHICLE_KEEP_NEW_PENDING_ID
  | typeof SAME_VEHICLE_ACCEPT_ATOM_UPDATE
  | typeof DIFFERENT_VEHICLE_ALLOCATE_NEW_PENDING_ID
  | typeof EXCLUDE_SHEET_ROW;

export type SheetIdentityDecision = {
  fingerprint: string;
  category: SheetIdentityDecisionCategory;
  decision: SheetIdentityDecisionValue;
  status: 'recorded' | 'revoked';
  provider: string;
  existing_key: string;
  incoming_key: string;
  recorded_at?: number;
  recorded_by?: string;
  revoked_at?: number;
  revoked_by?: string;
};

/** raw는 지문 재검증과 계약보호 확인에만 쓰며 원장에는 저장하지 않는다. */
export type SheetIdentityDecisionInput = {
  fingerprint: string;
  category: SheetIdentityDecisionCategory;
  decision: SheetIdentityDecisionValue;
  raw: string;
  provider: string;
  existingKey: string;
  incomingKey: string;
};

const text = (value: unknown): string => String(value ?? '').trim();
const normalizePlate = (value: unknown): string => text(value).replace(/\s/g, '');
const productPlate = (row: EntityRecord): string => normalizePlate(row.car_number || row.car_number_snapshot);

export function identityDecisionFingerprint(category: SheetIdentityDecisionCategory, raw: string): string {
  return sheetConflictFingerprint(category, raw);
}

function compatibleDecision(
  category: SheetIdentityDecisionCategory | undefined,
  decision: SheetIdentityDecisionValue | undefined,
): boolean {
  if (decision === EXCLUDE_SHEET_ROW) return category === UNOWNED_DELETED_CATEGORY
    || category === PENDING_IDENTITY_DRIFT_CATEGORY
    || category === PENDING_SIGNATURE_CATEGORY;
  if (category === UNOWNED_DELETED_CATEGORY) {
    return decision === SAME_VEHICLE_RESTORE_REVIEW || decision === DIFFERENT_VEHICLE_CREATE_REVIEW;
  }
  if (category === PENDING_IDENTITY_DRIFT_CATEGORY) {
    return decision === SAME_VEHICLE_KEEP_OLD_PENDING_ID || decision === DIFFERENT_VEHICLE_KEEP_NEW_PENDING_ID;
  }
  if (category === PENDING_SIGNATURE_CATEGORY) {
    return decision === SAME_VEHICLE_ACCEPT_ATOM_UPDATE
      || decision === DIFFERENT_VEHICLE_ALLOCATE_NEW_PENDING_ID;
  }
  return false;
}

export function validSheetIdentityDecisionInput(input: unknown): input is SheetIdentityDecisionInput {
  if (!input || typeof input !== 'object') return false;
  const value = input as Partial<SheetIdentityDecisionInput>;
  if (typeof value.raw !== 'string' || !value.raw.trim() || value.raw.length > 1_000) return false;
  if (typeof value.fingerprint !== 'string' || !/^SCR-[0-9a-f]{16}$/.test(value.fingerprint)) return false;
  if (typeof value.provider !== 'string' || !value.provider.trim() || value.provider.length > 100) return false;
  if (typeof value.existingKey !== 'string' || !value.existingKey.trim() || value.existingKey.length > 200) return false;
  if (typeof value.incomingKey !== 'string' || !value.incomingKey.trim() || value.incomingKey.length > 200) return false;
  return compatibleDecision(value.category, value.decision)
    && value.fingerprint === identityDecisionFingerprint(value.category!, value.raw);
}

/** 충돌 원문에서 보호 확인에 필요한 차량번호만 추출한다. 빈 결과는 서버에서 fail-closed 처리한다. */
export function identityConflictPlates(raw: string, category: SheetIdentityDecisionCategory): string[] {
  let values: string[] = [];
  if (category === UNOWNED_DELETED_CATEGORY) {
    values = [text(raw).split(' (')[0]];
  } else if (category === PENDING_SIGNATURE_CATEGORY) {
    values = [text(raw).split('|').at(-1) || ''];
  } else if (category === PENDING_IDENTITY_DRIFT_CATEGORY) {
    const match = /^.+? \(기존 (.+?) ↔ 신규 (.+?)\)$/.exec(text(raw));
    if (match) values = [...match[1].split(','), ...match[2].split(',')];
  }
  return [...new Set(values.map(normalizePlate).filter(Boolean))];
}

function terminalContract(row: EntityRecord): boolean {
  return [
    '계약완료', '완료', '계약취소', '취소', 'completed', 'complete', 'cancelled', 'canceled',
  ].includes(text(row.contract_status || row.status).toLowerCase());
}

/** 판단 기록도 계약 차량에는 허용하지 않는다. 차량번호를 해석할 수 없으면 안전하게 차단한다. */
export function isSheetIdentityDecisionProtected(
  raw: string,
  category: SheetIdentityDecisionCategory,
  products: EntityRecord[],
  contracts: EntityRecord[],
): boolean {
  const plates = new Set(identityConflictPlates(raw, category));
  if (!plates.size) return true;
  const matched = products.filter((row) => plates.has(productPlate(row)));
  if (matched.some((row) => !!text(row.locked_by_contract) || text(row.vehicle_status) === '계약중')) return true;
  const keys = new Set(matched.flatMap((row) => [row._key, row.product_code, row.product_uid, row._rtdb_key])
    .map(text).filter(Boolean));
  return contracts.some((contract) => {
    if (contract._deleted === true || contract.deletedAt || terminalContract(contract)) return false;
    if (plates.has(productPlate(contract))) return true;
    return [contract.product_code, contract.product_uid, contract.product_id]
      .map(text).filter(Boolean).some((key) => keys.has(key));
  });
}

export function sheetIdentityDecisionLabel(value: SheetIdentityDecisionValue): string {
  return ({
    [SAME_VEHICLE_RESTORE_REVIEW]: '동일 차량 · 기존 삭제키 복구/귀속 검토',
    [DIFFERENT_VEHICLE_CREATE_REVIEW]: '다른 차량 · 삭제 유지/Sheet 신규 검토',
    [SAME_VEHICLE_KEEP_OLD_PENDING_ID]: '동일 차량 · 기존 임시번호 유지',
    [DIFFERENT_VEHICLE_KEEP_NEW_PENDING_ID]: '다른 차량 · 신규 임시번호 유지',
    [SAME_VEHICLE_ACCEPT_ATOM_UPDATE]: '동일 차량 · 원자 수정 수용 검토',
    [DIFFERENT_VEHICLE_ALLOCATE_NEW_PENDING_ID]: '다른 차량 · 신규 임시번호 발급 검토',
    [EXCLUDE_SHEET_ROW]: 'Sheet 오류 · 유입 제외',
  } as Record<SheetIdentityDecisionValue, string>)[value];
}

export function sheetIdentityDecisionOptions(category: SheetIdentityDecisionCategory): SheetIdentityDecisionValue[] {
  if (category === UNOWNED_DELETED_CATEGORY) {
    return [SAME_VEHICLE_RESTORE_REVIEW, DIFFERENT_VEHICLE_CREATE_REVIEW, EXCLUDE_SHEET_ROW];
  }
  if (category === PENDING_IDENTITY_DRIFT_CATEGORY) {
    return [SAME_VEHICLE_KEEP_OLD_PENDING_ID, DIFFERENT_VEHICLE_KEEP_NEW_PENDING_ID, EXCLUDE_SHEET_ROW];
  }
  return [SAME_VEHICLE_ACCEPT_ATOM_UPDATE, DIFFERENT_VEHICLE_ALLOCATE_NEW_PENDING_ID, EXCLUDE_SHEET_ROW];
}
