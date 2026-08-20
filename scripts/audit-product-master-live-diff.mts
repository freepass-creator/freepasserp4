/**
 * 상품마스터 ↔ 운영 ERP의 최신 반영 예정 diff 감사기. 읽기 전용.
 *
 * - Google Sheet/RTDB write 없음
 * - v3 products는 읽지 않음(상품 정본은 v4/products)
 * - 전체 계획과 공급사별 격리 계획을 분리해 한 공급사의 충돌이 다른 공급사 진단을 가리지 않게 함
 * - 차량번호·고객/계약 원문을 출력하지 않고 집계만 기록
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';
import type { EntityRecord } from '../lib/intake/entities';
import {
  DEFAULT_PRODUCT_MASTER_SHEET_ID,
  PRODUCT_MASTER_COLUMN_MAPPING_TAB,
  PRODUCT_MASTER_MANUAL_TAB,
  PRODUCT_MASTER_TAB,
} from '../lib/domain/product-master-sheet';
import {
  applyProductMasterManualGate,
  importProductMasterSheet,
  isolateProductMasterBlockedProviders,
} from '../lib/domain/product-master-import';
import {
  planDailySheetSync,
  planProductMasterProviderBatches,
  type DailySheetSyncPlan,
} from '../lib/domain/sheet-daily-sync';
import type { SheetConflictResolution } from '../lib/domain/sheet-conflict-resolution';
import type { VehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import { mergeProductPrivate, splitProductPrivate } from '../lib/firebase/rtdb-products';
import { toV4Record } from '../lib/firebase/rtdb-records';
import {
  PRODUCT_PATCH_GUARD_FIELDS,
  productPatchPreconditionMatches,
} from '../lib/domain/product-write-guard';

type Rec = Record<string, unknown>;
type SheetSnapshot = {
  fetched_at?: string;
  spreadsheet_id?: string;
  product_master?: { values?: unknown[][] };
  manual?: { values?: unknown[][] };
  mapping?: { values?: unknown[][] };
};

const S = (value: unknown) => String(value ?? '').trim();
const arg = (name: string, fallback: string) =>
  (process.argv.find((value) => value.startsWith(`--${name}=`)) || '').slice(name.length + 3) || fallback;
const inputPath = resolve(arg('input', 'tmp/product-master-live-input.json'));
const outputPath = resolve(arg('out', 'tmp/product-master-live-diff.json'));
const refreshSheet = process.argv.includes('--refresh-sheet');
const companyId = S(process.env.SHEET_SYNC_COMPANY_ID) || 'freepass';
const databaseURL = S(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL)
  || 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

function table(value: unknown[][] | undefined): string[][] {
  return (value || []).map((row) => row.map((cell) => S(cell)));
}

async function refreshSheetSnapshot(
  path: string,
  serviceAccount: Parameters<typeof cert>[0] & { client_email?: string; private_key?: string },
): Promise<SheetSnapshot> {
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('Google Sheets 읽기 자격증명 형식 오류');
  }
  const spreadsheetId = arg('sheet', DEFAULT_PRODUCT_MASTER_SHEET_ID);
  const jwt = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    // Workspace 도메인 위임에 등록된 범위와 동일하게 토큰을 발급하되 이 감사기는
    // values:batchGet만 호출하고 write endpoint는 갖지 않는다.
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    subject: arg('subject', S(process.env.GOOGLE_WORKSPACE_SUBJECT) || 'pyh@teamjpk.com'),
  });
  const token = await jwt.getAccessToken();
  if (!token.token) throw new Error('Google Sheets 읽기 토큰 발급 실패');
  const ranges = [
    `${PRODUCT_MASTER_TAB}!A1:AZ1000`,
    `${PRODUCT_MASTER_MANUAL_TAB}!A1:L1000`,
    `${PRODUCT_MASTER_COLUMN_MAPPING_TAB}!A1:Q1000`,
  ];
  const endpoint = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet`);
  for (const range of ranges) endpoint.searchParams.append('ranges', range);
  endpoint.searchParams.set('valueRenderOption', 'FORMATTED_VALUE');
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token.token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({})) as {
    valueRanges?: Array<{ values?: unknown[][] }>;
    error?: { message?: string };
  };
  if (!response.ok || body.valueRanges?.length !== ranges.length) {
    throw new Error(body.error?.message || `Google Sheets 읽기 실패 ${response.status}`);
  }
  const snapshot: SheetSnapshot = {
    fetched_at: new Date().toISOString(),
    spreadsheet_id: spreadsheetId,
    product_master: { values: body.valueRanges[0]?.values || [] },
    manual: { values: body.valueRanges[1]?.values || [] },
    mapping: { values: body.valueRanges[2]?.values || [] },
  };
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return snapshot;
}

function normalizedRows(
  entity: 'partner' | 'product' | 'contract',
  raw: unknown,
): EntityRecord[] {
  return Object.entries((raw || {}) as Record<string, Record<string, unknown>>)
    .filter(([, row]) => row && typeof row === 'object')
    .map(([key, row]) => toV4Record(entity, key, row, companyId));
}

function mergeRows(v3: EntityRecord[], v4: EntityRecord[]): EntityRecord[] {
  const rows = new Map<string, EntityRecord>();
  for (const row of v3) rows.set(S(row._key), row);
  for (const row of v4) {
    const key = S(row._key);
    rows.set(key, { ...(rows.get(key) || {}), ...row });
  }
  return [...rows.values()];
}

function active(row: EntityRecord): boolean {
  return row._deleted !== true && !row.deletedAt && S(row.status) !== 'deleted';
}

function compactPlan(plan: DailySheetSyncPlan) {
  const patchFields: Record<string, number> = {};
  for (const item of plan.patches) {
    for (const field of Object.keys(item.patch)) patchFields[field] = (patchFields[field] || 0) + 1;
  }
  return {
    ok: plan.ok,
    block_reason: plan.blockReason || '',
    counts: plan.counts,
    notes: plan.notes,
    intended_diff: plan.ok ? {
      creates: plan.creates.length,
      patches: plan.patches.length,
      checkpoints: plan.checkpoints.length,
      patch_fields: Object.fromEntries(Object.entries(patchFields).sort((a, b) => b[1] - a[1])),
    } : null,
  };
}

function applyInMemory(
  plan: DailySheetSyncPlan,
  current: { active: EntityRecord[]; deleted: EntityRecord[] },
): { active: EntityRecord[]; deleted: EntityRecord[] } {
  // 운영 transaction은 논리 product_code가 아니라 실제 v4 child key 맵에 적용된다.
  // toV4Record가 보존한 _rtdb_key를 써야 legacy child와 새 canonical child가 함께 있는
  // 상태까지 실제 재읽기와 같아진다.
  const all = new Map<string, EntityRecord>();
  for (const row of [...current.active, ...current.deleted]) {
    all.set(S(row._rtdb_key || row._key || row.product_code), { ...row });
  }
  for (const row of plan.creates) {
    const key = S(row.product_code || row._key);
    all.set(key, { ...row, _key: key, product_code: key });
  }
  for (const item of plan.patches) {
    const before = all.get(item.key) || { _key: item.key, product_code: item.key };
    const logicalProductCode = S(item.patch.product_code || item.expected.product_code
      || item.expected._key || item.key);
    all.set(item.key, {
      ...before,
      ...item.patch,
      _key: logicalProductCode,
      product_code: logicalProductCode,
    });
  }
  const rows = [...all.entries()].map(([childKey, row]) => toV4Record('product', childKey, row, companyId));
  return { active: rows.filter(active), deleted: rows.filter((row) => !active(row)) };
}

function validateSupportTable(rows: string[][], width: number, name: string) {
  const headerRow = rows.findIndex((row) => row.length >= 3 && S(row[0]) === '판정');
  if (headerRow < 0) throw new Error(`${name} 헤더 없음`);
  const headers = rows[headerRow] || [];
  if (headers.length !== width) throw new Error(`${name} 헤더 폭 오류(${headers.length}/${width})`);
  if (new Set(headers).size !== headers.length) throw new Error(`${name} 헤더 중복`);
  const data = rows.slice(headerRow + 1).filter((row) => row.some(S));
  const required = data.filter((row) => !S(row[0]) || !S(row[1]) || !S(row[2]));
  // 매뉴얼은 손오공처럼 같은 코드 아래 렌트/구독 행을 따로 둘 수 있다. 코드만으로
  // 중복 판정하면 정상 분리를 오탐하므로 공급사 표시명까지 결합한다.
  const duplicateKeys = data.map((row) => name === '공급사 열 매핑'
    ? `${S(row[2])}|${S(row[4])}`
    : `${S(row[2])}|${S(row[1])}`);
  return {
    rows: data.length,
    required_blank: required.length,
    duplicate_keys: duplicateKeys.length - new Set(duplicateKeys).size,
  };
}

const saPath = S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(saPath, 'utf8')) as Parameters<typeof cert>[0] & {
  client_email?: string;
  private_key?: string;
};
const sheet = refreshSheet
  ? await refreshSheetSnapshot(inputPath, sa)
  : JSON.parse(readFileSync(inputPath, 'utf8')) as SheetSnapshot;
const productTable = table(sheet.product_master?.values);
const manualTable = table(sheet.manual?.values);
const mappingTable = table(sheet.mapping?.values);
if (!productTable.length || !manualTable.length || !mappingTable.length) throw new Error('시트 스냅샷 탭 누락');

const app = initializeApp({ credential: cert(sa), databaseURL }, `product-master-audit-${Date.now()}`);
try {
  const db = getDatabase(app);
  const [v3Partners, v4Partners, v4Products, v4Private, v3Contracts, v4Contracts, resolutionsSnap] = await Promise.all([
    db.ref('partners').get(),
    db.ref('v4/partners').get(),
    db.ref('v4/products').get(),
    db.ref('v4/products_private').get(),
    db.ref('contracts').get(),
    db.ref('v4/contracts').get(),
    db.ref('v4/sheet_conflict_resolutions').get(),
  ]);
  const partners = mergeRows(
    normalizedRows('partner', v3Partners.val()),
    normalizedRows('partner', v4Partners.val()),
  );
  const privateByCode = new Map<string, EntityRecord>();
  for (const [key, row] of Object.entries((v4Private.val() || {}) as Record<string, EntityRecord>)) {
    if (!row || typeof row !== 'object') continue;
    privateByCode.set(S(row.product_code || key), { ...row, _key: key, product_code: row.product_code || key });
  }
  const allProducts = normalizedRows('product', v4Products.val())
    .map((row) => mergeProductPrivate(row, privateByCode.get(S(row.product_code || row._key))));
  const state = {
    active: allProducts.filter(active),
    deleted: allProducts.filter((row) => !active(row)),
  };
  const contracts = mergeRows(
    normalizedRows('contract', v3Contracts.val()),
    normalizedRows('contract', v4Contracts.val()),
  );
  const resolutions = Object.values((resolutionsSnap.val() || {}) as Record<string, SheetConflictResolution>)
    .filter((item) => item && typeof item === 'object');
  const trim = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as VehicleTrimMasterArtifact;
  const knownProviderCodes = state.active
    .map((row) => S(row.provider_company_code || row.partner_code))
    .filter(Boolean);

  const imported = applyProductMasterManualGate(importProductMasterSheet({
    table: productTable,
    partners,
    trimRecords: trim.records,
    tabTitle: '상품마스터',
    tabGid: '679088240',
    knownProviderCodes,
  }), manualTable);
  const isolation = isolateProductMasterBlockedProviders(imported);
  const allPlan = planDailySheetSync({
    fetched: isolation.fetched,
    existing: state.active,
    deleted: state.deleted,
    partners,
    contracts,
    resolutions,
  });

  const providerBatches = planProductMasterProviderBatches({
    fetched: isolation.fetched,
    existing: state.active,
    deleted: state.deleted,
    partners,
    contracts,
    resolutions,
  });
  const providerResults = providerBatches.map((batch) => {
    const line = batch.fetched.lines[0]!;
    const first = batch.plan;
    let second: DailySheetSyncPlan | null = null;
    let idempotencyDiagnostics: Rec | null = null;
    if (first.ok) {
      const projected = applyInMemory(first, state);
      const incomingKeys = new Set(line.products.map((row) => S(row.product_code || row._key)));
      const incomingProviderPlates = new Set(line.products.map((row) =>
        `${S(row.provider_company_code || row.partner_code)}|${S(row.car_number).replace(/\s/g, '')}`));
      const exactActive = projected.active.filter((row) => incomingKeys.has(S(row._key || row.product_code))).length;
      const providerPlateActive = projected.active.filter((row) => incomingProviderPlates.has(
        `${S(row.provider_company_code || row.partner_code)}|${S(row.car_number || row.car_number_snapshot).replace(/\s/g, '')}`,
      )).length;
      idempotencyDiagnostics = {
        projected_active: projected.active.length,
        projected_deleted: projected.deleted.length,
        exact_active_matches: exactActive,
        provider_plate_active_matches: providerPlateActive,
        first_revives: first.patches.filter((item) => item.patch.revived_at != null).length,
      };
      second = planDailySheetSync({
        fetched: batch.fetched,
        existing: projected.active,
        deleted: projected.deleted,
        partners,
        contracts,
        resolutions,
        now: 1,
      });
    }
    return {
      code: line.code,
      label: line.label,
      rows: line.imported,
      review_rows: line.products.filter((row) => row._needs_master_review === true).length,
      no_price_rows: line.noPriceCount,
      plan: compactPlan(first),
      idempotent: second ? second.ok && second.creates.length === 0 && second.patches.length === 0 : null,
      second_plan: second ? compactPlan(second) : null,
      idempotency_diagnostics: idempotencyDiagnostics,
      second_block_reason: second && !second.ok ? second.blockReason : '',
    };
  });
  const safeBatches = providerBatches.filter((batch) => batch.plan.ok);
  const safePatches = safeBatches.flatMap((batch) => batch.plan.patches);
  const safeCreates = safeBatches.flatMap((batch) => batch.plan.creates);
  const rawV4Products = (v4Products.val() || {}) as Record<string, EntityRecord>;
  const casMismatches = safeBatches.flatMap((batch) => batch.plan.patches.flatMap((item) => {
    const { publicRecord: expectedPublic } = splitProductPrivate(item.expected);
    const { publicRecord: patchPublic } = splitProductPrivate(item.patch);
    const current = rawV4Products[item.key] && typeof rawV4Products[item.key] === 'object'
      ? rawV4Products[item.key]
      : null;
    const ignoredFields = ['_key', '_rtdb_key'];
    if (productPatchPreconditionMatches(current, expectedPublic, patchPublic, {
      overlayFallback: true,
      ignoredFields,
    })) return [];
    const fields = new Set([...Object.keys(patchPublic), ...PRODUCT_PATCH_GUARD_FIELDS]);
    for (const field of ignoredFields) fields.delete(field);
    const mismatchFields = [...fields].filter((field) => {
      const hasCurrent = !!current && Object.prototype.hasOwnProperty.call(current, field);
      const actual = !hasCurrent ? expectedPublic[field] : current?.[field];
      try { return JSON.stringify(actual) !== JSON.stringify(expectedPublic[field]); } catch { return true; }
    });
    return [{
      provider: batch.code,
      current_exists: !!current,
      revive: item.patch.revived_at != null,
      key_uses_rtdb_child: S(item.expected._rtdb_key) !== '' && item.key === S(item.expected._rtdb_key),
      mismatch_fields: mismatchFields.sort(),
    }];
  }));
  const lockedPatches = safePatches.filter((item) =>
    S(item.expected.locked_by_contract) !== '' || S(item.expected.vehicle_status) === '계약중');
  const targetKeys = [
    ...safePatches.map((item) => item.key),
    ...safeCreates.map((row) => S(row.product_code || row._key)),
  ].filter(Boolean);
  const hasPrice = (row: EntityRecord) => row.price && typeof row.price === 'object'
    && Object.values(row.price as Record<string, unknown>).some((terms) =>
      terms && typeof terms === 'object' && Number((terms as Record<string, unknown>).rent) > 0);
  const sourceSnapshotHash = createHash('sha256').update(JSON.stringify({
    product_master: productTable,
    manual: manualTable,
    mapping: mappingTable,
  })).digest('hex');

  const result = {
    mode: 'read-only-dry-run',
    generated_at: new Date().toISOString(),
    sheet_snapshot_at: sheet.fetched_at || '',
    source: {
      product_rows: productTable.length - 1,
      imported_rows: imported.products.length,
      unique_product_keys: new Set(imported.products.map((row) => S(row.product_code || row._key))).size,
      providers: imported.lines.length,
      verification: imported.products.reduce((acc, row) => {
        const key = S(row._product_master_verification) || '(공란)';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      management: imported.products.reduce((acc, row) => {
        const key = S(row._product_master_management) || '(공란)';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      manual: validateSupportTable(manualTable, 12, '공급사 데이터 매뉴얼'),
      mapping: validateSupportTable(mappingTable, 17, '공급사 열 매핑'),
    },
    erp: {
      active_products: state.active.length,
      deleted_products: state.deleted.length,
      partners: partners.filter(active).length,
      contracts: contracts.length,
      conflict_resolutions: resolutions.length,
    },
    isolation: {
      runnable_rows: isolation.fetched.products.length,
      runnable_providers: isolation.fetched.lines.length,
      blocked: isolation.blocked.map((item) => ({ code: item.code, label: item.label, reason: item.reason, rows: item.products })),
    },
    global_plan: compactPlan(allPlan),
    provider_plans: providerResults,
    summary: {
      provider_total: providerResults.length + isolation.blocked.length,
      provider_pass: providerResults.filter((row) => row.plan.ok).length,
      provider_blocked: providerResults.filter((row) => !row.plan.ok).length,
      provider_manual_blocked: isolation.blocked.length,
      source_rows_total: imported.products.length,
      source_rows_safe: providerResults.filter((row) => row.plan.ok)
        .reduce((sum, row) => sum + row.plan.counts.imported, 0),
      source_rows_conflict_blocked: providerResults.filter((row) => !row.plan.ok)
        .reduce((sum, row) => sum + row.plan.counts.imported, 0),
      source_rows_manual_blocked: isolation.blocked.reduce((sum, item) => sum
        + (imported.lines.find((line) => line.code === item.code)?.imported || 0), 0),
      intended_creates_safe: providerResults.filter((row) => row.plan.ok)
        .reduce((sum, row) => sum + row.plan.counts.created, 0),
      intended_updates_safe: providerResults.filter((row) => row.plan.ok)
        .reduce((sum, row) => sum + row.plan.counts.updated, 0),
      provider_idempotent_pass: providerResults.filter((row) => row.idempotent === true).length,
      provider_idempotent_fail: providerResults.filter((row) => row.idempotent === false).length,
    },
    apply_safety: {
      source_snapshot_sha256: sourceSnapshotHash,
      target_rows: targetKeys.length,
      unique_target_keys: new Set(targetKeys).size,
      duplicate_target_keys: targetKeys.length - new Set(targetKeys).size,
      locked_targets: lockedPatches.length,
      locked_status_writes: lockedPatches.filter((item) =>
        Object.prototype.hasOwnProperty.call(item.patch, 'vehicle_status')).length,
      create_without_price: safeCreates.filter((row) => !hasPrice(row)).length,
      review_creates: safeCreates.filter((row) => row._needs_master_review === true).length,
      private_top_level_writes: [...safeCreates, ...safePatches.map((item) => item.patch)]
        .filter((row) => ['vehicle_price', 'vin', 'account_number'].some((field) =>
          Object.prototype.hasOwnProperty.call(row, field))).length,
      cas_mismatch_count: casMismatches.length,
      cas_mismatches: casMismatches,
    },
    writes: { sheet: 0, rtdb: 0 },
  };
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await deleteApp(app);
}
