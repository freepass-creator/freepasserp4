import type { EntityRecord } from '@/lib/intake/entities';
import type {
  SheetDecisionApplicationPlan,
  SheetDecisionApplicationRow,
} from '@/lib/domain/sheet-decision-application-plan';
import { changedPatch, softMergeProduct, stripSheetPrivatePatchFields } from '@/lib/domain/sheet-merge';
import { splitProductPrivate } from '@/lib/firebase/rtdb-products';
import { PRODUCT_PATCH_GUARD_FIELDS } from '@/lib/domain/product-write-guard';

export type SheetDecisionPatchMode = 'update' | 'create_if_absent';

export type SheetDecisionPatchOperation = {
  path: string;
  mode: SheetDecisionPatchMode;
  patch: EntityRecord;
  /** 실제 적용 직전 fresh overlay에 productPatchPreconditionMatches로 대조할 최소 기대값. */
  casExpected: EntityRecord | null;
  casFields: string[];
};

export type SheetDecisionPatchStatus =
  | 'patch_ready_review'
  | 'no_change'
  | 'blocked_application_plan'
  | 'blocked_source_missing'
  | 'blocked_private_input'
  | 'blocked_reference_migration';

export type SheetDecisionPatchDryRunRow = {
  fingerprint: string;
  category: string;
  decisionCode: string;
  kind: SheetDecisionApplicationRow['kind'];
  status: SheetDecisionPatchStatus;
  reason: string;
  operations: SheetDecisionPatchOperation[];
  applyAllowed: false;
};

export type SheetDecisionPatchDryRun = {
  generatedAt: number;
  sourceGeneratedAt: number;
  rows: SheetDecisionPatchDryRunRow[];
  summary: {
    total: number;
    readyReview: number;
    noChange: number;
    blocked: number;
    operationCount: number;
    productUpdates: number;
    productCreates: number;
    exclusionCreates: number;
    executableOperations: 0;
  };
};

const text = (value: unknown): string => String(value ?? '').trim();
const keyOf = (row: EntityRecord): string => text(row.product_code || row._key || row._rtdb_key);
const hasOwn = (row: EntityRecord, key: string): boolean => Object.prototype.hasOwnProperty.call(row, key);

function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clean) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, clean(item)])) as T;
  }
  return value;
}

function indexRows(rows: EntityRecord[]): Map<string, EntityRecord> {
  const out = new Map<string, EntityRecord>();
  for (const row of rows) {
    for (const key of [row._key, row.product_code, row._rtdb_key].map(text).filter(Boolean)) {
      if (!out.has(key)) out.set(key, row);
    }
  }
  return out;
}

function casExpected(expected: EntityRecord, patch: EntityRecord): { expected: EntityRecord; fields: string[] } {
  const fields = [...new Set([...Object.keys(patch), ...PRODUCT_PATCH_GUARD_FIELDS])].sort();
  return {
    expected: Object.fromEntries(fields.map((field) => [field, expected[field]])),
    fields,
  };
}

function productUpdate(path: string, patch: EntityRecord, expected: EntityRecord): SheetDecisionPatchOperation {
  const publicExpected = splitProductPrivate(expected).publicRecord;
  const cas = casExpected(publicExpected, patch);
  return {
    path,
    mode: 'update',
    patch: clean(patch),
    casExpected: cas.expected,
    casFields: cas.fields,
  };
}

function blocked(
  row: SheetDecisionApplicationRow,
  status: SheetDecisionPatchStatus,
  reason: string,
): SheetDecisionPatchDryRunRow {
  return {
    fingerprint: row.fingerprint,
    category: row.category,
    decisionCode: row.decisionCode,
    kind: row.kind,
    status,
    reason,
    operations: [],
    applyAllowed: false,
  };
}

const IDENTITY_FIELDS: Record<string, string[]> = {
  제조사: ['maker'],
  모델: ['model'],
  세부모델: ['sub_model'],
  트림: ['trim_name'],
  외장색: ['ext_color'],
  내장색: ['int_color'],
  '최초등록·연식': ['first_registration_date', 'year'],
  연료: ['fuel_type'],
  저장신원서명: ['_pending_signature'],
  '저장 신원서명': ['_pending_signature'],
};

