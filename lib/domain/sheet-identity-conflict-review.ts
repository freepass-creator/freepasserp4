import type { EntityRecord } from '@/lib/intake/entities';
import { storedPendingSignature } from '@/lib/domain/pending-plate';
import { sheetProviderOf } from '@/lib/domain/sheet-merge';
import { sheetConflictFingerprint } from '@/lib/domain/sheet-conflict-resolution';
import type { SheetSyncExistingConflicts } from '@/lib/domain/sheet-sync-all';

export const UNOWNED_DELETED_CATEGORY = '공급사 미확정 삭제이력';
export const PENDING_IDENTITY_DRIFT_CATEGORY = '번호미정 식별변경';
export const PENDING_SIGNATURE_CATEGORY = '임시번호 신원불일치';

export type SheetIdentityReviewCategory =
  | typeof UNOWNED_DELETED_CATEGORY
  | typeof PENDING_IDENTITY_DRIFT_CATEGORY
  | typeof PENDING_SIGNATURE_CATEGORY;

export type SheetIdentityReviewStatus =
  | 'contract_protected'
  | 'unowned_deleted_single_candidate'
  | 'unowned_deleted_ambiguous'
  | 'pending_identity_drift_review'
  | 'pending_signature_review';

export type SheetIdentityReviewRow = {
  raw: string;
  fingerprint: string;
  category: SheetIdentityReviewCategory;
  status: SheetIdentityReviewStatus;
  provider: string;
  carNumbers: string[];
  existingKeys: string[];
  incomingKeys: string[];
  changedAtoms: string[];
  contractProtection: string;
  mergedAlias: boolean;
  reason: string;
  nextAction: string;
  applyAllowed: false;
};

export type SheetIdentityConflictReview = {
  generatedAt: number;
  rows: SheetIdentityReviewRow[];
  summary: {
    total: number;
    unownedDeleted: number;
    pendingIdentityDrift: number;
    pendingSignature: number;
    protected: number;
    unownedSingleCandidates: number;
    ambiguous: number;
    executableOperations: 0;
    changedAtomCounts: Record<string, number>;
  };
};

const text = (value: unknown): string => String(value ?? '').trim();
const compact = (value: unknown): string => text(value).replace(/\s+/g, '').toLowerCase();
const plate = (row: EntityRecord): string => text(row.car_number || row.car_number_snapshot).replace(/\s/g, '');
const key = (row: EntityRecord): string => text(row.product_code || row._key || row._rtdb_key);
const unique = (values: string[]): string[] => [...new Set(values.map(text).filter(Boolean))];
const isPending = (row: EntityRecord): boolean => Boolean(row.is_pending_plate) || /^100신\d{4,}$/.test(plate(row));

const ATOMS = [
  ['제조사', (row: EntityRecord) => row.maker],
  ['모델', (row: EntityRecord) => row.model],
  ['세부모델', (row: EntityRecord) => row.sub_model],
  ['트림', (row: EntityRecord) => row.trim_name],
  ['외장색', (row: EntityRecord) => row.ext_color],
  ['내장색', (row: EntityRecord) => row.int_color],
  ['최초등록·연식', (row: EntityRecord) => row.first_registration_date || row.year],
  ['연료', (row: EntityRecord) => row.fuel_type],
] as const;

function signatureBasis(row: EntityRecord): EntityRecord {
  const raw = row._raw_vehicle && typeof row._raw_vehicle === 'object'
    ? row._raw_vehicle as EntityRecord
    : null;
  return raw ? { ...row, ...raw } : row;
}

function changedAtoms(beforeRows: EntityRecord[], incomingRows: EntityRecord[]): string[] {
  const changed = new Set<string>();
  for (const beforeRaw of beforeRows) {
    const before = signatureBasis(beforeRaw);
    for (const incomingRaw of incomingRows) {
      const incoming = signatureBasis(incomingRaw);
      for (const [label, value] of ATOMS) {
        if (compact(value(before)) !== compact(value(incoming))) changed.add(label);
      }
      if (isPending(beforeRaw) && isPending(incomingRaw)
        && storedPendingSignature(beforeRaw) !== storedPendingSignature(incomingRaw)
        && changed.size === 0) changed.add('저장 신원서명');
    }
  }
  return [...changed];
}

function terminalContract(row: EntityRecord): boolean {
  return [
    '계약완료', '완료', '계약취소', '취소', 'completed', 'complete', 'cancelled', 'canceled',
  ].includes(text(row.contract_status || row.status).toLowerCase());
}

