import 'server-only';

import type { Database } from 'firebase-admin/database';
import { planSheetLiveStatusSync, type SheetLiveStatusPlan } from '@/lib/domain/sheet-live-status';
import { productPatchPreconditionMatches } from '@/lib/domain/product-write-guard';
import { splitProductPrivate } from '@/lib/firebase/rtdb-products';
import type { EntityRecord } from '@/lib/intake/entities';
import { firebaseAdminDatabase } from '@/lib/server/firebase-admin';
import { fetchProductMasterSheet } from '@/lib/server/product-master-sheet';
import { readPartners, readProducts } from '@/lib/server/sheet-daily-sync';
import { newId } from '@/lib/domain/ids';

const LOCK_PATH = 'v4/system_locks/sheet_live_status';
const STATUS_PATH = 'v4/system_status/sheet_live_status';
const FRESH_MS = 45_000;
const LEASE_MS = 2 * 60_000;
const ALLOWED_PATCH_FIELDS = new Set([
  'vehicle_status',
  'sheet_status_owner',
  'sheet_block_reason',
  'sheet_blocked_at',
]);

export type SheetLiveStatusResult = {
  ok: boolean;
  status: 'completed' | 'fresh' | 'coalesced' | 'blocked' | 'failed' | 'disabled';
  runId: string;
  syncedAt: number;
  counts?: SheetLiveStatusPlan['counts'];
  blockReason?: string;
  statuses: Record<string, string>;
};

function statusMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries((raw || {}) as Record<string, EntityRecord>)) {
    if (!value || typeof value !== 'object') continue;
    if (value._deleted === true || value.deletedAt || String(value.status || '') === 'deleted') continue;
    out[key] = String(value.vehicle_status || '').trim();
  }
  return out;
}