function exclusionPatch(row: SheetDecisionApplicationRow, now: number): SheetDecisionPatchDryRunRow {
  if (!row.fingerprint || !row.provider || !row.incomingKey || !row.decisionCode) {
    return blocked(row, 'blocked_source_missing', '유입 제외 원장에 필요한 지문·공급사·Sheet키·결정코드 누락');
  }
  return {
    fingerprint: row.fingerprint,
    category: row.category,
    decisionCode: row.decisionCode,
    kind: row.kind,
    status: 'patch_ready_review',
    reason: '원본 지문과 현재 Sheet키에 결속된 유입 제외 원장 create-if-absent 후보',
    operations: [{
      path: `v4/sheet_sync_exclusions/${row.fingerprint}`,
      mode: 'create_if_absent',
      patch: {
        fingerprint: row.fingerprint,
        category: row.category,
        decision: row.decisionCode,
        provider: row.provider,
        existing_key: row.existingKey,
        incoming_key: row.incomingKey,
        status: 'active',
        recorded_at: now,
        recorded_by: 'system:sheet-decision-patch-dry-run',
      },
      casExpected: null,
      casFields: [],
    }],
    applyAllowed: false,
  };
}

function restorePatch(
  row: SheetDecisionApplicationRow,
  existing: EntityRecord | undefined,
  incoming: EntityRecord | undefined,
): SheetDecisionPatchDryRunRow {
  if (!existing || !incoming) return blocked(row, 'blocked_source_missing', '복구할 기존 삭제 레코드 또는 현재 Sheet 행 누락');
  const incomingSplit = splitProductPrivate(incoming);
  if (incomingSplit.privateRecord) return blocked(row, 'blocked_private_input', 'Sheet 행에 원가·VIN·계좌·내부 수수료가 포함됨');
  const merged = softMergeProduct(existing, incomingSplit.publicRecord);
  const mergedPatch = changedPatch(existing, merged) || {};
  const patch = stripSheetPrivatePatchFields({
    ...mergedPatch,
    _deleted: null,
    deletedAt: null,
    deletedReason: null,
    ...(text(existing.status).toLowerCase() === 'deleted' ? { status: null } : {}),
    provider_company_code: row.provider,
  });
  return {
    fingerprint: row.fingerprint,
    category: row.category,
    decisionCode: row.decisionCode,
    kind: row.kind,
    status: 'patch_ready_review',
    reason: '기존 삭제키 CAS + 삭제필드 해제 + 공개 Sheet soft-merge 후보',
    operations: [productUpdate(`v4/products/${row.existingKey}`, patch, existing)],
    applyAllowed: false,
  };
}

function createPatch(
  row: SheetDecisionApplicationRow,
  incoming: EntityRecord | undefined,
  companyId: string,
  now: number,
): SheetDecisionPatchDryRunRow {
  if (!incoming) return blocked(row, 'blocked_source_missing', '신규 생성할 현재 Sheet 행 누락');
  const { publicRecord, privateRecord } = splitProductPrivate(incoming);
  if (privateRecord) return blocked(row, 'blocked_private_input', 'Sheet 신규 행에 원가·VIN·계좌·내부 수수료가 포함됨');
  const at = new Date(now).toISOString();
  const product = clean({
    ...publicRecord,
    _key: row.incomingKey,
    product_code: row.incomingKey,
    provider_company_code: row.provider,
    companyId,
    _deleted: null,
    deletedAt: null,
    deletedReason: null,
    createdAt: at,
    createdBy: 'sheet_decision_apply',
    updatedAt: at,
    updatedBy: 'sheet_decision_apply',
    sheet_decision_fingerprint: row.fingerprint,
  });
  return {
    fingerprint: row.fingerprint,
    category: row.category,
    decisionCode: row.decisionCode,
    kind: row.kind,
    status: 'patch_ready_review',
    reason: '현재 Sheet 공개 필드만 사용하는 상품 create-if-absent 후보',
    operations: [{
      path: `v4/products/${row.incomingKey}`,
      mode: 'create_if_absent',
      patch: product,
      casExpected: null,
      casFields: [],
    }],
    applyAllowed: false,
  };
}