function protection(
  records: EntityRecord[],
  contracts: EntityRecord[],
  carNumbers: string[],
): string {
  const plates = new Set(carNumbers.map((value) => value.replace(/\s/g, '')).filter(Boolean));
  const matched = records.filter((row) => plates.has(plate(row)));
  const lock = matched.find((row) => text(row.locked_by_contract) || text(row.vehicle_status) === '계약중');
  if (lock) return text(lock.locked_by_contract) ? `계약락 ${text(lock.locked_by_contract)}` : '차량상태 계약중';
  const keys = new Set(matched.flatMap((row) => [row._key, row.product_code, row.product_uid, row._rtdb_key])
    .map(text).filter(Boolean));
  const linked = contracts.find((contract) => {
    if (contract._deleted === true || contract.deletedAt || terminalContract(contract)) return false;
    if (plates.has(plate(contract))) return true;
    return [contract.product_code, contract.product_uid, contract.product_id]
      .map(text).filter(Boolean).some((value) => keys.has(value));
  });
  return linked ? `진행계약 ${text(linked.contract_code || linked._key) || '확인필요'}` : '';
}

function driftParts(raw: string): { provider: string; oldPlates: string[]; newPlates: string[] } {
  const match = /^(.+?) \(기존 (.+?) ↔ 신규 (.+?)\)$/.exec(text(raw));
  if (!match) return { provider: '', oldPlates: [], newPlates: [] };
  return {
    provider: text(match[1]),
    oldPlates: unique(match[2].split(',')),
    newPlates: unique(match[3].split(',')),
  };
}

