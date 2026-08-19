import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyAdminBearer } from '@/lib/server/firebase-admin';
import { fetchIronRentcarCatalog } from '@/lib/server/ironrentcar-source';
import { planIronRentcarReconcile } from '@/lib/domain/ironrentcar-reconcile';
import { applyIronRentcarPublicOverlay } from '@/lib/domain/ironrentcar-apply';
import {
  affectedProductsMatch,
  failPreparedIronRentcarRun,
  ironRentcarPlanKeys,
  ironRentcarRootWriteAllowed,
  replaceAffectedProducts,
  snapshotMatches,
  snapshotsForKeys,
  storedSnapshot,
  syncStateDigest,
  type IronRentcarSyncRun,
} from '@/lib/domain/ironrentcar-rollback';
import { mergeV3V4Records } from '@/lib/firebase/rtdb-records';
import { newId } from '@/lib/domain/ids';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONFIRMATION = '아이언 홈페이지 연동 적용';
const MAX_OPERATIONS = 100;
const LOCK_MS = 120_000;

type ApplyBody = {
  revision?: string;
  confirmation?: string;
  expected?: { patches?: number; creates?: number; absentBlocks?: number };
};

type V4Root = Record<string, any>;

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

export async function POST(request: Request): Promise<Response> {
  let admin: { uid: string } | null;
  try {
    admin = await verifyAdminBearer(request);
  } catch {
    return NextResponse.json({ error: 'server auth unavailable' }, { status: 503, headers });
  }
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers });
  if (process.env.IRONRENTCAR_SYNC_ENABLED !== 'true') {
    return NextResponse.json({ error: 'ironrentcar sync disabled' }, { status: 409, headers });
  }

  let body: ApplyBody;
  try {
    body = await request.json() as ApplyBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400, headers });
  }
  if (body.confirmation !== CONFIRMATION || !body.revision || !body.expected) {
    return NextResponse.json({ error: 'explicit confirmation required' }, { status: 400, headers });
  }

  const db = firebaseAdminDatabase();
  const owner = `${admin.uid}:${randomUUID()}`;
  const lockRef = db.ref('v4/system_locks/ironrentcar_sync');
  const acquired = await lockRef.transaction((current) => {
    const expiresAt = Number((current as { expiresAt?: number } | null)?.expiresAt || 0);
    if (expiresAt > Date.now()) return;
    return { owner, actor_uid: admin.uid, acquiredAt: Date.now(), expiresAt: Date.now() + LOCK_MS };
  }, undefined, false);
  if (!acquired.committed) {
    return NextResponse.json({ error: 'ironrentcar sync already running' }, { status: 409, headers });
  }

  const runId = newId('run');
  const applyAuditId = newId('audit');
  const completedAuditId = newId('audit');
  let preparedRun: IronRentcarSyncRun | null = null;
  const finalizePreparedFailure = async (failureCode: string): Promise<boolean> => {
    const failedAt = Date.now();
    let failedRun: IronRentcarSyncRun | null = null;
    const transitioned = await db.ref(`v4/inventory_sync_runs/ironrentcar/${runId}`).transaction((current) => {
      failedRun = null;
      const existing = current && typeof current === 'object' ? current as IronRentcarSyncRun : null;
      if (existing?.state === 'apply_failed' && existing.apply_audit_id === applyAuditId) {
        failedRun = existing;
        return;
      }
      const next = failPreparedIronRentcarRun(current, failedAt, failureCode);
      if (!next) return;
      failedRun = next;
      return next;
    }, undefined, false);
    if (!failedRun) return false;
    const failureAuditId = `${applyAuditId}-failed`;
    const failure = failedRun as IronRentcarSyncRun;
    await db.ref(`v4/audit_logs/${failureAuditId}`).set({
      _key: failureAuditId,
      entity: 'ironrentcar_sync',
      action: 'apply_failed',
      at: failure.failed_at || failedAt,
      actor_uid: failure.actor_uid,
      run_id: failure.run_id,
      revision: failure.revision,
      before_digest: failure.before_digest,
      after_digest: failure.after_digest,
      counts: failure.counts,
      failure_code: failure.failure_code,
    });
    return transitioned.committed || failure.state === 'apply_failed';
  };
  try {
    const catalog = await fetchIronRentcarCatalog({ cacheMs: 0 });
    if (!catalog.complete || catalog.listings < 20 || catalog.active < 1) {
      return NextResponse.json({ error: 'incomplete supplier catalog' }, { status: 502, headers });
    }
    if (catalog.revision !== body.revision) {
      return NextResponse.json({ error: 'catalog revision changed', revision: catalog.revision }, { status: 409, headers });
    }
    const [v4Snapshot, partnerSnapshot, controlSnapshot, sheetLockSnapshot] = await Promise.all([
      db.ref('v4/products').get(),
      db.ref('v4/partners/RP006').get(),
      db.ref('v4/inventory_sync_control/ironrentcar').get(),
      db.ref('v4/system_locks/sheet_daily_sync').get(),
    ]);
    const sheetLock = sheetLockSnapshot.val() as { status?: string; expires_at?: number } | null;
    if (sheetLock?.status === 'running' && Number(sheetLock.expires_at || 0) > Date.now()) {
      return NextResponse.json({ error: 'sheet sync is running' }, { status: 409, headers });
    }

    const currentOverlay = v4Snapshot.val() as Record<string, unknown> | null;
    // 아이언 홈페이지와 ERP4 overlay만 비교한다. ERP3 재고는 이 연동의 입력이 아니다.
    const existing = mergeV3V4Records('product', null, currentOverlay);
    const plan = planIronRentcarReconcile({
      webItems: catalog.items,
      existing,
      sourceComplete: catalog.complete,
    });
    const counts = {
      patches: plan.patchCandidates.length,
      creates: plan.createCandidates.length,
      absentBlocks: plan.absentBlockCandidates.length,
    };
    const planKeys = ironRentcarPlanKeys(plan);
    if (plan.duplicatePlateGroups || plan.candidateOperations > MAX_OPERATIONS || !planKeys.valid
      || Number(body.expected.patches) !== counts.patches
      || Number(body.expected.creates) !== counts.creates
      || Number(body.expected.absentBlocks) !== counts.absentBlocks) {
      return NextResponse.json({ error: 'candidate plan changed', counts }, { status: 409, headers });
    }

    const preparedAt = Date.now();
    const preparedIso = new Date(preparedAt).toISOString();
    const calculated = applyIronRentcarPublicOverlay({
      currentOverlay,
      plan,
      now: preparedIso,
      runId,
      revision: catalog.revision,
    });
    if (!calculated.ok) {
      return NextResponse.json({ error: 'product precondition conflict' }, { status: 409, headers });
    }
    const productsBefore = snapshotsForKeys(currentOverlay, planKeys.keys);
    const productsAfter = snapshotsForKeys(calculated.overlay, planKeys.keys);
    if (Object.values(productsAfter).some((snapshot) => !snapshot.exists)) {
      return NextResponse.json({ error: 'calculated product snapshot missing' }, { status: 409, headers });
    }
    const partnerBefore = storedSnapshot(partnerSnapshot.val());
    const partnerAfterValue = {
      ...((partnerSnapshot.val() && typeof partnerSnapshot.val() === 'object') ? partnerSnapshot.val() : {}),
      _key: 'RP006',
      partner_code: 'RP006',
      inventory_source: 'ironrentcar_web',
      sheet_sync_disabled_reason: 'ironrentcar_web_authority',
      sheet_sync_disabled_at: preparedAt,
      ironrentcar_source_switch_revision: catalog.revision,
      ironrentcar_sync_run_id: runId,
      ironrentcar_sync_revision: catalog.revision,
      ironrentcar_synced_at: preparedIso,
      updatedAt: preparedIso,
    };
    const partnerAfter = storedSnapshot(partnerAfterValue);
    const controlBefore = storedSnapshot(controlSnapshot.val());
    const controlAfter = storedSnapshot({
      ...((controlSnapshot.val() && typeof controlSnapshot.val() === 'object') ? controlSnapshot.val() : {}),
      latest_applied_run_id: runId,
      latest_applied_revision: catalog.revision,
      latest_applied_at: preparedAt,
      state: 'applied',
    });
    const beforeDigest = syncStateDigest({ products: productsBefore, partner: partnerBefore, control: controlBefore });
    const afterDigest = syncStateDigest({ products: productsAfter, partner: partnerAfter, control: controlAfter });
    preparedRun = {
      run_id: runId,
      provider_code: 'RP006',
      revision: catalog.revision,
      counts,
      actor_uid: admin.uid,
      apply_audit_id: applyAuditId,
      state: 'prepared',
      affected_keys: planKeys.keys,
      products_before: productsBefore,
      products_after: productsAfter,
      partner_before: partnerBefore,
      partner_after: partnerAfter,
      control_before: controlBefore,
      control_after: controlAfter,
      before_digest: beforeDigest,
      after_digest: afterDigest,
      prepared_at: preparedAt,
    };
    await db.ref('v4').update({
      [`inventory_sync_runs/ironrentcar/${runId}`]: preparedRun,
      [`audit_logs/${applyAuditId}`]: {
        _key: applyAuditId,
        entity: 'ironrentcar_sync',
        action: 'apply_prepared',
        at: preparedAt,
        actor_uid: admin.uid,
        run_id: runId,
        revision: catalog.revision,
        before_digest: beforeDigest,
        after_digest: afterDigest,
        counts,
      },
    });

    let conflict = 'apply conflict';
    const committed = await db.ref('v4').transaction((raw) => {
      const root: V4Root = raw && typeof raw === 'object' ? { ...raw as V4Root } : {};
      const run = root.inventory_sync_runs?.ironrentcar?.[runId] as IronRentcarSyncRun | undefined;
      if (!run || run.state !== 'prepared' || run.after_digest !== afterDigest) {
        conflict = 'prepared run changed';
        return;
      }
      const currentProducts = root.products || {};
      if (!affectedProductsMatch(currentProducts, productsBefore)) {
        conflict = 'affected products changed';
        return;
      }
      if (!snapshotMatches(root.partners?.RP006, partnerBefore)) {
        conflict = 'partner changed';
        return;
      }
      if (!snapshotMatches(root.inventory_sync_control?.ironrentcar, controlBefore)) {
        conflict = 'sync control changed';
        return;
      }
      const replaced = replaceAffectedProducts(currentProducts, productsBefore, productsAfter);
      if (!replaced.ok) {
        conflict = 'affected products changed';
        return;
      }
      root.products = replaced.products;
      root.partners = { ...(root.partners || {}), RP006: partnerAfter.value };
      root.inventory_sync_control = {
        ...(root.inventory_sync_control || {}),
        ironrentcar: controlAfter.value,
      };
      root.inventory_sync_runs = { ...(root.inventory_sync_runs || {}) };
      root.inventory_sync_runs.ironrentcar = { ...(root.inventory_sync_runs.ironrentcar || {}) };
      root.inventory_sync_runs.ironrentcar[runId] = {
        ...run,
        state: 'applied',
        applied_at: preparedAt,
        apply_completed_audit_id: completedAuditId,
      };
      root.audit_logs = { ...(root.audit_logs || {}) };
      root.audit_logs[completedAuditId] = {
        _key: completedAuditId,
        entity: 'ironrentcar_sync',
        action: 'apply_completed',
        at: preparedAt,
        actor_uid: admin.uid,
        run_id: runId,
        revision: catalog.revision,
        before_digest: beforeDigest,
        after_digest: afterDigest,
        counts,
      };
      if (!ironRentcarRootWriteAllowed(root)) {
        conflict = 'proposed root rejected';
        return;
      }
      return root;
    }, undefined, false);
    if (!committed.committed) {
      await finalizePreparedFailure('apply_conflict');
      return NextResponse.json({ error: conflict, runId }, { status: 409, headers });
    }
    return NextResponse.json({
      applied: true,
      runId,
      revision: catalog.revision,
      afterDigest,
      appliedAt: preparedAt,
      ...counts,
    }, { headers });
  } catch {
    if (preparedRun) await finalizePreparedFailure('apply_exception').catch(() => false);
    return NextResponse.json({ error: 'ironrentcar sync failed' }, { status: 503, headers });
  } finally {
    await lockRef.transaction((current) => (
      (current as { owner?: string } | null)?.owner === owner ? null : current
    ), undefined, false).catch(() => undefined);
  }
}
