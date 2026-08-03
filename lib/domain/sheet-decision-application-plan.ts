import type { EntityRecord } from '@/lib/intake/entities';
import type { SheetConflictDecisionDryRun, SheetConflictDecisionDryRunRow } from '@/lib/domain/sheet-conflict-decision-dry-run';
import type { SheetIdentityConflictReview, SheetIdentityReviewRow } from '@/lib/domain/sheet-identity-conflict-review';
import {
  DIFFERENT_VEHICLE_ALLOCATE_NEW_PENDING_ID,
  DIFFERENT_VEHICLE_CREATE_REVIEW,
  DIFFERENT_VEHICLE_KEEP_NEW_PENDING_ID,
  EXCLUDE_SHEET_ROW,
  SAME_VEHICLE_ACCEPT_ATOM_UPDATE,
  SAME_VEHICLE_KEEP_OLD_PENDING_ID,
  SAME_VEHICLE_RESTORE_REVIEW,
  sheetIdentityDecisionLabel,
  type SheetIdentityDecision,
  type SheetIdentityDecisionValue,
} from '@/lib/domain/sheet-identity-decision';
import { sheetConflictDecisionLabel } from '@/lib/domain/sheet-conflict-decision';
import { sheetProviderOf } from '@/lib/domain/sheet-merge';

export type SheetDecisionCandidateKind =
  | 'exclude_sheet_row'
  | 'restore_deleted_overlay'
  | 'create_product'
  | 'migrate_owner_references'
  | 'update_identity_atoms'
  | 'none';

export type SheetDecisionApplicationStatus =
  | 'candidate_review'
  | 'requires_reference_migration'
  | 'undecided'
  | 'blocked_contract'
  | 'blocked_ambiguous'
  | 'blocked_ledger'
  | 'blocked_alias'
  | 'blocked_overlap'
  | 'stale_ledger';

export type SheetDecisionReferenceCounts = {
  contracts: number;
  rooms: number;
  quotes: number;
  total: number;
};

export type SheetDecisionApplicationRow = {
  source: 'ownership_or_deleted' | 'identity';
  fingerprint: string;
  category: string;
  decisionCode: string;
  decision: string;
  provider: string;
  carNumbers: string[];
  existingKey: string;
  incomingKey: string;
  kind: SheetDecisionCandidateKind;
  status: SheetDecisionApplicationStatus;
  reason: string;
  nextAction: string;
  candidatePaths: string[];
  candidateFields: string[];
  references: SheetDecisionReferenceCounts;
  applyAllowed: false;
};

export type SheetDecisionApplicationPlan = {
  generatedAt: number;
  rows: SheetDecisionApplicationRow[];
  summary: {
    total: number;
    candidateReview: number;
    referenceMigrations: number;
    exclusions: number;
    restores: number;
    creates: number;
    identityUpdates: number;
    undecided: number;
    blocked: number;
    staleLedger: number;
    executableOperations: 0;
  };
};

type ReferenceInput = {
  contracts?: EntityRecord[];
  rooms?: EntityRecord[];
  quotes?: EntityRecord[];
};

const text = (value: unknown): string => String(value ?? '').trim();
const plate = (value: unknown): string => text(value).replace(/\s/g, '');
const recordKey = (row: EntityRecord): string => text(row.product_code || row._key || row._rtdb_key);
const unique = (values: string[]): string[] => [...new Set(values.map(text).filter(Boolean))];

function referencesFor(
  existingKey: string,
  carNumbers: string[],
  input: ReferenceInput,
): SheetDecisionReferenceCounts {
  const keys = new Set([existingKey].filter(Boolean));
  const plates = new Set(carNumbers.map(plate).filter(Boolean));
  const matches = (row: EntityRecord): boolean => {
    const rowKeys = [row.product_code, row.product_uid, row.product_id].map(text).filter(Boolean);
    if (rowKeys.some((key) => keys.has(key))) return true;
    const rowPlate = plate(row.car_number || row.car_number_snapshot || row.vehicle_number);
    return !!rowPlate && plates.has(rowPlate);
  };
  const contracts = (input.contracts || []).filter(matches).length;
  const rooms = (input.rooms || []).filter(matches).length;
  const quotes = (input.quotes || []).filter(matches).length;
  return { contracts, rooms, quotes, total: contracts + rooms + quotes };
}

