import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyAdminBearer } from '@/lib/server/firebase-admin';
import {
  affectedProductsHaveContractLock,
  affectedProductsMatch,
  ironRentcarRootWriteAllowed,
  replaceAffectedProducts,
  rollbackRequestMatches,
  snapshotMatches,
  restoreStoredSnapshot,
  type IronRentcarSyncRun,
} from '@/lib/domain/ironrentcar-rollback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONFIRMATION = '아이언 홈페이지 연동 롤백';
const LOCK_MS = 120_000;
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };

type RollbackBody = {
  confirmation?: string;
  runId?: string;
  expectedRevision?: string;
  expectedAfterDigest?: string;
  reason?: string;
};

type V4Root = Record<string, any>;

function controlMatchesRun(control: unknown, run: IronRentcarSyncRun): boolean {
  const value = control && typeof control === 'object' ? control as Record<string, unknown> : {};
  return String(value.latest_applied_run_id || '') === run.run_id
    && String(value.latest_applied_revision || '') === run.revision
    && snapshotMatches(control, run.control_after);
}

function rollbackAudit(input: {
  id: string;
  action: string;
  at: number;
  actorUid: string;
  run: IronRentcarSyncRun;
  reason: string;
}) {
  return {
    _key: input.id,
    entity: 'ironrentcar_sync',
    action: input.action,
    at: input.at,
    actor_uid: input.actorUid,
    run_id: input.run.run_id,
    revision: input.run.revision,
    before_digest: input.run.before_digest,
    after_digest: input.run.after_digest,
    reason: input.reason,
  };
}

export async function GET(request: Request): Promise<Response> {
  let admin: { uid: string } | null;
  try {
    admin = await verifyAdminBearer(request);
  } catch {
    return NextResponse.json({ error: 'server auth unavailable' }, { status: 503, headers });
  }
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers });

  try {
    const db = firebaseAdminDatabase();
    const controlSnapshot = await db.ref('v4/inventory_sync_control/ironrentcar').get();
    const control = controlSnapshot.val() as Record<string, unknown> | null;
    const latestRunId = String(control?.latest_applied_run_id || '').trim();
    if (!latestRunId) return NextResponse.json({ available: false }, { headers });
    const runSnapshot = await db.ref(`v4/inventory_sync_runs/ironrentcar/${latestRunId}`).get();
    const run = runSnapshot.val() as IronRentcarSyncRun | null;
    const available = !!run
      && ['applied', 'rollback_products_restored'].includes(run.state)
      && controlMatchesRun(control, run);
    if (!run || !available) {
      return NextResponse.json({ available: false, state: run?.state }, { headers });
    }
    return NextResponse.json({
      available: true,
      state: run.state,
      runId: run.run_id,
      revision: run.revision,
      afterDigest: run.after_digest,
      appliedAt: run.applied_at || run.prepared_at,
      counts: run.counts,
    }, { headers });
  } catch {
    return NextResponse.json({ error: 'rollback state unavailable' }, { status: 503, headers });
  }
}

