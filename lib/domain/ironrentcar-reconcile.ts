import type { EntityRecord } from '@/lib/intake/entities';
import type { IronRentcarCatalogItem } from '@/lib/server/ironrentcar-source';
import type { GuardedProductPatch } from '@/lib/domain/product-write-guard';

export type IronRentcarReconcilePlan = {
  providerCode: string;
  authority: 'ironrentcar_web';
  matched: number;
  patchCandidates: GuardedProductPatch[];
  unchanged: number;
  createCandidates: EntityRecord[];
  ignoredSoldNew: number;
  webAbsentErp: number;
  absentBlockCandidates: GuardedProductPatch[];
  protectedErpOnly: number;
  alreadyUnavailableErpOnly: number;
  duplicatePlateGroups: number;
  blockedExternalIds: string[];
  candidateOperations: number;
  /** 자동 적용은 별도 승인·CAS 경로 전까지 항상 0. */
  executableOperations: 0;
};

const plateOf = (row: EntityRecord): string => String(row.car_number || row.vehicle_number || '').replace(/\s/g, '');

/**
 * 아이언 홈페이지가 직접 소유하는 공개 상품 필드.
 * 식별키·계약락·원가/VIN/계좌/수수료는 포함하지 않는다.
 */
export const IRONRENTCAR_WEB_OWNED_FIELDS = [
  'maker', 'model', 'sub_model', 'variant', 'trim_name', 'year', 'fuel_type', 'mileage',
  'ext_color', 'int_color', 'options', 'vehicle_status', 'product_type',
  'provider_company_code', 'provider_name', 'price', 'image_urls', 'photo_link',
  'source', 'source_schema', 'source_external_id', 'source_url', '_raw_vehicle',
] as const;

function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

function providerOf(row: EntityRecord): string {
  return String(row.provider_company_code || row.source_schema || row.partner_code || '');
}

function explicitProviderOf(row: EntityRecord): string {
  return String(row.provider_company_code || row.partner_code || '').trim();
}

function active(row: EntityRecord): boolean {
  return row._deleted !== true && !row.deletedAt && String(row.status || '').trim() !== 'deleted';
}

function emptyWebValue(field: typeof IRONRENTCAR_WEB_OWNED_FIELDS[number]): unknown {
  // RTDB에 null을 쓰면 해당 child가 삭제되어 v3의 옛 값이 다시 드러난다.
  // 홈페이지가 값을 제공하지 않았다는 사실은 저장 가능한 빈 값으로 overlay한다.
  if (field === 'image_urls') return [];
  return '';
}

function exactWebPatch(existing: EntityRecord, incoming: EntityRecord): EntityRecord {
  const patch: EntityRecord = {};
  const engineLocked = !!String(existing.locked_by_contract || '').trim()
    || String(existing.vehicle_status || '').trim() === '계약중';
  const existingStatus = String(existing.vehicle_status || '').trim();
  const incomingStatus = String(incoming.vehicle_status || '').trim();
  const webOwnedBlock = existingStatus === '출고불가'
    && existing.ironrentcar_status_owner === 'web'
    && existing.ironrentcar_block_reason === 'missing_from_complete_catalog';

  for (const field of IRONRENTCAR_WEB_OWNED_FIELDS) {
    if (field === 'vehicle_status') {
      // 계약엔진 락과 운영자가 직접 건 출고불가는 홈페이지 재등장만으로 풀지 않는다.
      if (engineLocked || (existingStatus === '출고불가' && incomingStatus !== '출고불가' && !webOwnedBlock)) continue;
    }
    const hasIncoming = Object.prototype.hasOwnProperty.call(incoming, field);
    const next = hasIncoming ? incoming[field] : undefined;
    if (next === undefined) {
      const empty = emptyWebValue(field);
      if (!same(existing[field], empty)) patch[field] = empty;
      continue;
    }
    if (!same(existing[field], next)) patch[field] = next;
  }

  if (webOwnedBlock && incomingStatus !== '출고불가' && !engineLocked) {
    patch.ironrentcar_status_owner = null;
    patch.ironrentcar_block_reason = null;
    patch.ironrentcar_blocked_at = null;
  }
  return patch;
}

