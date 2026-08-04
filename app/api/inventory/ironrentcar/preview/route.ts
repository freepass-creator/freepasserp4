import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyAdminBearer } from '@/lib/server/firebase-admin';
import { fetchIronRentcarCatalog } from '@/lib/server/ironrentcar-source';
import { planIronRentcarReconcile } from '@/lib/domain/ironrentcar-reconcile';
import type { EntityRecord } from '@/lib/intake/entities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  let admin: { uid: string } | null;
  try {
    admin = await verifyAdminBearer(request);
  } catch {
    return NextResponse.json({ error: 'server auth unavailable' }, { status: 503 });
  }
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    const database = firebaseAdminDatabase();
    const [catalog, v3Snapshot, v4Snapshot] = await Promise.all([
      fetchIronRentcarCatalog(),
      database.ref('products').get(),
      database.ref('v4/products').get(),
    ]);
    const merged = new Map<string, EntityRecord>();
    for (const [key, value] of Object.entries<EntityRecord>((v3Snapshot.val() || {}) as Record<string, EntityRecord>)) {
      merged.set(key, { ...value, _key: key });
    }
    for (const [key, value] of Object.entries<EntityRecord>((v4Snapshot.val() || {}) as Record<string, EntityRecord>)) {
      merged.set(key, { ...(merged.get(key) || {}), ...value, _key: key });
    }
    const plan = planIronRentcarReconcile({
      webItems: catalog.items,
      existing: [...merged.values()],
      sourceComplete: catalog.complete,
    });
    return NextResponse.json({
      source: catalog.source,
      authority: plan.authority,
      providerCode: catalog.providerCode,
      fetchedAt: catalog.fetchedAt,
      revision: catalog.revision,
      complete: catalog.complete,
      catalog: {
        listings: catalog.listings,
        active: catalog.active,
        sold: catalog.sold,
        newCount: catalog.newCount,
        usedCount: catalog.usedCount,
        errors: catalog.errors,
      },
      reconciliation: {
        matched: plan.matched,
        patchCandidates: plan.patchCandidates.length,
        unchanged: plan.unchanged,
        createCandidates: plan.createCandidates.length,
        ignoredSoldNew: plan.ignoredSoldNew,
        webAbsentErp: plan.webAbsentErp,
        absentBlockCandidates: plan.absentBlockCandidates.length,
        protectedErpOnly: plan.protectedErpOnly,
        alreadyUnavailableErpOnly: plan.alreadyUnavailableErpOnly,
        duplicatePlateGroups: plan.duplicatePlateGroups,
        blocked: plan.blockedExternalIds.length,
        candidateOperations: plan.candidateOperations,
        executableOperations: plan.executableOperations,
      },
      candidates: {
        patches: plan.patchCandidates.map((candidate) => ({
          key: candidate.key,
          fields: Object.keys(candidate.patch).sort(),
          vehicleStatus: candidate.patch.vehicle_status,
        })),
        creates: plan.createCandidates.map((product) => ({
          key: String(product.product_code || product._key || ''),
          vehicleStatus: product.vehicle_status,
          sourceUrl: product.source_url,
        })),
        absentBlocks: plan.absentBlockCandidates.map((candidate) => ({
          key: candidate.key,
          fields: Object.keys(candidate.patch).sort(),
          vehicleStatus: candidate.patch.vehicle_status,
        })),
      },
    }, {
      status: catalog.complete ? 200 : 502,
      headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' },
    });
  } catch (error) {
    return NextResponse.json({ error: 'ironrentcar preview unavailable', detail: String((error as Error)?.message || error) }, {
      status: 502,
      headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' },
    });
  }
}
