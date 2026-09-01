import 'server-only';

import type { Database } from 'firebase-admin/database';
import {
  planDailySheetSync,
  planProductMasterProviderBatches,
  type DailySheetSyncPlan,
  type ProductMasterProviderPlan,
} from '@/lib/domain/sheet-daily-sync';
import { productPatchPreconditionMatches } from '@/lib/domain/product-write-guard';
import { mergeProductPrivate, splitProductPrivate } from '@/lib/firebase/rtdb-products';
import { toV4Record } from '@/lib/firebase/rtdb-records';
import type { EntityRecord } from '@/lib/intake/entities';
import { firebaseAdminDatabase } from '@/lib/server/firebase-admin';
import type { SheetConflictResolution } from '@/lib/domain/sheet-conflict-resolution';
import { fetchSalesInventorySheet } from '@/lib/server/sales-inventory-sheet';
import { isolateProductMasterBlockedProviders } from '@/lib/domain/product-master-import';
import { newId } from '@/lib/domain/ids';

const LOCK_PATH = 'v4/system_locks/sheet_daily_sync';
const STATUS_PATH = 'v4/system_status/sheet_daily_sync';
const LEASE_MS = 20 * 60 * 1000;

type DailyRunStatus = 'blocked' | 'completed' | 'failed' | 'dry_run';

export type DailySheetSyncResult = {
  ok: boolean;
  status: DailyRunStatus;
  runId: string;
  backupId?: string;
  blockReason?: string;
  counts?: DailySheetSyncPlan['counts'];
  notes?: string[];
  providers?: DailySheetSyncProviderResult[];
};

export type ProductSyncBackupEntry = {
  key: string;
  existed: boolean;
  before?: EntityRecord;
  providerCode: string;
};

type ProductSyncBackup = {
  schema_version: 1;
  run_id: string;
  company_id: string;
  status: 'prepared' | 'completed' | 'partial' | 'rolled_back';
  created_at: number;
  entries: ProductSyncBackupEntry[];
  providers: Array<{ code: string; touched: number }>;
};

export type DailySheetSyncRollbackResult = {
  ok: boolean;
  status: 'dry_run' | 'rolled_back' | 'blocked' | 'failed';
  sourceRunId: string;
  rollbackRunId: string;
  restorable: number;
  untouched: number;
  conflicts: number;
  blockReason?: string;
};

export type DailySheetSyncProviderResult = {
  code: string;
  label: string;
  status: 'planned' | 'blocked' | 'completed' | 'failed';
  sourceRows: number;
  blockReason?: string;
  counts?: DailySheetSyncPlan['counts'];
};

const clean = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(clean) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, clean(item)])) as T;
  }
  return value;
};

function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, normalize(nested)]));
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function sameStoredProduct(left: unknown, right: unknown): boolean {
  return canonicalJson(left ?? null) === canonicalJson(right ?? null);
}

async function writeProductSyncBackup(
  db: Database,
  companyId: string,
  runId: string,
  plans: ProductMasterProviderPlan[],
): Promise<ProductSyncBackup> {
  const rawProducts = ((await db.ref('v4/products').get()).val() || {}) as Record<string, EntityRecord>;
  const ownerByKey = new Map<string, string>();
  for (const item of plans) {
    for (const key of [
      ...item.plan.patches.map((patch) => patch.key),
      ...item.plan.creates.map((record) => String(record.product_code || record._key || '')),
    ].filter(Boolean)) {
      const existingOwner = ownerByKey.get(key);
      if (existingOwner && existingOwner !== item.code) {
        throw new Error('백업 대상 상품키가 둘 이상의 공급사 계획에 포함됐습니다');
      }
      ownerByKey.set(key, item.code);
    }
  }
  const entries = [...ownerByKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, providerCode]) => {
    const existed = Object.prototype.hasOwnProperty.call(rawProducts, key);
    return clean<ProductSyncBackupEntry>({
      key,
      existed,
      before: existed ? rawProducts[key] : undefined,
      providerCode,
    });
  });
  const backup = clean<ProductSyncBackup>({
    schema_version: 1,
    run_id: runId,
    company_id: companyId,
    status: 'prepared',
    created_at: Date.now(),
    entries,
    providers: plans.map((item) => ({
      code: item.code,
      touched: entries.filter((entry) => entry.providerCode === item.code).length,
    })),
  });
  // 운영 반영보다 먼저 같은 RTDB 안에 영향 키의 정확한 공개 노드 원본을 남긴다.
  // 이 쓰기가 실패하면 제품 반영은 시작하지 않는다.
  await db.ref(`v4/sheet_sync_backups/${runId}`).set(backup);
  return backup;
}

