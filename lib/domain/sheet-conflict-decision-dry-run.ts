import type { EntityRecord } from '@/lib/intake/entities';
import type { SheetConflictReportRow } from '@/lib/domain/sheet-conflict-report';
import {
  ASSIGN_SHEET_OWNER,
  DELETED_REAPPEARANCE_CONFLICT,
  KEEP_DELETED,
  KEEP_EXISTING_OWNER,
  OWNERSHIP_CONFLICT,
  RESTORE_DELETED,
  decisionFingerprint,
  sheetConflictDecisionLabel,
  type SheetConflictDecision,
  type SheetConflictDecisionCategory,
  type SheetConflictDecisionValue,
} from '@/lib/domain/sheet-conflict-decision';
import { sheetProviderOf } from '@/lib/domain/sheet-merge';

export type SheetConflictDecisionTarget = {
  category: SheetConflictDecisionCategory;
  raw: string;
  fingerprint: string;
  carNumber: string;
  providers: string[];
  sheetProviders: string[];
  productKeys: string[];
  contractProtections: string[];
  mergedAlias: boolean;
};

export type SheetConflictDecisionDryRunStatus =
  | 'undecided'
  | 'contract_protected'
  | 'target_ambiguous'
  | 'ledger_mismatch'
  | 'keep_existing_ready'
  | 'assign_owner_migration'
  | 'keep_deleted_ready'
  | 'restore_overlay_candidate'
  | 'restore_forbidden_alias'
  | 'stale_ledger';

export type SheetConflictDecisionDryRunRow = SheetConflictDecisionTarget & {
  decision?: SheetConflictDecisionValue;
  status: SheetConflictDecisionDryRunStatus;
  reason: string;
  nextAction: string;
  candidatePath: string;
  candidateFields: string[];
  applyAllowed: false;
};

export type SheetConflictDecisionDryRun = {
  generatedAt: number;
  rows: SheetConflictDecisionDryRunRow[];
  summary: {
    currentTargets: number;
    recordedCurrent: number;
    undecided: number;
    protected: number;
    ambiguous: number;
    ledgerMismatch: number;
    keepExistingReady: number;
    assignOwnerMigration: number;
    keepDeletedReady: number;
    restoreCandidates: number;
    restoreForbiddenAlias: number;
    staleLedger: number;
    executableOperations: 0;
  };
};

const text = (value: unknown): string => String(value ?? '').trim();
const normalizedPlate = (value: unknown): string => text(value).replace(/\s/g, '');
const recordKey = (row: EntityRecord): string => text(row.product_code || row._key || row._rtdb_key);
const unique = (values: string[]): string[] => [...new Set(values.map(text).filter(Boolean))];

export function buildSheetConflictDecisionTargets(input: {
  reportRows: SheetConflictReportRow[];
  incoming: EntityRecord[];
  records?: EntityRecord[];
  providerCodes?: Iterable<string>;
}): SheetConflictDecisionTarget[] {
  const grouped = new Map<string, SheetConflictDecisionTarget>();
  for (const report of input.reportRows) {
    if (report.category !== OWNERSHIP_CONFLICT && report.category !== DELETED_REAPPEARANCE_CONFLICT) continue;
    const category = report.category as SheetConflictDecisionCategory;
    const key = `${category}|${report.raw}`;
    const current = grouped.get(key) || {
      category,
      raw: report.raw,
      fingerprint: decisionFingerprint(category, report.raw),
      carNumber: report.carNumber,
      providers: [],
      sheetProviders: [],
      productKeys: [],
      contractProtections: [],
      mergedAlias: false,
    };
    current.providers = unique([...current.providers, report.provider]);
    current.productKeys = unique([...current.productKeys, report.productKey]);
    current.contractProtections = unique([...current.contractProtections, report.contractProtection]);
    grouped.set(key, current);
  }

  const providerCodes = new Set(input.providerCodes || []);
  const recordsByKey = new Map((input.records || []).map((row) => [recordKey(row), row]));
  for (const target of grouped.values()) {
    target.sheetProviders = unique(input.incoming
      .filter((row) => normalizedPlate(row.car_number || row.car_number_snapshot) === normalizedPlate(target.carNumber))
      .map((row) => sheetProviderOf(row, providerCodes)));
    target.mergedAlias = target.productKeys.some((key) => !!text(recordsByKey.get(key)?._merged_into));
  }
  return [...grouped.values()].sort((a, b) => (
    a.category.localeCompare(b.category, 'ko') || a.carNumber.localeCompare(b.carNumber, 'ko')
  ));
}

