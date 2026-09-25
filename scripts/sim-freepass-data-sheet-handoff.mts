import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inventoryCountSnapshot } from '../lib/domain/inventory-contract';
import {
  hashFreePassDataSheetHandoff,
  hashFreePassDataSheetPayload,
  materializeFreePassDataSalesSnapshot,
  type FreePassDataSheetHandoff
} from '../lib/server/freepass-data-sheet-handoff';
import { readSalesPublishSnapshot } from '../lib/server/sales-publish-snapshot';

const product = {
  _key: 'TEST-1',
  car_number: '12가3456',
  vehicle_status: '즉시출고',
  listable: true,
  status_kind: '가용',
  provider_company_code: 'RP999',
  source: 'test-source'
};

const snapshot = {
  version: 1 as const,
  snapshotId: 'snapshot-test',
  capturedAt: '2026-09-25T07:01:00.000Z',
  products: [product],
  policies: [],
  partners: [],
  inventory: inventoryCountSnapshot([product])
};

const approvedRelease = {
  projectionId: 'sheet-publication-bridge',
  releaseId: 'rel_test',
  manifestId: 'manifest_test',
  inputDigest: 'input_test',
  dataDigest: hashFreePassDataSheetPayload({
    products: snapshot.products,
    policies: snapshot.policies,
    partners: snapshot.partners,
    inventory: snapshot.inventory
  }),
  observedAt: '2026-09-25T07:00:00.000Z'
};

const unsigned: Omit<FreePassDataSheetHandoff, 'handoffHash'> = {
  contractVersion: 'freepass-sheet-handoff-v1',
  consumerId: 'google-sheets-f01',
  workbook: 'F01',
  generatedAt: '2026-09-25T07:02:00.000Z',
  releaseAuthority: 'LEGACY_VERIFIED_BRIDGE',
  approvedRelease,
  snapshot
};

const handoff: FreePassDataSheetHandoff = {
  ...unsigned,
  handoffHash: hashFreePassDataSheetHandoff(unsigned)
};

const materialized = materializeFreePassDataSalesSnapshot(handoff);
assert.equal(materialized.source, 'freepass-data');
assert.equal(materialized.releaseAuthority, 'LEGACY_VERIFIED_BRIDGE');
assert.deepEqual(materialized.approvedRelease, approvedRelease);
assert.equal(materialized.inventory.registered, 1);
assert.ok(materialized.payloadHash);

assert.throws(
  () => materializeFreePassDataSalesSnapshot({ ...handoff, handoffHash: 'tampered' }),
  /handoff hash mismatch/
);

const crossedUnsigned = {
  ...unsigned,
  consumerId: 'google-sheets-f86' as const
};
assert.throws(
  () => materializeFreePassDataSalesSnapshot({
    ...crossedUnsigned,
    handoffHash: hashFreePassDataSheetHandoff(crossedUnsigned)
  }),
  /consumer\/workbook mismatch/
);

const badInventoryUnsigned = {
  ...unsigned,
  snapshot: {
    ...snapshot,
    inventory: { ...snapshot.inventory, registered: 999 }
  }
};
assert.throws(
  () => materializeFreePassDataSalesSnapshot({
    ...badInventoryUnsigned,
    handoffHash: hashFreePassDataSheetHandoff(badInventoryUnsigned)
  }),
  /inventory mismatch/
);

const dir = await mkdtemp(path.join(tmpdir(), 'freepass-data-handoff-'));
try {
  const file = path.join(dir, 'snapshot.json');
  await writeFile(file, JSON.stringify(materialized));
  const readback = readSalesPublishSnapshot(file, { maxAgeMs: Number.MAX_SAFE_INTEGER });
  assert.equal(readback.source, 'freepass-data');
  assert.equal(readback.approvedRelease?.releaseId, approvedRelease.releaseId);

  const missingRelease = { ...materialized } as Record<string, unknown>;
  delete missingRelease.approvedRelease;
  const { payloadHash: _oldHash, ...missingUnsigned } = missingRelease as any;
  const { hashSalesPublishSnapshotPayload } = await import('../lib/server/sales-publish-snapshot');
  const broken = {
    ...missingUnsigned,
    payloadHash: hashSalesPublishSnapshotPayload(missingUnsigned)
  };
  await writeFile(file, JSON.stringify(broken));
  assert.throws(
    () => readSalesPublishSnapshot(file, { maxAgeMs: Number.MAX_SAFE_INTEGER }),
    /승인 release 증거 누락/
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log('PASS freepass-data sheet handoff: 6/6');
