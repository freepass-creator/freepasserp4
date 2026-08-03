import type { EntityRecord } from '@/lib/intake/entities';
import type { GuardedProductPatch } from '@/lib/domain/product-write-guard';
import { prepareMasterIngress } from '@/lib/domain/sheet-import';
import {
  buildPrevForGuard,
  buildSheetSyncCheckpoint,
  canonicalSheetProductsFromLines,
  findSheetSyncExistingConflicts,
  sheetSyncCommitBlockReason,
  sheetSyncExistingConflictReason,
  type PartnerSheetsFetch,
} from '@/lib/domain/sheet-sync-all';
import {
  planAbsentBlocked,
  planProductUpsert,
  shouldReconcileAbsent,
} from '@/lib/domain/sheet-merge';
import {
  applySheetConflictResolutions,
  type SheetConflictResolution,
} from '@/lib/domain/sheet-conflict-resolution';

export type DailySheetSyncPlan = {
  ok: boolean;
  blockReason: string;
  creates: EntityRecord[];
  patches: GuardedProductPatch[];
  checkpoints: Array<{ key: string; patch: EntityRecord }>;
  counts: {
    sourceRows: number;
    imported: number;
    excluded: number;
    noPrice: number;
    confirmed: number;
    review: number;
    created: number;
    updated: number;
    unchanged: number;
    absentBlocked: number;
    absentGuarded: number;
    lockedPreserved: number;
  };
  notes: string[];
};

const emptyCounts = () => ({
  sourceRows: 0,
  imported: 0,
  excluded: 0,
  noPrice: 0,
  confirmed: 0,
  review: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  absentBlocked: 0,
  absentGuarded: 0,
  lockedPreserved: 0,
});

const rowKey = (row: EntityRecord): string => String(row.product_code || row._key || '');
const plate = (row: EntityRecord): string => String(row.car_number || '').replace(/\s/g, '');

/**
 * 매일 자동 연동과 관리자 수동 연동이 공유하는 순수 계획.
 * 외부 write 없이 신규·수정·부재차단·checkpoint와 hard-block 사유를 결정한다.
 */
export function planDailySheetSync(input: {
  fetched: PartnerSheetsFetch;
  existing: EntityRecord[];
  deleted: EntityRecord[];
  partners: EntityRecord[];
  contracts?: EntityRecord[];
  resolutions?: SheetConflictResolution[];
  now?: number;
}): DailySheetSyncPlan {
  const counts = emptyCounts();
  const notes: string[] = [];
  for (const line of input.fetched.lines) {
    counts.sourceRows += line.sourceRowCount;
    counts.imported += line.imported;
    counts.excluded += line.excludedCount;
    counts.noPrice += line.noPriceCount;
  }

  const fetchBlock = sheetSyncCommitBlockReason(input.fetched);
  if (fetchBlock) {
    return { ok: false, blockReason: fetchBlock, creates: [], patches: [], checkpoints: [], counts, notes };
  }
  const canonical = canonicalSheetProductsFromLines(input.fetched);
  if (canonical.reason) {
    return { ok: false, blockReason: canonical.reason, creates: [], patches: [], checkpoints: [], counts, notes };
  }
  const rawConflicts = findSheetSyncExistingConflicts(input.fetched, input.existing, input.deleted);
  const resolutionResult = applySheetConflictResolutions({
    conflicts: rawConflicts,
    resolutions: input.resolutions,
    existing: input.existing,
    contracts: input.contracts,
  });
  if (resolutionResult.resolvedPricePeriods) {
    notes.push(`관리자 승인으로 기존 가격기간 유지 ${resolutionResult.resolvedPricePeriods}건`);
  }
  const conflictBlock = sheetSyncExistingConflictReason(resolutionResult.conflicts);
  if (conflictBlock) {
    return { ok: false, blockReason: conflictBlock, creates: [], patches: [], checkpoints: [], counts, notes };
  }

  const ingress = prepareMasterIngress(canonical.products);
  counts.confirmed = ingress.confirmed;
  counts.review = ingress.review;
  const upsert = planProductUpsert(ingress.products, input.existing);
  counts.created = upsert.creates.length;
  counts.updated = upsert.patches.length;
  counts.unchanged = upsert.unchanged;

  const guard = buildPrevForGuard(input.partners, input.existing);
  const absentPatches: GuardedProductPatch[] = [];
  const checkpoints: Array<{ key: string; patch: EntityRecord }> = [];
  const now = input.now ?? Date.now();
  for (const line of input.fetched.lines) {
    const rowsRead = line.sourceRowCount
      || line.imported + line.excludedCount + line.noPriceCount + line.skippedCount;
    const gate = shouldReconcileAbsent(rowsRead, guard.get(line.code) || 0);
    checkpoints.push({ key: line.code, patch: buildSheetSyncCheckpoint(line, now, gate.ok) });
    if (!gate.ok) {
      counts.absentGuarded++;
      notes.push(`${line.label}: 부재처리 보류(${gate.reason === 'collapse' ? '급감' : '유입0'})`);
      continue;
    }
    const presentKeys = new Set(line.products.map(rowKey).filter(Boolean));
    const presentPlates = new Set(line.products
      .filter((row) => row.is_pending_plate !== true && !/^100신\d+$/i.test(plate(row)))
      .map(plate)
      .filter(Boolean));
    const absent = planAbsentBlocked({
      existing: input.existing,
      providerCode: line.code,
      presentKeys,
      presentPlates,
    });
    absentPatches.push(...absent.patches);
    counts.absentBlocked += absent.patches.length;
    counts.lockedPreserved += absent.skipped_locked;
  }

  return {
    ok: true,
    blockReason: '',
    creates: upsert.creates,
    patches: [...upsert.patches, ...absentPatches],
    checkpoints,
    counts,
    notes,
  };
}