export function planSheetIdentityConflictReview(input: {
  conflicts: SheetSyncExistingConflicts;
  existing: EntityRecord[];
  deleted: EntityRecord[];
  incoming: EntityRecord[];
  contracts?: EntityRecord[];
  providerCodes?: Iterable<string>;
  now?: number;
}): SheetIdentityConflictReview {
  const providerCodes = new Set(input.providerCodes || []);
  const contracts = input.contracts || [];
  const allRecords = [...input.existing, ...input.deleted];
  const rows: SheetIdentityReviewRow[] = [];

  for (const raw of input.conflicts.unownedDeletedMatches) {
    const targetPlate = text(raw).split(' (')[0].replace(/\s/g, '');
    const deleted = input.deleted.filter((row) => plate(row) === targetPlate && !sheetProviderOf(row, providerCodes));
    const incoming = input.incoming.filter((row) => plate(row) === targetPlate);
    const owners = unique(incoming.map((row) => sheetProviderOf(row, providerCodes)));
    const protectedReason = protection(allRecords, contracts, [targetPlate]);
    const mergedAlias = deleted.some((row) => !!text(row._merged_into));
    const single = deleted.length === 1 && incoming.length === 1 && owners.length === 1 && !mergedAlias;
    rows.push({
      raw,
      fingerprint: sheetConflictFingerprint(UNOWNED_DELETED_CATEGORY, raw),
      category: UNOWNED_DELETED_CATEGORY,
      status: protectedReason
        ? 'contract_protected'
        : single ? 'unowned_deleted_single_candidate' : 'unowned_deleted_ambiguous',
      provider: owners.length === 1 ? owners[0] : '',
      carNumbers: unique([targetPlate]),
      existingKeys: unique(deleted.map(key)),
      incomingKeys: unique(incoming.map(key)),
      changedAtoms: changedAtoms(deleted, incoming),
      contractProtection: protectedReason,
      mergedAlias,
      reason: protectedReason || (single
        ? '공급사 없는 삭제 1건과 현재 단일 Sheet 행이 연결됨'
        : `삭제 ${deleted.length}건 · Sheet ${incoming.length}건 · Sheet 공급사 ${owners.length}곳`),
      nextAction: protectedReason
        ? '계약 상태와 차량 잠금 해제 전 자동수정 금지'
        : single
          ? '실소유 공급사 확정 후 삭제 유지 또는 동일키 복구를 별도 결정'
          : '삭제 레코드와 현재 Sheet 행의 대표 대상을 먼저 확정',
      applyAllowed: false,
    });
  }

  for (const raw of input.conflicts.pendingSignatureConflicts) {
    const [provider, targetPlate] = text(raw).split('|');
    const existing = input.existing.filter((row) => plate(row) === targetPlate
      && sheetProviderOf(row, providerCodes) === provider);
    const incoming = input.incoming.filter((row) => plate(row) === targetPlate
      && sheetProviderOf(row, providerCodes) === provider);
    const protectedReason = protection(allRecords, contracts, [targetPlate]);
    rows.push({
      raw,
      fingerprint: sheetConflictFingerprint(PENDING_SIGNATURE_CATEGORY, raw),
      category: PENDING_SIGNATURE_CATEGORY,
      status: protectedReason ? 'contract_protected' : 'pending_signature_review',
      provider,
      carNumbers: unique([targetPlate]),
      existingKeys: unique(existing.map(key)),
      incomingKeys: unique(incoming.map(key)),
      changedAtoms: changedAtoms(existing, incoming),
      contractProtection: protectedReason,
      mergedAlias: false,
      reason: protectedReason || '같은 임시번호의 최초 저장 신원서명과 현재 Sheet 서명이 다름',
      nextAction: protectedReason
        ? '계약 상태와 임시차 신원 연결을 먼저 확인'
        : '같은 차량의 원문 수정인지 다른 실물 차량 교체인지 확인',
      applyAllowed: false,
    });
  }

  for (const raw of input.conflicts.pendingIdentityDrifts) {
    const parts = driftParts(raw);
    const existing = input.existing.filter((row) => parts.oldPlates.includes(plate(row))
      && sheetProviderOf(row, providerCodes) === parts.provider);
    const incoming = input.incoming.filter((row) => parts.newPlates.includes(plate(row))
      && sheetProviderOf(row, providerCodes) === parts.provider);
    const protectedReason = protection(allRecords, contracts, [...parts.oldPlates, ...parts.newPlates]);
    rows.push({
      raw,
      fingerprint: sheetConflictFingerprint(PENDING_IDENTITY_DRIFT_CATEGORY, raw),
      category: PENDING_IDENTITY_DRIFT_CATEGORY,
      status: protectedReason ? 'contract_protected' : 'pending_identity_drift_review',
      provider: parts.provider,
      carNumbers: unique([...parts.oldPlates, ...parts.newPlates]),
      existingKeys: unique(existing.map(key)),
      incomingKeys: unique(incoming.map(key)),
      changedAtoms: changedAtoms(existing, incoming),
      contractProtection: protectedReason,
      mergedAlias: false,
      reason: protectedReason || `기존 임시번호 ${parts.oldPlates.length}개가 사라지고 신규 임시번호 ${parts.newPlates.length}개 생성`,
      nextAction: protectedReason
        ? '계약 상태와 기존 임시차 연결을 먼저 확인'
        : '동일 차량 수정이면 기존 임시번호 유지, 다른 차량이면 신규 발급으로 확정',
      applyAllowed: false,
    });
  }

  const changedAtomCounts: Record<string, number> = {};
  for (const row of rows) for (const atom of row.changedAtoms) changedAtomCounts[atom] = (changedAtomCounts[atom] || 0) + 1;
  const count = (category: SheetIdentityReviewCategory) => rows.filter((row) => row.category === category).length;
  return {
    generatedAt: input.now ?? Date.now(),
    rows,
    summary: {
      total: rows.length,
      unownedDeleted: count(UNOWNED_DELETED_CATEGORY),
      pendingIdentityDrift: count(PENDING_IDENTITY_DRIFT_CATEGORY),
      pendingSignature: count(PENDING_SIGNATURE_CATEGORY),
      protected: rows.filter((row) => row.status === 'contract_protected').length,
      unownedSingleCandidates: rows.filter((row) => row.status === 'unowned_deleted_single_candidate').length,
      ambiguous: rows.filter((row) => row.status === 'unowned_deleted_ambiguous').length,
      executableOperations: 0,
      changedAtomCounts,
    },
  };
}

const safeCell = (value: unknown): string => text(value).replace(/[\t\r\n]+/g, ' ');

export function sheetIdentityConflictReviewTsv(review: SheetIdentityConflictReview): string {
  return [
    ['구분', '상태', '공급사', '차량번호', '기존상품키', '현재Sheet키', '변경원자', '계약보호', '병합별칭', '판단근거', '다음조치', '적용허용'],
    ...review.rows.map((row) => [
      row.category, row.status, row.provider, row.carNumbers.join(', '), row.existingKeys.join(', '),
      row.incomingKeys.join(', '), row.changedAtoms.join(', '), row.contractProtection,
      row.mergedAlias ? 'YES' : 'NO', row.reason, row.nextAction, 'NO',
    ]),
  ].map((cells) => cells.map(safeCell).join('\t')).join('\n');
}
