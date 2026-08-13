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
  sheetSourceRowsRead,
  type PartnerSheetsFetch,
} from '@/lib/domain/sheet-sync-all';
import {
  planAbsentBlocked,
  planProductUpsert,
  resolveSheetReviveTarget,
  shouldReconcileAbsent,
  stripSheetPrivatePatchFields,
} from '@/lib/domain/sheet-merge';
import {
  applySheetConflictResolutions,
  type SheetConflictResolution,
} from '@/lib/domain/sheet-conflict-resolution';
import { buildPriceChangesValue } from '@/lib/domain/sheet-conflict-report';

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

function contractStatusBlockReason(incoming: EntityRecord[], existing: EntityRecord[]): string {
  const byKey = new Map(existing.map((row) => [rowKey(row), row]));
  const byProviderPlate = new Map(existing.map((row) => [
    `${String(row.provider_company_code || row.partner_code || '').trim()}|${plate(row)}`,
    row,
  ]));
  for (const row of incoming) {
    if (row._sheet_contract_status !== true) continue;
    const before = byKey.get(rowKey(row)) || byProviderPlate.get(
      `${String(row.provider_company_code || row.partner_code || '').trim()}|${plate(row)}`,
    );
    const locked = before && (String(before.vehicle_status || '').trim() === '계약중'
      || !!String(before.locked_by_contract || '').trim());
    if (!locked) return `영업자 시트 계약중 차량이 ERP 계약 엔진과 일치하지 않습니다(${plate(row) || rowKey(row)})`;
  }
  return '';
}

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
  const contractStatusBlock = contractStatusBlockReason(canonical.products, input.existing);
  if (contractStatusBlock) {
    return { ok: false, blockReason: contractStatusBlock, creates: [], patches: [], checkpoints: [], counts, notes };
  }
  const rawConflicts = findSheetSyncExistingConflicts(input.fetched, input.existing, input.deleted);
  const resolutionResult = applySheetConflictResolutions({
    conflicts: rawConflicts,
    // 미리보기와 같은 판정을 쓴다 — 빠뜨리면 화면엔 승인할 것이 없는데 여기서만 막힌다.
    priceChangesValue: buildPriceChangesValue({
      conflicts: rawConflicts,
      existing: input.existing,
      deleted: input.deleted,
      incoming: input.fetched.products,
      contracts: input.contracts,
      providerCodes: input.fetched.lines.map((line) => line.code),
    }),
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

  const ingress = prepareMasterIngress(canonical.products.map((row) => {
    const clean = { ...row };
    delete clean._sheet_contract_status;
    delete clean._sheet_price_scope;
    return clean;
  }));
  counts.confirmed = ingress.confirmed;
  counts.review = ingress.review;
  const upsert = planProductUpsert(ingress.products, input.existing);
  // 판매용 정본에 다시 나타난 동일 공급사·차량번호가 과거 soft-delete 톰스톤과 겹치면
  // 신규 키를 만들지 않고 기존 노드를 되살린다. create로 두면 RTDB transaction이 기존
  // tombstone을 정상적으로 충돌 처리해 전체 동기화가 영구히 멈춘다(63주0598).
  const revivePatches: GuardedProductPatch[] = [];
  const creates: EntityRecord[] = [];
  const claimedReviveKeys = new Set<string>();
  for (const row of upsert.creates) {
    const target = resolveSheetReviveTarget(row, input.deleted);
    if (!target || claimedReviveKeys.has(target.key)) {
      creates.push(row);
      continue;
    }
    claimedReviveKeys.add(target.key);
    revivePatches.push({
      key: target.key,
      expected: target.expected,
      patch: {
        ...stripSheetPrivatePatchFields(row),
        _deleted: null,
        deletedAt: null,
        status: null,
        revived_at: new Date(input.now ?? Date.now()).toISOString(),
      },
    });
  }
  counts.created = creates.length;
  counts.updated = upsert.patches.length + revivePatches.length;
  counts.unchanged = upsert.unchanged;

  const guard = buildPrevForGuard(input.partners, input.existing);
  const absentPatches: GuardedProductPatch[] = [];
  const checkpoints: Array<{ key: string; patch: EntityRecord }> = [];
  const now = input.now ?? Date.now();
  const salesCanonical = input.fetched.sourceKind === 'sales_inventory';
  if (salesCanonical) {
    // 영업자 판매용 워크북 4개 탭은 전 공급사 재고를 확정하는 하나의 정본이다. 공급사별 과거
    // baseline은 원본 시트 시절의 숫자라 첫 전환 때 정상 감소까지 막는다(실측: 아이언 48→20).
    // 대신 표 전체가 절반 이하로 붕괴했는지만 막고, 정상 범위 안에서는 공급사별 증감을
    // 그대로 반영해야 ERP가 영업자 표와 계속 일치한다.
    const totalGate = shouldReconcileAbsent(counts.sourceRows, input.existing.length);
    if (!totalGate.ok) {
      return {
        ok: false,
        blockReason: `영업자 상품리스트 전체 ${totalGate.reason === 'collapse' ? '급감' : '유입 0'} — 부재 재고 반영을 중단합니다`,
        creates: [],
        patches: [],
        checkpoints: [],
        counts,
        notes,
      };
    }
  }
  for (const line of input.fetched.lines) {
    const rowsRead = sheetSourceRowsRead(line);
    const gate = salesCanonical
      ? { ok: true as const }
      : shouldReconcileAbsent(rowsRead, guard.get(line.code) || 0);
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

  if (salesCanonical) {
    // 표에서 공급사가 통째로 빠진 것도 명시적 부재다. 현재 ERP에만 남은 공급사 코드를
    // 추가로 훑어 기존 재고가 유령으로 남지 않게 한다. 알 수 없는 소유코드는 건드리지 않는다.
    const lineCodes = new Set(input.fetched.lines.map((line) => line.code));
    const knownCodes = new Set(input.partners.map((partner) => String(partner.partner_code || partner._key || '').trim()).filter(Boolean));
    const missingProviderCodes = new Set(input.existing
      .map((row) => String(row.provider_company_code || row.partner_code || '').trim())
      .filter((code) => code && knownCodes.has(code) && !lineCodes.has(code)));
    for (const code of missingProviderCodes) {
      const absent = planAbsentBlocked({
        existing: input.existing,
        providerCode: code,
        presentKeys: new Set(),
        presentPlates: new Set(),
      });
      absentPatches.push(...absent.patches);
      counts.absentBlocked += absent.patches.length;
      counts.lockedPreserved += absent.skipped_locked;
      notes.push(`${code}: 영업자 상품리스트 부재 ${absent.patches.length}대 출고불가`);
    }
  }

  return {
    ok: true,
    blockReason: '',
    creates,
    patches: [...upsert.patches, ...revivePatches, ...absentPatches],
    checkpoints,
    counts,
    notes,
  };
}
