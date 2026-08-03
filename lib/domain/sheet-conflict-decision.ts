import type { EntityRecord } from '@/lib/intake/entities';
import { sheetConflictFingerprint } from '@/lib/domain/sheet-conflict-resolution';

export const OWNERSHIP_CONFLICT = '공급사 소유 충돌';
export const DELETED_REAPPEARANCE_CONFLICT = '삭제이력 재등장';

export const KEEP_EXISTING_OWNER = 'keep_existing_owner';
export const ASSIGN_SHEET_OWNER = 'assign_sheet_owner';
export const KEEP_DELETED = 'keep_deleted';
export const RESTORE_DELETED = 'restore_deleted';

export type SheetConflictDecisionCategory =
  | typeof OWNERSHIP_CONFLICT
  | typeof DELETED_REAPPEARANCE_CONFLICT;
export type SheetConflictDecisionValue =
  | typeof KEEP_EXISTING_OWNER
  | typeof ASSIGN_SHEET_OWNER
  | typeof KEEP_DELETED
  | typeof RESTORE_DELETED;

export type SheetConflictDecision = {
  fingerprint: string;
  category: SheetConflictDecisionCategory;
  decision: SheetConflictDecisionValue;
  status: 'recorded' | 'revoked';
  provider?: string;
  product_key?: string;
  recorded_at?: number;
  recorded_by?: string;
};

export type SheetConflictDecisionInput = {
  fingerprint: string;
  category: SheetConflictDecisionCategory;
  decision: SheetConflictDecisionValue;
  raw: string;
  provider?: string;
  productKey?: string;
};

const text = (value: unknown): string => String(value ?? '').trim();
const plate = (row: EntityRecord): string => text(row.car_number || row.car_number_snapshot).replace(/\s/g, '');

export function decisionFingerprint(category: SheetConflictDecisionCategory, raw: string): string {
  return sheetConflictFingerprint(category, raw);
}

export function validSheetConflictDecisionInput(input: unknown): input is SheetConflictDecisionInput {
  if (!input || typeof input !== 'object') return false;
  const value = input as Partial<SheetConflictDecisionInput>;
  if (typeof value.raw !== 'string' || !value.raw.trim() || value.raw.length > 1_000) return false;
  if (typeof value.fingerprint !== 'string' || !/^SCR-[0-9a-f]{16}$/.test(value.fingerprint)) return false;
  if (typeof value.provider !== 'string' || !value.provider.trim() || value.provider.length > 100) return false;
  if (typeof value.productKey !== 'string' || !value.productKey.trim() || value.productKey.length > 200) return false;
  const compatible = value.category === OWNERSHIP_CONFLICT
    ? value.decision === KEEP_EXISTING_OWNER || value.decision === ASSIGN_SHEET_OWNER
    : value.category === DELETED_REAPPEARANCE_CONFLICT
      ? value.decision === KEEP_DELETED || value.decision === RESTORE_DELETED
      : false;
  return compatible && value.fingerprint === decisionFingerprint(value.category!, value.raw);
}

export function conflictDecisionPlate(raw: string): string {
  return (text(raw).split(' (')[0].split('|').at(-1) || '').replace(/\s/g, '');
}

function terminalContract(row: EntityRecord): boolean {
  return [
    '계약완료', '완료', '계약취소', '취소', 'completed', 'complete', 'cancelled', 'canceled',
  ].includes(text(row.contract_status || row.status).toLowerCase());
}

/** 결정은 기록만 하더라도 계약 차량에는 오판 선택지를 남기지 않는다. */
export function isSheetConflictDecisionProtected(
  raw: string,
  products: EntityRecord[],
  contracts: EntityRecord[],
): boolean {
  const targetPlate = conflictDecisionPlate(raw);
  if (!targetPlate) return true;
  const matched = products.filter((row) => plate(row) === targetPlate);
  if (matched.some((row) => !!text(row.locked_by_contract) || text(row.vehicle_status) === '계약중')) return true;
  const keys = new Set(matched.flatMap((row) => [row._key, row.product_code, row.product_uid, row._rtdb_key])
    .map(text).filter(Boolean));
  return contracts.some((contract) => {
    if (contract._deleted === true || contract.deletedAt || terminalContract(contract)) return false;
    if (plate(contract) === targetPlate) return true;
    return [contract.product_code, contract.product_uid, contract.product_id]
      .map(text).filter(Boolean).some((key) => keys.has(key));
  });
}

export function sheetConflictDecisionLabel(value: SheetConflictDecisionValue): string {
  return ({
    [KEEP_EXISTING_OWNER]: '기존 공급사 유지',
    [ASSIGN_SHEET_OWNER]: '현재 Sheet 공급사로 변경',
    [KEEP_DELETED]: '삭제 유지',
    [RESTORE_DELETED]: '동일 상품키 복구',
  } as Record<SheetConflictDecisionValue, string>)[value];
}
