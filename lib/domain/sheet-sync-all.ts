/**
 * 관리자 전체 시트 연동 — 공급사별 sheet_url 순회 → 취합 → master-ingress 커밋.
 * UI는 SheetSync. 저장은 commitSupplierProducts만 (마스터 틀 SSOT).
 * 오토플러스 = main+프로모션 2탭 병합(sheet-autoplus).
 * fetch 성공·가드 통과 공급사만 부재→출고불가(삭제 없음).
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { getStore } from '@/lib/store';
import { type MasterEntry } from '@/lib/domain/vehicle-master-match';
import {
  assertDistinctSheetTable,
  fetchSheetTable,
  importSheetTable,
  parseMappingHeaderSignature,
  parseMappingProfile,
  type MappingHeaderSignature,
  type MappingProfile,
} from '@/lib/domain/sheet-import';
import { commitSupplierProducts, productsForSheetCommit, type MasterIngressCommit } from '@/lib/domain/master-ingress';
import { partnerSheetOpts, resolveAdapter } from '@/lib/domain/sheet-adapters';
import { createPlateAllocator, storedPendingSignature, type PendingPlateMap } from '@/lib/domain/pending-plate';
import {
  applyAbsentBlocked,
  isManualSheetHold,
  listSheetReconcileState,
  planAbsentBlocked,
  planProductUpsert,
  sheetProviderOf,
  SUPPLIER_OWNED_PRODUCT_FIELDS,
  sheetReconcileStateRevision,
  shouldReconcileAbsent,
} from '@/lib/domain/sheet-merge';
import {
  importAutoplusMerged,
} from '@/lib/domain/sheet-autoplus';
import { isExactRealPlate } from '@/lib/domain/product';
import {
  applySheetConflictResolutions,
  type SheetConflictResolution,
} from '@/lib/domain/sheet-conflict-resolution';
import { buildPriceChangesValue } from '@/lib/domain/sheet-conflict-report';
import {
  fetchSupplierSheet as fetchSupplierSheetWorkbook,
  type SupplierSheetFetcher,
  type SupplierTab,
} from '@/lib/domain/supplier-sheet-read';

function safeProfile(v: unknown): MappingProfile | undefined {
  return parseMappingProfile(v);
}

export type PartnerSheetRow = {
  code: string;
  name: string;
  url: string;
  adapter: string;
  lastSyncedAt: number | null;
  /** fetch·번호할당·급감가드에 영향을 주는 partner 설정 revision */
  syncRevision: string;
};

function stableSheetValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSheetValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableSheetValue(item)]));
  }
  return value;
}

function safeHeaderSignature(v: unknown): MappingHeaderSignature | undefined {
  return parseMappingHeaderSignature(v);
}