function normalizedRows(
  entity: 'partner' | 'product' | 'contract',
  raw: unknown,
  companyId: string,
): EntityRecord[] {
  return Object.entries((raw || {}) as Record<string, Record<string, unknown>>)
    .filter(([, row]) => row && typeof row === 'object')
    .map(([key, row]) => toV4Record(entity, key, row, companyId));
}

function mergeRows(v3: EntityRecord[], v4: EntityRecord[]): EntityRecord[] {
  const rows = new Map<string, EntityRecord>();
  for (const row of v3) rows.set(String(row._key), row);
  for (const row of v4) {
    const key = String(row._key);
    const merged: EntityRecord = { ...(rows.get(key) || {}) };
    for (const [field, value] of Object.entries(row)) if (value !== undefined) merged[field] = value;
    rows.set(key, merged);
  }
  return [...rows.values()];
}

export async function readPartners(db: Database, companyId: string): Promise<EntityRecord[]> {
  const [v3, v4] = await Promise.all([db.ref('partners').get(), db.ref('v4/partners').get()]);
  return mergeRows(
    normalizedRows('partner', v3.val(), companyId),
    normalizedRows('partner', v4.val(), companyId),
  );
}

export async function readProducts(db: Database, companyId: string): Promise<{
  active: EntityRecord[];
  deleted: EntityRecord[];
}> {
  // ERP4 재고는 중앙 판매시트 3탭 정본에서 구축한다. ERP3 products는 채팅·계약·정산 이력과 달리
  // 연동 정본도 fallback도 아니다. 여기서 섞으면 초기화한 낡은 재고가 다시 살아난다.
  const [v4, privateSnap] = await Promise.all([
    db.ref('v4/products').get(),
    db.ref('v4/products_private').get(),
  ]);
  const privateByCode = new Map<string, EntityRecord>();
  for (const [key, row] of Object.entries((privateSnap.val() || {}) as Record<string, EntityRecord>)) {
    if (!row || typeof row !== 'object') continue;
    privateByCode.set(String(row.product_code || key), { ...row, _key: key, product_code: row.product_code || key });
  }
  const all = normalizedRows('product', v4.val(), companyId)
    .map((row) => mergeProductPrivate(row, privateByCode.get(String(row.product_code || row._key))));
  return {
    active: all.filter((row) => row._deleted !== true && !row.deletedAt && String(row.status || '') !== 'deleted'),
    deleted: all.filter((row) => row._deleted === true || !!row.deletedAt || String(row.status || '') === 'deleted'),
  };
}

export async function readContracts(db: Database, companyId: string): Promise<EntityRecord[]> {
  const [v3, v4] = await Promise.all([db.ref('contracts').get(), db.ref('v4/contracts').get()]);
  return mergeRows(
    normalizedRows('contract', v3.val(), companyId),
    normalizedRows('contract', v4.val(), companyId),
  );
}

export async function readResolutions(db: Database): Promise<SheetConflictResolution[]> {
  const snapshot = await db.ref('v4/sheet_conflict_resolutions').get();
  return Object.values((snapshot.val() || {}) as Record<string, SheetConflictResolution>)
    .filter((item) => item && typeof item === 'object');
}