function identityPatch(
  row: SheetDecisionApplicationRow,
  existing: EntityRecord | undefined,
  incoming: EntityRecord | undefined,
): SheetDecisionPatchDryRunRow {
  if (!existing || !incoming) return blocked(row, 'blocked_source_missing', '신원 갱신할 기존 레코드 또는 현재 Sheet 행 누락');
  const fields = [...new Set(row.candidateFields.flatMap((label) => IDENTITY_FIELDS[label] || []))];
  const patch: EntityRecord = {};
  for (const field of fields) {
    if (!hasOwn(incoming, field)) continue;
    const value = incoming[field];
    if (value == null || typeof value === 'string' && !value.trim()) continue;
    patch[field] = value;
  }
  if (hasOwn(incoming, '_pending_signature') && text(incoming._pending_signature)) {
    patch._pending_signature = incoming._pending_signature;
  }
  if (!Object.keys(patch).length) {
    return blocked(row, 'no_change', '승인된 변경 원자에 현재 Sheet 값이 없거나 기존값과 동일');
  }
  const changed = Object.fromEntries(Object.entries(patch)
    .filter(([field, value]) => JSON.stringify(existing[field]) !== JSON.stringify(value)));
  if (!Object.keys(changed).length) return blocked(row, 'no_change', '승인된 신원 원자가 이미 현재값과 일치');
  return {
    fingerprint: row.fingerprint,
    category: row.category,
    decisionCode: row.decisionCode,
    kind: row.kind,
    status: 'patch_ready_review',
    reason: '승인된 신원 원자만 기존 상품키에 CAS patch하는 후보',
    operations: [productUpdate(`v4/products/${row.existingKey}`, changed, existing)],
    applyAllowed: false,
  };
}

export function planSheetDecisionPatchDryRun(input: {
  applicationPlan: SheetDecisionApplicationPlan;
  records: EntityRecord[];
  incoming: EntityRecord[];
  companyId: string;
  now?: number;
}): SheetDecisionPatchDryRun {
  const now = input.now ?? Date.now();
  const records = indexRows(input.records);
  const incoming = indexRows(input.incoming);
  const rows = input.applicationPlan.rows.map((row): SheetDecisionPatchDryRunRow => {
    if (row.status === 'requires_reference_migration') {
      return blocked(row, 'blocked_reference_migration', '공급사 대표키·private·계약·채팅·견적의 원자적 이관 정책 승인 필요');
    }
    if (row.status !== 'candidate_review') {
      return blocked(row, 'blocked_application_plan', `${row.status}: ${row.reason}`);
    }
    if (row.kind === 'exclude_sheet_row') return exclusionPatch(row, now);
    if (row.kind === 'restore_deleted_overlay') return restorePatch(row, records.get(row.existingKey), incoming.get(row.incomingKey));
    if (row.kind === 'create_product') return createPatch(row, incoming.get(row.incomingKey), input.companyId, now);
    if (row.kind === 'update_identity_atoms') return identityPatch(row, records.get(row.existingKey), incoming.get(row.incomingKey));
    return blocked(row, 'blocked_application_plan', `지원하지 않는 후보작업 ${row.kind}`);
  });
  const operations = rows.flatMap((row) => row.operations);
  return {
    generatedAt: now,
    sourceGeneratedAt: input.applicationPlan.generatedAt,
    rows,
    summary: {
      total: rows.length,
      readyReview: rows.filter((row) => row.status === 'patch_ready_review').length,
      noChange: rows.filter((row) => row.status === 'no_change').length,
      blocked: rows.filter((row) => row.status.startsWith('blocked_')).length,
      operationCount: operations.length,
      productUpdates: operations.filter((operation) => operation.mode === 'update' && operation.path.startsWith('v4/products/')).length,
      productCreates: operations.filter((operation) => operation.mode === 'create_if_absent' && operation.path.startsWith('v4/products/')).length,
      exclusionCreates: operations.filter((operation) => operation.path.startsWith('v4/sheet_sync_exclusions/')).length,
      executableOperations: 0,
    },
  };
}

/** 관리자 검토용. raw 충돌 원문과 private 필드는 포함하지 않는다. */
export function sheetDecisionPatchDryRunJson(plan: SheetDecisionPatchDryRun): string {
  return JSON.stringify(plan, null, 2);
}

const safeCell = (value: unknown): string => text(value).replace(/[\t\r\n]+/g, ' ');

export function sheetDecisionPatchDryRunTsv(plan: SheetDecisionPatchDryRun): string {
  return [
    ['지문', '구분', '결정코드', '후보작업', '상태', '경로', '모드', 'patch필드', 'CAS필드', '판단근거', '적용허용'],
    ...plan.rows.flatMap((row) => row.operations.length
      ? row.operations.map((operation) => [
        row.fingerprint, row.category, row.decisionCode, row.kind, row.status,
        operation.path, operation.mode, Object.keys(operation.patch).join(', '), operation.casFields.join(', '), row.reason, 'NO',
      ])
      : [[row.fingerprint, row.category, row.decisionCode, row.kind, row.status, '', '', '', '', row.reason, 'NO']]),
  ].map((cells) => cells.map(safeCell).join('\t')).join('\n');
}