export function sheetConflictDecisionTargetBlockReason(target: SheetConflictDecisionTarget): string {
  if (target.contractProtections.length) return target.contractProtections.join(' · ');
  if (target.productKeys.length !== 1) return `관련 상품키 ${target.productKeys.length}개 — 1개로 정리 필요`;
  if (target.providers.length !== 1) return `현재 ERP 공급사 ${target.providers.length}곳 — 단일 공급사 확인 필요`;
  if (target.sheetProviders.length !== 1) return `현재 Sheet 공급사 ${target.sheetProviders.length}곳 — 단일 공급사 확인 필요`;
  if (target.category === DELETED_REAPPEARANCE_CONFLICT
    && target.providers[0] !== target.sheetProviders[0]) {
    return `삭제 공급사 ${target.providers[0]}와 현재 Sheet 공급사 ${target.sheetProviders[0]} 불일치`;
  }
  return '';
}

function expectedProvider(target: SheetConflictDecisionTarget, decision: SheetConflictDecisionValue): string {
  return decision === ASSIGN_SHEET_OWNER ? target.sheetProviders[0] : target.providers[0];
}

function decidedRow(
  target: SheetConflictDecisionTarget,
  decision: SheetConflictDecision,
): SheetConflictDecisionDryRunRow {
  const common = { ...target, decision: decision.decision, candidatePath: '', candidateFields: [], applyAllowed: false as const };
  const compatible = target.category === OWNERSHIP_CONFLICT
    ? decision.decision === KEEP_EXISTING_OWNER || decision.decision === ASSIGN_SHEET_OWNER
    : decision.decision === KEEP_DELETED || decision.decision === RESTORE_DELETED;
  if (decision.category !== target.category || !compatible) {
    return {
      ...common,
      status: 'ledger_mismatch',
      reason: '기록된 충돌 유형과 결정값이 현재 대상과 맞지 않음',
      nextAction: '손상된 결정 철회 후 현재 검증 결과로 다시 결정',
    };
  }
  const expected = expectedProvider(target, decision.decision);
  if (text(decision.provider) !== expected || text(decision.product_key) !== target.productKeys[0]) {
    return {
      ...common,
      status: 'ledger_mismatch',
      reason: '기록 당시 공급사·상품키와 현재 대상이 다름',
      nextAction: '기존 결정 철회 후 현재 검증 결과로 다시 결정',
    };
  }
  if (decision.decision === KEEP_EXISTING_OWNER) return {
    ...common,
    status: 'keep_existing_ready',
    reason: '기존 ERP 공급사 귀속 유지 결정 일치',
    nextAction: '현재 Sheet 유입 제외 정책 dry-run 필요 · 재고 patch 없음',
  };
  if (decision.decision === ASSIGN_SHEET_OWNER) return {
    ...common,
    status: 'assign_owner_migration',
    reason: '상품키의 공급사 정체성과 현재 Sheet 공급사가 달라짐',
    nextAction: '대표 상품키와 계약·채팅·견적·비공개 원가 참조 이관계획 필요',
  };
  if (decision.decision === KEEP_DELETED) return {
    ...common,
    status: 'keep_deleted_ready',
    reason: '기존 tombstone 유지 결정 일치',
    nextAction: '현재 Sheet 유입 제외 정책 dry-run 필요 · tombstone patch 없음',
  };
  if (target.mergedAlias) return {
    ...common,
    status: 'restore_forbidden_alias',
    reason: '병합 별칭 tombstone은 원본 상품으로 복구할 수 없음',
    nextAction: '대표 상품 연결 상태와 Sheet 행의 정본 상품키 재확인',
  };
  return {
    ...common,
    status: 'restore_overlay_candidate',
    reason: '동일 상품키·동일 공급사 복구 결정 일치',
    nextAction: '현재 Sheet soft-merge 값과 삭제 필드 해제를 포함한 v4 overlay patch 재검증',
    candidatePath: `v4/products/${target.productKeys[0]}`,
    candidateFields: ['_deleted', 'deletedAt', 'status', 'Sheet soft-merge fields'],
  };
}

