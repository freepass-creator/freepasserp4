import assert from 'node:assert/strict';
import {
  buildProductVehiclePartialResolution,
  canonicalProductVehicleDrive,
} from '../lib/domain/product-vehicle-partial-resolution';

assert.equal(canonicalProductVehicleDrive('전륜'), 'FWD');
assert.equal(canonicalProductVehicleDrive('후륜'), 'RWD');
assert.equal(canonicalProductVehicleDrive('quattro'), 'AWD');
assert.equal(canonicalProductVehicleDrive('콰트로'), 'AWD');

const source = {
  maker: '기아', model: 'K8', subModel: 'K8 GL3', trim: '', fuel: '가솔린',
  engineCc: 2497, drive: '2WD', seats: null,
};
const k8 = ['노블레스 라이트', '노블레스', '시그니처', '시그니처 스페셜'].map((trim) => ({
  subModel: 'K8 GL3', trim, fuel: '가솔린', engineCc: 2497, drive: '2WD', seats: 5,
}));
const partial = buildProductVehiclePartialResolution(source, k8);
assert.equal(partial.basis, 'review_consensus');
assert.equal(partial.confirmed.subModel, 'K8 GL3');
assert.equal(partial.confirmed.seats, 5);
assert.equal(partial.confirmed.trim, '');
assert.deepEqual(partial.unresolvedAxes, ['세부트림']);
assert.match(partial.display, /K8 GL3.*가솔린.*2,497cc.*2WD.*5인승.*세부트림 미확정\(4종\)/);

const ray = buildProductVehiclePartialResolution({
  maker: '기아', model: '레이', subModel: '더 뉴 레이', trim: '', fuel: '가솔린',
  engineCc: 998, drive: '', seats: null,
}, [
  { subModel: '더 뉴 기아 레이 TAM', trim: '프레스티지', fuel: '가솔린', engineCc: 998, drive: '2WD', seats: 5 },
  { subModel: '더 뉴 기아 레이 TAM', trim: '시그니처', fuel: '가솔린', engineCc: 998, drive: '2WD', seats: 5 },
  { subModel: '더 뉴 기아 레이 TAM', trim: '프레스티지 스페셜', fuel: '가솔린', engineCc: 998, drive: '2WD', seats: 2 },
]);
assert.match(ray.display, /더 뉴 기아 레이 TAM.*구동.*2WD|더 뉴 기아 레이 TAM.*2WD/);
assert.match(ray.display, /인승 미확정\(2인승\/5인승\)/);
assert.deepEqual(ray.unresolvedAxes, ['인승', '세부트림']);

const blocked = buildProductVehiclePartialResolution({
  maker: '쉐보레', model: '스파크', subModel: '스파크 M300', trim: 'LT', fuel: '가솔린',
  engineCc: 1000, drive: '', seats: null,
}, [], {
  blockedCandidates: [{
    subModel: '스파크 M300', trim: 'LT', fuel: '가솔린', engineCc: 999, drive: '', seats: 5,
    trimRowKey: 'mf-003.md-043.sm-m300::v01::t06', usageTier: 'blocked',
  }],
});
assert.equal(blocked.statusLabel, '정본 단일 후보 · 운영 차단');
assert.equal(blocked.trimRowKey, 'mf-003.md-043.sm-m300::v01::t06');
assert.match(blocked.display, /스파크 M300.*999cc.*5인승.*LT/);

const blockedPair = buildProductVehiclePartialResolution({
  maker: '기아', model: '카니발', subModel: '뉴카니발 VQ', trim: '', fuel: '디젤',
  engineCc: 2900, drive: '', seats: null,
}, [], { blockedCandidates: [
  { subModel: '뉴카니발 VQ', trim: '기본형', fuel: '디젤', engineCc: 2902, drive: '', seats: null, usageTier: 'blocked' },
  { subModel: '뉴카니발 VQ', trim: '최고급형', fuel: '디젤', engineCc: 2902, drive: '', seats: null, usageTier: 'blocked' },
] });
assert.equal(blockedPair.basis, 'blocked_master_candidates');
assert.equal(blockedPair.statusLabel, '정본 후보 2개 · 모두 운영 차단');
assert.match(blockedPair.display, /뉴카니발 VQ.*2,902cc.*세부트림 미확정\(2종\)/);

const incompleteSingle = buildProductVehiclePartialResolution({
  maker: '테스트', model: '단일후보', subModel: '', trim: '', fuel: '', engineCc: null, drive: '', seats: null,
}, [{ subModel: '세부모델 A', trim: '트림 A', fuel: '가솔린', engineCc: 1998, drive: 'FWD', seats: null }]);
assert.deepEqual(incompleteSingle.unresolvedAxes, ['인승']);
assert.match(incompleteSingle.statusLabel, /부분 특정.*인승/);
assert.match(incompleteSingle.display, /인승 미확정/);

const conflictingFuel = buildProductVehiclePartialResolution({
  maker: '테스트', model: '충돌차', subModel: '', trim: '', fuel: '하이브리드', engineCc: 1600, drive: 'AWD', seats: null,
}, [{ subModel: '충돌차 A', trim: '기본형', fuel: '가솔린', engineCc: 1998, drive: 'FWD', seats: 5 }], {
  conflictAxes: ['fuel', 'engine_cc', 'drive'],
});
assert.equal(conflictingFuel.confirmed.subModel, '충돌차 A');
assert.equal(conflictingFuel.confirmed.fuel, '');
assert.equal(conflictingFuel.confirmed.engineCc, null);
assert.equal(conflictingFuel.confirmed.drive, '');
assert.deepEqual(conflictingFuel.conflictAxes, ['fuel', 'engine_cc', 'drive']);
assert.match(conflictingFuel.display, /연료 충돌\(입력:하이브리드; 정본후보:가솔린\)/);
assert.match(conflictingFuel.statusLabel, /연료·배기량·구동 정본충돌/);

const ev = buildProductVehiclePartialResolution({
  maker: '테슬라', model: '모델 3', subModel: '', trim: '', fuel: '전기', engineCc: null, drive: '', seats: null,
}, [{ subModel: '모델 3 FL', trim: 'Long Range', fuel: '전기', engineCc: null, drive: 'AWD', seats: 5 }]);
assert.deepEqual(ev.notApplicableAxes, ['engine_cc']);
assert.deepEqual(ev.unresolvedAxes, []);
assert.equal(ev.statusLabel, '계층 단일 특정');

const sourceOnly = buildProductVehiclePartialResolution({
  maker: '르노코리아', model: 'SM7', subModel: 'SM7', trim: 'LE', fuel: '가솔린',
  engineCc: 2300, drive: '', seats: 5,
}, []);
assert.equal(sourceOnly.statusLabel, '입력축만 확인 · 정본 계보 미연결');
assert.match(sourceOnly.display, /SM7\(입력\).*2,300cc\(입력\).*5인승\(입력\).*세부트림 미확정\(입력:LE\)/);

console.log('PASS product vehicle partial resolution — shared axes kept, only divergent axes unresolved');
