import type { EntityRecord } from '@/lib/intake/entities';
import {
  planProductDuplicateMigration,
  type DuplicateMigrationGroup,
} from '@/lib/domain/product-duplicate-migration';

export type DuplicateDryRunOperation = {
  phase: number;
  kind: 'candidate-fill' | 'private-fill' | 'reference-patch' | 'alias-tombstone' | 'private-delete';
  path: string;
  fields: string[];
  fromProductKey: string;
  toProductKey: string;
  note: string;
  destructive: boolean;
  claudeGate: boolean;
};

export type DuplicateDryRunGroup = {
  carNumber: string;
  provider: string;
  representativeKey: string;
  duplicateKeys: string[];
  eligible: boolean;
  blockers: string[];
  publicFillFields: string[];
  publicConflictFields: string[];
  publicUnclassifiedFields: string[];
  privateFillFields: string[];
  privateConflictFields: string[];
  privateUnclassifiedFields: string[];
  accountNumberDisposition: string;
  operations: DuplicateDryRunOperation[];
};

const text = (value: unknown): string => String(value ?? '').trim();
const keyOf = (row: EntityRecord): string => text(row._key || row.product_code);
const safeCell = (value: unknown): string => text(value).replace(/[\t\r\n]+/g, ' ');
const META_FIELDS = new Set([
  '_key', 'product_code', '_rtdb_key', 'companyId',
  'createdAt', 'created_at', 'createdBy', 'created_by',
  'updatedAt', 'updated_at', 'updatedBy', 'updated_by',
  '_deleted', 'deletedAt', 'deletedReason', '_merged_into',
  'provider_name', '_policy',
  'product_uid', 'source', 'source_schema', 'status', 'status_label',
  'match_flags', 'sheet_meta', '_snapped', '_snap_confidence', '_needs_master_review',
  'gen_code', 'source_sheet_id', 'sub_model_legacy', 'trim_name_legacy',
  'match_confidence', 'raw_model_full', 'raw_model_short', 'migratedAt',
  '_sheet_snapshot_at', '_sheet_snapshot_hash', '_sheet_manual_fields',
  'sheet_sync_run_id', 'last_sheet_seen_at', 'sheet_status_owner', 'sheet_block_reason',
  'source_row', 'source_row_number', 'status_label_raw',
]);
const NEVER_FILL_FIELDS = new Set([
  'car_number', 'car_number_snapshot',
  'provider_company_code', 'partner_code',
  'vehicle_status', 'status', 'locked_by_contract',
]);
const PUBLIC_MERGE_FIELDS = new Set([
  'car_number', 'car_number_snapshot',
  'maker', 'model', 'sub_model', 'variant', 'trim_name', 'trim_extra', 'vehicle_class',
  'year', 'fuel_type', 'mileage', 'accident_history', 'drive_type', 'seats', 'engine_cc',
  'ext_color', 'int_color', 'usage', 'first_registration_date',
  'options', 'vehicle_status', 'locked_by_contract', 'product_type',
  'provider_company_code', 'partner_code', 'policy_code',
  'location', 'image_urls', 'images', 'photos', 'image_url', 'photo', 'interior_photo',
  'photo_link', 'doc_images', 'catalog_id', 'fp_options',
  'review_status', 'deposit_free', 'event_tags',
  'annual_mileage', 'deposit_condition', 'arrival_note', 'is_pending_plate', 'physical_status',
  'transmission', 'vehicle_age_expiry_date', 'cert_car_name', 'type_number', 'engine_type',
  'partner_memo', 'price',
]);
const PRIVATE_MERGE_FIELDS = new Set(['vin', 'vehicle_price', 'price']);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => JSON.parse(canonical(item))));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, JSON.parse(canonical(item))]);
    return JSON.stringify(Object.fromEntries(entries));
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? '"__undefined__"' : serialized;
}