function emptyReferences(): SheetDecisionReferenceCounts {
  return { contracts: 0, rooms: 0, quotes: 0, total: 0 };
}

function incomingKeysFor(
  row: SheetConflictDecisionDryRunRow,
  incoming: EntityRecord[],
  providerCodes: Set<string>,
): string[] {
  const targetPlate = plate(row.carNumber);
  const targetProvider = text(row.sheetProviders[0]);
  return unique(incoming
    .filter((item) => plate(item.car_number || item.car_number_snapshot) === targetPlate)
    .filter((item) => !targetProvider || sheetProviderOf(item, providerCodes) === targetProvider)
    .map(recordKey));
}

function conflictRow(input: {
  row: SheetConflictDecisionDryRunRow;
  incoming: EntityRecord[];
  providerCodes: Set<string>;
  references: ReferenceInput;
}): SheetDecisionApplicationRow {
  const { row } = input;
  const incomingKeys = incomingKeysFor(row, input.incoming, input.providerCodes);
  const existingKey = text(row.productKeys[0]);
  const incomingKey = text(incomingKeys[0]);
  const common = {
    source: 'ownership_or_deleted' as const,
    fingerprint: row.fingerprint,
    category: row.category,
    decisionCode: row.decision || '',
    decision: row.decision ? sheetConflictDecisionLabel(row.decision) : '',
    provider: text(row.sheetProviders[0] || row.providers[0]),
    carNumbers: unique([row.carNumber]),
    existingKey,
    incomingKey,
    kind: 'none' as SheetDecisionCandidateKind,
    candidatePaths: [] as string[],
    candidateFields: [] as string[],
    references: existingKey ? referencesFor(existingKey, [row.carNumber], input.references) : emptyReferences(),
    applyAllowed: false as const,
  };
  const blocked = (status: SheetDecisionApplicationStatus, reason: string, nextAction: string): SheetDecisionApplicationRow => ({
    ...common, status, reason, nextAction,
  });
  if (row.status === 'stale_ledger') return blocked('stale_ledger', row.reason, row.nextAction);
  if (row.status === 'undecided') return blocked('undecided', row.reason, row.nextAction);
  if (row.status === 'contract_protected') return blocked('blocked_contract', row.reason, row.nextAction);
  if (row.status === 'target_ambiguous') return blocked('blocked_ambiguous', row.reason, row.nextAction);
  if (row.status === 'ledger_mismatch') return blocked('blocked_ledger', row.reason, row.nextAction);
  if (row.status === 'restore_forbidden_alias') return blocked('blocked_alias', row.reason, row.nextAction);
  if (row.status !== 'keep_existing_ready'
    && row.status !== 'assign_owner_migration'
    && row.status !== 'keep_deleted_ready'
    && row.status !== 'restore_overlay_candidate') {
    return blocked('blocked_ambiguous', row.reason, row.nextAction);
  }
  if (incomingKeys.length !== 1) {
    return blocked('blocked_ambiguous', `현재 Sheet 상품키 ${incomingKeys.length}개`, '현재 Sheet 행을 단일 상품키로 먼저 확정');
  }
  if (row.status === 'assign_owner_migration') return {
    ...common,
    kind: 'migrate_owner_references',
    status: 'requires_reference_migration',
    reason: common.references.total
      ? `계약 ${common.references.contracts} · 채팅방 ${common.references.rooms} · 견적 ${common.references.quotes} 참조 이관 필요`
      : '참조 0건이지만 상품·private 정체성 이관계획과 원자적 교체 필요',
    nextAction: '대표키·private·계약·채팅방·견적을 한 묶음으로 검토하는 별도 patch dry-run',
    candidatePaths: unique([
      `v4/products/${existingKey}`, `v4/products/${incomingKey}`,
      `v4/products_private/${existingKey}`, `v4/products_private/${incomingKey}`,
    ]),
    candidateFields: ['product_code', 'provider_company_code', '참조 product_code/product_uid', 'private 원가 참조'],
  };
  if (row.status === 'restore_overlay_candidate') return {
    ...common,
    kind: 'restore_deleted_overlay',
    status: 'candidate_review',
    reason: '동일 상품키 복구 결정과 현재 단일 Sheet 행이 일치',
    nextAction: '삭제필드 해제+Sheet soft-merge patch를 현재 revision 기준으로 재계산',
    candidatePaths: [`v4/products/${existingKey}`],
    candidateFields: unique([...row.candidateFields, '_deleted', 'deletedAt', 'status']),
  };
  return {
    ...common,
    kind: 'exclude_sheet_row',
    status: 'candidate_review',
    reason: row.status === 'keep_existing_ready' ? '기존 공급사 유지 결정' : '삭제 유지 결정',
    nextAction: '원본 지문에 결속된 Sheet 유입 제외 규칙 후보를 생성하고 다음 검증에서 동일 충돌만 해제',
    candidatePaths: [`v4/sheet_sync_exclusions/${row.fingerprint}`],
    candidateFields: ['fingerprint', 'provider', 'incoming_key', 'decision', 'status'],
  };
}

