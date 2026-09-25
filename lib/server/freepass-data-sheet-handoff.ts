import { createHash } from 'node:crypto';
import { inventoryCountSnapshot } from '../domain/inventory-contract';
import {
  SALES_PUBLISH_SNAPSHOT_VERSION,
  hashSalesPublishSnapshotPayload,
  type SalesPublishSnapshot
} from './sales-publish-snapshot';

export type FreePassDataApprovedRelease = NonNullable<SalesPublishSnapshot['approvedRelease']>;
export type FreePassSheetConsumerId = 'google-sheets-f01' | 'google-sheets-f86';
export type FreePassSheetWorkbook = 'F01' | 'F86';

export type FreePassDataSheetHandoff = {
  contractVersion: 'freepass-sheet-handoff-v1';
  consumerId: FreePassSheetConsumerId;
  workbook: FreePassSheetWorkbook;
  generatedAt: string;
  releaseAuthority: 'LEGACY_VERIFIED_BRIDGE' | 'CANONICAL_ACTIVE';
  approvedRelease: FreePassDataApprovedRelease;
  snapshot: {
    version: typeof SALES_PUBLISH_SNAPSHOT_VERSION;
    snapshotId: string;
    capturedAt: string;
    products: Record<string, unknown>[];
    policies: Record<string, unknown>[];
    partners: Record<string, unknown>[];
    inventory: SalesPublishSnapshot['inventory'];
  };
  handoffHash: string;
};

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stable(child)])
    );
  }
  return value;
};

export const hashFreePassDataSheetPayload = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

export const hashFreePassDataSheetHandoff = (
  value: Omit<FreePassDataSheetHandoff, 'handoffHash'>
) => hashFreePassDataSheetPayload(value);

const expectedConsumer = (workbook: FreePassSheetWorkbook): FreePassSheetConsumerId =>
  workbook === 'F01' ? 'google-sheets-f01' : 'google-sheets-f86';

const nonEmpty = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0;

export function materializeFreePassDataSalesSnapshot(
  handoff: FreePassDataSheetHandoff
): SalesPublishSnapshot {
  if (handoff.contractVersion !== 'freepass-sheet-handoff-v1') {
    throw new Error('HOLD: unsupported FreePass Data sheet handoff contract');
  }
  if (handoff.consumerId !== expectedConsumer(handoff.workbook)) {
    throw new Error('HOLD: FreePass Data sheet consumer/workbook mismatch');
  }
  if (!['LEGACY_VERIFIED_BRIDGE', 'CANONICAL_ACTIVE'].includes(handoff.releaseAuthority)) {
    throw new Error('HOLD: invalid FreePass Data release authority');
  }
  if (!Number.isFinite(Date.parse(handoff.generatedAt))) {
    throw new Error('HOLD: invalid FreePass Data handoff generatedAt');
  }

  const releaseKeys = [
    'projectionId',
    'releaseId',
    'manifestId',
    'inputDigest',
    'dataDigest',
    'observedAt'
  ] as const;
  if (
    releaseKeys.some((key) => !nonEmpty(handoff.approvedRelease?.[key])) ||
    !Number.isFinite(Date.parse(handoff.approvedRelease.observedAt))
  ) {
    throw new Error('HOLD: incomplete approved FreePass Data release evidence');
  }

  if (
    handoff.snapshot.version !== SALES_PUBLISH_SNAPSHOT_VERSION ||
    !nonEmpty(handoff.snapshot.snapshotId) ||
    !Number.isFinite(Date.parse(handoff.snapshot.capturedAt)) ||
    !Array.isArray(handoff.snapshot.products) ||
    !Array.isArray(handoff.snapshot.policies) ||
    !Array.isArray(handoff.snapshot.partners)
  ) {
    throw new Error('HOLD: incomplete FreePass Data sheet snapshot');
  }

  const { handoffHash, ...unsignedHandoff } = handoff;
  if (hashFreePassDataSheetHandoff(unsignedHandoff) !== handoffHash) {
    throw new Error('HOLD: FreePass Data sheet handoff hash mismatch');
  }

  const actualInventory = inventoryCountSnapshot(handoff.snapshot.products);
  if (JSON.stringify(actualInventory) !== JSON.stringify(handoff.snapshot.inventory)) {
    throw new Error('HOLD: FreePass Data sheet handoff inventory mismatch');
  }
  const actualDataDigest = hashFreePassDataSheetPayload({
    products: handoff.snapshot.products,
    policies: handoff.snapshot.policies,
    partners: handoff.snapshot.partners,
    inventory: handoff.snapshot.inventory
  });
  if (actualDataDigest !== handoff.approvedRelease.dataDigest) {
    throw new Error('HOLD: FreePass Data sheet snapshot data digest mismatch');
  }

  const unsigned: Omit<SalesPublishSnapshot, 'payloadHash'> = {
    version: handoff.snapshot.version,
    snapshotId: handoff.snapshot.snapshotId,
    capturedAt: handoff.snapshot.capturedAt,
    source: 'freepass-data',
    releaseAuthority: handoff.releaseAuthority,
    approvedRelease: { ...handoff.approvedRelease },
    products: structuredClone(handoff.snapshot.products),
    policies: structuredClone(handoff.snapshot.policies),
    partners: structuredClone(handoff.snapshot.partners),
    inventory: structuredClone(handoff.snapshot.inventory)
  };

  return {
    ...unsigned,
    payloadHash: hashSalesPublishSnapshotPayload(unsigned)
  };
}
