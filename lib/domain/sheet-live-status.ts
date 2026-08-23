import type { EntityRecord } from '@/lib/intake/entities';
import type { GuardedProductPatch } from '@/lib/domain/product-write-guard';
import {
  canonicalSheetProductsFromLines,
  sheetSyncCommitBlockReason,
  type PartnerSheetsFetch,
} from '@/lib/domain/sheet-sync-all';
import {
  isContractEngineLocked,
  isManualSheetHold,
  planAbsentBlocked,
  sheetProviderOf,
  shouldReconcileAbsent,
} from '@/lib/domain/sheet-merge';

const SOURCE_CONTRACT_REASON = 'source_contract_status';

export type SheetLiveStatusPlan = {
  ok: boolean;
  blockReason: string;
  patches: GuardedProductPatch[];
  counts: {
    sourceRows: number;
    imported: number;
    matched: number;
    changed: number;
    unchanged: number;
    absentBlocked: number;
    lockedPreserved: number;
    manualHoldsPreserved: number;
    unmatchedIncoming: number;
  };
};

const keyOf = (row: EntityRecord): string => String(row._key || row.product_code || '').trim();
const plateOf = (row: EntityRecord): string => String(row.car_number || row.car_number_snapshot || '')
  .replace(/\s/g, '');
const isPending = (row: EntityRecord): boolean => row.is_pending_plate === true || /^100신\d{4,}$/.test(plateOf(row));
const isLiveStatusOwnedBlock = (row: EntityRecord): boolean => row.sheet_status_owner === 'sheet'
  && ['missing_or_excluded', SOURCE_CONTRACT_REASON].includes(String(row.sheet_block_reason || ''));

function emptyCounts(): SheetLiveStatusPlan['counts'] {
  return {
    sourceRows: 0,
    imported: 0,
    matched: 0,
    changed: 0,
    unchanged: 0,
    absentBlocked: 0,
    lockedPreserved: 0,
    manualHoldsPreserved: 0,
    unmatchedIncoming: 0,
  };
}

function activeTwins(existing: EntityRecord[], providerCodes: Set<string>): string {
  const groups = new Map<string, string[]>();
  const owners = new Map<string, Set<string>>();
  for (const row of existing) {
    if (row._deleted === true || row.deletedAt || String(row.status || '') === 'deleted' || isPending(row)) continue;
    const provider = sheetProviderOf(row, providerCodes);
    const plate = plateOf(row);
    if (!provider || !plate) continue;
    const identity = `${provider}|${plate}`;
    const keys = groups.get(identity) || [];
    keys.push(keyOf(row));
    groups.set(identity, keys);
    const plateOwners = owners.get(plate) || new Set<string>();
    plateOwners.add(provider);
    owners.set(plate, plateOwners);
  }
  const twin = [...groups].find(([, keys]) => keys.length > 1);
  if (twin) return `ERP 동일 공급사·차량번호 중복 ${twin[0]} (${twin[1].join(', ')})`;
  const crossProvider = [...owners].find(([, codes]) => codes.size > 1);
  if (crossProvider) return `ERP 공급사 간 동일 실차번 ${crossProvider[0]} (${[...crossProvider[1]].join(', ')})`;
  return '';
}

function incomingOwnershipConflict(
  incoming: EntityRecord[],
  existing: EntityRecord[],
  providerCodes: Set<string>,
): string {
  const existingByPlate = new Map<string, Set<string>>();
  for (const row of existing) {
    if (row._deleted === true || row.deletedAt || String(row.status || '') === 'deleted' || isPending(row)) continue;
    const plate = plateOf(row);
    if (!plate) continue;
    const provider = sheetProviderOf(row, providerCodes) || '(소유 미확정)';
    const owners = existingByPlate.get(plate) || new Set<string>();
    owners.add(provider);
    existingByPlate.set(plate, owners);
  }
  for (const row of incoming) {
    if (isPending(row)) continue;
    const plate = plateOf(row);
    const provider = sheetProviderOf(row, providerCodes);
    const owners = existingByPlate.get(plate);
    if (owners?.size && !owners.has(provider)) {
      return `시트와 ERP의 차량번호 소유 공급사가 다릅니다(${plate}: 시트 ${provider} / ERP ${[...owners].join(', ')})`;
    }
  }
  return '';
}

/**
 * 상품마스터에서 차량상태만 뽑아 ERP에 반영하는 순수 계획.
 *
 * 상품 제원·가격·사진은 건드리지 않는다. `계약중`과 `locked_by_contract`는 계약 엔진이
 * 유일한 writer이므로 언제나 보존한다. 시트의 `계약중` 표시는 계약 락을 만들지 않고
 * 판매만 막는 `출고불가`로 투영한다.
 */
