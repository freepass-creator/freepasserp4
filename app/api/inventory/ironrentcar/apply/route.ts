import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyAdminBearer } from '@/lib/server/firebase-admin';
import { fetchIronRentcarCatalog } from '@/lib/server/ironrentcar-source';
import { planIronRentcarReconcile } from '@/lib/domain/ironrentcar-reconcile';
import { applyIronRentcarPublicOverlay } from '@/lib/domain/ironrentcar-apply';
import { mergeV3V4Records } from '@/lib/firebase/rtdb-records';

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

  const auditId = `AL-${Date.now()}-ironrentcar-web-sync`;
  const partnerRef = db.ref('v4/partners/RP006');
  let previousPartnerOverlay: Record<string, unknown> | null = null;
  let partnerSwitched = false;
  let applyCompleted = false;
  let switchRevision = '';
  try {
    const catalog = await fetchIronRentcarCatalog({ cacheMs: 0 });
    if (!catalog.complete || catalog.listings < 20 || catalog.active < 1) {
      return NextResponse.json({ error: 'incomplete supplier catalog' }, { status: 502, headers });
    }
    if (catalog.revision !== body.revision) {
      return NextResponse.json({ error: 'catalog revision changed', revision: catalog.revision }, { status: 409, headers });
    }
    const [v3Snapshot, v4Snapshot] = await Promise.all([
      db.ref('products').get(),
      db.ref('v4/products').get(),
    ]);
    const existing = mergeV3V4Records('product', v3Snapshot.val(), v4Snapshot.val());
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
    if (plan.duplicatePlateGroups || plan.candidateOperations > MAX_OPERATIONS
      || Number(body.expected.patches) !== counts.patches
      || Number(body.expected.creates) !== counts.creates
      || Number(body.expected.absentBlocks) !== counts.absentBlocks) {
      return NextResponse.json({ error: 'candidate plan changed', counts }, { status: 409, headers });
    }

    const sheetLock = (await db.ref('v4/system_locks/sheet_daily_sync').get()).val() as {
      status?: string;
      expires_at?: number;
    } | null;
    if (sheetLock?.status === 'running' && Number(sheetLock.expires_at || 0) > Date.now()) {
      return NextResponse.json({ error: 'sheet sync is running' }, { status: 409, headers });
    }

    switchRevision = catalog.revision;
    const switched = await partnerRef.transaction((current) => {
      previousPartnerOverlay = current && typeof current === 'object'
        ? { ...(current as Record<string, unknown>) }
        : null;
      return {
        ...((current && typeof current === 'object') ? current as Record<string, unknown> : {}),
        _key: 'RP006',
        partner_code: 'RP006',
        inventory_source: 'ironrentcar_web',
        sheet_sync_disabled_reason: 'ironrentcar_web_authority',
        sheet_sync_disabled_at: Date.now(),
        ironrentcar_source_switch_revision: switchRevision,
        updatedAt: new Date().toISOString(),
      };
    }, undefined, false);
    if (!switched.committed) {
      return NextResponse.json({ error: 'supplier source switch conflict' }, { status: 409, headers });
    }
    partnerSwitched = true;

    await db.ref(`v4/audit_logs/${auditId}`).set({
      _key: auditId,
      entity: 'ironrentcar_sync',
      action: 'apply_started',
      actor_uid: admin.uid,
      actor_role: 'admin',
      at: Date.now(),
      source_revision: catalog.revision,
      counts,
      changes: [],
    });

    let transactionConflicts: string[] = [];
    const applied = await db.ref('v4/products').transaction((current) => {
      const result = applyIronRentcarPublicOverlay({
        currentOverlay: current,
        plan,
        now: new Date().toISOString(),
      });
      transactionConflicts = result.conflicts;
      return result.ok ? result.overlay : undefined;
    }, undefined, false);
    if (!applied.committed) {
      await db.ref(`v4/audit_logs/${auditId}`).update({
        action: 'apply_conflict',
        completed_at: Date.now(),
        conflict_count: transactionConflicts.length,
      });
      return NextResponse.json({ error: 'product CAS conflict', conflicts: transactionConflicts }, { status: 409, headers });
    }
    applyCompleted = true;
    let auditCompleted = true;
    try {
      await db.ref(`v4/audit_logs/${auditId}`).update({ action: 'apply_completed', completed_at: Date.now() });
    } catch {
      // 시작 감사는 이미 남아 있다. 공개상품 원자 transaction 성공 뒤 감사 완료표식 실패를
      // 전체 실패로 오보고하거나 공급사 source를 Sheet로 되돌리면 이중 writer가 된다.
      auditCompleted = false;
    }
    return NextResponse.json({ applied: true, auditCompleted, revision: catalog.revision, ...counts }, { headers });
  } catch {
    try {
      await db.ref(`v4/audit_logs/${auditId}`).update({ action: 'apply_failed', completed_at: Date.now() });
    } catch { /* 시작 감사 전 실패는 기록할 노드가 없을 수 있다. */ }
    return NextResponse.json({ error: 'ironrentcar sync failed' }, { status: 503, headers });
  } finally {
    if (partnerSwitched && !applyCompleted) {
      await partnerRef.transaction((current) => {
        const row = current && typeof current === 'object' ? current as Record<string, unknown> : null;
        if (!row || row.ironrentcar_source_switch_revision !== switchRevision) return current;
        return previousPartnerOverlay;
      }, undefined, false).catch(() => undefined);
    }
    await lockRef.transaction((current) => (
      (current as { owner?: string } | null)?.owner === owner ? null : current
    ), undefined, false).catch(() => undefined);
  }
}