function storedStatuses(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (!entries.every(([key, value]) => key && typeof value === 'string')) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

async function readStatuses(db: Database): Promise<Record<string, string>> {
  return statusMap((await db.ref('v4/products').get()).val());
}

async function acquireLease(db: Database, runId: string, now: number): Promise<boolean> {
  const result = await db.ref(LOCK_PATH).transaction((current) => {
    const lock = current && typeof current === 'object' ? current as Record<string, unknown> : {};
    if (String(lock.status || '') === 'running' && Number(lock.expires_at || 0) > now) return;
    return { run_id: runId, status: 'running', started_at: now, expires_at: now + LEASE_MS };
  }, undefined, false);
  return result.committed;
}

async function finishRun(
  db: Database,
  runId: string,
  status: SheetLiveStatusResult['status'],
  payload: Record<string, unknown> = {},
): Promise<number> {
  const finishedAt = Date.now();
  const value = { run_id: runId, status, finished_at: finishedAt, ...payload };
  await db.ref('v4').update({
    'system_status/sheet_live_status': value,
    'system_locks/sheet_live_status': {
      run_id: runId,
      status,
      finished_at: finishedAt,
      expires_at: finishedAt,
    },
  });
  return finishedAt;
}

async function applyStatusPlan(
  db: Database,
  runId: string,
  plan: SheetLiveStatusPlan,
): Promise<Record<string, string>> {
  if (!plan.patches.length) return readStatuses(db);
  const patches = plan.patches.map((item) => {
    for (const field of Object.keys(item.patch)) {
      if (!ALLOWED_PATCH_FIELDS.has(field)) {
        throw new Error(`차량상태 전용 연동이 허용되지 않은 필드를 쓰려 했습니다(${item.key}.${field})`);
      }
    }
    const { publicRecord: expected } = splitProductPrivate(item.expected);
    return { ...item, expected };
  });
  let conflictKey = '';
  const updatedAt = new Date().toISOString();
  const result = await db.ref('v4/products').transaction((current) => {
    const products = current && typeof current === 'object'
      ? { ...(current as Record<string, EntityRecord>) }
      : {};
    for (const item of patches) {
      const before = products[item.key] && typeof products[item.key] === 'object'
        ? products[item.key]
        : null;
      if (!productPatchPreconditionMatches(before, item.expected, item.patch, { overlayFallback: true })) {
        conflictKey = item.key;
        return;
      }
    }
    for (const item of patches) {
      products[item.key] = {
        ...products[item.key],
        ...item.patch,
        _key: item.key,
        product_code: item.key,
        updatedAt,
        updatedBy: 'sheet_live_status',
        sheet_status_sync_run_id: runId,
      };
    }
    return products;
  }, undefined, false);
  if (!result.committed) {
    throw new Error(`상태 반영 직전 ERP 차량이 변경됐습니다${conflictKey ? `(${conflictKey})` : ''}`);
  }
  return statusMap(result.snapshot.val());
}

/** 한 명의 화면만 Google Sheet를 읽고, 나머지 사용자는 같은 최신 결과를 공유한다. */
export async function runSheetLiveStatusSync(): Promise<SheetLiveStatusResult> {
  const db = firebaseAdminDatabase();
  const now = Date.now();
  if (String(process.env.SHEET_LIVE_STATUS_ENABLED || 'true').toLowerCase() === 'false') {
    return { ok: true, status: 'disabled', runId: '', syncedAt: 0, statuses: await readStatuses(db) };
  }
  const previous = (await db.ref(STATUS_PATH).get()).val() as Record<string, unknown> | null;
  const previousAt = Number(previous?.finished_at || 0);
  const previousStatuses = storedStatuses(previous?.statuses);
  if (String(previous?.status || '') === 'completed' && previousAt > now - FRESH_MS) {
    return {
      ok: true,
      status: 'fresh',
      runId: String(previous?.run_id || ''),
      syncedAt: previousAt,
      statuses: previousStatuses || await readStatuses(db),
    };
  }

  const runId = newId('run');
  if (!await acquireLease(db, runId, now)) {
    return {
      ok: true,
      status: 'coalesced',
      runId: '',
      syncedAt: previousAt,
      statuses: previousStatuses || await readStatuses(db),
    };
  }
  try {
    await db.ref(STATUS_PATH).set({
      run_id: runId,
      status: 'running',
      started_at: now,
      ...(previousStatuses ? { statuses: previousStatuses } : {}),
    });
    const companyId = String(process.env.SHEET_SYNC_COMPANY_ID || 'freepass').trim();
    const [partners, initial] = await Promise.all([
      readPartners(db, companyId),
      readProducts(db, companyId),
    ]);
    const fetched = await fetchProductMasterSheet({
      partners,
      knownProviderCodes: initial.active
        .map((row) => String(row.provider_company_code || row.partner_code || '').trim())
        .filter(Boolean),
    });
    const initialPlan = planSheetLiveStatusSync({ fetched, existing: initial.active, partners });
    if (!initialPlan.ok) {
      const syncedAt = await finishRun(db, runId, 'blocked', {
        block_reason: initialPlan.blockReason,
        counts: initialPlan.counts,
        ...(previousStatuses ? { statuses: previousStatuses } : {}),
      });
      return {
        ok: false,
        status: 'blocked',
        runId,
        syncedAt,
        counts: initialPlan.counts,
        blockReason: initialPlan.blockReason,
        statuses: previousStatuses || await readStatuses(db),
      };
    }

    // 시트 조회 중 계약 엔진이 차량을 선점할 수 있으므로 write 직전 fresh 상태로 다시 계획한다.
    const fresh = await readProducts(db, companyId);
    const plan = planSheetLiveStatusSync({ fetched, existing: fresh.active, partners });
    if (!plan.ok) throw new Error(`상태 저장 직전 재검증 실패 — ${plan.blockReason}`);
    const statuses = await applyStatusPlan(db, runId, plan);
    const syncedAt = await finishRun(db, runId, 'completed', { counts: plan.counts, statuses });
    return { ok: true, status: 'completed', runId, syncedAt, counts: plan.counts, statuses };
  } catch (error) {
    const blockReason = String((error as Error)?.message || error);
    const syncedAt = await finishRun(db, runId, 'failed', {
      error: blockReason,
      ...(previousStatuses ? { statuses: previousStatuses } : {}),
    }).catch(() => Date.now());
    return {
      ok: false,
      status: 'failed',
      runId,
      syncedAt,
      blockReason,
      statuses: previousStatuses || await readStatuses(db).catch(() => ({})),
    };
  }
}