function compatibleIdentityDecision(row: SheetIdentityReviewRow, value: SheetIdentityDecisionValue): boolean {
  return value === EXCLUDE_SHEET_ROW
    || row.category === '공급사 미확정 삭제이력' && (
      value === SAME_VEHICLE_RESTORE_REVIEW || value === DIFFERENT_VEHICLE_CREATE_REVIEW)
    || row.category === '번호미정 식별변경' && (
      value === SAME_VEHICLE_KEEP_OLD_PENDING_ID || value === DIFFERENT_VEHICLE_KEEP_NEW_PENDING_ID)
    || row.category === '임시번호 신원불일치' && (
      value === SAME_VEHICLE_ACCEPT_ATOM_UPDATE || value === DIFFERENT_VEHICLE_ALLOCATE_NEW_PENDING_ID);
}

function identityRow(input: {
  row: SheetIdentityReviewRow;
  decision?: SheetIdentityDecision;
  records: EntityRecord[];
  references: ReferenceInput;
}): SheetDecisionApplicationRow {
  const { row, decision } = input;
  const existingKey = text(row.existingKeys[0]);
  const incomingKey = text(row.incomingKeys[0]);
  const common = {
    source: 'identity' as const,
    fingerprint: row.fingerprint,
    category: row.category,
    decisionCode: decision?.decision || '',
    decision: decision ? sheetIdentityDecisionLabel(decision.decision) : '',
    provider: row.provider,
    carNumbers: row.carNumbers,
    existingKey,
    incomingKey,
    kind: 'none' as SheetDecisionCandidateKind,
    candidatePaths: [] as string[],
    candidateFields: [] as string[],
    references: existingKey ? referencesFor(existingKey, row.carNumbers, input.references) : emptyReferences(),
    applyAllowed: false as const,
  };
  const blocked = (status: SheetDecisionApplicationStatus, reason: string, nextAction: string): SheetDecisionApplicationRow => ({
    ...common, status, reason, nextAction,
  });
  if (row.contractProtection || row.status === 'contract_protected') {
    return blocked('blocked_contract', row.contractProtection || row.reason, row.nextAction);
  }
  if (row.mergedAlias) return blocked('blocked_alias', '병합 별칭 삭제이력은 원본키 복구·재사용 금지', '대표키 연결과 Sheet 정본을 다시 확인');
  if (!row.provider || row.existingKeys.length !== 1 || row.incomingKeys.length !== 1) {
    return blocked('blocked_ambiguous', `공급사 ${row.provider ? 1 : 0} · 기존키 ${row.existingKeys.length} · Sheet키 ${row.incomingKeys.length}`, row.nextAction);
  }
  if (!decision) return blocked('undecided', '현재 원본 충돌에 대한 관리자 신원 결정 없음', '관리자 건별 신원 판단 기록');
  if (decision.category !== row.category || !compatibleIdentityDecision(row, decision.decision)
    || text(decision.provider) !== row.provider
    || text(decision.existing_key) !== existingKey
    || text(decision.incoming_key) !== incomingKey) {
    return blocked('blocked_ledger', '기록 당시 유형·공급사·상품키와 현재 검증 대상이 다름', '기존 결정 철회 후 현재 스냅샷으로 다시 결정');
  }
  if (decision.decision === EXCLUDE_SHEET_ROW) return {
    ...common,
    kind: 'exclude_sheet_row',
    status: 'candidate_review',
    reason: 'Sheet 오류·유입 제외 결정과 현재 대상 일치',
    nextAction: '원본 지문에 결속된 Sheet 유입 제외 규칙 후보 생성',
    candidatePaths: [`v4/sheet_sync_exclusions/${row.fingerprint}`],
    candidateFields: ['fingerprint', 'provider', 'incoming_key', 'decision', 'status'],
  };
  if (decision.decision === SAME_VEHICLE_RESTORE_REVIEW) return {
    ...common,
    kind: 'restore_deleted_overlay',
    status: 'candidate_review',
    reason: '공급사 없는 단일 삭제키를 동일 차량으로 복구하는 판단',
    nextAction: '기존키에 공급사 귀속·삭제필드 해제·Sheet soft-merge patch를 CAS 기준으로 계산',
    candidatePaths: [`v4/products/${existingKey}`],
    candidateFields: ['provider_company_code', '_deleted', 'deletedAt', 'status', 'Sheet soft-merge fields'],
  };
  if (decision.decision === SAME_VEHICLE_KEEP_OLD_PENDING_ID
    || decision.decision === SAME_VEHICLE_ACCEPT_ATOM_UPDATE) return {
    ...common,
    kind: 'update_identity_atoms',
    status: 'candidate_review',
    reason: '동일 차량 판단에 따라 기존 상품키를 유지',
    nextAction: '변경 승인된 신원 원자만 기존키에 CAS patch하고 최초 신원서명 변경을 별도 감사',
    candidatePaths: [`v4/products/${existingKey}`],
    candidateFields: row.changedAtoms,
  };
  const currentKeys = new Set(input.records.map(recordKey).filter(Boolean));
  if (currentKeys.has(incomingKey)) {
    return blocked('blocked_ambiguous', '신규 후보키가 현재 ERP 레코드에 이미 존재', '기존키와 incoming키의 활성·삭제 상태를 다시 대조');
  }
  return {
    ...common,
    kind: 'create_product',
    status: 'candidate_review',
    reason: decision.decision === DIFFERENT_VEHICLE_CREATE_REVIEW
      ? '기존 삭제차와 다른 차량으로 신규 생성 판단'
      : decision.decision === DIFFERENT_VEHICLE_KEEP_NEW_PENDING_ID
        ? '다른 차량으로 현재 신규 임시번호 유지 판단'
        : '다른 차량으로 신규 임시번호 발급 판단',
    nextAction: '현재 Sheet 행에서 신규 공개상품을 만들고 기존 상품·private·참조는 변경하지 않는 create dry-run',
    candidatePaths: [`v4/products/${incomingKey}`],
    candidateFields: ['Sheet public product fields', 'createdAt', 'createdBy', 'sheet_sync fingerprint'],
  };
}

