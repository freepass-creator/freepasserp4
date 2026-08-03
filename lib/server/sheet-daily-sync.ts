import 'server-only';

import type { Database } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allowedHost } from '@/lib/net/proxy-hosts';
import { resolveGoogleSheetCsvUrl } from '@/lib/domain/sheet-url';
import { parseDelimited } from '@/lib/domain/sheet-import';
import { fetchAllPartnerSheets } from '@/lib/domain/sheet-sync-all';
import { planDailySheetSync, type DailySheetSyncPlan } from '@/lib/domain/sheet-daily-sync';
import { productPatchPreconditionMatches } from '@/lib/domain/product-write-guard';
import { mergeProductPrivate, splitProductPrivate } from '@/lib/firebase/rtdb-products';
import { toV4Record } from '@/lib/firebase/rtdb-records';
import type { MasterEntry } from '@/lib/domain/vehicle-master-types';
import type { EntityRecord } from '@/lib/intake/entities';
import { firebaseAdminDatabase } from '@/lib/server/firebase-admin';
import type { SheetConflictResolution } from '@/lib/domain/sheet-conflict-resolution';

const LOCK_PATH = 'v4/system_locks/sheet_daily_sync';
const STATUS_PATH = 'v4/system_status/sheet_daily_sync';
const LEASE_MS = 20 * 60 * 1000;

type DailyRunStatus = 'blocked' | 'completed' | 'failed' | 'dry_run';