export async function POST(request: Request): Promise<Response> {
  let admin: { uid: string } | null;
  try {
    admin = await verifyAdminBearer(request);
  } catch {
    return NextResponse.json({ error: 'server auth unavailable' }, { status: 503, headers });
  }
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers });

  let body: RollbackBody;
  try {
    body = await request.json() as RollbackBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400, headers });
  }
  const runId = String(body.runId || '').trim();
  const expectedRevision = String(body.expectedRevision || '').trim();
  const expectedAfterDigest = String(body.expectedAfterDigest || '').trim();
  const reason = String(body.reason || '').trim();
  if (body.confirmation !== CONFIRMATION
    || !/^iron-\d+-[0-9a-f-]{36}$/i.test(runId)
    || !expectedRevision || expectedRevision.length > 500
    || !/^[0-9a-f]{64}$/i.test(expectedAfterDigest)
    || reason.length < 2 || reason.length > 500) {
    return NextResponse.json({ error: 'explicit rollback confirmation required' }, { status: 400, headers });
  }

  const db = firebaseAdminDatabase();
  let snapshots;
  try {
    snapshots = await Promise.all([
      db.ref(`v4/inventory_sync_runs/ironrentcar/${runId}`).get(),
      db.ref('v4/inventory_sync_control/ironrentcar').get(),
      db.ref('v4/products').get(),
      db.ref('v4/partners/RP006').get(),
    ]);
  } catch {
    return NextResponse.json({ error: 'rollback state unavailable' }, { status: 503, headers });
  }
  const [runSnapshot, controlSnapshot, productsSnapshot, partnerSnapshot] = snapshots;
  const run = runSnapshot.val() as IronRentcarSyncRun | null;
  if (!run || !['applied', 'rollback_products_restored'].includes(run.state)
    || !rollbackRequestMatches({ run, expectedRevision, expectedAfterDigest })
    || !controlMatchesRun(controlSnapshot.val(), run)
    || (run.state === 'rollback_products_restored' && run.rollback_reason !== reason)) {
    return NextResponse.json({ error: 'rollback precondition conflict' }, { status: 409, headers });
  }
  const preflightProducts = productsSnapshot.val();
  const productExpected = run.state === 'applied' ? run.products_after : run.products_before;
  if (!affectedProductsMatch(preflightProducts, productExpected)
    || (run.state === 'applied' && affectedProductsHaveContractLock(preflightProducts, run.affected_keys))
    || !snapshotMatches(partnerSnapshot.val(), run.partner_after)) {
    return NextResponse.json({ error: 'rollback target changed' }, { status: 409, headers });
  }

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

  try {
    const stageAt = Date.now();
    const generatedRollbackAuditId = `AL-${stageAt}-ironrentcar-rollback-${randomUUID()}`;
    let stageConflict = 'rollback product conflict';
    const productStage = await db.ref('v4').transaction((raw) => {
      const root: V4Root = raw && typeof raw === 'object' ? { ...raw as V4Root } : {};
      const currentRun = root.inventory_sync_runs?.ironrentcar?.[runId] as IronRentcarSyncRun | undefined;
      if (!currentRun || !['applied', 'rollback_products_restored'].includes(currentRun.state)
        || !rollbackRequestMatches({ run: currentRun, expectedRevision, expectedAfterDigest })
        || !controlMatchesRun(root.inventory_sync_control?.ironrentcar, currentRun)) {
        stageConflict = 'rollback run changed';
        return;
      }
      if (!snapshotMatches(root.partners?.RP006, currentRun.partner_after)) {
        stageConflict = 'rollback partner changed';
        return;
      }
      if (currentRun.state === 'rollback_products_restored') {
        if (currentRun.rollback_reason !== reason
          || !affectedProductsMatch(root.products, currentRun.products_before)) {
          stageConflict = 'restored products changed';
          return;
        }
        if (!ironRentcarRootWriteAllowed(root)) {
          stageConflict = 'proposed root rejected';
          return;
        }
        return root;
      }
      if (!affectedProductsMatch(root.products, currentRun.products_after)
        || affectedProductsHaveContractLock(root.products, currentRun.affected_keys)) {
        stageConflict = 'rollback products changed or locked';
        return;
      }
      const restored = replaceAffectedProducts(root.products, currentRun.products_after, currentRun.products_before);
      if (!restored.ok) {
        stageConflict = 'rollback products changed';
        return;
      }
      const rollbackAuditId = currentRun.rollback_audit_id || generatedRollbackAuditId;
      root.products = restored.products;
      root.inventory_sync_runs = { ...(root.inventory_sync_runs || {}) };
      root.inventory_sync_runs.ironrentcar = { ...(root.inventory_sync_runs.ironrentcar || {}) };
      root.inventory_sync_runs.ironrentcar[runId] = {
        ...currentRun,
        state: 'rollback_products_restored',
        rollback_actor_uid: admin.uid,
        rollback_reason: reason,
        rollback_audit_id: rollbackAuditId,
        rollback_products_restored_at: stageAt,
      };
      root.audit_logs = { ...(root.audit_logs || {}) };
      const auditId = `${rollbackAuditId}-products-restored`;
      root.audit_logs[auditId] = rollbackAudit({
        id: auditId,
        action: 'rollback_products_restored',
        at: stageAt,
        actorUid: admin.uid,
        run: currentRun,
        reason,
      });
      if (!ironRentcarRootWriteAllowed(root)) {
        stageConflict = 'proposed root rejected';
        return;
      }
      return root;
    }, undefined, false);
    if (!productStage.committed) {
      return NextResponse.json({ error: stageConflict }, { status: 409, headers });
    }

    let finalConflict = 'rollback partner conflict';
    const completedAt = Date.now();
    const partnerStage = await db.ref('v4').transaction((raw) => {
      const root: V4Root = raw && typeof raw === 'object' ? { ...raw as V4Root } : {};
      const currentRun = root.inventory_sync_runs?.ironrentcar?.[runId] as IronRentcarSyncRun | undefined;
      if (!currentRun || currentRun.state !== 'rollback_products_restored'
        || !rollbackRequestMatches({ run: currentRun, expectedRevision, expectedAfterDigest })
        || !controlMatchesRun(root.inventory_sync_control?.ironrentcar, currentRun)) {
        finalConflict = 'rollback resume state changed';
        return;
      }
      if (!affectedProductsMatch(root.products, currentRun.products_before)) {
        finalConflict = 'restored products changed';
        return;
      }
      if (!snapshotMatches(root.partners?.RP006, currentRun.partner_after)) {
        finalConflict = 'rollback partner changed';
        return;
      }
      const rollbackAuditId = currentRun.rollback_audit_id;
      if (!rollbackAuditId || currentRun.rollback_reason !== reason) {
        finalConflict = 'rollback request changed';
        return;
      }
      root.partners = { ...(root.partners || {}) };
      const restoredPartner = restoreStoredSnapshot(currentRun.partner_before);
      if (restoredPartner === null) delete root.partners.RP006;
      else root.partners.RP006 = restoredPartner;
      root.inventory_sync_control = { ...(root.inventory_sync_control || {}) };
      const restoredControl = restoreStoredSnapshot(currentRun.control_before);
      if (restoredControl === null) delete root.inventory_sync_control.ironrentcar;
      else root.inventory_sync_control.ironrentcar = restoredControl;
      root.inventory_sync_runs = { ...(root.inventory_sync_runs || {}) };
      root.inventory_sync_runs.ironrentcar = { ...(root.inventory_sync_runs.ironrentcar || {}) };
      root.inventory_sync_runs.ironrentcar[runId] = {
        ...currentRun,
        state: 'rolled_back',
        rolled_back_at: completedAt,
      };
      root.audit_logs = { ...(root.audit_logs || {}) };
      const completedAuditId = `${rollbackAuditId}-completed`;
      root.audit_logs[completedAuditId] = rollbackAudit({
        id: completedAuditId,
        action: 'rollback_completed',
        at: completedAt,
        actorUid: admin.uid,
        run: currentRun,
        reason,
      });
      if (!ironRentcarRootWriteAllowed(root)) {
        finalConflict = 'proposed root rejected';
        return;
      }
      return root;
    }, undefined, false);
    if (!partnerStage.committed) {
      return NextResponse.json({
        error: finalConflict,
        state: 'rollback_products_restored',
        runId,
      }, { status: 409, headers });
    }
    return NextResponse.json({ rolledBack: true, runId, revision: run.revision }, { headers });
  } catch {
    return NextResponse.json({
      error: 'ironrentcar rollback failed',
      state: 'rollback_products_restored_or_applied',
      runId,
    }, { status: 503, headers });
  } finally {
    await lockRef.transaction((current) => (
      (current as { owner?: string } | null)?.owner === owner ? null : current
    ), undefined, false).catch(() => undefined);
  }
}
