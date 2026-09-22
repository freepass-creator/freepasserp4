export const CORE_SNAPSHOT_CONTRACT = 'core-snapshot/v1';
export const ERP5_PRODUCTION_ENGINE_REVISION = '05f43fb14aabfc48f18092b4481dd31b0e71e3f7';

export type SalesPublishSnapshotLike = {
  version: number;
  snapshotId: string;
  capturedAt: string;
  source: string;
  payloadHash: string;
  products: unknown[];
  policies: unknown[];
  partners: unknown[];
  inventory: unknown;
};

export function toCoreSalesPublishSnapshot(snapshot: SalesPublishSnapshotLike) {
  if (!snapshot || snapshot.version !== 1) throw new Error('CORE_SHADOW_SNAPSHOT_VERSION_INVALID');
  if (snapshot.source !== 'firestore') throw new Error('CORE_SHADOW_SNAPSHOT_SOURCE_INVALID');
  if (!snapshot.snapshotId || !snapshot.capturedAt) throw new Error('CORE_SHADOW_SNAPSHOT_IDENTITY_REQUIRED');
  if (!/^[0-9a-f]{64}$/i.test(snapshot.payloadHash || '')) throw new Error('CORE_SHADOW_SNAPSHOT_HASH_INVALID');

  return Object.freeze({
    schema_version: CORE_SNAPSHOT_CONTRACT,
    snapshot_id: snapshot.snapshotId,
    subject_type: 'freepass.erp5.sales-publish',
    subject_id: 'erp5-sales-publish',
    subject_revision: `sha256:${snapshot.payloadHash.toLowerCase()}`,
    source_revision: `git:${ERP5_PRODUCTION_ENGINE_REVISION}`,
    created_at: snapshot.capturedAt,
    payload: snapshot,
    payload_digest: `sha256:${snapshot.payloadHash.toLowerCase()}`,
  });
}
