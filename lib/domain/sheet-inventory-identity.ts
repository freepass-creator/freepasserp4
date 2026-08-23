import { isOpenContractRow } from '@/lib/domain/contract';
import { isExactRealPlate } from '@/lib/domain/product';
import type { EntityRecord } from '@/lib/intake/entities';

export const inventoryText = (value: unknown): string => String(value ?? '').trim();
export const inventoryPlate = (value: unknown): string => inventoryText(value).replace(/\s+/g, '');
export const inventoryProvider = (row: EntityRecord): string => inventoryText(
  row.provider_company_code || row.partner_code,
);

/** 실번호판은 전역 키, `100신…` 번호미정은 공급사별 영구 대체키다. */
export function inventoryIdentity(row: EntityRecord): string {
  const plate = inventoryPlate(row.car_number || row.car_number_snapshot);
  if (isExactRealPlate(plate)) return `plate:${plate}`;
  if (plate) return `pending:${inventoryProvider(row)}|${plate}`;
  return `record:${inventoryText(row.product_code || row._key)}`;
}

export type IndexedInventoryRow = { row: EntityRecord; key: string };

export function indexInventoryRows(rows: EntityRecord[]): {
  byIdentity: Map<string, IndexedInventoryRow>;
  duplicates: Array<{ plate: string; keys: string[] }>;
} {
  const grouped = new Map<string, IndexedInventoryRow[]>();
  for (const row of rows) {
    const plate = inventoryPlate(row.car_number || row.car_number_snapshot);
    const key = inventoryText(row.product_code || row._key);
    if (!plate && !key) continue;
    const identity = inventoryIdentity(row);
    const list = grouped.get(identity) || [];
    list.push({ row, key });
    grouped.set(identity, list);
  }
  const duplicates = [...grouped.values()]
    .filter((list) => list.length > 1)
    .map((list) => ({
      plate: inventoryPlate(list[0].row.car_number || list[0].row.car_number_snapshot),
      keys: list.map((item) => item.key),
    }));
  return {
    byIdentity: new Map([...grouped.entries()].map(([identity, list]) => [identity, list[0]])),
    duplicates,
  };
}

export function contractReferencesInventoryRow(contract: EntityRecord, row: EntityRecord): boolean {
  const keys = new Set([row._key, row._rtdb_key, row.product_code].map(inventoryText).filter(Boolean));
  const plate = inventoryPlate(row.car_number || row.car_number_snapshot);
  return [contract.product_code, contract.product_uid, contract.product_id]
    .map(inventoryText).some((key) => keys.has(key))
    || (!!plate && inventoryPlate(contract.car_number || contract.car_number_snapshot) === plate);
}

export function hasOpenContractReference(row: EntityRecord, contracts: EntityRecord[]): boolean {
  return contracts.some((contract) => isOpenContractRow(contract) && contractReferencesInventoryRow(contract, row));
}