export function ironRentcarExistingRows(rows: EntityRecord[], providerCode = 'RP006'): EntityRecord[] {
  return rows.filter((row) => {
    if (!active(row)) return false;
    const explicitProvider = explicitProviderOf(row);
    if (explicitProvider) return explicitProvider === providerCode;
    const key = String(row._key || row.product_code || '');
    return providerOf(row) === providerCode || key.startsWith(`${providerCode}_`) || key.endsWith(`_${providerCode}`);
  });
}

/**
 * 아이언은 연동 활성화 뒤 웹사이트가 단일 정본이다.
 * 완전한 웹 스냅샷일 때만 웹에서 사라진 ERP 재고를 출고불가 후보로 만들며,
 * 계약 잠금·중복 차번은 자동 후보에서 제외한다.
 */
export function planIronRentcarReconcile(input: {
  webItems: IronRentcarCatalogItem[];
  existing: EntityRecord[];
  providerCode?: string;
  sourceComplete?: boolean;
}): IronRentcarReconcilePlan {
  const providerCode = input.providerCode || 'RP006';
  const existing = ironRentcarExistingRows(input.existing, providerCode);
  const foreignByPlate = new Map<string, EntityRecord[]>();
  for (const row of input.existing) {
    if (!active(row)) continue;
    const explicitProvider = explicitProviderOf(row);
    if (!explicitProvider || explicitProvider === providerCode) continue;
    const plate = plateOf(row);
    if (!plate) continue;
    foreignByPlate.set(plate, [...(foreignByPlate.get(plate) || []), row]);
  }
  const byPlate = new Map<string, EntityRecord[]>();
  for (const row of existing) {
    const plate = plateOf(row);
    if (!plate) continue;
    byPlate.set(plate, [...(byPlate.get(plate) || []), row]);
  }

  const duplicatePlateGroups = [...byPlate.values()].filter((group) => group.length > 1).length;
  const seenExistingPlates = new Set<string>();
  const patchCandidates: GuardedProductPatch[] = [];
  const createCandidates: EntityRecord[] = [];
  const blockedExternalIds: string[] = [];
  let matched = 0;
  let unchanged = 0;
  let ignoredSoldNew = 0;

  for (const item of input.webItems) {
    const plate = plateOf(item.product);
    if ((foreignByPlate.get(plate) || []).length) {
      blockedExternalIds.push(item.externalId);
      continue;
    }
    const group = byPlate.get(plate) || [];
    if (group.length > 1) {
      blockedExternalIds.push(item.externalId);
      seenExistingPlates.add(plate);
      continue;
    }
    if (group.length === 1) {
      matched++;
      seenExistingPlates.add(plate);
      const existingRow = group[0];
      const existingKey = String(existingRow._key || existingRow.product_code || '');
      const patch = exactWebPatch(existingRow, item.product);
      if (Object.keys(patch).length) patchCandidates.push({ key: existingKey, expected: existingRow, patch });
      else unchanged++;
      continue;
    }
    if (item.sold || String(item.product.vehicle_status || '') === '출고불가') {
      ignoredSoldNew++;
      continue;
    }
    createCandidates.push(item.product);
  }

  const absentBlockCandidates: GuardedProductPatch[] = [];
  let webAbsentErp = 0;
  let protectedErpOnly = 0;
  let alreadyUnavailableErpOnly = 0;
  for (const [plate, group] of byPlate.entries()) {
    if (seenExistingPlates.has(plate) || group.length !== 1) continue;
    webAbsentErp++;
    const row = group[0];
    const status = String(row.vehicle_status || '').trim();
    if (status === '출고불가') {
      alreadyUnavailableErpOnly++;
      continue;
    }
    if (row.locked_by_contract || status === '계약중') {
      protectedErpOnly++;
      continue;
    }
    if (input.sourceComplete === false) continue;
    const key = String(row._key || row.product_code || '');
    absentBlockCandidates.push({
      key,
      expected: row,
      patch: {
        vehicle_status: '출고불가',
        ironrentcar_status_owner: 'web',
        ironrentcar_block_reason: 'missing_from_complete_catalog',
        provider_company_code: providerCode,
      },
    });
  }
  return {
    providerCode,
    authority: 'ironrentcar_web',
    matched,
    patchCandidates,
    unchanged,
    createCandidates,
    ignoredSoldNew,
    webAbsentErp,
    absentBlockCandidates,
    protectedErpOnly,
    alreadyUnavailableErpOnly,
    duplicatePlateGroups,
    blockedExternalIds,
    candidateOperations: patchCandidates.length + createCandidates.length + absentBlockCandidates.length,
    executableOperations: 0,
  };
}
