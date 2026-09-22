import assert from 'node:assert/strict';
import { compareSupplementaryInventoryReference } from '../lib/domain/supplementary-inventory-reference';

const keys = (count: number, from = 0) => Array.from({ length: count }, (_, index) => `차량-${from + index}`);

const differentIdentities = compareSupplementaryInventoryReference(keys(240), keys(217, 1000));
assert.equal(differentIdentities.status, 'OBSERVED');
assert.equal(differentIdentities.referenceCount, 240);
assert.equal(differentIdentities.canonicalCount, 217);
assert.equal(differentIdentities.sharedCount, 0);

const emptyReference = compareSupplementaryInventoryReference([], keys(57));
assert.equal(emptyReference.status, 'OBSERVED');
assert.equal(emptyReference.referenceCount, 0);

const duplicateReference = compareSupplementaryInventoryReference(['12가3456', '12가 3456'], ['12가3456']);
assert.equal(duplicateReference.status, 'OBSERVED');
assert.equal(duplicateReference.duplicateReferenceKeys, 1);

console.log('✓ 보완 시트는 차이·빈값·중복을 관측 증거로 남기고 새 원천 발행을 막지 않는다');
