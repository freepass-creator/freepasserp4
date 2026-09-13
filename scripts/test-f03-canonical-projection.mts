import assert from 'node:assert/strict';
import {
  driveConflicts,
  explicitDriveFromSource,
  normalizeF03CanonicalRow,
  resolveF03Projection,
  stripF03Parentheses,
} from '../lib/domain/f03-canonical-projection';

assert.equal(stripF03Parentheses('G80 (RG3)'), 'G80 RG3', '괄호 문자는 빼되 RG3 내용은 보존');

assert.deepEqual(
  normalizeF03CanonicalRow({ maker: '제네시스', model: 'GV70', subModel: 'GV70', trim: '기본형' }),
  { maker: '제네시스', model: 'GV70', subModel: '기본형', trim: '기본형' },
  '모델=세부모델이면 FreePass 세부모델은 기본형',
);

const genesis = [
  { maker: '제네시스', model: 'GV70', subModel: 'GV70', trim: '기본형' },
  { maker: '제네시스', model: 'GV70', subModel: '일렉트리파이드 GV70', trim: '기본형' },
  { maker: '제네시스', model: 'G70', subModel: 'G70', trim: '엘리트' },
  { maker: '제네시스', model: 'G70', subModel: '더 뉴 G70', trim: '기본형' },
  { maker: '제네시스', model: 'G70', subModel: '더 뉴 G70 슈팅브레이크', trim: '기본형' },
];

const gv70 = resolveF03Projection(genesis, {
  maker: '제네시스',
  sourceModel: 'GV70',
  refinedModel: 'GV70',
  refinedSubModel: 'GV70 (JK1)',
  rawName: 'GV70 가솔린 2.5 터보 AWD',
  rawFuel: '가솔린',
});
assert.equal(gv70.matched, true);
assert.equal(gv70.subModel, '기본형');
assert.equal(gv70.trim, '기본형');

const shooting = resolveF03Projection(genesis, {
  maker: '제네시스',
  sourceModel: 'G70',
  refinedModel: 'G70',
  rawName: 'G70 슈팅브레이크 가솔린 2.5 터보 AWD',
  rawFuel: '가솔린',
});
assert.equal(shooting.matched, true);
assert.equal(shooting.subModel, '더 뉴 G70 슈팅브레이크');
assert.equal(shooting.trim, '기본형');

const ambiguousG70 = resolveF03Projection(genesis, {
  maker: '제네시스', sourceModel: 'G70', refinedModel: 'G70', rawName: 'G70 가솔린 2.0', rawFuel: '가솔린',
});
assert.equal(ambiguousG70.matched, false, '세대 근거 없는 G70은 기본형으로 추측 확정하지 않는다');

assert.equal(explicitDriveFromSource('GV70 디젤 2.2 2WD'), '2WD');
assert.equal(explicitDriveFromSource('GV70 가솔린 2.5 터보 AWD'), 'AWD');
assert.equal(driveConflicts('2WD', 'AWD'), true, '원문 2WD를 AWD로 바꾸는 것은 금지');
assert.equal(driveConflicts('2WD', 'RWD'), false, '2WD만으로 전/후륜까지 추측하지 않는다');

console.log('✓ F03 canonical projection regressions passed');