function blank(value: unknown): boolean {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

function mergeAssessment(
  candidate: EntityRecord,
  duplicates: EntityRecord[],
  allowedFields: Set<string>,
  extraIgnoredFields: Set<string> = new Set(),
): { fills: string[]; conflicts: string[]; unclassified: string[] } {
  const fields = new Set([...Object.keys(candidate), ...duplicates.flatMap(Object.keys)]);
  const fills: string[] = [];
  const conflicts: string[] = [];
  const unclassified: string[] = [];
  for (const field of fields) {
    if (META_FIELDS.has(field) || extraIgnoredFields.has(field)) continue;
    const candidateValue = candidate[field];
    const otherValues = duplicates.map((row) => row[field]).filter((value) => !blank(value));
    const uniqueOther = [...new Set(otherValues.map(canonical))];
    if (!allowedFields.has(field)) {
      if (!uniqueOther.length) continue;
      const current = blank(candidateValue) ? '' : canonical(candidateValue);
      if (!current || uniqueOther.some((value) => value !== current)) unclassified.push(field);
      continue;
    }
    if (blank(candidateValue)) {
      if (!uniqueOther.length) continue;
      if (NEVER_FILL_FIELDS.has(field) || uniqueOther.length > 1) conflicts.push(field);
      else fills.push(field);
      continue;
    }
    const current = canonical(candidateValue);
    if (uniqueOther.some((value) => value !== current)) conflicts.push(field);
  }
  return {
    fills: [...new Set(fills)].sort(),
    conflicts: [...new Set(conflicts)].sort(),
    unclassified: [...new Set(unclassified)].sort(),
  };
}

function matchingFields(row: EntityRecord, productKey: string): string[] {
  return ['product_code', 'product_uid', 'product_id']
    .filter((field) => text(row[field]) === productKey);
}

function relationKey(entity: 'contract' | 'room' | 'quote', row: EntityRecord): string {
  if (entity === 'contract') return text(row._key || row.contract_code);
  if (entity === 'room') return text(row._key || row.room_id);
  return text(row._key || row.quote_code);
}

function relationOperations(
  entity: 'contract' | 'room' | 'quote',
  rows: EntityRecord[],
  duplicateKey: string,
  representativeKey: string,
): DuplicateDryRunOperation[] {
  const node = entity === 'contract' ? 'contracts' : entity === 'room' ? 'rooms' : 'quotes';
  return rows.flatMap((row) => {
    const fields = matchingFields(row, duplicateKey);
    const key = relationKey(entity, row);
    if (!fields.length || !key) return [];
    return [{
      phase: 2,
      kind: 'reference-patch' as const,
      path: `v4/${node}/${key}`,
      fields,
      fromProductKey: duplicateKey,
      toProductKey: representativeKey,
      note: entity === 'room'
        ? '방 ID와 messages 경로는 유지하고 상품 참조 필드만 변경'
        : entity === 'contract'
          ? '계약 snapshot은 유지하고 상품키 참조만 변경'
          : '견적 snapshot은 유지하고 상품키 참조만 변경',
      destructive: false,
      claudeGate: entity === 'contract',
    }];
  });
}

function groupDryRun(input: {
  group: DuplicateMigrationGroup;
  productsByKey: Map<string, EntityRecord>;
  contracts: EntityRecord[];
  rooms: EntityRecord[];
  quotes: EntityRecord[];
  privateByKey: Map<string, EntityRecord>;
  partners: EntityRecord[];
}): DuplicateDryRunGroup {
  const representativeKey = input.group.representativeCandidate;
  const candidate = input.productsByKey.get(representativeKey);
  const duplicateKeys = input.group.records
    .map((row) => row.productKey)
    .filter((key) => key && key !== representativeKey);
  const duplicates = duplicateKeys.map((key) => input.productsByKey.get(key)).filter(Boolean) as EntityRecord[];
  const productAccountNumbers = [candidate, ...duplicates]
    .filter(Boolean)
    .map((row) => text((row as EntityRecord).account_number))
    .filter(Boolean);
  const partner = input.partners.find((row) =>
    text(row.partner_code || row._key) === input.group.provider);
  const partnerAccountNumber = text(partner?.bank_account || partner?.account_number);
  const accountNumberDisposition = !productAccountNumbers.length
    ? '없음'
    : partnerAccountNumber && productAccountNumbers.every((value) => value === partnerAccountNumber)
      ? '파트너 계좌 중복값 · 상품에서 폐기'
      : '파트너 계좌 불일치 · 수동확인';
  const publicAssessment = candidate
    ? mergeAssessment(candidate, duplicates, PUBLIC_MERGE_FIELDS, new Set(['account_number']))
    : { fills: [], conflicts: [], unclassified: [] };
  const privateCandidate = input.privateByKey.get(representativeKey) || {};
  const privateDuplicates = duplicateKeys
    .map((key) => input.privateByKey.get(key))
    .filter(Boolean) as EntityRecord[];
  const privateAssessment = mergeAssessment(
    privateCandidate,
    privateDuplicates,
    PRIVATE_MERGE_FIELDS,
    new Set(['provider_company_code']),
  );
  const blockers = [...input.group.blockers];
  if (!candidate) blockers.push('대표 상품 레코드 없음');
  if (publicAssessment.conflicts.length) {
    blockers.push(`공개 상품값 충돌: ${publicAssessment.conflicts.join(', ')}`);
  }
  if (privateAssessment.conflicts.length) {
    blockers.push(`비공개 원가값 충돌: ${privateAssessment.conflicts.join(', ')}`);
  }
  if (publicAssessment.unclassified.length) {
    blockers.push(`미분류 공개필드 수동확인: ${publicAssessment.unclassified.join(', ')}`);
  }
  if (privateAssessment.unclassified.length) {
    blockers.push(`미분류 비공개필드 수동확인: ${privateAssessment.unclassified.join(', ')}`);
  }
  if (accountNumberDisposition.includes('불일치')) {
    blockers.push('상품 account_number와 파트너 bank_account 불일치');
  }
  const operations: DuplicateDryRunOperation[] = [];
  if (candidate && representativeKey) {
    if (publicAssessment.fills.length) {
      operations.push({
        phase: 1,
        kind: 'candidate-fill',
        path: `v4/products/${representativeKey}`,
        fields: publicAssessment.fills,
        fromProductKey: duplicateKeys.join(','),
        toProductKey: representativeKey,
        note: '대표키의 빈 필드만 채움',
        destructive: false,
        claudeGate: false,
      });
    }
    if (privateAssessment.fills.length) {
      operations.push({
        phase: 1,
        kind: 'private-fill',
        path: `v4/products_private/${representativeKey}`,
        fields: privateAssessment.fills,
        fromProductKey: duplicateKeys.join(','),
        toProductKey: representativeKey,
        note: '비공개 원가의 빈 필드만 서버에서 복사하며 값은 보고서에 노출하지 않음',
        destructive: false,
        claudeGate: true,
      });
    }
    for (const duplicateKey of duplicateKeys) {
      operations.push(
        ...relationOperations('contract', input.contracts, duplicateKey, representativeKey),
        ...relationOperations('room', input.rooms, duplicateKey, representativeKey),
        ...relationOperations('quote', input.quotes, duplicateKey, representativeKey),
        {
          phase: 3,
          kind: 'alias-tombstone',
          path: `v4/products/${duplicateKey}`,
          fields: ['_merged_into', '_deleted', 'deletedAt', 'deletedReason'],
          fromProductKey: duplicateKey,
          toProductKey: representativeKey,
          note: '구 URL·찜 코드는 _merged_into로 대표 상품을 복원하고 목록에서는 제거',
          destructive: true,
          claudeGate: true,
        },
      );
      if (input.privateByKey.has(duplicateKey)) {
        operations.push({
          phase: 4,
          kind: 'private-delete',
          path: `v4/products_private/${duplicateKey}`,
          fields: ['전체 노드'],
          fromProductKey: duplicateKey,
          toProductKey: representativeKey,
          note: '대표 비공개 원가 사후검증이 끝난 뒤에만 삭제',
          destructive: true,
          claudeGate: true,
        });
      }
    }
  }
  const eligible = blockers.length === 0;
  return {
    carNumber: input.group.carNumber,
    provider: input.group.provider,
    representativeKey,
    duplicateKeys,
    eligible,
    blockers: [...new Set(blockers)],
    publicFillFields: publicAssessment.fills,
    publicConflictFields: publicAssessment.conflicts,
    publicUnclassifiedFields: publicAssessment.unclassified,
    privateFillFields: privateAssessment.fills,
    privateConflictFields: privateAssessment.conflicts,
    privateUnclassifiedFields: privateAssessment.unclassified,
    accountNumberDisposition,
    operations: eligible ? operations : [],
  };
}

export function planProductDuplicateDryRun(input: {
  products: EntityRecord[];
  contracts: EntityRecord[];
  rooms: EntityRecord[];
  quotes: EntityRecord[];
  productPrivate: EntityRecord[];
  partners: EntityRecord[];
  providerCodes?: Iterable<string>;
}): DuplicateDryRunGroup[] {
  const migrationGroups = planProductDuplicateMigration({
    ...input,
    scan: { contracts: true, rooms: true, quotes: true, productPrivate: true },
  });
  const productsByKey = new Map(input.products.map((row) => [keyOf(row), row]));
  const privateByKey = new Map(input.productPrivate.map((row) => [keyOf(row), row]));
  return migrationGroups.map((group) => groupDryRun({
    group,
    productsByKey,
    contracts: input.contracts,
    rooms: input.rooms,
    quotes: input.quotes,
    privateByKey,
    partners: input.partners,
  }));
}

export function productDuplicateDryRunTsv(groups: DuplicateDryRunGroup[]): string {
  return [
    [
      '차량번호', '공급사', '대표키', '중복키', 'dry-run판정', '차단사유',
      '공개채움필드', '공개충돌필드', '공개미분류필드',
      '비공개채움필드', '비공개충돌필드', '비공개미분류필드', '상품계좌처리',
      '단계', '작업', '경로', '변경필드', '기존키', '대표키참조', '파괴적', 'Claude게이트', '설명',
    ],
    ...groups.flatMap((group) => {
      const base = [
        group.carNumber,
        group.provider,
        group.representativeKey,
        group.duplicateKeys.join(', '),
        group.eligible ? '적용후보' : '차단',
        group.blockers.join(' · '),
        group.publicFillFields.join(', '),
        group.publicConflictFields.join(', '),
        group.publicUnclassifiedFields.join(', '),
        group.privateFillFields.join(', '),
        group.privateConflictFields.join(', '),
        group.privateUnclassifiedFields.join(', '),
        group.accountNumberDisposition,
      ];
      if (!group.operations.length) return [[...base, '', '', '', '', '', '', '', '', '']];
      return group.operations.map((operation) => [
        ...base,
        operation.phase,
        operation.kind,
        operation.path,
        operation.fields.join(', '),
        operation.fromProductKey,
        operation.toProductKey,
        operation.destructive ? '예' : '아니오',
        operation.claudeGate ? '필수' : '일반',
        operation.note,
      ]);
    }),
  ].map((cells) => cells.map(safeCell).join('\t')).join('\n');
}