export function planSheetLiveStatusSync(input: {
  fetched: PartnerSheetsFetch;
  existing: EntityRecord[];
  partners: EntityRecord[];
}): SheetLiveStatusPlan {
  const counts = emptyCounts();
  counts.sourceRows = input.fetched.lines.reduce((sum, line) => sum + line.sourceRowCount, 0);
  counts.imported = input.fetched.lines.reduce((sum, line) => sum + line.imported, 0);
  const blocked = sheetSyncCommitBlockReason(input.fetched);
  if (blocked) return { ok: false, blockReason: blocked, patches: [], counts };
  if (input.fetched.sourceKind !== 'product_master' && input.fetched.sourceKind !== 'sales_inventory') {
    return { ok: false, blockReason: '차량상태 실시간 연동은 상품마스터 정본만 허용합니다', patches: [], counts };
  }
  const canonical = canonicalSheetProductsFromLines(input.fetched);
  if (canonical.reason) return { ok: false, blockReason: canonical.reason, patches: [], counts };

  const lineCodes = new Set(input.fetched.lines.map((line) => line.code).filter(Boolean));
  const knownCodes = new Set(input.partners
    .map((partner) => String(partner.partner_code || partner._key || '').trim())
    .filter(Boolean));
  const managedExisting = input.existing.filter((row) => {
    const provider = sheetProviderOf(row, knownCodes);
    return provider && knownCodes.has(provider);
  });
  const collapseGate = shouldReconcileAbsent(canonical.products.length, managedExisting.length);
  if (!collapseGate.ok) {
    return {
      ok: false,
      blockReason: `${input.fetched.sourceKind === 'product_master' ? '상품마스터' : '영업자 상품리스트'} 전체 ${collapseGate.reason === 'collapse' ? '급감' : '유입 0'} — 상태 반영을 중단합니다`,
      patches: [],
      counts,
    };
  }
  const twinBlock = activeTwins(input.existing, knownCodes);
  if (twinBlock) return { ok: false, blockReason: twinBlock, patches: [], counts };
  const ownershipBlock = incomingOwnershipConflict(canonical.products, input.existing, knownCodes);
  if (ownershipBlock) return { ok: false, blockReason: ownershipBlock, patches: [], counts };

  const byKey = new Map(input.existing.map((row) => [keyOf(row), row]));
  const byProviderPlate = new Map<string, EntityRecord>();
  for (const row of input.existing) {
    const provider = sheetProviderOf(row, knownCodes);
    const plate = plateOf(row);
    if (provider && plate && !isPending(row)) byProviderPlate.set(`${provider}|${plate}`, row);
  }

  const patches: GuardedProductPatch[] = [];
  const patchedKeys = new Set<string>();
  for (const incoming of canonical.products) {
    const incomingKey = keyOf(incoming);
    const provider = sheetProviderOf(incoming, lineCodes);
    const plate = plateOf(incoming);
    const before = byKey.get(incomingKey)
      || (!isPending(incoming) ? byProviderPlate.get(`${provider}|${plate}`) : undefined);
    if (!before) {
      counts.unmatchedIncoming++;
      continue;
    }
    counts.matched++;
    if (isContractEngineLocked(before)) {
      counts.lockedPreserved++;
      continue;
    }

    const sourceContract = incoming._sheet_contract_status === true;
    const desired = sourceContract ? '출고불가' : String(incoming.vehicle_status || '').trim();
    if (!desired) {
      counts.unchanged++;
      continue;
    }
    if (isManualSheetHold(before) && !isLiveStatusOwnedBlock(before)) {
      counts.manualHoldsPreserved++;
      continue;
    }

    const patch: EntityRecord = {};
    if (String(before.vehicle_status || '').trim() !== desired) patch.vehicle_status = desired;
    if (sourceContract) {
      if (before.sheet_status_owner !== 'sheet') patch.sheet_status_owner = 'sheet';
      if (String(before.sheet_block_reason || '') !== SOURCE_CONTRACT_REASON) {
        patch.sheet_block_reason = SOURCE_CONTRACT_REASON;
      }
    } else if (isLiveStatusOwnedBlock(before)) {
      patch.sheet_status_owner = null;
      patch.sheet_block_reason = null;
      patch.sheet_blocked_at = null;
    }
    if (!Object.keys(patch).length) {
      counts.unchanged++;
      continue;
    }
    const key = keyOf(before);
    patches.push({ key, expected: before, patch });
    patchedKeys.add(key);
    counts.changed++;
  }

  // 행 삭제·필터 제외 역시 상태 변화다. 전체 스냅샷 안전 게이트를 통과한 경우에만
  // 기존 부재 처리와 같은 provenance를 남겨, 차량이 다시 나타나면 자동 복구할 수 있게 한다.
  const absentPatches: GuardedProductPatch[] = [];
  for (const line of input.fetched.lines) {
    const presentKeys = new Set(line.products.map(keyOf).filter(Boolean));
    const presentPlates = new Set(line.products.filter((row) => !isPending(row)).map(plateOf).filter(Boolean));
    const absent = planAbsentBlocked({
      existing: input.existing,
      providerCode: line.code,
      presentKeys,
      presentPlates,
    });
    counts.lockedPreserved += absent.skipped_locked;
    for (const item of absent.patches) {
      if (patchedKeys.has(item.key)) continue;
      absentPatches.push({
        ...item,
        patch: {
          vehicle_status: item.patch.vehicle_status,
          sheet_status_owner: item.patch.sheet_status_owner,
          sheet_block_reason: item.patch.sheet_block_reason,
          sheet_blocked_at: item.patch.sheet_blocked_at,
        },
      });
    }
  }
  const missingProviderCodes = new Set(managedExisting
    .map((row) => sheetProviderOf(row, knownCodes))
    .filter((code) => code && !lineCodes.has(code)));
  for (const code of missingProviderCodes) {
    const absent = planAbsentBlocked({
      existing: input.existing,
      providerCode: code,
      presentKeys: new Set(),
      presentPlates: new Set(),
    });
    counts.lockedPreserved += absent.skipped_locked;
    for (const item of absent.patches) {
      if (patchedKeys.has(item.key)) continue;
      absentPatches.push({
        ...item,
        patch: {
          vehicle_status: item.patch.vehicle_status,
          sheet_status_owner: item.patch.sheet_status_owner,
          sheet_block_reason: item.patch.sheet_block_reason,
          sheet_blocked_at: item.patch.sheet_blocked_at,
        },
      });
    }
  }
  counts.absentBlocked = absentPatches.length;
  counts.changed += absentPatches.length;
  return { ok: true, blockReason: '', patches: [...patches, ...absentPatches], counts };
}
