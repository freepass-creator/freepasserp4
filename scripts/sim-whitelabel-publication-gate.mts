import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./verify-whitelabel-publication.mts', import.meta.url), 'utf8');

assert.match(source, /readSalesPublishSnapshot\(snapshotPath\)/);
assert.match(source, /collection\('products'\)\.get\(\)/);
assert.match(source, /collection\('policy'\)\.get\(\)/);
assert.match(source, /vehicle_status/);
assert.match(source, /price:/);
assert.match(source, /policy_code/);
assert.match(source, /photo_link/);
assert.match(source, /공개 차량 식별자 중복/);
assert.match(source, /공개 발행 대사 실패/);
assert.match(source, /--write-receipt/);
assert.doesNotMatch(source, /firebase\/database|getDatabase\(/);

console.log('PASS ERP5 snapshot-to-public-catalog gate contract');