export type DailySheetSyncResult = {
  ok: boolean;
  status: DailyRunStatus;
  runId: string;
  blockReason?: string;
  counts?: DailySheetSyncPlan['counts'];
  notes?: string[];
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

async function fetchSheetTableDirect(url: string, gid?: string): Promise<string[][]> {
  const csvUrl = resolveGoogleSheetCsvUrl(url, gid);
  if (!allowedHost(csvUrl, 'sheet')) throw new Error('허용되지 않은 Google Sheet 호스트');
  const response = await fetch(csvUrl, {
    headers: { 'User-Agent': 'freepasserp4-sheet-daily-sync/1.0' },
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`시트 로드 실패 ${response.status}`);
  const csv = await response.text();
  if (/^\s*<(!doctype|html)/i.test(csv)) throw new Error('시트 비공개 또는 로그인 HTML 응답');
  return parseDelimited(csv);
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

async function readPartners(db: Database, companyId: string): Promise<EntityRecord[]> {
  const [v3, v4] = await Promise.all([db.ref('partners').get(), db.ref('v4/partners').get()]);
  return mergeRows(
    normalizedRows('partner', v3.val(), companyId),
    normalizedRows('partner', v4.val(), companyId),
  );
}

async function readProducts(db: Database, companyId: string): Promise<{
  active: EntityRecord[];
  deleted: EntityRecord[];
}> {
  const [v3, v4, privateSnap] = await Promise.all([
    db.ref('products').get(),
    db.ref('v4/products').get(),
    db.ref('v4/products_private').get(),
  ]);
  const privateByCode = new Map<string, EntityRecord>();
  for (const [key, row] of Object.entries((privateSnap.val() || {}) as Record<string, EntityRecord>)) {
    if (!row || typeof row !== 'object') continue;
    privateByCode.set(String(row.product_code || key), { ...row, _key: key, product_code: row.product_code || key });
  }
  const all = mergeRows(
    normalizedRows('product', v3.val(), companyId),
    normalizedRows('product', v4.val(), companyId),
  ).map((row) => mergeProductPrivate(row, privateByCode.get(String(row.product_code || row._key))));
  return {
    active: all.filter((row) => row._deleted !== true && !row.deletedAt && String(row.status || '') !== 'deleted'),
    deleted: all.filter((row) => row._deleted === true || !!row.deletedAt || String(row.status || '') === 'deleted'),
  };
}

async function readContracts(db: Database, companyId: string): Promise<EntityRecord[]> {
  const [v3, v4] = await Promise.all([db.ref('contracts').get(), db.ref('v4/contracts').get()]);
  return mergeRows(
    normalizedRows('contract', v3.val(), companyId),
    normalizedRows('contract', v4.val(), companyId),
  );
}

async function readResolutions(db: Database): Promise<SheetConflictResolution[]> {
  const snapshot = await db.ref('v4/sheet_conflict_resolutions').get();
  return Object.values((snapshot.val() || {}) as Record<string, SheetConflictResolution>)
    .filter((item) => item && typeof item === 'object');
}

function masterEntries(): MasterEntry[] {
  const raw = JSON.parse(readFileSync(join(process.cwd(), 'public/data/vehicle-master.json'), 'utf8')) as {
    entries?: MasterEntry[];
  } | MasterEntry[];
  const entries = Array.isArray(raw) ? raw : raw.entries;
  if (!entries?.length) throw new Error('차종마스터 없음');
  return entries;
}

async function acquireLease(db: Database, runId: string, now: number): Promise<void> {
  const result = await db.ref(LOCK_PATH).transaction((current) => {
    const lock = current && typeof current === 'object' ? current as Record<string, unknown> : {};
    if (String(lock.status || '') === 'running' && Number(lock.expires_at || 0) > now) return;
    return { run_id: runId, status: 'running', started_at: now, expires_at: now + LEASE_MS };
  }, undefined, false);
  if (!result.committed) throw new Error('다른 일일 시트 동기화가 실행 중입니다');
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
    return { ...item, publicRecord };
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
      if (!productPatchPreconditionMatches(overlay, item.expected, item.publicRecord, { overlayFallback: true })) {
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
      products[item.key] = clean({
        ...(products[item.key] || {}),
        ...item.publicRecord,
        _key: item.key,
        product_code: item.key,
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
  if (!result.committed) throw new Error(`동기화 중 재고가 변경됐습니다${conflictKey ? `(${conflictKey})` : ''}`);
}

async function applyPlan(
  db: Database,
  companyId: string,
  runId: string,
  plan: DailySheetSyncPlan,
): Promise<void> {
  // v4/products 한 번의 transaction에서 기존 CAS 검증과 신규 중복 검사를 모두 통과해야
  // 전체 재고 변경을 반영한다. 한 건이라도 충돌하면 부분 저장 없이 전부 취소한다.
  await applyProductPlan(db, companyId, runId, plan);
  const metadata: Record<string, unknown> = {};
  for (const checkpoint of plan.checkpoints) {
    metadata[`partners/${checkpoint.key}`] = clean({
      ...checkpoint.patch,
      partner_code: checkpoint.key,
      sheet_sync_run_id: runId,
    });
  }
  const auditId = `AL-${Date.now()}-sheet-daily`;
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
    summary: `신규 ${plan.counts.created} · 수정 ${plan.counts.updated} · 부재차단 ${plan.counts.absentBlocked}`,
    changes: [],
  };
  await db.ref('v4').update(metadata);
}

export async function runDailySheetSync(opts: { dryRun?: boolean } = {}): Promise<DailySheetSyncResult> {
  const runId = `SS-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const companyId = String(process.env.SHEET_SYNC_COMPANY_ID || 'freepass').trim();
  const db = firebaseAdminDatabase();
  await acquireLease(db, runId, Date.now());
  try {
    await db.ref(STATUS_PATH).set({
      run_id: runId,
      status: 'running',
      started_at: Date.now(),
    });
    const [partners, initialState, initialContracts, initialResolutions] = await Promise.all([
      readPartners(db, companyId),
      readProducts(db, companyId),
      readContracts(db, companyId),
      readResolutions(db),
    ]);
    const fetched = await fetchAllPartnerSheets(companyId, masterEntries(), {
      partnerRows: partners,
      fetchTable: fetchSheetTableDirect,
    });
    const plan = planDailySheetSync({
      fetched,
      existing: initialState.active,
      deleted: initialState.deleted,
      partners,
      contracts: initialContracts,
      resolutions: initialResolutions,
    });
    if (!plan.ok) {
      await writeRun(db, runId, 'blocked', { block_reason: plan.blockReason, counts: plan.counts, notes: plan.notes });
      return { ok: false, status: 'blocked', runId, blockReason: plan.blockReason, counts: plan.counts, notes: plan.notes };
    }
    if (opts.dryRun) {
      await writeRun(db, runId, 'dry_run', { counts: plan.counts, notes: plan.notes });
      return { ok: true, status: 'dry_run', runId, counts: plan.counts, notes: plan.notes };
    }

    // fetch·계획 사이의 사용자 편집도 write 전에 한 번 더 차단한다.
    const [freshState, freshContracts, freshResolutions] = await Promise.all([
      readProducts(db, companyId),
      readContracts(db, companyId),
      readResolutions(db),
    ]);
    const freshPlan = planDailySheetSync({
      fetched,
      existing: freshState.active,
      deleted: freshState.deleted,
      partners,
      contracts: freshContracts,
      resolutions: freshResolutions,
    });
    if (!freshPlan.ok) throw new Error(`저장 직전 재검증 실패 — ${freshPlan.blockReason}`);
    await applyPlan(db, companyId, runId, freshPlan);

    const [after, afterContracts, afterResolutions] = await Promise.all([
      readProducts(db, companyId),
      readContracts(db, companyId),
      readResolutions(db),
    ]);
    const remaining = planDailySheetSync({
      fetched,
      existing: after.active,
      deleted: after.deleted,
      partners,
      contracts: afterContracts,
      resolutions: afterResolutions,
    });
    if (!remaining.ok || remaining.creates.length || remaining.patches.length) {
      throw new Error(`사후검증 실패 — ${remaining.blockReason || `신규 ${remaining.creates.length}·수정 ${remaining.patches.length}`}`);
    }
    await writeRun(db, runId, 'completed', { counts: freshPlan.counts, notes: freshPlan.notes });
    return { ok: true, status: 'completed', runId, counts: freshPlan.counts, notes: freshPlan.notes };
  } catch (error) {
    const message = String((error as Error)?.message || error);
    await writeRun(db, runId, 'failed', { error: message }).catch(() => {});
    return { ok: false, status: 'failed', runId, blockReason: message };
  }
}