export function planSheetConflictDecisionDryRun(input: {
  targets: SheetConflictDecisionTarget[];
  decisions: SheetConflictDecision[];
  now?: number;
}): SheetConflictDecisionDryRun {
  const active = input.decisions.filter((item) => item.status === 'recorded');
  const activeByFingerprint = new Map(active.map((item) => [item.fingerprint, item]));
  const currentFingerprints = new Set(input.targets.map((target) => target.fingerprint));
  const rows: SheetConflictDecisionDryRunRow[] = input.targets.map((target) => {
    const common = { ...target, candidatePath: '', candidateFields: [], applyAllowed: false as const };
    if (target.contractProtections.length) return {
      ...common,
      status: 'contract_protected' as const,
      reason: target.contractProtections.join(' · '),
      nextAction: '계약 종료·취소 정책과 차량 잠금 해제 후 다시 검증',
    };
    const blockReason = sheetConflictDecisionTargetBlockReason(target);
    if (blockReason) return {
      ...common,
      status: 'target_ambiguous' as const,
      reason: blockReason,
      nextAction: '공급사·상품키를 단일 대상으로 먼저 확정',
    };
    const decision = activeByFingerprint.get(target.fingerprint);
    if (!decision) return {
      ...common,
      status: 'undecided' as const,
      reason: '현재 원본 충돌에 대한 관리자 결정 없음',
      nextAction: '관리자 건별 판단 기록',
    };
    return decidedRow(target, decision);
  });

  for (const decision of active) {
    if (currentFingerprints.has(decision.fingerprint)) continue;
    rows.push({
      category: decision.category,
      raw: '',
      fingerprint: decision.fingerprint,
      carNumber: '',
      providers: unique([text(decision.provider)]),
      sheetProviders: [],
      productKeys: unique([text(decision.product_key)]),
      contractProtections: [],
      mergedAlias: false,
      decision: decision.decision,
      status: 'stale_ledger',
      reason: '현재 충돌 목록에 같은 지문이 없음',
      nextAction: '원본 변경 또는 충돌 해소 여부 확인 후 결정 철회',
      candidatePath: '',
      candidateFields: [],
      applyAllowed: false,
    });
  }

  const count = (status: SheetConflictDecisionDryRunStatus) => rows.filter((row) => row.status === status).length;
  return {
    generatedAt: input.now ?? Date.now(),
    rows,
    summary: {
      currentTargets: input.targets.length,
      recordedCurrent: input.targets.filter((target) => activeByFingerprint.has(target.fingerprint)).length,
      undecided: count('undecided'),
      protected: count('contract_protected'),
      ambiguous: count('target_ambiguous'),
      ledgerMismatch: count('ledger_mismatch'),
      keepExistingReady: count('keep_existing_ready'),
      assignOwnerMigration: count('assign_owner_migration'),
      keepDeletedReady: count('keep_deleted_ready'),
      restoreCandidates: count('restore_overlay_candidate'),
      restoreForbiddenAlias: count('restore_forbidden_alias'),
      staleLedger: count('stale_ledger'),
      executableOperations: 0,
    },
  };
}

const safeCell = (value: unknown): string => text(value).replace(/[\t\r\n]+/g, ' ');

export function sheetConflictDecisionDryRunTsv(plan: SheetConflictDecisionDryRun): string {
  return [
    ['구분', '차량번호', '현재 ERP 공급사', '현재 Sheet 공급사', '상품키', '결정', 'dry-run 상태', '차단·판단근거', '다음조치', '후보경로', '후보필드', '적용허용'],
    ...plan.rows.map((row) => [
      row.category,
      row.carNumber,
      row.providers.join(', '),
      row.sheetProviders.join(', '),
      row.productKeys.join(', '),
      row.decision ? sheetConflictDecisionLabel(row.decision) : '',
      row.status,
      row.reason,
      row.nextAction,
      row.candidatePath,
      row.candidateFields.join(', '),
      'NO',
    ]),
  ].map((cells) => cells.map(safeCell).join('\t')).join('\n');
}