function configHash(value: unknown): string {
  const text = JSON.stringify(stableSheetValue(value));
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function sheetPartnerSyncRevision(p: EntityRecord): string {
  const code = String(p.partner_code || p._key || '');
  return configHash({
    _key: p._key || '',
    partner_code: p.partner_code || '',
    code,
    name: p.name || '',
    partner_name: p.partner_name || '',
    partner_type: p.partner_type || '',
    status: p.status || '',
    inventory_source: p.inventory_source || '',
    _deleted: p._deleted || false,
    deletedAt: p.deletedAt || null,
    sheet_url: p.sheet_url || '',
    sheet_gid: p.sheet_gid || '',
    sheet_tab: p.sheet_tab || '',
    header_row: Number(p.header_row) || 0,
    adapter_id: resolveAdapter(p).id,
    mapping_profile: safeProfile(p.mapping_profile) || {},
    mapping_header_signature: safeHeaderSignature(p.mapping_header_signature) || {},
    deposit_rule: p.deposit_rule || '',
    pending_plates: p.pending_plates || {},
    pending_plate_seq: Number(p.pending_plate_seq) || 0,
    last_sheet_rows: Number(p.last_sheet_rows) || 0,
    last_sheet_imported: Number(p.last_sheet_imported) || 0,
  });
}

export function isWebInventoryPartner(p: EntityRecord): boolean {
  const code = String(p.partner_code || p._key || '').trim();
  // RP006은 첫 홈페이지 반영 전에도 이미 홈페이지 전용 검증 UI를 사용한다.
  // inventory_source 표식은 첫 apply가 성공해야 저장되므로 그것만 보면, 전환 직전의
  // 낡은 sheet_url이 전체 시트 roster에 다시 들어와 홈페이지와 이중 정본이 된다.
  return code === 'RP006' || String(p.inventory_source || '').trim() === 'ironrentcar_web';
}

function isSheetPartnerRecord(p: EntityRecord): boolean {
  if (!String(p.sheet_url || '').trim()) return false;
  if (isWebInventoryPartner(p)) return false;
  if (p._deleted === true || p.deletedAt || String(p.status || '') === 'deleted') return false;
  return !/영업|sales/i.test(String(p.partner_type || ''));
}

function sheetPartnerRecordPriority(row: EntityRecord, code: string): number {
  return (String(row._key || '') === code ? 100 : 0)
    + (row.mapping_profile ? 20 : 0)
    + (row.sheet_gid || row.sheet_tab ? 10 : 0)
    + (row.adapter_id ? 5 : 0)
    + (row.last_synced_at ? 1 : 0);
}

/** 같은 공급사 코드의 레거시·v4 레코드가 함께 남아도 실제 fetch는 정확히 한 번만 한다. */
export function canonicalSheetPartnerRecords(rows: EntityRecord[]): EntityRecord[] {
  const byCode = new Map<string, EntityRecord>();
  for (const row of rows.filter(isSheetPartnerRecord)) {
    const code = String(row.partner_code || row._key || '').trim();
    if (!code) continue;
    const current = byCode.get(code);
    if (!current || sheetPartnerRecordPriority(row, code) > sheetPartnerRecordPriority(current, code)) {
      byCode.set(code, row);
    }
  }
  return [...byCode.values()];
}

export function sheetPartnerRows(rows: EntityRecord[]): PartnerSheetRow[] {
  return canonicalSheetPartnerRecords(rows)
    .map((p) => {
      const code = String(p.partner_code || p._key || '');
      const name = String(p.name || p.partner_name || p.partner_code || code);
      try {
        return {
          code,
          name,
          url: String(p.sheet_url || '').trim(),
          adapter: resolveAdapter(p).id,
          lastSyncedAt: p.last_synced_at != null ? Number(p.last_synced_at) : null,
          syncRevision: sheetPartnerSyncRevision(p),
        };
      } catch (error) {
        throw new Error(`${name} (${code || '코드없음'}) 시트 설정 오류 — ${String((error as Error).message || error)}`);
      }
    })
    .filter((r) => r.code)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

export function sheetPartnerRosterRevision(rows: PartnerSheetRow[]): string {
  return rows.map((row) => `${row.code}|${row.syncRevision}`).sort().join('\n');
}

/** 단건 연동은 선택한 공급사 설정만, 전체 연동은 전체 설정을 같은 범위로 비교한다. */
export function rosterRevisionForFetched(rows: PartnerSheetRow[], fetched: { lines: Array<Pick<PartnerFetchLine, 'code'>> }): string {
  const fetchedCodes = new Set(fetched.lines.map((line) => line.code));
  return sheetPartnerRosterRevision(rows.filter((row) => fetchedCodes.has(row.code)));
}

/**
 * 시트가 지정된 공급사만 (영업채널 제외).
 *
 * ⚠ partner_type 은 실데이터에 **한글·영문이 섞여 있다**(`공급사` / `provider` / `영업채널` / `sales_channel`).
 * 예전엔 한글 '공급사'만 통과시켜서 `provider` 로 저장된 공급사가 전부 목록에서 빠졌다
 * (2026-07-31 실측: 시트 등록 16곳 중 2곳만 보였다). 그래서 **영업채널만 걸러내는 방식**으로 뒤집는다 —
 * 새 표기가 생겨도 공급사가 조용히 사라지지 않는다.
 */
export async function listSheetPartners(companyId: string, fresh = false): Promise<PartnerSheetRow[]> {
  return sheetPartnerRows(await listSheetPartnerRecords(companyId, fresh));
}

/** 시트 설정 원본. RTDB live/overlay 일부 read 실패를 빈 roster로 승인하지 않는다. */
export async function listSheetPartnerRecords(
  companyId: string,
  fresh = false,
): Promise<EntityRecord[]> {
  const store = getStore();
  let rows: EntityRecord[];
  if (fresh && typeof store.listFreshWithHealth === 'function') {
    const health = await store.listFreshWithHealth('partner', companyId);
    if (!health.complete) {
      throw new Error(`시트 대상 설정 조회 불완전 — ${(health.failures || ['source read 실패']).join(' · ')}`);
    }
    rows = health.rows;
  } else {
    rows = fresh && typeof store.listFresh === 'function'
      ? await store.listFresh('partner', companyId)
      : await store.list('partner', companyId);
  }
  // 동기화 직전마다 공급사 허브 주소를 덮어써서 과거 종합시트 URL로 회귀하지 못하게 한다.
  const { fetchHubPartners, overlayHubSheetUrls } = await import('@/lib/domain/sheet-hub-sync');
  return overlayHubSheetUrls(rows, await fetchHubPartners());
}

export type PartnerFetchLine = {
  code: string;
  label: string;
  ok: boolean;
  sourceRowCount: number;  // 어댑터가 판독한 비어있지 않은 데이터 행(올림+제외+스킵)
  imported: number;
  excludedCount: number;   // 시트에 '출고불가'로 적혀 있어 안 올린 대수
  noPriceCount: number;    // 대여료가 없는 행(실차번이 있으면 products/imported에도 포함되는 진단 부분집합)
  noPriceSkippedCount?: number; // 가격도 실차번도 없어 스킵한 행(= skippedCount의 부분집합)
  skippedCount: number;    // 중복 차번·무효 차번·가격도 실차번도 없는 행
  duplicateCount: number;
  /** 저장을 막아야 하는 동일 탭/상태충돌 중복. 정상적인 탭 간 겹침은 제외 가능. */
  blockingDuplicateCount?: number;
  invalidCount: number;
  issueSamples: string[];
  /** 번호미정 신차에 새 임시번호를 뽑았으면 저장할 값(없으면 undefined) */
  plateAlloc?: { pending_plates: PendingPlateMap; pending_plate_seq: number };
  message: string;
  products: EntityRecord[];
};

export type AbsentSyncSummary = {
  blocked: number;
  skipped_locked: number;
  skipped_guard: number;
  notes: string[];
};

export type PartnerSheetsFetch = {
  lines: PartnerFetchLine[];
  products: EntityRecord[];
  partnerCount: number;
  rosterRevision: string;
  /** 공급사별 원본 묶음인지, 프리패스 영업자용 단일 정본인지 구분한다. */
  sourceKind?: 'supplier_sources' | 'sales_inventory';
  /** UI 검증 시점의 활성 ERP 재고 revision. 커밋 경계에서 반드시 비교한다. */
  reconcileRevision?: string;
};

export type PartnerSourceReadiness = {
  status: 'ready' | 'review' | 'blocked';
  reasons: string[];
  masterReviewCount: number;
};

/** 가격없음은 반영 매물과 겹치는 진단값이다. 원본 행 합계에는 두 번 더하지 않는다. */
export function sheetSourceRowsRead(line: Pick<PartnerFetchLine,
  'sourceRowCount' | 'imported' | 'excludedCount' | 'skippedCount'>): number {
  return line.sourceRowCount || line.imported + line.excludedCount + line.skippedCount;
}

function sheetSourceCountMatches(line: PartnerFetchLine): boolean {
  return line.sourceRowCount === line.imported + line.excludedCount + line.skippedCount;
}

function sheetIssueCountMatches(line: PartnerFetchLine): boolean {
  return line.skippedCount === line.duplicateCount + line.invalidCount + (line.noPriceSkippedCount || 0);
}

/** 공급사 한 곳만 떼어 봐도 안전한지 판정한다. 전체 커밋 게이트와 별도로 UI·감사가 공유한다. */
export function partnerSourceReadiness(line: PartnerFetchLine): PartnerSourceReadiness {
  const reasons: string[] = [];
  const sheetDuplicates = line.blockingDuplicateCount ?? line.duplicateCount;
  const masterReviewCount = line.products.filter((row) => row._needs_master_review === true).length;
  if (!line.ok) reasons.push('원본 조회 실패');
  if (line.invalidCount > 0) reasons.push(`무효 차번 ${line.invalidCount}`);
  if (line.imported === 0 && !isExplicitAllExcluded(line)) reasons.push('안전하지 않은 올림 0대');
  if (!sheetSourceCountMatches(line)) {
    reasons.push('판독 행 집계 불일치');
  }
  if (!sheetIssueCountMatches(line)) reasons.push('중복·무효·식별불가 집계 불일치');
  if (line.sourceRowCount >= 10 && line.skippedCount >= line.sourceRowCount * 0.5) {
    reasons.push('스킵·무효 비율 50% 이상');
  }
  // 시트 중복은 커밋을 막지 않는다(한 대는 이미 올림). 확인만 필요.
  if (reasons.length) return { status: 'blocked', reasons, masterReviewCount };
  if (sheetDuplicates > 0) reasons.push(`시트 중복 ${sheetDuplicates}(올린 매물은 반영)`);
  if (line.noPriceCount > 0) reasons.push(`가격 누락 ${line.noPriceCount}`);
  if (masterReviewCount > 0) reasons.push(`차종 검수 ${masterReviewCount}`);
  return { status: reasons.length ? 'review' : 'ready', reasons, masterReviewCount };
}

export function isExplicitAllExcluded(line: Pick<PartnerFetchLine,
  'sourceRowCount' | 'imported' | 'excludedCount' | 'noPriceCount' | 'skippedCount'>): boolean {
  return line.imported === 0
    && line.sourceRowCount > 0
    && line.excludedCount === line.sourceRowCount
    && line.noPriceCount === 0
    && line.skippedCount === 0;
}

/** 실차번은 전역 식별자다. 같은 번호를 두 공급사가 보내면 소유자 확정 전까지 저장하지 않는다. */
function incomingProvidersByPlate(fetched: PartnerSheetsFetch): Map<string, Set<string>> {
  const groups = new Map<string, Set<string>>();
  for (const line of fetched.lines) {
    for (const row of line.products) {
      if (isPendingSheetRow(row)) continue;
      const plate = String(row.car_number || row.car_number_snapshot || '').replace(/\s/g, '');
      if (!plate || !line.code) continue;
      const owners = groups.get(plate) || new Set<string>();
      owners.add(line.code);
      groups.set(plate, owners);
    }
  }
  return groups;
}

/**
 * 커밋 정본은 공급사별 line.products다. fetched.products는 UI 합계/표시용 복제본일 뿐이며,
 * 직접 호출자가 둘을 같은 개수의 다른 내용으로 바꿔치기해도 저장 정본이 되어서는 안 된다.
 * 각 행의 공급사 소유·상품키·차번 provenance까지 커밋 경계에서 독립 검증한다.
 */
export function canonicalSheetProductsFromLines(
  fetched: PartnerSheetsFetch,
): { products: EntityRecord[]; reason: string } {
  const products: EntityRecord[] = [];
  const keys = new Set<string>();
  for (const line of fetched.lines) {
    for (const [index, row] of line.products.entries()) {
      const at = `${line.label} ${index + 1}번째 매물`;
      const provider = String(row.provider_company_code || '').trim();
      const partner = String(row.partner_code || '').trim();
      const sourceSchema = String(row.source_schema || '').trim();
      if (provider !== line.code || partner !== line.code || sourceSchema !== line.code) {
        return {
          products: [],
          reason: `${at} 공급사 소유 불일치 (${provider || '-'} / ${partner || '-'} / ${sourceSchema || '-'} ≠ ${line.code})`,
        };
      }
      if (String(row.source || '').trim() !== 'sheet') {
        return { products: [], reason: `${at} 시트 provenance 누락` };
      }
      if (row.is_pending_plate !== undefined && typeof row.is_pending_plate !== 'boolean') {
        return { products: [], reason: `${at} 번호미정 플래그 형식 오류` };
      }
      const plate = String(row.car_number || row.car_number_snapshot || '').replace(/\s/g, '');
      const validPlate = row.is_pending_plate === true
        ? /^100신\d{4,}$/.test(plate)
        : isExactRealPlate(plate);
      if (!validPlate) return { products: [], reason: `${at} 차량번호 형식 불일치 (${plate || '공란'})` };
      const key = String(row.product_code || '').trim();
      const recordKey = String(row._key || '').trim();
      const expectedKey = `${line.code}_${plate}`;
      if (key !== expectedKey || (recordKey && recordKey !== key)) {
        return {
          products: [],
          reason: `${at} 상품키 불일치 (${recordKey || key || '공란'} ≠ ${expectedKey})`,
        };
      }
      if (keys.has(key)) return { products: [], reason: `${at} 상품키 중복 (${key})` };
      keys.add(key);
      products.push(row);
    }
  }

  if (products.length !== fetched.products.length) {
    return { products: [], reason: `검증 스냅샷 매물 수 불일치 (${products.length}/${fetched.products.length})` };
  }
  const fingerprints = (rows: EntityRecord[]) => rows
    .map((row) => JSON.stringify(stableSheetValue(row)))
    .sort();
  const canonicalFingerprints = fingerprints(products);
  const aggregateFingerprints = fingerprints(fetched.products);
  if (canonicalFingerprints.some((fingerprint, index) => fingerprint !== aggregateFingerprints[index])) {
    return { products: [], reason: '검증 스냅샷 매물 내용 불일치' };
  }
  return { products, reason: '' };
}

/**
 * 검증 스냅샷이 그대로 커밋 가능한지 확인한다.
 *
 * 일부 공급사 조회가 실패한 상태에서 성공한 공급사만 저장하면 한 번의 일괄 동기화가
 * 서로 다른 기준시각의 재고를 만든다. UI 우회 호출도 있으므로 화면 버튼뿐 아니라
 * 커밋 경계에서도 fail-closed 한다.
 */
export function sheetSyncCommitBlockReason(fetched: PartnerSheetsFetch): string {
  if (!fetched.rosterRevision) return '시트 대상 설정 revision 없음';
  if (fetched.partnerCount <= 0) return '시트 대상 공급사 없음';
  if (fetched.lines.length !== fetched.partnerCount) {
    return `공급사 조회 결과 불일치 (${fetched.lines.length}/${fetched.partnerCount})`;
  }
  const failed = fetched.lines.filter((line) => !line.ok);
  if (failed.length) {
    return `조회 실패 공급사 ${failed.length}곳 (${failed.map((line) => line.label).join(', ')})`;
  }
  const duplicatedCodes = fetched.lines
    .map((line) => line.code)
    .filter((code, index, all) => !code || all.indexOf(code) !== index);
  if (duplicatedCodes.length) return '공급사 코드 중복 또는 누락';

  // 차번 오타·설명문처럼 신원을 확정하지 못한 행을 빼고 부재처리를 계속하면,
  // 같은 기존 차량이 "시트에서 사라짐"으로 오판되어 출고불가로 내려간다.
  // 구조용 섹션 행은 파서에서 이미 제외하므로 남은 무효 행은 운영자가 원문을
  // 고친 뒤 다시 검증하게 fail-closed 한다.
  //
  // 시트 안 중복 차번: 파서가 이미 한 대만 products에 남긴다. 예전엔 중복이 있으면
  // 검증된 나머지 전체 커밋까지 막았는데, 운영 요청은 «중복이 있어도 올린 매물은 반영».
  // 중복 행 자체는 여전히 제외되고, 커밋만 막지 않는다.
  const invalidIdentity = fetched.lines.find((line) => line.invalidCount > 0);
  if (invalidIdentity) {
    return `${invalidIdentity.label} 무효 차번 ${invalidIdentity.invalidCount}건 (원문 수정 필요)`;
  }
  const crossProviderPlate = [...incomingProvidersByPlate(fetched).entries()]
    .find(([, providers]) => providers.size > 1);
  if (crossProviderPlate) {
    return `공급사 간 동일 실차번 ${crossProviderPlate[0]} (${[...crossProviderPlate[1]].join(', ')})`;
  }

  const unsafeEmpty = fetched.lines.find((line) => line.imported === 0 && !isExplicitAllExcluded(line));
  if (unsafeEmpty) {
    return `${unsafeEmpty.label} 올림 0대 (전 행 명시적 출고불가가 아님)`;
  }
  const parseCollapse = fetched.lines.find((line) => line.sourceRowCount >= 10
    && line.skippedCount >= line.sourceRowCount * 0.5);
  if (parseCollapse) {
    return `${parseCollapse.label} 스킵·무효 비율 50% 초과`;
  }
  const unstablePending = fetched.lines.find((line) =>
    line.products.some(isPendingSheetRow) && !line.plateAlloc);
  if (unstablePending) return `${unstablePending.label} 번호미정 차량의 영구 식별자 없음`;

  const lineProductCount = fetched.lines.reduce((sum, line) => sum + line.products.length, 0);
  if (lineProductCount !== fetched.products.length) {
    return `검증 스냅샷 매물 수 불일치 (${lineProductCount}/${fetched.products.length})`;
  }
  const lineCountMismatch = fetched.lines.find((line) => line.imported !== line.products.length);
  if (lineCountMismatch) {
    return `${lineCountMismatch.label} 올림 대수 불일치 (${lineCountMismatch.imported}/${lineCountMismatch.products.length})`;
  }
  const sourceCountMismatch = fetched.lines.find((line) => !sheetSourceCountMatches(line));
  if (sourceCountMismatch) {
    return `${sourceCountMismatch.label} 판독 행 집계 불일치`;
  }
  const issueCountMismatch = fetched.lines.find((line) => !sheetIssueCountMatches(line));
  if (issueCountMismatch) return `${issueCountMismatch.label} 중복·무효·식별불가 집계 불일치`;
  const canonical = canonicalSheetProductsFromLines(fetched);
  if (canonical.reason) return canonical.reason;
  return '';
}

export type SheetSyncExistingConflicts = {
  activeTwins: string[];
  /** 시트 또는 기존 ERP에서 같은 실차번의 소유 공급사가 둘 이상인 경우 */
  crossProviderPlateConflicts: string[];
  deletedCollisions: string[];
  /** 공급사 귀속을 확정할 수 없는 삭제 이력과 신규 실차번 충돌 */
  unownedDeletedMatches: string[];
  manualReactivations: string[];
  /** 차단 사유는 아니며, 시트보다 수기 출고불가를 우선해 상태를 보존한 행 */
  manualHoldsPreserved: string[];
  pendingIdentityTransitions: string[];
  /** 기존 임시번호가 사라진 동시에 새 임시번호가 생겨 동일 차량 수정/교체를 구분할 수 없는 경우 */
  pendingIdentityDrifts: string[];
  /** 같은 공급사·임시번호인데 최초 신원 서명이 달라진 경우 */
  pendingSignatureConflicts: string[];
  /** 기존 시트 매물에 있던 가격 기간이 이번 시트에서 사라진 경우(자동 삭제하지 않고 차단) */
  missingPricePeriods: string[];
  /** 공급사 필드·키로 귀속을 확정 못 한 기존차와 유입 차번 충돌 */
  unownedLegacyMatches: string[];
};

function syncPlate(row: EntityRecord): string {
  return String(row.car_number || row.car_number_snapshot || '').replace(/\s/g, '');
}

/**
 * 번호미정 판정 SSOT.
 *
 * erp3에서 만든 `100신…` 레코드는 `is_pending_plate`가 없을 수 있다. 플래그만
 * 신뢰하면 같은 임시번호의 신원서명 교체·번호 변경·실차 전환 충돌을 전부 우회한다.
 */
function isPendingSheetRow(row: EntityRecord): boolean {
  return Boolean(row.is_pending_plate) || /^100신\d{4,}$/.test(syncPlate(row));
}

const pendingVehicleFamily = (row: EntityRecord): string => {
  const maker = String(row.maker || '').trim().replace(/\s+/g, '').toLowerCase();
  const model = String(row.model || '').trim().replace(/\s+/g, '').toLowerCase();
  return maker && model ? `${maker}|${model}` : '';
};

/** 기존 ERP 상태와 충돌하는 시트 반영은 자동 선택하지 않고 커밋을 막는다. */
export function findSheetSyncExistingConflicts(
  fetched: PartnerSheetsFetch,
  existing: EntityRecord[],
  deleted: EntityRecord[],
): SheetSyncExistingConflicts {
  const providerCodes = new Set(fetched.lines.map((line) => line.code));
  const upsertPlan = planProductUpsert(fetched.products, existing);
  const incomingOwners = incomingProvidersByPlate(fetched);
  const twinGroups = new Map<string, string[]>();
  for (const row of existing) {
    const provider = sheetProviderOf(row, providerCodes);
    const plate = syncPlate(row);
    if (!providerCodes.has(provider) || !plate || isPendingSheetRow(row)) continue;
    const group = `${provider}|${plate}`;
    const keys = twinGroups.get(group) || [];
    keys.push(String(row._key || row.product_code || ''));
    twinGroups.set(group, keys);
  }
  const activeTwins = [...twinGroups.entries()]
    .filter(([, keys]) => keys.filter(Boolean).length > 1)
    .map(([group, keys]) => `${group} (${keys.join(', ')})`);

  const deletedKeys = new Set(deleted.map((row) => String(row._key || row.product_code || '')).filter(Boolean));
  const deletedPlates = new Set(deleted.map((row) => {
    const provider = sheetProviderOf(row, providerCodes);
    const plate = syncPlate(row);
    return provider && plate && !isPendingSheetRow(row) ? `${provider}|${plate}` : '';
  }).filter(Boolean));
  // 활성 canonical과 매칭되어 patch될 유입은 과거 tombstone을 되살리지 않는다.
  // 실제 create 후보만 삭제 이력과 충돌하는지 본다.
  const deletedCollisions = [...new Set(upsertPlan.creates
    .filter((row) => {
      const key = String(row.product_code || row._key || '');
      const provider = sheetProviderOf(row, providerCodes);
      const plate = syncPlate(row);
      return deletedKeys.has(key) || (!!provider && !!plate && deletedPlates.has(`${provider}|${plate}`));
    })
    .map((row) => String(row.car_number || row.product_code || row._key || '')))];
  const createPlates = new Set(upsertPlan.creates
    .filter((row) => !isPendingSheetRow(row))
    .map(syncPlate)
    .filter(Boolean));
  const unownedDeletedMatches = deleted.flatMap((row) => {
    const plate = syncPlate(row);
    if (!plate || isPendingSheetRow(row) || !createPlates.has(plate) || sheetProviderOf(row, providerCodes)) return [];
    const owners = incomingOwners.get(plate);
    if (!owners?.size) return [];
    return [`${plate} (${String(row._key || row.product_code || '키없음')} ↔ ${[...owners].join(',')})`];
  });

  const existingByKey = new Map(existing.map((row) => [String(row._key || row.product_code || ''), row]));
  const manualReactivations = [...new Set(upsertPlan.patches
    .filter(({ key, patch }) => {
      const before = existingByKey.get(key);
      return !!before
        && isManualSheetHold(before)
        && patch.vehicle_status !== undefined
        && String(patch.vehicle_status) !== '출고불가';
    })
    .map(({ key }) => key))];

  const existingByPlate = new Map(existing
    .filter((row) => syncPlate(row) && !isPendingSheetRow(row))
    .map((row) => [`${sheetProviderOf(row, providerCodes)}|${syncPlate(row)}`, row]));
  const manualHoldsPreserved = [...new Set(fetched.products.flatMap((incoming) => {
    const key = String(incoming.product_code || incoming._key || '');
    const provider = sheetProviderOf(incoming, providerCodes);
    const before = existingByKey.get(key)
      || existingByPlate.get(`${provider}|${syncPlate(incoming)}`);
    if (!before) return [];
    const manualHold = isManualSheetHold(before)
      && String(incoming.vehicle_status || '') !== '출고불가';
    return manualHold ? [String(before._key || before.product_code || key)] : [];
  }))];

  const existingPendingByPlate = new Map(existing.flatMap((row) => {
    if (!isPendingSheetRow(row)) return [];
    const provider = sheetProviderOf(row, providerCodes);
    const plate = syncPlate(row);
    return provider && plate ? [[`${provider}|${plate}`, row] as const] : [];
  }));
  const pendingSignatureConflicts = fetched.products.flatMap((incoming) => {
    if (!isPendingSheetRow(incoming)) return [];
    const provider = sheetProviderOf(incoming, providerCodes);
    const plate = syncPlate(incoming);
    const before = existingPendingByPlate.get(`${provider}|${plate}`);
    if (!before) return [];
    const beforeSig = storedPendingSignature(before);
    const incomingSig = storedPendingSignature(incoming);
    return beforeSig && incomingSig && beforeSig !== incomingSig
      ? [`${provider}|${plate}`]
      : [];
  });

  const missingPricePeriods = fetched.products.flatMap((incoming) => {
    const key = String(incoming.product_code || incoming._key || '');
    const provider = sheetProviderOf(incoming, providerCodes);
    const keyed = existingByKey.get(key);
    const before = (keyed && sheetProviderOf(keyed, providerCodes) === provider ? keyed : undefined)
      || (!isPendingSheetRow(incoming) ? existingByPlate.get(`${provider}|${syncPlate(incoming)}`) : undefined);
    if (!before) return [];
    // 레거시 시트 레코드는 source/source_schema가 없거나 `general`·`autoplus`일 수 있다.
    // 동일 공급사+키/차번으로 확정 매칭된 기존 가격은 출처 표식과 무관하게 비교한다.
    // 수기 추가 기간도 자동 삭제하거나 조용히 보존 승인하지 않고, 기간별 승인 workflow가
    // 생길 때까지 운영자 확인 대상으로 hard block 한다.
    const beforePrice = before.price && typeof before.price === 'object'
      ? before.price as Record<string, unknown>
      : {};
    const incomingPrice = incoming.price && typeof incoming.price === 'object'
      ? incoming.price as Record<string, unknown>
      : {};
    const salesStandardScope = incoming._sheet_price_scope === 'sales_standard_months';
    const missing = Object.keys(beforePrice).filter((period) => {
      if (period in incomingPrice) return false;
      // 영업자 표에는 운영 표준기간만 편다. 표에서 표현할 수 없는 6개월·72개월·주행거리
      // 변형 가격은 기존 ERP 값을 보존하되, 표준기간 공란은 기존과 동일하게 차단한다.
      return !salesStandardScope || /^(1|12|24|36|48|60)$/.test(period);
    }).sort();
    return missing.length ? [`${provider}|${syncPlate(incoming) || key} (${missing.join(', ')})`] : [];
  });

  // 번호미정 행에는 공급사 고유 row ID/VIN이 없다. 따라서 색상·트림·출고월처럼
  // signature 구성값이 수정되면 allocator는 새 100신 번호를 발급한다. 같은 동기화에서
  // 기존 임시번호가 사라지고 새 임시번호 create가 생겼다면 "기존차 수정"과
  // "기존차 제거 + 신차 추가"를 자동으로 구분할 수 없으므로 둘 다 쓰기 전에 막는다.
  // 기존 번호가 모두 남은 순수 증차는 허용한다.
  const incomingPendingPlates = new Set(fetched.products
    .filter(isPendingSheetRow)
    .map((row) => `${sheetProviderOf(row, providerCodes)}|${syncPlate(row)}`));
  const missingPendingByProvider = new Map<string, EntityRecord[]>();
  for (const row of existing) {
    if (!isPendingSheetRow(row)) continue;
    const provider = sheetProviderOf(row, providerCodes);
    const plate = syncPlate(row);
    if (!providerCodes.has(provider) || !plate || incomingPendingPlates.has(`${provider}|${plate}`)) continue;
    const values = missingPendingByProvider.get(provider) || [];
    values.push(row);
    missingPendingByProvider.set(provider, values);
  }
  const createdPendingByProvider = new Map<string, EntityRecord[]>();
  const createdRealByProvider = new Map<string, EntityRecord[]>();
  for (const row of upsertPlan.creates) {
    const provider = sheetProviderOf(row, providerCodes);
    const plate = syncPlate(row);
    if (!provider || !plate) continue;
    const target = isPendingSheetRow(row) ? createdPendingByProvider : createdRealByProvider;
    const values = target.get(provider) || [];
    values.push(row);
    target.set(provider, values);
  }
  const pendingIdentityDrifts = [...missingPendingByProvider.entries()].flatMap(([provider, missing]) => {
    const created = createdPendingByProvider.get(provider) || [];
    if (!created.length) return [];
    const pairedOld = new Set<string>();
    const pairedNew = new Set<string>();
    for (const oldRow of missing) {
      const oldFamily = pendingVehicleFamily(oldRow);
      const locked = !!oldRow.locked_by_contract || String(oldRow.vehicle_status || '') === '계약중';
      for (const newRow of created) {
        // 계약에 물린 임시차는 모델 표기까지 수정될 수 있어 같은 공급사의 신규 임시차와
        // 모두 보수적으로 충돌시킨다. 미계약 행은 제조사+모델이 같은 경우만 잡아
        // 서로 다른 차종의 정상 교체를 과도하게 막지 않는다.
        if (!locked && (!oldFamily || oldFamily !== pendingVehicleFamily(newRow))) continue;
        pairedOld.add(syncPlate(oldRow));
        pairedNew.add(syncPlate(newRow));
      }
    }
    if (!pairedOld.size || !pairedNew.size) return [];
    return [`${provider} (기존 ${[...pairedOld].join(', ')} ↔ 신규 ${[...pairedNew].join(', ')})`];
  });
  const pendingIdentityTransitions = [...missingPendingByProvider.entries()].flatMap(([provider, missing]) => {
    const created = createdRealByProvider.get(provider) || [];
    if (!created.length) return [];
    const pairedOld = new Set<string>();
    const pairedReal = new Set<string>();
    for (const oldRow of missing) {
      const family = pendingVehicleFamily(oldRow);
      const locked = !!oldRow.locked_by_contract || String(oldRow.vehicle_status || '') === '계약중';
      for (const realRow of created) {
        if (!locked && (!family || pendingVehicleFamily(realRow) !== family)) continue;
        pairedOld.add(syncPlate(oldRow));
        pairedReal.add(syncPlate(realRow));
      }
    }
    if (!pairedOld.size || !pairedReal.size) return [];
    return [`${provider} (임시 ${[...pairedOld].join(', ')} ↔ 실차 ${[...pairedReal].join(', ')})`];
  });

  const allOwners = new Map<string, Set<string>>(
    [...incomingOwners].map(([plate, owners]) => [plate, new Set(owners)]),
  );
  for (const row of existing) {
    const plate = syncPlate(row);
    if (!plate || isPendingSheetRow(row) || !incomingOwners.has(plate)) continue;
    const provider = sheetProviderOf(row, providerCodes);
    if (!provider) continue;
    const owners = allOwners.get(plate) || new Set<string>();
    owners.add(provider);
    allOwners.set(plate, owners);
  }
  const crossProviderPlateConflicts = [...allOwners.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([plate, owners]) => `${plate} (${[...owners].sort().join(' ↔ ')})`);
  const unownedLegacyMatches = existing.flatMap((row) => {
    const plate = syncPlate(row);
    if (!plate || isPendingSheetRow(row) || sheetProviderOf(row, providerCodes)) return [];
    const incomingProviders = incomingOwners.get(plate);
    if (!incomingProviders?.size) return [];
    return [`${plate} (${String(row._key || row.product_code || '키없음')} ↔ ${[...incomingProviders].join(',')})`];
  });

  return {
    activeTwins,
    crossProviderPlateConflicts,
    deletedCollisions,
    unownedDeletedMatches,
    manualReactivations,
    manualHoldsPreserved,
    pendingIdentityTransitions,
    pendingIdentityDrifts,
    pendingSignatureConflicts,
    missingPricePeriods,
    unownedLegacyMatches,
  };
}

export function sheetSyncExistingConflictReason(conflicts: SheetSyncExistingConflicts): string {
  const parts: string[] = [];
  if (conflicts.activeTwins.length) parts.push(`활성 중복차번 ${conflicts.activeTwins.length}건`);
  if (conflicts.crossProviderPlateConflicts.length) parts.push(`공급사 간 차번 소유 충돌 ${conflicts.crossProviderPlateConflicts.length}건`);
  // 동일 공급사 삭제 톰스톤 재등장(deletedCollisions)은 commitSheetProducts가
  // 공급사+차번으로 되살린다. 예전엔 승인 UI도 없이 여기 남겨 반영만 막았고,
  // 키 불일치(RP004_… vs EXT_…)로 되살림도 스킵돼 아이카 21대가 고착됐다.
  if (conflicts.unownedDeletedMatches.length) parts.push(`공급사 미확정 삭제이력 충돌 ${conflicts.unownedDeletedMatches.length}건`);
  if (conflicts.manualReactivations.length) parts.push(`수기 출고불가 해제 후보 ${conflicts.manualReactivations.length}건`);
  if (conflicts.pendingIdentityTransitions.length) parts.push(`임시번호→실차번 연결 후보 ${conflicts.pendingIdentityTransitions.length}건`);
  if (conflicts.pendingIdentityDrifts.length) parts.push(`번호미정 식별자 변경 후보 ${conflicts.pendingIdentityDrifts.length}건`);
  if (conflicts.pendingSignatureConflicts.length) parts.push(`임시번호 신원서명 불일치 ${conflicts.pendingSignatureConflicts.length}건`);
  if (conflicts.missingPricePeriods.length) parts.push(`기존 가격기간 누락 ${conflicts.missingPricePeriods.length}건`);
  if (conflicts.unownedLegacyMatches.length) parts.push(`공급사 미확정 기존차 충돌 ${conflicts.unownedLegacyMatches.length}건`);
  return parts.join(' · ');
}

/** visible=1(Grid+사진) 전면화 후 공급사 병렬 4는 Sheets 분당 quota에 자주 걸린다. */
const CONCURRENCY = 2;

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

/** 공급사별 시트만 당겨 취합(쓰기 없음). 마스터 필수. */
export async function fetchAllPartnerSheets(
  companyId: string,
  master: MasterEntry[],
  deps: {
    /** 서버 cron처럼 getStore를 사용할 수 없는 실행 경계의 strict partner snapshot. */
    partnerRows?: EntityRecord[];
    /** 브라우저 /api/sheet 또는 서버 직접 Google CSV fetch. */
    fetchTable?: typeof fetchSheetTable;
    /** 보이는 탭 전부와 보이는 행을 같은 Grid 스냅샷으로 읽는 공급사 시트 SSOT. */
    fetchSupplierSheet?: SupplierSheetFetcher;
  } = {},
): Promise<PartnerSheetsFetch> {
  if (!master?.length) throw new Error('차종마스터 없음');
  // 대상 선정은 listSheetPartners 하나로 — 여기 따로 filter 를 두면 목록과 어긋난다.
  //  실제로 그랬다: 화면 목록엔 16곳이 나오는데 여기서 한글 '공급사'만 통과시켜 2곳만 가져왔다.
  // 대상 목록과 실제 fetch 레코드를 **같은 fresh 스냅샷**에서 만든다. 두 번 읽으면
  // 중간 설정 변경으로 roster와 gid/mapping이 서로 다른 시점이 될 수 있다.
  const partnerRows = deps.partnerRows ?? await listSheetPartnerRecords(companyId, true);
  const readTable = deps.fetchTable ?? fetchSheetTable;
  const readSupplier = deps.fetchSupplierSheet ?? (deps.fetchTable ? undefined : fetchSupplierSheetWorkbook);
  const roster = sheetPartnerRows(partnerRows);
  const partners = canonicalSheetPartnerRecords(partnerRows);
  const lines = await mapPool(partners, CONCURRENCY, async (p): Promise<PartnerFetchLine> => {
    const label = String(p.name || p.partner_name || p.partner_code);
    const code = String(p.partner_code || p._key || '');
    try {
      const o = partnerSheetOpts(p);
      const profile = safeProfile(o.profileRaw);
      const profileHeaders = safeHeaderSignature(p.mapping_header_signature);
      const allocator = createPlateAllocator(
        (p.pending_plates as PendingPlateMap | undefined),
        Number(p.pending_plate_seq) || 0,
      );
      const pendingOccurrence = new Map<string, number>();
      if (o.adapter.id === 'autoplus') {
        const res = await importAutoplusMerged({
          url: o.url,
          providerCode: o.providerCode,
          entries: master,
          profile,
          profileHeaders,
          fetchTable: readTable,
          headerRow: o.headerRow,
          plateAllocator: allocator,
          pendingOccurrence,
          depositRule: o.depositRule,
        });
        const zeroUpload = res.imported === 0 && !isExplicitAllExcluded({
          sourceRowCount: res.total,
          imported: res.imported,
          excludedCount: res.excludedCount,
          noPriceCount: res.noPriceCount,
          skippedCount: res.skipped,
        });
        const missingDepositRule = !o.depositRule;
        return {
          code, label, ok: !zeroUpload, sourceRowCount: res.total, imported: res.imported,
          excludedCount: res.excludedCount, noPriceCount: res.noPriceCount,
          noPriceSkippedCount: res.noPriceSkippedCount, skippedCount: res.skipped,
          duplicateCount: res.duplicateCount, blockingDuplicateCount: res.blockingDuplicateCount,
          invalidCount: res.invalidCount, issueSamples: res.issueSamples,
          plateAlloc: res.products.some(isPendingSheetRow) ? allocator.snapshot() : undefined,
          message: `${zeroUpload ? '✗' : '✓'} ${label} [autoplus 2탭] — ${res.imported}매물 (본 ${res.mainN}+프로모 ${res.promoOnlyN} · 재고 ${res.stock} · 확정 ${res.snap.high + res.snap.medium}·검수 ${res.snap.low + res.snap.none}${res.excludedCount ? ` · 출고불가 제외 ${res.excludedCount}` : ''}${res.noPriceCount ? ` · 가격없음 ${res.noPriceCount}` : ''}${missingDepositRule ? ' · 보증금 규칙 미설정(국산 2·수입 3개월치 설정 필요)' : ''}${res.duplicateCount ? ` · 중복 ${res.duplicateCount}` : ''}${res.invalidCount ? ` · 무효 ${res.invalidCount}` : ''}${zeroUpload ? ' · 올림0 안전차단' : ''})`,
          products: res.products,
        };
      }
      // 탭이 여러 개면 전부 읽어 합친다. 한 탭만 읽으면 나머지 탭 차량이 「시트에 없음」으로 잡혀
      //  멀쩡한 매물이 부재처리로 출고불가가 된다 — 조용히 일어나서 더 위험하다.
      // 번호미정 신차 임시번호 — 저장된 부여기록 위에서 이어 뽑는다(같은 차는 같은 번호 유지).
      let workbookTabs: SupplierTab[] | undefined;
      const ignoredTabNotes: string[] = [];
      const products: EntityRecord[] = [];
      const seen = new Set<string>();
      let sourceRows = 0, imported = 0, excluded = 0, noPrice = 0, noPriceSkipped = 0, skipped = 0;
      let duplicate = 0, blockingDuplicate = 0, crossTabOverlap = 0;
      let invalid = 0, high = 0, low = 0;
      const issueSamples: string[] = [];
      const tabNotes: string[] = [];
      const tabResponses = new Map<string, string>();
      if (readSupplier) {
        const workbook = await readSupplier(o.url, p);
        workbookTabs = workbook.tabs;
        for (const failure of workbook.failures) {
          const note = `${failure.title || failure.gid}: ${failure.reason}`;
          // 명시한 탭 또는 실제 차량번호가 든 탭의 실패는 공급사 전체를 차단한다.
          // 차량번호도 없는 월렌트·수수료·메모 탭은 재고 탭이 아니므로 경고만 남긴다.
          if (o.gids.length || failure.vehicleLike) tabNotes.push(note);
          else ignoredTabNotes.push(note);
        }
      }
      const tabs = workbookTabs?.map((tab) => tab.gid) ?? (o.gids.length ? o.gids : ['']);
      for (const g of tabs) {
        try {
          // 사진은 셀 링크에 있어 표에 안 담긴다 — CSV엔 링크가 없고 visible=1(Grid)만
          // hyperlink·스마트칩을 준다. 오토플러스는 어댑터에서 이미 visible 강제.
          // 여기 generic/ianka 경로가 CSV만 타면 검증 미리보기「사진 없음」이 전부다.
          const workbookTab = workbookTabs?.find((tab) => tab.gid === g);
          let photoByPlate: Record<string, string> | undefined = workbookTab?.photoByPlate;
          const raw = workbookTab?.table ?? await readTable(o.url, g || undefined, {
            // 레거시 fetch 폴백. 운영·관리자 경로는 위 통합 Grid reader를 사용한다.
            visibleRowsOnly: Boolean(g),
            onPhotoByPlate: (map) => { photoByPlate = map; },
          });
          if (!workbookTabs && tabs.length > 1) assertDistinctSheetTable(tabResponses, raw, `gid ${g || '기본'}`);
          const t = workbookTab ? raw : o.adapter.prepareTable(raw, { headerRow: o.headerRow });
          if (t.length < 2) { tabNotes.push(`gid ${g || '기본'}: 데이터 없음`); continue; }
          const r = importSheetTable(t, {
            providerCode: o.providerCode,
            entries: master,
            profile,
            profileHeaders,
            depositRule: o.depositRule,
            plateAllocator: allocator,
            pendingOccurrence,
            photoByPlate,
          });
          for (const product of r.products) {
            product.sheet_source_gid = g || '기본';
            if (workbookTab?.title) product.sheet_source_tab = workbookTab.title;
          }
          sourceRows += r.total;
          excluded += r.excludedCount;
          noPrice += r.noPriceCount;
          noPriceSkipped += r.noPriceSkippedCount;
          skipped += r.skipped;
          duplicate += r.duplicateCount;
          blockingDuplicate += r.duplicateCount;
          invalid += r.invalidCount;
          for (const issue of r.issueSamples) {
            if (issueSamples.length < 12) issueSamples.push(`${g ? `gid ${g} · ` : ''}${issue}`);
          }
          high += r.snap.high + r.snap.medium;
          low += r.snap.low + r.snap.none;
          for (const rec of r.products) {
            // 같은 차가 두 탭에 있으면 먼저 읽은 탭이 이긴다(탭 순서 = 사용자가 적은 순서).
            const k = String(rec.product_code || rec._key || '');
            if (k && seen.has(k)) {
              skipped++; duplicate++;
              if (o.adapter.id === 'ianka') crossTabOverlap++;
              else blockingDuplicate++;
              if (issueSamples.length < 12) issueSamples.push(`${g ? `gid ${g} · ` : ''}탭 중복 · ${String(rec.car_number || k)}`);
              continue;
            }
            if (k) seen.add(k);
            products.push(rec);
            imported++;
          }
        } catch (error) {
          tabNotes.push(`gid ${g || '기본'}: ${String((error as Error).message || error)}`);
        }
      }
      const zeroUpload = imported === 0 && !isExplicitAllExcluded({
        sourceRowCount: sourceRows,
        imported,
        excludedCount: excluded,
        noPriceCount: noPrice,
        skippedCount: skipped,
      });
      const partialTabFailure = tabNotes.length > 0;
      return {
        code, label, ok: !zeroUpload && !partialTabFailure, sourceRowCount: sourceRows, imported,
        excludedCount: excluded, noPriceCount: noPrice,
        noPriceSkippedCount: noPriceSkipped, skippedCount: skipped,
        duplicateCount: duplicate, invalidCount: invalid, issueSamples,
        blockingDuplicateCount: blockingDuplicate,
        // 기존 map을 그대로 재사용하면 dirty=false다. 그래도 번호미정 매물이 있으면
        // 영구 매핑이 존재한다는 증거를 commit snapshot에 반드시 포함한다.
        plateAlloc: products.some(isPendingSheetRow) ? allocator.snapshot() : undefined,
        message: `${zeroUpload || partialTabFailure ? '✗' : '✓'} ${label} [${o.adapter.id}${tabs.length > 1 ? ` ${tabs.length}탭` : ''}] — ${imported}매물 (확정 ${high}·검수 ${low}${excluded ? ` · 출고불가 제외 ${excluded}` : ''}${noPrice ? ` · 가격미입력 ${noPrice}` : ''}${crossTabOverlap ? ` · 탭 겹침 ${crossTabOverlap}(우선탭 유지)` : ''}${blockingDuplicate ? ` · 차단 중복 ${blockingDuplicate}` : ''}${invalid ? ` · 무효 ${invalid}` : ''}${ignoredTabNotes.length ? ` · 비차량 탭 제외 ${ignoredTabNotes.length}` : ''}${zeroUpload ? ' · 올림0 안전차단' : ''}${partialTabFailure ? ` · 탭 실패: ${tabNotes.join(' · ')}` : ''})`,
        products,
      };
    } catch (e) {
      return {
        code, label, ok: false, sourceRowCount: 0, imported: 0,
        excludedCount: 0, noPriceCount: 0, skippedCount: 0,
        duplicateCount: 0, invalidCount: 0, issueSamples: [],
        message: `✗ ${label} — ${String((e as Error).message || e)}`,
        products: [],
      };
    }
  });
  const products = lines.filter((line) => line.ok).flatMap((line) => line.products);
  // 첫 roster가 이번 검증의 기대 집합이다. 중간 재조회에서 한 공급사가 사라지면
  // 더 작은 집합을 정상 전체처럼 취급하지 말고 commitBlockReason의 수 불일치로 막는다.
  return {
    lines,
    products,
    partnerCount: roster.length,
    rosterRevision: sheetPartnerRosterRevision(roster),
  };
}

/** 이번 유입 차량번호 — 키 규약이 달라도 차번이 같으면 시트에 있는 차다(부재처리 오작동 방지). */
function presentPlateSet(products: EntityRecord[]): Set<string> {
  const s = new Set<string>();
  for (const p of products) {
    if (isPendingSheetRow(p)) continue;   // 임시번호는 실물 차번이 아니다
    const v = String(p.car_number || '').replace(/\s/g, '');
    if (v) s.add(v);
  }
  return s;
}

function presentKeySet(products: EntityRecord[]): Set<string> {
  const s = new Set<string>();
  for (const p of products) {
    const k = String(p.product_code || p._key || '');
    if (k) s.add(k);
  }
  return s;
}

export function buildPrevForGuard(
  partners: EntityRecord[],
  existing: EntityRecord[],
): Map<string, number> {
  const prevForGuard = new Map<string, number>();
  for (const p of partners) {
    const code = String(p.partner_code || p._key || '');
    if (!code) continue;
    // last_sheet_rows(읽은 행) 우선 — 없으면 구버전 last_sheet_imported 로 폴백.
    const rows = Number(p.last_sheet_rows ?? p.last_sheet_imported ?? 0);
    if (rows > 0) prevForGuard.set(code, rows);
  }
  const fallbackCounts = new Map<string, number>();
  for (const r of existing) {
    if (r._deleted) continue;
    const code = sheetProviderOf(r, partners.map((partner) => String(partner.partner_code || partner._key || '')).filter(Boolean));
    if (!code) continue;
    fallbackCounts.set(code, (fallbackCounts.get(code) || 0) + 1);
  }
  for (const [code, count] of fallbackCounts) {
    if (!prevForGuard.has(code)) prevForGuard.set(code, count);
  }
  return prevForGuard;
}

/** 급감가드 실패 시 깨진 행수를 다음 정상 기준으로 승격하지 않는다. */
export function buildSheetSyncCheckpoint(
  line: PartnerFetchLine,
  now: number,
  guardPassed: boolean,
): EntityRecord {
  const rowsRead = sheetSourceRowsRead(line);
  return {
    last_sheet_attempt_at: now,
    last_sheet_attempt_rows: rowsRead,
    ...(guardPassed ? {
      last_synced_at: now,
      last_sheet_imported: line.imported,
      last_sheet_rows: rowsRead,
      last_sheet_guarded_at: null,
    } : { last_sheet_guarded_at: now }),
    ...(line.plateAlloc || {}),
  };
}

/**
 * 이미 당겨 온 결과 → master-ingress 저장 + (가드 통과 시) 부재→출고불가.
 * 미리보기(confirm) 후 호출 — fetch 재실행 없음.
 */
export async function commitFetchedPartnerSheets(
  companyId: string,
  master: MasterEntry[],
  fetched: PartnerSheetsFetch,
  options: {
    resolutions?: SheetConflictResolution[];
    contracts?: EntityRecord[];
    loadConflictContext?: () => Promise<{
      resolutions: SheetConflictResolution[];
      contracts: EntityRecord[];
    }>;
  } = {},
): Promise<{
  lines: PartnerFetchLine[];
  commit: MasterIngressCommit | null;
  ingress: { confirmed: number; review: number } | null;
  absent: AbsentSyncSummary;
  partnerCount: number;
  okCount: number;
  failCount: number;
}> {
  const store = getStore();
  const { lines, partnerCount } = fetched;
  const okCount = lines.filter((l) => l.ok).length;
  const failCount = lines.length - okCount;
  const blocked = sheetSyncCommitBlockReason(fetched);
  if (blocked) throw new Error(`전체 동기화 중단 — ${blocked}. 데이터 검증을 다시 실행하세요.`);
  const canonical = canonicalSheetProductsFromLines(fetched);
  if (canonical.reason) throw new Error(`전체 동기화 중단 — ${canonical.reason}. 데이터 검증을 다시 실행하세요.`);
  const products = canonical.products;
  if (!fetched.reconcileRevision) {
    throw new Error('전체 동기화 중단 — ERP 재고 검증 revision 없음. 데이터 검증을 다시 실행하세요.');
  }
  // 급감 기준도 호출자 preview Map을 신뢰하지 않고, product와 같은 커밋 경계에서
  // strict fresh partner/currentState로 다시 만든다. 빈 Map 주입으로 대량 부재차단 우회 금지.
  const [currentState, currentPartnerRows] = await Promise.all([
    listSheetReconcileState(companyId, true),
    listSheetPartnerRecords(companyId, true),
  ]);
  const currentRoster = sheetPartnerRows(currentPartnerRows);
  if (sheetReconcileStateRevision(currentState) !== fetched.reconcileRevision) {
    throw new Error('전체 동기화 중단 — 검증 후 ERP 재고가 변경됐습니다. 데이터 검증을 다시 실행하세요.');
  }
  if (rosterRevisionForFetched(currentRoster, fetched) !== fetched.rosterRevision) {
    throw new Error('전체 동기화 중단 — 검증 후 시트 대상·탭·매핑·급감 기준이 변경됐습니다. 다시 검증하세요.');
  }
  const currentExisting = currentState.active;
  const currentDeleted = currentState.deleted;
  const conflictContext = options.loadConflictContext
    ? await options.loadConflictContext()
    : { resolutions: options.resolutions, contracts: options.contracts };
  const commitConflicts = findSheetSyncExistingConflicts(fetched, currentExisting, currentDeleted);
  const existingConflict = sheetSyncExistingConflictReason(applySheetConflictResolutions({
    conflicts: commitConflicts,
    resolutions: conflictContext.resolutions,
    existing: currentExisting,
    contracts: conflictContext.contracts,
    // 미리보기와 같은 판정을 쓴다 — 빠뜨리면 화면은 통과인데 여기서만 막혀 반영이 영영 안 된다.
    priceChangesValue: buildPriceChangesValue({
      conflicts: commitConflicts,
      existing: currentExisting,
      deleted: currentDeleted,
      incoming: fetched.products,
      contracts: conflictContext.contracts,
      providerCodes: fetched.lines.map((line) => line.code),
    }),
  }).conflicts);
  if (existingConflict) throw new Error(`전체 동기화 중단 — ${existingConflict}. 충돌 매물을 먼저 정리하세요.`);
  const currentCodes = new Set(currentRoster.map((row) => row.code));
  const currentPartners = currentPartnerRows
    // roster와 같은 대상만 guard 기준으로 쓴다. 같은 partner_code의 삭제/영업/URL없는
    // 레거시 중복행이 뒤에서 last_sheet_rows를 덮어 급감 기준을 낮추지 못하게 한다.
    .filter(isSheetPartnerRecord)
    .filter((row) => currentCodes.has(String(row.partner_code || row._key || '')));
  const guard = buildPrevForGuard(currentPartners, currentExisting);
  let commit: MasterIngressCommit | null = null;
  let ingress: { confirmed: number; review: number } | null = null;
  if (products.length) {
    commit = await commitSupplierProducts(companyId, products, master);
    ingress = { confirmed: commit.confirmed, review: commit.review };
  }

  const absent: AbsentSyncSummary = {
    blocked: 0,
    skipped_locked: 0,
    skipped_guard: 0,
    notes: [],
  };
  const now = Date.now();
  for (const line of lines) {
    if (!line.ok) {
      absent.notes.push(`${line.label}: 부재처리 스킵(fetch 실패)`);
      continue;
    }
    const prev = guard.get(line.code) || 0;
    // ⚠ 가드에는 **읽은 행 수**(올린 것 + 출고불가로 걸러낸 것)를 넣는다.
    //  급감가드는 "시트가 깨졌나"를 보는 장치지 "공급사가 차를 막았나"를 보는 장치가 아니다.
    //  올린 대수만 넣으면 — 공급사가 절반을 출고불가로 돌린 날 가드가 걸려 부재처리가 통째로 스킵되고,
    //  그 차들은 유입에도 없으니 ERP 에서 계속 출고가능으로 남는다(정확히 반대 방향의 사고).
    // 원문 데이터 행 전체를 급감 기준으로 쓴다. 가격없음·중복/무효를 빼면 가격열이 깨진 날
    // 이전 행수가 허위로 급감하고, 정작 어떤 행이 문제였는지도 운영 기준에서 사라진다.
    const rowsRead = sheetSourceRowsRead(line);
    const gate = shouldReconcileAbsent(rowsRead, prev);
    if (!gate.ok) {
      absent.skipped_guard++;
      absent.notes.push(`${line.label}: 부재처리 스킵(${gate.reason === 'collapse' ? '급감가드' : '유입0'})`);
    } else {
      const a = await applyAbsentBlocked(companyId, line.code, presentKeySet(line.products), presentPlateSet(line.products));
      absent.blocked += a.absent_blocked;
      absent.skipped_locked += a.skipped_locked;
      if (a.absent_blocked) {
        line.message += ` · 부재→출고불가 ${a.absent_blocked}`;
        absent.notes.push(`${line.label}: 출고불가 ${a.absent_blocked}`);
      }
    }
    // 번호미정 신차에 새로 뽑은 임시번호는 가드와 무관하게 반드시 저장한다.
    // 반면 급감한 rowsRead를 정상 baseline으로 저장하면 같은 깨진 시트 2회차에 가드가 풀리므로
    // last_sheet_rows는 가드 통과 때만 갱신한다. 실패를 삼키면 번호가 흔들리므로 전체 오류로 올린다.
    await store.update('partner', companyId, line.code, buildSheetSyncCheckpoint(line, now, gate.ok));
  }

  // 비원자 다단계 쓰기이므로 마지막에 반드시 실제 ERP를 다시 읽어 잔여 반영분을 확인한다.
  // 네트워크가 중간에 끊겨 일부 청크만 남았으면 성공 토스트 대신 오류로 올려 재검증/재시도하게 한다.
  // ⚠ 사후검증 incoming 은 커밋과 같은 ensureSnapped·prepareMasterIngress 결과여야 한다.
  //    fetch 원본을 그대로 넣으면 soft-merge 유령 diff 로 사후검증이 영구 실패한다.
  const after = (await listSheetReconcileState(companyId, true)).active;
  const incomplete: string[] = [];
  for (const line of lines) {
    const ready = productsForSheetCommit(line.products, master).products;
    const upsert = planProductUpsert(ready, after);
    const rowsRead = sheetSourceRowsRead(line);
    const gate = shouldReconcileAbsent(rowsRead, guard.get(line.code) || 0);
    const absentPlan = planAbsentBlocked({
      existing: after,
      providerCode: line.code,
      presentKeys: presentKeySet(ready),
      presentPlates: presentPlateSet(ready),
    });
    const remainingAbsent = gate.ok ? absentPlan.patches.length : 0;
    if (upsert.creates.length || upsert.patches.length || remainingAbsent) {
      const sample = [
        ...upsert.creates.slice(0, 2).map((row) => `신규:${String(row.product_code || row.car_number || '?')}`),
        ...upsert.patches.slice(0, 2).map((row) => `수정:${row.key}[${Object.keys(row.patch).slice(0, 4).join(',')}]`),
      ].join(' ');
      incomplete.push(
        `${line.label}(신규 ${upsert.creates.length}·수정 ${upsert.patches.length}·차단 ${remainingAbsent}${sample ? ` · ${sample}` : ''})`,
      );
    }
  }
  if (incomplete.length) {
    throw new Error(`동기화 사후검증 실패 — ${incomplete.slice(0, 5).join(', ')}. 다시 데이터 검증하세요.`);
  }

  return { lines, commit, ingress, absent, partnerCount, okCount, failCount };
}

/**
 * 가격·삭제·신원 충돌이 있어도 기존 차량의 안전한 공급사 입력 원자는 같은 클릭에서 반영한다.
 * 신규 생성, 가격 변경, 부재 차단은 하지 않으며 공급사+실차번이 활성 ERP 한 대와 정확히
 * 일치하는 경우만 CAS 저장 경로로 보낸다.
 */
export function planSafeSupplierProducts(
  incomingProducts: EntityRecord[],
  activeProducts: EntityRecord[],
): EntityRecord[] {
  const cleanPlate = (value: unknown) => String(value || '').replace(/\s/g, '');
  const existingByIdentity = new Map<string, EntityRecord[]>();
  for (const row of activeProducts) {
    const provider = sheetProviderOf(row);
    const plate = cleanPlate(row.car_number);
    if (!provider || !isExactRealPlate(plate)) continue;
    const identity = `${provider}|${plate}`;
    existingByIdentity.set(identity, [...(existingByIdentity.get(identity) || []), row]);
  }
  const incomingIdentityCount = new Map<string, number>();
  for (const incoming of incomingProducts) {
    const provider = sheetProviderOf(incoming);
    const plate = cleanPlate(incoming.car_number);
    if (!provider || !isExactRealPlate(plate)) continue;
    const identity = `${provider}|${plate}`;
    incomingIdentityCount.set(identity, (incomingIdentityCount.get(identity) || 0) + 1);
  }
  const safe: EntityRecord[] = [];
  for (const incoming of incomingProducts) {
    const provider = sheetProviderOf(incoming);
    const plate = cleanPlate(incoming.car_number);
    if (!provider || !isExactRealPlate(plate)) continue;
    const identity = `${provider}|${plate}`;
    if (incomingIdentityCount.get(identity) !== 1) continue;
    const matches = existingByIdentity.get(identity) || [];
    if (matches.length !== 1) continue;
    const existing = matches[0];
    const row: EntityRecord = {
      product_code: String(existing._key || existing.product_code || ''),
      car_number: plate,
      provider_company_code: provider,
      partner_code: provider,
      // 가격은 기존값을 그대로 넣어 master ingress 최소요건을 만족시키되 변경하지 않는다.
      price: existing.price,
    };
    for (const field of SUPPLIER_OWNED_PRODUCT_FIELDS) {
      if (field === 'price' || field === 'vehicle_status') continue;
      const value = incoming[field];
      if (value != null && String(value).trim() !== '') row[field] = value;
    }
    safe.push(row);
  }
  return safe;
}

export async function commitSafeSupplierFields(
  companyId: string,
  master: MasterEntry[],
  fetched: PartnerSheetsFetch,
): Promise<MasterIngressCommit | null> {
  const sourceBlocked = sheetSyncCommitBlockReason(fetched);
  if (sourceBlocked) throw new Error(`안전 정보 연동 중단 — ${sourceBlocked}`);
  const [state, partnerRows] = await Promise.all([
    listSheetReconcileState(companyId, true),
    listSheetPartnerRecords(companyId, true),
  ]);
  if (!fetched.reconcileRevision || sheetReconcileStateRevision(state) !== fetched.reconcileRevision) {
    throw new Error('검증 뒤 ERP 재고가 변경됐습니다. 다시 검증해 주세요.');
  }
  if (rosterRevisionForFetched(sheetPartnerRows(partnerRows), fetched) !== fetched.rosterRevision) {
    throw new Error('검증 뒤 공급사 시트 설정이 변경됐습니다. 다시 검증해 주세요.');
  }
  const safe = planSafeSupplierProducts(fetched.products, state.active);
  return safe.length ? commitSupplierProducts(companyId, safe, master) : null;
}

/** 당겨오기 + 저장(마스터 필수). 미리보기 없이 한 방에 쓸 때. */
export async function syncAllPartnerSheets(
  companyId: string,
  master: MasterEntry[],
): Promise<{
  lines: PartnerFetchLine[];
  commit: MasterIngressCommit | null;
  ingress: { confirmed: number; review: number } | null;
  absent: AbsentSyncSummary;
  partnerCount: number;
  okCount: number;
  failCount: number;
}> {
  const fetched = await fetchAllPartnerSheets(companyId, master);
  const [reconcileState, partnerRows] = await Promise.all([
    listSheetReconcileState(companyId, true),
    listSheetPartnerRecords(companyId, true),
  ]);
  const roster = sheetPartnerRows(partnerRows);
  if (rosterRevisionForFetched(roster, fetched) !== fetched.rosterRevision) {
    throw new Error('전체 동기화 중단 — 시트 조회 중 대상·탭·매핑·급감 기준이 변경됐습니다. 다시 실행하세요.');
  }
  fetched.reconcileRevision = sheetReconcileStateRevision(reconcileState);
  return commitFetchedPartnerSheets(companyId, master, fetched);
}