/*
 * `masterEntries()` 를 지웠다(2026-08-23 · 사장님 「차종마스터 관련 싹 다 걷어내고 정제칸을 정확히 반영한다」).
 * 이미 **부르는 곳이 없는 죽은 export** 였다 — 일일 동기는 판매시트만 읽는다.
 * 남겨 두면 «여기서 마스터를 쓰는구나» 로 오해해서 되살리는 사람이 나온다.
 */

async function acquireLease(db: Database, runId: string, now: number): Promise<void> {
  const result = await db.ref(LOCK_PATH).transaction((current) => {
    const lock = current && typeof current === 'object' ? current as Record<string, unknown> : {};
    if (String(lock.status || '') === 'running' && Number(lock.expires_at || 0) > now) return;
    return { run_id: runId, status: 'running', started_at: now, expires_at: now + LEASE_MS };
  }, undefined, false);
  if (!result.committed) throw new Error('다른 일일 시트 동기화가 실행 중입니다');
}

function backupEntries(raw: unknown): ProductSyncBackupEntry[] {
  const entries = Array.isArray(raw)
    ? raw
    : Object.values((raw || {}) as Record<string, ProductSyncBackupEntry>);
  return entries.filter((entry): entry is ProductSyncBackupEntry => (
    !!entry && typeof entry === 'object' && !!String(entry.key || '').trim()
  ));
}

export function classifyRollbackEntries(
  sourceRunId: string,
  entries: ProductSyncBackupEntry[],
  products: Record<string, EntityRecord>,
): { restorable: ProductSyncBackupEntry[]; untouched: ProductSyncBackupEntry[]; conflicts: ProductSyncBackupEntry[] } {
  const restorable: ProductSyncBackupEntry[] = [];
  const untouched: ProductSyncBackupEntry[] = [];
  const conflicts: ProductSyncBackupEntry[] = [];
  for (const entry of entries) {
    const current = products[entry.key];
    if (String(current?.sheet_sync_run_id || '') === sourceRunId) {
      restorable.push(entry);
      continue;
    }
    const before = entry.existed ? entry.before : undefined;
    if (sameStoredProduct(current, before)) untouched.push(entry);
    else conflicts.push(entry);
  }
  return { restorable, untouched, conflicts };
}

/**
 * 한 번의 ERP 판매시트 반영이 찍은 공개 상품 노드만 원상복구한다.
 * 기본 dry-run이며, 이후 다른 실행/수기 변경이 닿은 키가 하나라도 있으면 전체 롤백을 중단한다.
 */
