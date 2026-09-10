import { createSourceSnapshotV1, sha256Utf8 } from '../lib/server/source-snapshot';

let pass = 0;
const check = (name: string, actual: unknown, expected: unknown): void => {
  if (actual !== expected) throw new Error(`${name}: expected=${String(expected)} actual=${String(actual)}`);
  pass++;
};

const base = {
  providerCode: 'RP006',
  sourceKind: 'ironrentcar_vehicle_detail_html',
  sourceExternalId: 'vehicle-1',
  sourceUrl: 'https://ironrentcar.com/vehicles/vehicle-1',
  observedAt: '2026-09-09T00:00:00.000Z',
  rawPayload: '<html>\r\n  원문  \n</html>',
  inventoryKey: 'RP006_12가3456',
  carNumber: '12가3456',
  context: { sold_on_listing: true, condition: 'used' },
} as const;
const first = createSourceSnapshotV1(base);
const repeated = createSourceSnapshotV1({ ...base, observedAt: '2026-09-10T00:00:00.000Z' });
const changed = createSourceSnapshotV1({ ...base, rawPayload: `${base.rawPayload} ` });
const unresolved = createSourceSnapshotV1({ ...base, inventoryKey: '', carNumber: '' });

check('원문 SHA-256은 정확한 UTF-8 본문 기준', first.raw_payload_sha256, sha256Utf8(base.rawPayload));
check('관측시각이 달라도 같은 원문 revision', repeated.source_revision, first.source_revision);
check('관측시각이 달라도 같은 snapshot ID', repeated.snapshot_id, first.snapshot_id);
check('공백 한 글자 변경도 새 revision', changed.source_revision === first.source_revision, false);
check('차번 확보 원문은 재고 등록', first.inventory_registration, 'registered');
check('차번 미확보 원문은 식별 대기', unresolved.inventory_registration, 'pending_identity');

console.log(`source snapshot: ${pass}/${pass} PASS`);
