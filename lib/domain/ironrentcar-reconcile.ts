import type { EntityRecord } from '@/lib/intake/entities';
import type { IronRentcarCatalogItem } from '@/lib/server/ironrentcar-source';
import { planProductUpsert } from '@/lib/domain/sheet-merge';
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

function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

function providerOf(row: EntityRecord): string {
  return String(row.provider_company_code || row.source_schema || row.partner_code || '');
}

export function ironRentcarExistingRows(rows: EntityRecord[], providerCode = 'RP006'): EntityRecord[] {
  return rows.filter((row) => {
    if (row._deleted || row.deletedAt || String(row.status || '') === 'deleted') return false;
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
    const group = byPlate.get(plate) || [];
    if (group.length > 1) {
      blockedExternalIds.push(item.externalId);
      seenExistingPlates.add(plate);
      continue;
    }
    if (group.length === 1) {
      matched++;
      seenExistingPlates.add(plate);
      const upsert = planProductUpsert([item.product], group);
      const existingRow = group[0];
      const existingKey = String(existingRow._key || existingRow.product_code || '');
      let candidate = upsert.patches.find((patch) => patch.key === existingKey) || upsert.patches[0];
      const ensureCandidate = (): GuardedProductPatch => {
        if (candidate) return candidate;
        candidate = { key: existingKey, expected: existingRow, patch: { provider_company_code: providerCode } };
        upsert.patches.push(candidate);
        upsert.unchanged = Math.max(0, upsert.unchanged - 1);
        return candidate;
      };
      // 아이언 웹이 단일 정본이므로 시트 soft-merge와 달리 사라진 기간도 제거한다.
      // 계약 금액은 별도 snapshot이라 기존 계약에는 영향을 주지 않는다.
      if (!same(existingRow.price, item.product.price)) {
        ensureCandidate().patch.price = item.product.price;
      }
      const incomingStatus = String(item.product.vehicle_status || '').trim();
      const webOwnedBlock = String(existingRow.vehicle_status || '').trim() === '출고불가'
        && existingRow.ironrentcar_status_owner === 'web'
        && existingRow.ironrentcar_block_reason === 'missing_from_complete_catalog';
      if (webOwnedBlock && incomingStatus !== '출고불가'
        && !existingRow.locked_by_contract && String(existingRow.vehicle_status || '') !== '계약중') {
        const reactivation = ensureCandidate();
        reactivation.patch.vehicle_status = incomingStatus;
        reactivation.patch.ironrentcar_status_owner = null;
        reactivation.patch.ironrentcar_block_reason = null;
      }
      patchCandidates.push(...upsert.patches);
      unchanged += upsert.unchanged;
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
