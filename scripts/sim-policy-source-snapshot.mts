import { strict as assert } from 'node:assert';
import { createPolicySourceSnapshot } from '../lib/server/policy-source-snapshot';

const grid = {
  spreadsheet_id: 'sheet-1', tab: '운영정책', sheet_id: 17, range: "'운영정책'!A1:BT200", read_at: '2026-09-14T00:00:00.000Z',
  rows: [[
    { user_entered: '자차최소면책금', effective: '자차최소면책금', formatted: '자차최소면책금' },
    { user_entered: 500000, effective: 500000, formatted: '50만원' },
  ]],
} as const;
const first = createPolicySourceSnapshot(['RP004'], grid);
const later = createPolicySourceSnapshot(['RP004'], { ...grid, read_at: '2026-09-15T00:00:00.000Z' });
assert.equal(first.snapshot_id, later.snapshot_id);
assert.equal(first.raw_payload_sha256, later.raw_payload_sha256);
assert.match(first.raw_payload, /"user_entered":500000/);
assert.match(first.raw_payload, /"formatted":"50만원"/);
assert.deepEqual(first.provider_codes, ['RP004']);
console.log('POLICY SOURCE SNAPSHOT 5/5 PASS');