export async function rollbackDailySheetSyncBackup(opts: {
  sourceRunId: string;
  dryRun?: boolean;
}): Promise<DailySheetSyncRollbackResult> {
  const sourceRunId = String(opts.sourceRunId || '').trim();
  const rollbackRunId = newId('run');
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(sourceRunId)) {
    return {
      ok: false, status: 'blocked', sourceRunId, rollbackRunId,
      restorable: 0, untouched: 0, conflicts: 0,
      blockReason: '잘못된 원본 실행 ID',
    };
  }
  const db = firebaseAdminDatabase();
  const backupPath = `v4/sheet_sync_backups/${sourceRunId}`;
  const [backupSnap, productsSnap] = await Promise.all([
    db.ref(backupPath).get(),
    db.ref('v4/products').get(),
  ]);
  const backup = backupSnap.val() as ProductSyncBackup | null;
  if (!backup || backup.schema_version !== 1 || String(backup.run_id || '') !== sourceRunId) {
    return {
      ok: false, status: 'blocked', sourceRunId, rollbackRunId,
      restorable: 0, untouched: 0, conflicts: 0,
      blockReason: '유효한 동기화 백업을 찾지 못했습니다',
    };
  }
  if (backup.status === 'rolled_back') {
    return {
      ok: false, status: 'blocked', sourceRunId, rollbackRunId,
      restorable: 0, untouched: backupEntries(backup.entries).length, conflicts: 0,
      blockReason: '이미 롤백된 실행입니다',
    };
  }
  const entries = backupEntries(backup.entries);
  const products = (productsSnap.val() || {}) as Record<string, EntityRecord>;
  const initial = classifyRollbackEntries(sourceRunId, entries, products);
  const initialResult = {
    sourceRunId,
    rollbackRunId,
    restorable: initial.restorable.length,
    untouched: initial.untouched.length,
    conflicts: initial.conflicts.length,
  };
  if (initial.conflicts.length) {
    return {
      ok: false, status: 'blocked', ...initialResult,
      blockReason: '반영 이후 다른 변경이 감지되어 전체 롤백을 중단했습니다',
    };
  }
  if (opts.dryRun !== false) return { ok: true, status: 'dry_run', ...initialResult };

  await acquireLease(db, rollbackRunId, Date.now());
  try {
    let transactionConflict = false;
    const tx = await db.ref('v4/products').transaction((current) => {
      const currentProducts = current && typeof current === 'object'
        ? { ...(current as Record<string, EntityRecord>) }
        : {};
      const fresh = classifyRollbackEntries(sourceRunId, entries, currentProducts);
      if (fresh.conflicts.length) {
        transactionConflict = true;
        return;
      }
      for (const entry of fresh.restorable) {
        if (entry.existed) currentProducts[entry.key] = clean(entry.before || {});
        else delete currentProducts[entry.key];
      }
      return currentProducts;
    }, undefined, false);
    if (!tx.committed) {
      throw new Error(transactionConflict
        ? '롤백 직전 다른 상품 변경이 감지됐습니다'
        : '상품 원상복구 transaction이 커밋되지 않았습니다');
    }
    const at = Date.now();
    const auditId = `AL-${at}-sheet-rollback`;
    await db.ref('v4').update({
      [`sheet_sync_backups/${sourceRunId}/status`]: 'rolled_back',
      [`sheet_sync_backups/${sourceRunId}/rolled_back_at`]: at,
      [`sheet_sync_backups/${sourceRunId}/rollback_run_id`]: rollbackRunId,
      [`sheet_sync_rollback_runs/${rollbackRunId}`]: {
        run_id: rollbackRunId,
        source_run_id: sourceRunId,
        status: 'rolled_back',
        finished_at: at,
        restored: initial.restorable.length,
        untouched: initial.untouched.length,
      },
      [`audit_logs/${auditId}`]: {
        _key: auditId,
        entity: 'product',
        target_key: `sheet-daily:${sourceRunId}`,
        action: 'sheet_daily_sync_rollback',
        at,
        actor_uid: 'system:sheet-daily',
        actor_role: 'system',
        actor_name: '판매시트 연동 롤백',
        summary: `원상복구 ${initial.restorable.length}건`,
        changes: [],
      },
      'system_locks/sheet_daily_sync': {
        run_id: rollbackRunId,
        source_run_id: sourceRunId,
        status: 'rolled_back',
        finished_at: at,
        expires_at: at,
      },
    });
    return { ok: true, status: 'rolled_back', ...initialResult };
  } catch (error) {
    const message = String((error as Error)?.message || error);
    const at = Date.now();
    await db.ref('v4').update({
      [`sheet_sync_rollback_runs/${rollbackRunId}`]: {
        run_id: rollbackRunId,
        source_run_id: sourceRunId,
        status: 'failed',
        finished_at: at,
        error: message,
      },
      'system_locks/sheet_daily_sync': {
        run_id: rollbackRunId,
        source_run_id: sourceRunId,
        status: 'failed',
        finished_at: at,
        expires_at: at,
      },
    }).catch(() => {});
    return { ok: false, status: 'failed', ...initialResult, blockReason: message };
  }
}