function markOverlaps(rows: SheetDecisionApplicationRow[]): SheetDecisionApplicationRow[] {
  const candidates = rows.filter((row) => row.status === 'candidate_review' || row.status === 'requires_reference_migration');
  const byKey = new Map<string, Set<string>>();
  for (const row of candidates) {
    for (const key of unique([row.existingKey, row.incomingKey])) {
      const fingerprints = byKey.get(key) || new Set<string>();
      fingerprints.add(row.fingerprint);
      byKey.set(key, fingerprints);
    }
  }
  const overlapKeys = new Set([...byKey].filter(([, fingerprints]) => fingerprints.size > 1).map(([key]) => key));
  return rows.map((row) => {
    const keys = unique([row.existingKey, row.incomingKey]).filter((key) => overlapKeys.has(key));
    if (!keys.length || (row.status !== 'candidate_review' && row.status !== 'requires_reference_migration')) return row;
    return {
      ...row,
      status: 'blocked_overlap',
      reason: `다른 판단 계획과 상품키 중복: ${keys.join(', ')}`,
      nextAction: '중복 판단을 하나의 차량별 대표 계획으로 병합한 뒤 다시 생성',
    };
  });
}

export function planSheetDecisionApplication(input: {
  conflictPlan: SheetConflictDecisionDryRun;
  identityReview: SheetIdentityConflictReview;
  identityDecisions: SheetIdentityDecision[];
  incoming: EntityRecord[];
  records: EntityRecord[];
  providerCodes?: Iterable<string>;
  references?: ReferenceInput;
  now?: number;
}): SheetDecisionApplicationPlan {
  const providerCodes = new Set(input.providerCodes || []);
  const references = input.references || {};
  const rows: SheetDecisionApplicationRow[] = input.conflictPlan.rows.map((row) => conflictRow({
    row, incoming: input.incoming, providerCodes, references,
  }));
  const activeIdentity = new Map(input.identityDecisions
    .filter((decision) => decision.status === 'recorded')
    .map((decision) => [decision.fingerprint, decision]));
  for (const row of input.identityReview.rows) rows.push(identityRow({
    row,
    decision: activeIdentity.get(row.fingerprint),
    records: input.records,
    references,
  }));
  const currentIdentity = new Set(input.identityReview.rows.map((row) => row.fingerprint));
  for (const decision of activeIdentity.values()) {
    if (currentIdentity.has(decision.fingerprint)) continue;
    rows.push({
      source: 'identity', fingerprint: decision.fingerprint, category: decision.category,
      decisionCode: decision.decision,
      decision: sheetIdentityDecisionLabel(decision.decision), provider: decision.provider, carNumbers: [],
      existingKey: decision.existing_key, incomingKey: decision.incoming_key, kind: 'none', status: 'stale_ledger',
      reason: '현재 신원 충돌 목록에 같은 지문이 없음', nextAction: '원본 변경 또는 충돌 해소 여부 확인 후 결정 철회',
      candidatePaths: [], candidateFields: [], references: emptyReferences(), applyAllowed: false,
    });
  }
  const checked = markOverlaps(rows);
  const countStatus = (status: SheetDecisionApplicationStatus) => checked.filter((row) => row.status === status).length;
  const countKind = (kind: SheetDecisionCandidateKind) => checked.filter((row) => row.kind === kind).length;
  return {
    generatedAt: input.now ?? Date.now(),
    rows: checked,
    summary: {
      total: checked.length,
      candidateReview: countStatus('candidate_review'),
      referenceMigrations: countStatus('requires_reference_migration'),
      exclusions: countKind('exclude_sheet_row'),
      restores: countKind('restore_deleted_overlay'),
      creates: countKind('create_product'),
      identityUpdates: countKind('update_identity_atoms'),
      undecided: countStatus('undecided'),
      blocked: checked.filter((row) => row.status.startsWith('blocked_')).length,
      staleLedger: countStatus('stale_ledger'),
      executableOperations: 0,
    },
  };
}

const safeCell = (value: unknown): string => text(value).replace(/[\t\r\n]+/g, ' ');

export function sheetDecisionApplicationPlanTsv(plan: SheetDecisionApplicationPlan): string {
  return [
    ['원장', '구분', '차량번호', '공급사', '기존키', 'Sheet키', '결정코드', '결정', '후보작업', '상태', '참조계약', '참조채팅', '참조견적', '후보경로', '후보필드', '판단근거', '다음조치', '적용허용'],
    ...plan.rows.map((row) => [
      row.source, row.category, row.carNumbers.join(', '), row.provider, row.existingKey, row.incomingKey,
      row.decisionCode, row.decision, row.kind, row.status, row.references.contracts, row.references.rooms, row.references.quotes,
      row.candidatePaths.join(', '), row.candidateFields.join(', '), row.reason, row.nextAction, 'NO',
    ]),
  ].map((cells) => cells.map(safeCell).join('\t')).join('\n');
}
