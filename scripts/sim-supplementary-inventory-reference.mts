import assert from 'node:assert/strict';
import { compareSupplementaryInventoryReference } from '../lib/domain/supplementary-inventory-reference';

const keys = (count: number, from = 0) => Array.from({ length: count }, (_, index) => `차량-${from + index}`);
const historic = compareSupplementaryInventoryReference(keys(240), keys(224));
assert.equal(historic.status, 'PASS', '손오공 과거 240↔224 수준은 보완참조 허용 범위다');
assert.equal(historic.tolerance, 24);
const materialGap = compareSupplementaryInventoryReference(keys(72), keys(54));
assert.equal(materialGap.status, 'HOLD');
assert.ok(materialGap.reasons.includes('COUNT_OUTSIDE_TOLERANCE'));
assert.equal(compareSupplementaryInventoryReference([], keys(10)).status, 'HOLD');
assert.equal(compareSupplementaryInventoryReference(['12가3456', '12가 3456'], ['12가3456']).status, 'HOLD');
const symmetric = compareSupplementaryInventoryReference([...keys(90), ...keys(10, 1000)], [...keys(90), ...keys(10, 2000)]);
assert.equal(symmetric.status, 'PASS');
console.log('✓ 보완참조 게이트: 10% 또는 5대, 빈 참조·중복·큰 양방향 차이 HOLD');