async function writeRun(
  db: Database,
  runId: string,
  status: DailyRunStatus,
  payload: Record<string, unknown>,
): Promise<void> {
  const at = Date.now();
  const result = clean({ run_id: runId, status, finished_at: at, ...payload });
  await db.ref('v4').update({
    [`sheet_sync_runs/${runId}`]: result,
    'system_status/sheet_daily_sync': result,
    'system_locks/sheet_daily_sync': { run_id: runId, status, finished_at: at, expires_at: at },
  });
}

async function applyProductPlan(
  db: Database,
  companyId: string,
  runId: string,
  plan: DailySheetSyncPlan,
): Promise<void> {
  const patches = plan.patches.map((item) => {
    const { publicRecord, privateRecord } = splitProductPrivate(item.patch);
    if (privateRecord) throw new Error(`자동 시트 동기화는 private 상품 필드를 쓸 수 없습니다(${item.key})`);
    // readProducts()는 공개 상품과 products_private를 합쳐 계획을 만든다. 하지만 아래 CAS의
    // current는 v4/products 공개 노드뿐이다. expected.price에 수수료가 섞인 상품은 공개 price와
    // 항상 다르다고 판정됐으므로, 쓰려는 patch와 동일하게 expected도 공개 모양으로 비교한다.
    const { publicRecord: expectedPublic } = splitProductPrivate(item.expected);
    return { ...item, expected: expectedPublic, publicRecord };
  });
  const creates = plan.creates.map((record) => {
    const key = String(record.product_code || record._key || '');
    if (!key) throw new Error('신규 시트 상품키 없음');
    const { publicRecord, privateRecord } = splitProductPrivate(record);
    if (privateRecord) throw new Error(`자동 시트 동기화는 private 상품 필드를 만들 수 없습니다(${key})`);
    return { key, publicRecord };
  });
  if (!patches.length && !creates.length) return;

  const updatedAt = new Date().toISOString();
  let conflictKey = '';
  const result = await db.ref('v4/products').transaction((current) => {
    const products = current && typeof current === 'object'
      ? { ...(current as Record<string, EntityRecord>) }
      : {};
    for (const item of patches) {
      const overlay = products[item.key] && typeof products[item.key] === 'object'
        ? products[item.key]
        : null;
      if (!productPatchPreconditionMatches(overlay, item.expected, item.publicRecord, {
        overlayFallback: true,
        // _key는 toV4Record가 product_code로 정규화한 논리키라 legacy raw overlay의
        // 저장값과 다를 수 있다. 실제 child path·product_code와 상태/잠금/updatedAt은
        // 계속 CAS하고, 이 파생 메타필드만 비교에서 제외한다.
        ignoredFields: ['_key', '_rtdb_key'],
      })) {
        conflictKey = item.key;
        return;
      }
    }
    for (const item of creates) {
      if (products[item.key] != null) {
        conflictKey = item.key;
        return;
      }
    }
    for (const item of patches) {
      const logicalProductCode = String(
        item.publicRecord.product_code
        || item.expected.product_code
        || item.expected._key
        || item.key,
      );
      products[item.key] = clean({
        ...(products[item.key] || {}),
        ...item.publicRecord,
        // item.key는 Firebase 실제 child key일 수 있다(삭제된 EXT_* revive). 논리
        // 상품코드는 상품마스터의 공급사+차번 키를 유지해야 다음 실행이 twin 없이 붙는다.
        _key: logicalProductCode,
        product_code: logicalProductCode,
        updatedAt,
        updatedBy: 'sheet_daily_sync',
        sheet_sync_run_id: runId,
      });
    }
    for (const item of creates) {
      products[item.key] = clean({
        ...item.publicRecord,
        companyId,
        _key: item.key,
        product_code: item.key,
        createdAt: updatedAt,
        createdBy: 'sheet_daily_sync',
        updatedAt,
        updatedBy: 'sheet_daily_sync',
        sheet_sync_run_id: runId,
      });
    }
    return products;
  }, undefined, false);
  // 실제 키에는 차량번호가 포함될 수 있다. 실패 사유는 관리자 상태 원장·UI에도 남으므로
  // 식별자를 노출하지 않고, 상세 충돌은 별도 관리자 충돌 화면에서 확인하게 한다.
  if (!result.committed) throw new Error(`동기화 중 공급사 재고가 변경됐습니다${conflictKey ? '(1건)' : ''}`);
}

