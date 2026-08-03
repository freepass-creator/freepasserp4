import type { EntityRecord } from '@/lib/intake/entities';
import type { SheetSyncExistingConflicts } from '@/lib/domain/sheet-sync-all';

export const PRICE_PERIOD_CONFLICT = '기존 가격기간 누락';
export const KEEP_EXISTING_PRICES = 'keep_existing_prices';

export type SheetConflictResolution = {
  fingerprint: string;
  category: typeof PRICE_PERIOD_CONFLICT;
  decision: typeof KEEP_EXISTING_PRICES;
  status: 'approved' | 'revoked';
  provider?: string;
  product_key?: string;
  approved_at?: number;
  approved_by?: string;
};

export type SheetConflictResolutionInput = {
  fingerprint: string;
  category: typeof PRICE_PERIOD_CONFLICT;
  decision: typeof KEEP_EXISTING_PRICES;
  raw: string;
  provider?: string;
  productKey?: string;
  storageKey?: string;
};

function hash32(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 원문이 조금이라도 바뀌면 과거 승인을 재사용하지 않는 deterministic 지문. */
export function sheetConflictFingerprint(category: string, raw: string): string {
  const canonical = `${String(category).trim()}\n${String(raw).trim()}`;
  return `SCR-${hash32(canonical, 2166136261)}${hash32(canonical, 3339675911)}`;
}

export function validPriceResolutionInput(input: unknown): input is SheetConflictResolutionInput {
  if (!input || typeof input !== 'object') return false;
  const candidate = input as Partial<SheetConflictResolutionInput>;
  if (typeof candidate.raw !== 'string' || !candidate.raw.trim() || candidate.raw.length > 1_000) return false;
  if (candidate.provider != null && (typeof candidate.provider !== 'string' || candidate.provider.length > 100)) return false;
  if (candidate.productKey != null && (typeof candidate.productKey !== 'string' || candidate.productKey.length > 200)) return false;
  if (candidate.storageKey != null && (typeof candidate.storageKey !== 'string' || candidate.storageKey.length > 200)) return false;
  return candidate.category === PRICE_PERIOD_CONFLICT
    && candidate.decision === KEEP_EXISTING_PRICES
    && candidate.fingerprint === sheetConflictFingerprint(candidate.category, candidate.raw);
}

export function priceConflictIdentity(raw: string): { provider: string; carNumber: string } {
  const head = String(raw || '').trim().split(' (')[0];
  const separator = head.indexOf('|');
  return separator > 0
    ? { provider: head.slice(0, separator), carNumber: head.slice(separator + 1).replace(/\s/g, '') }
    : { provider: '', carNumber: head.replace(/\s/g, '') };
}

const text = (value: unknown): string => String(value ?? '').trim();
const plate = (row: EntityRecord): string => text(row.car_number || row.car_number_snapshot).replace(/\s/g, '');
const terminalContract = (row: EntityRecord): boolean => [
  '계약완료', '완료', '계약취소', '취소', 'completed', 'complete', 'cancelled', 'canceled',
].includes(text(row.contract_status || row.status).toLowerCase());

/** 계약락·진행계약 차량은 관리자가 가격 유지 승인을 해도 자동 동기화 해제 대상이 아니다. */
export function isPriceConflictProtected(
  raw: string,
  existing: EntityRecord[],
  contracts: EntityRecord[],
): boolean {
  const { provider, carNumber } = priceConflictIdentity(raw);
  const products = existing.filter((row) => plate(row) === carNumber && (!provider || [
    text(row.provider_company_code), text(row.partner_code), text(row._key).split('_')[0],
  ].includes(provider)));
  if (products.some((row) => !!text(row.locked_by_contract) || text(row.vehicle_status) === '계약중')) return true;
  const keys = new Set(products.flatMap((row) => [text(row._key), text(row.product_code), text(row._rtdb_key)]).filter(Boolean));
  return contracts.some((contract) => {
    if (contract._deleted === true || contract.deletedAt || terminalContract(contract)) return false;
    if (plate(contract) === carNumber) return true;
    return [contract.product_code, contract.product_uid, contract.product_id]
      .map(text).filter(Boolean).some((key) => keys.has(key));
  });
}

export function applySheetConflictResolutions(input: {
  conflicts: SheetSyncExistingConflicts;
  resolutions?: SheetConflictResolution[];
  existing: EntityRecord[];
  contracts?: EntityRecord[];
}): { conflicts: SheetSyncExistingConflicts; resolvedPricePeriods: number } {
  const approved = new Set((input.resolutions || [])
    .filter((item) => item.status === 'approved'
      && item.category === PRICE_PERIOD_CONFLICT
      && item.decision === KEEP_EXISTING_PRICES)
    .map((item) => item.fingerprint));
  let resolvedPricePeriods = 0;
  const missingPricePeriods = input.conflicts.missingPricePeriods.filter((raw) => {
    if (!approved.has(sheetConflictFingerprint(PRICE_PERIOD_CONFLICT, raw))) return true;
    if (isPriceConflictProtected(raw, input.existing, input.contracts || [])) return true;
    resolvedPricePeriods++;
    return false;
  });
  return {
    conflicts: { ...input.conflicts, missingPricePeriods },
    resolvedPricePeriods,
  };
}
