import type { EntityRecord } from '@/lib/intake/entities';
import type { GuardedProductPatch } from '@/lib/domain/product-write-guard';
import { isExactRealPlate } from '@/lib/domain/product';
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

function normalizeSourceContractStatuses(
  incoming: EntityRecord[],
  existing: EntityRecord[],
  now: number,
): { products: EntityRecord[]; unavailableProjected: number } {
  const byKey = new Map(existing.map((row) => [rowKey(row), row]));
  const byProviderPlate = new Map(existing.map((row) => [
    `${String(row.provider_company_code || row.partner_code || '').trim()}|${plate(row)}`,
    row,
  ]));
  let unavailableProjected = 0;
  const products = incoming.map((row) => {
    if (row._sheet_contract_status !== true) return row;
    const before = byKey.get(rowKey(row)) || byProviderPlate.get(
      `${String(row.provider_company_code || row.partner_code || '').trim()}|${plate(row)}`,
    );
    const locked = before && (String(before.vehicle_status || '').trim() === '계약중'
      || !!String(before.locked_by_contract || '').trim());
    if (locked) return row;
    /**
     * ★2026-08-20 사장님 「ERP 에는 출고불가만 안 나타내는 거야 — 상품화중·계약중은 다 표시된다」.
     *   시트가 「계약중」이라고 적으면 ERP 도 계약중으로 둔다(마크로 알린다). 예전엔 출고불가로 투영해
     *   목록에서 사라졌고, 왜 안 보이는지 아무도 몰랐다(실측 손오공구독 308너3464·159무8252).
     *   계약락(ERP 계약 엔진)은 여전히 별도다 — 시트가 그 락을 만들지도, 풀지도 못한다.
     */
    unavailableProjected++;
    return {
      ...row,
      vehicle_status: '계약중',
      sheet_status_owner: 'sheet',
      sheet_block_reason: 'source_contract_status',
    };
  });
  return { products, unavailableProjected };
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
  const now = input.now ?? Date.now();
  const sourceStatuses = normalizeSourceContractStatuses(canonical.products, input.existing, now);
  if (sourceStatuses.unavailableProjected) {
    notes.push(`시트 계약중 ${sourceStatuses.unavailableProjected}대는 ERP 계약락 없이 출고불가로 반영`);
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
  let effectiveConflicts = resolutionResult.conflicts;
  if (input.fetched.sourceKind === 'product_master') {
    const authoritativeDeleted = effectiveConflicts.unownedDeletedMatches.length;
    const preservedPricePeriods = effectiveConflicts.missingPricePeriods.length;
    // 상품마스터는 공급사 원본을 규격화한 판매 정본이다. 삭제된 옛 ERP 행의 공급사
    // 표식이 비어 있더라도 현재 상품마스터의 명시적 공급사+차번을 우선한다. 옛 가격
    // 기간은 soft-merge가 그대로 보존하므로, 현재 표준기간을 갱신하면서 과거 기간을
    // 지우지 않는다. 활성 중복·타 공급사 소유·임시번호 전환 같은 실물 식별 충돌은
    // 아래 공통 게이트에 계속 남겨 자동 덮어쓰기를 금지한다.
    effectiveConflicts = {
      ...effectiveConflicts,
      unownedDeletedMatches: [],
      missingPricePeriods: [],
    };
    if (authoritativeDeleted) {
      notes.push(`상품마스터 공급사·차번을 우선해 미확정 삭제이력 ${authoritativeDeleted}건을 새 정본으로 연결`);
    }
    if (preservedPricePeriods) {
      notes.push(`상품마스터에 없는 기존 가격기간 ${preservedPricePeriods}건은 삭제하지 않고 ERP 값을 보존`);
    }
  }
  const conflictBlock = sheetSyncExistingConflictReason(effectiveConflicts);
  if (conflictBlock) {
    return { ok: false, blockReason: conflictBlock, creates: [], patches: [], checkpoints: [], counts, notes };
  }

  const ingress = prepareMasterIngress(sourceStatuses.products.map((row) => {
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
  const salesCanonical = input.fetched.sourceKind === 'sales_inventory'
    || input.fetched.sourceKind === 'product_master';
  const completeCanonical = salesCanonical && input.fetched.sourceScope !== 'providers';
  const canonicalLabel = input.fetched.sourceKind === 'product_master' ? '상품마스터' : '영업자 상품리스트';
  if (completeCanonical) {
    // 상품마스터(과거에는 영업자 판매용 워크북 4개 탭)는 전 공급사 재고를 확정하는 하나의 정본이다. 공급사별 과거
    // baseline은 원본 시트 시절의 숫자라 첫 전환 때 정상 감소까지 막는다(실측: 아이언 48→20).
    // 대신 표 전체가 절반 이하로 붕괴했는지만 막고, 정상 범위 안에서는 공급사별 증감을
    // 그대로 반영해야 ERP가 영업자 표와 계속 일치한다.
    const totalGate = shouldReconcileAbsent(counts.sourceRows, input.existing.length);
    if (!totalGate.ok) {
      return {
        ok: false,
        blockReason: `${canonicalLabel} 전체 ${totalGate.reason === 'collapse' ? '급감' : '유입 0'} — 부재 재고 반영을 중단합니다`,
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
    const gate = salesCanonical && completeCanonical
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

  if (completeCanonical) {
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
      notes.push(`${code}: ${canonicalLabel} 부재 ${absent.patches.length}대 출고불가`);
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

export type ProductMasterProviderPlan = {
  code: string;
  label: string;
  fetched: PartnerSheetsFetch;
  plan: DailySheetSyncPlan;
};

/**
 * 상품마스터를 공급사별 독립 계획으로 나눈다.
 *
 * 한 공급사의 삭제이력·가격기간 충돌이 다른 공급사의 안전한 상태/가격 반영까지 막지
 * 않게 하되, 각 계획은 sourceScope=providers로 고정해 범위 밖 공급사를 부재처리하지 않는다.
 * 불확실 충돌은 planDailySheetSync의 기존 게이트를 그대로 통과해야 하므로 자동 승인되지 않는다.
 */
export function planProductMasterProviderBatches(input: {
  fetched: PartnerSheetsFetch;
  existing: EntityRecord[];
  deleted: EntityRecord[];
  partners: EntityRecord[];
  contracts?: EntityRecord[];
  resolutions?: SheetConflictResolution[];
  now?: number;
}): ProductMasterProviderPlan[] {
  // ★정본은 «규격화된 판매 표»다 — 상품마스터(옛 경로)와 영업자 상품리스트(2026-08-20 사장님 「영업자가 보는 거랑 ERP 랑 바로 연동」) 둘 다 여기로 온다.
  //   공급사 원본 시트(supplier_sources)는 규격이 제각각이라 이 경로를 못 쓴다.
  if (input.fetched.sourceKind !== 'product_master' && input.fetched.sourceKind !== 'sales_inventory') {
    throw new Error('공급사별 독립 계획은 규격화된 판매 표(상품마스터·영업자 상품리스트)만 허용합니다');
  }
  // 실차번은 공급사보다 상위인 전역 식별자다. 공급사별로 먼저 쪼개면 같은 번호를
  // 서로 다른 두 공급사가 보낸 충돌을 각 단건 계획이 보지 못한다. 전체 스냅샷에서
  // 먼저 소유 충돌을 찾고, 연관 공급사만 보류해 나머지 공급사의 정상 반영은 유지한다.
  const providersByPlate = new Map<string, Set<string>>();
  for (const line of input.fetched.lines) {
    for (const product of line.products) {
      const carNumber = plate(product);
      if (!isExactRealPlate(carNumber)) continue;
      const providers = providersByPlate.get(carNumber) || new Set<string>();
      providers.add(line.code);
      providersByPlate.set(carNumber, providers);
    }
  }
  const crossProviderConflicts = new Map<string, number>();
  for (const providers of providersByPlate.values()) {
    if (providers.size < 2) continue;
    for (const code of providers) {
      crossProviderConflicts.set(code, (crossProviderConflicts.get(code) || 0) + 1);
    }
  }
  return input.fetched.lines.map((line) => {
    const fetched: PartnerSheetsFetch = {
      ...input.fetched,
      lines: [line],
      products: line.products,
      partnerCount: 1,
      sourceScope: 'providers',
    };
    const plan = planDailySheetSync({
      fetched,
      existing: input.existing,
      deleted: input.deleted,
      partners: input.partners,
      contracts: input.contracts,
      resolutions: input.resolutions,
      now: input.now,
    });
    const crossProviderCount = crossProviderConflicts.get(line.code) || 0;
    return {
      code: line.code,
      label: line.label,
      fetched,
      plan: !crossProviderCount ? plan : {
        ...plan,
        ok: false,
        blockReason: [
          `상품마스터 공급사 간 동일 실차번 ${crossProviderCount}건 — 귀속 확인 필요`,
          plan.blockReason,
        ].filter(Boolean).join(' · '),
        creates: [],
        patches: [],
        checkpoints: [],
        counts: {
          ...plan.counts,
          created: 0,
          updated: 0,
          unchanged: 0,
          absentBlocked: 0,
          absentGuarded: 0,
        },
      },
    };
  });
}