async function applyPlan(
  db: Database,
  companyId: string,
  runId: string,
  plan: DailySheetSyncPlan,
  providerCode = '',
): Promise<void> {
  // v4/products 한 번의 transaction에서 기존 CAS 검증과 신규 중복 검사를 모두 통과해야
  // 전체 재고 변경을 반영한다. 한 건이라도 충돌하면 부분 저장 없이 전부 취소한다.
  await applyProductPlan(db, companyId, runId, plan);
  const metadata: Record<string, unknown> = {};
  for (const checkpoint of plan.checkpoints) {
    // Firebase multi-location update에서 partners/{code}를 값으로 지정하면
    // 기존 파트너 설정 전체가 checkpoint만 남도록 교체된다. checkpoint 필드만
    // leaf path로 병합해 공급사 프로필·시트 매핑을 보존한다.
    const checkpointRecord = clean({
      ...checkpoint.patch,
      partner_code: checkpoint.key,
      sheet_sync_run_id: runId,
    });
    for (const [field, value] of Object.entries(checkpointRecord)) {
      metadata[`partners/${checkpoint.key}/${field}`] = value;
    }
  }
  const auditScope = providerCode.replace(/[^A-Za-z0-9_-]/g, '') || 'all';
  const auditId = `AL-${Date.now()}-sheet-daily-${auditScope}`;
  metadata[`audit_logs/${auditId}`] = {
    _key: auditId,
    entity: 'product',
    target_key: `sheet-daily:${runId}`,
    action: 'sheet_daily_sync',
    companyId,
    at: Date.now(),
    actor_uid: 'system:sheet-daily',
    actor_role: 'system',
    actor_name: '매일 시트 연동',
    summary: `${providerCode ? `${providerCode} · ` : ''}신규 ${plan.counts.created} · 수정 ${plan.counts.updated} · 부재차단 ${plan.counts.absentBlocked}`,
    changes: [],
  };
  await db.ref('v4').update(metadata);
}

function aggregateCounts(plans: ProductMasterProviderPlan[]): DailySheetSyncPlan['counts'] {
  const output: DailySheetSyncPlan['counts'] = {
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
  };
  for (const item of plans) {
    for (const key of Object.keys(output) as Array<keyof typeof output>) {
      output[key] += item.plan.counts[key];
    }
  }
  return output;
}

function plannedProviderResult(item: ProductMasterProviderPlan): DailySheetSyncProviderResult {
  return item.plan.ok
    ? {
        code: item.code,
        label: item.label,
        status: 'planned',
        sourceRows: item.plan.counts.sourceRows,
        counts: item.plan.counts,
      }
    : {
        code: item.code,
        label: item.label,
        status: 'blocked',
        sourceRows: item.plan.counts.sourceRows,
        blockReason: item.plan.blockReason,
        counts: item.plan.counts,
      };
}

export async function runDailySheetSync(opts: { dryRun?: boolean; providerCodes?: string[] } = {}): Promise<DailySheetSyncResult> {
  const runId = newId('run');
  const companyId = String(process.env.SHEET_SYNC_COMPANY_ID || 'freepass').trim();
  const db = firebaseAdminDatabase();
  let backupId: string | undefined;
  // dry-run은 계획 계산만 한다. 락·상태·실행이력도 운영 데이터 쓰기이므로 만들지 않는다.
  if (!opts.dryRun) await acquireLease(db, runId, Date.now());
  try {
    if (!opts.dryRun) {
      await db.ref(STATUS_PATH).set({
        run_id: runId,
        status: 'running',
        started_at: Date.now(),
      });
    }
    const [partners, initialState, initialContracts, initialResolutions] = await Promise.all([
      readPartners(db, companyId),
      readProducts(db, companyId),
      readContracts(db, companyId),
      readResolutions(db),
    ]);
    const requestedCodes = [...new Set((opts.providerCodes || []).map((code) => String(code).trim()).filter(Boolean))];
    /**
     * ERP 직접 정본은 판매시트 3탭으로 고정한다. 환경변수나 상품마스터로 우회하면
     * 영업자가 보는 현재값과 ERP가 다시 갈리므로 대체 경로를 두지 않는다.
     */
    const rawFetched = await fetchSalesInventorySheet({
      partners,
      providerCodes: requestedCodes,
    });
    const isolated = isolateProductMasterBlockedProviders(rawFetched);
    const fetched = isolated.fetched;
    const manualBlockedResults: DailySheetSyncProviderResult[] = isolated.blocked.map((item) => ({
      code: item.code,
      label: item.label,
      status: 'blocked',
      sourceRows: rawFetched.lines.find((line) => line.code === item.code)?.sourceRowCount || 0,
      blockReason: item.reason,
    }));
    const initialBatches = planProductMasterProviderBatches({
      fetched,
      existing: initialState.active,
      deleted: initialState.deleted,
      partners,
      contracts: initialContracts,
      resolutions: initialResolutions,
    });
    const initialResults = [...manualBlockedResults, ...initialBatches.map(plannedProviderResult)];
    const initialRunnable = initialBatches.filter((item) => item.plan.ok);
    const initialBlocked = initialResults.filter((item) => item.status === 'blocked');
    const initialNotes = initialBlocked.length
      ? [`보류 공급사 ${initialBlocked.length}곳 — ${initialBlocked.map((item) => `${item.label}(${item.code})`).join(', ')}`]
      : [];
    const initialCounts = aggregateCounts(initialRunnable);
    if (opts.dryRun) {
      if (!initialRunnable.length) {
        const blockReason = initialBlocked.map((item) => `${item.label}: ${item.blockReason}`).join(' · ')
          || '반영 가능한 공급사가 없습니다';
        return {
          ok: false,
          status: 'blocked',
          runId,
          blockReason,
          counts: initialCounts,
          notes: initialNotes,
          providers: initialResults,
        };
      }
      return {
        ok: true,
        status: 'dry_run',
        runId,
        counts: initialCounts,
        notes: initialNotes,
        providers: initialResults,
      };
    }

    // 판매시트 정본을 읽은 뒤 ERP가 바뀌었는지 write 직전에 한 번 더 확인한다.
    // 공급사별 계획을 다시 만들고, 충돌한 공급사만 보류한다.
    const [freshState, freshContracts, freshResolutions] = await Promise.all([
      readProducts(db, companyId),
      readContracts(db, companyId),
      readResolutions(db),
    ]);
    const freshBatches = planProductMasterProviderBatches({
      fetched,
      existing: freshState.active,
      deleted: freshState.deleted,
      partners,
      contracts: freshContracts,
      resolutions: freshResolutions,
    });
    const providerResults = new Map<string, DailySheetSyncProviderResult>();
    for (const item of manualBlockedResults) providerResults.set(item.code, item);
    for (const item of freshBatches) providerResults.set(item.code, plannedProviderResult(item));
    const freshRunnable = freshBatches.filter((item) => item.plan.ok);
    if (!freshRunnable.length) {
      const providers = [...providerResults.values()];
      const blockReason = providers.map((item) => `${item.label}: ${item.blockReason || '반영 차단'}`).join(' · ')
        || '반영 가능한 공급사가 없습니다';
      const notes = [`보류 공급사 ${providers.length}곳`];
      await writeRun(db, runId, 'blocked', {
        block_reason: blockReason,
        counts: aggregateCounts([]),
        notes,
        providers,
      });
      return { ok: false, status: 'blocked', runId, blockReason, counts: aggregateCounts([]), notes, providers };
    }

    // 제품 노드를 하나라도 쓰기 전에 이번 계획이 닿는 정확한 RTDB child 원본을 보관한다.
    // 백업 실패 시 아래 공급사별 apply loop에는 진입하지 않는다.
    const backup = await writeProductSyncBackup(db, companyId, runId, freshRunnable);
    backupId = backup.run_id;

    const applied: ProductMasterProviderPlan[] = [];
    for (const item of freshRunnable) {
      try {
        await applyPlan(db, companyId, runId, item.plan, item.code);
        applied.push(item);
        providerResults.set(item.code, {
          code: item.code,
          label: item.label,
          status: 'completed',
          sourceRows: item.plan.counts.sourceRows,
          counts: item.plan.counts,
        });
      } catch (error) {
        providerResults.set(item.code, {
          code: item.code,
          label: item.label,
          status: 'failed',
          sourceRows: item.plan.counts.sourceRows,
          blockReason: String((error as Error)?.message || error),
          counts: item.plan.counts,
        });
      }
    }

    const [after, afterContracts, afterResolutions] = await Promise.all([
      readProducts(db, companyId),
      readContracts(db, companyId),
      readResolutions(db),
    ]);
    for (const item of applied) {
      const remaining = planDailySheetSync({
        fetched: item.fetched,
        existing: after.active,
        deleted: after.deleted,
        partners,
        contracts: afterContracts,
        resolutions: afterResolutions,
      });
      if (!remaining.ok || remaining.creates.length || remaining.patches.length) {
        providerResults.set(item.code, {
          code: item.code,
          label: item.label,
          status: 'failed',
          sourceRows: item.plan.counts.sourceRows,
          blockReason: `사후검증 실패 — ${remaining.blockReason || `신규 ${remaining.creates.length}·수정 ${remaining.patches.length}`}`,
          counts: item.plan.counts,
        });
      }
    }
    const providers = [...providerResults.values()];
    const completedCodes = new Set(providers.filter((item) => item.status === 'completed').map((item) => item.code));
    const completedPlans = freshRunnable.filter((item) => completedCodes.has(item.code));
    const counts = aggregateCounts(completedPlans);
    const blockedCount = providers.filter((item) => item.status === 'blocked').length;
    const failed = providers.filter((item) => item.status === 'failed');
    const notes = [
      `판매시트 ${counts.imported}대 → ERP 반영`,
      ...(blockedCount ? [`보류 공급사 ${blockedCount}곳은 상태·가격·부재처리 제외`] : []),
    ];
    if (failed.length) {
      const blockReason = `공급사별 반영 실패 ${failed.length}곳 — ${failed.map((item) => `${item.label}: ${item.blockReason}`).join(', ')}`;
      await db.ref(`v4/sheet_sync_backups/${runId}/status`).set('partial');
      await writeRun(db, runId, 'failed', { error: blockReason, backup_id: backupId, counts, notes, providers });
      return { ok: false, status: 'failed', runId, backupId, blockReason, counts, notes, providers };
    }
    await db.ref(`v4/sheet_sync_backups/${runId}/status`).set('completed');
    await writeRun(db, runId, 'completed', { backup_id: backupId, counts, notes, providers });
    return { ok: true, status: 'completed', runId, backupId, counts, notes, providers };
  } catch (error) {
    const message = String((error as Error)?.message || error);
    if (!opts.dryRun && backupId) {
      await db.ref(`v4/sheet_sync_backups/${backupId}/status`).set('partial').catch(() => {});
    }
    if (!opts.dryRun) await writeRun(db, runId, 'failed', { error: message }).catch(() => {});
    return { ok: false, status: 'failed', runId, backupId, blockReason: message };
  }
}
