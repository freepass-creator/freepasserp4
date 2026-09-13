/** ERP5 차종마스터 병합·활성화 경계 회귀검사. 외부 접속/쓰기 없음. */
import assert from 'node:assert/strict';
import { buildVehicleMaster, parseVehicleMasterSheet, type EncarReferenceRow } from '../lib/domain/erp5-vehicle-master-ssot';

const headers = ['원산지', '제조사', '모델', '세부모델', '세부트림', '생산시작', '생산종료', '커서 엔카대조'];
const filler = Array.from({ length: 50 }, (_, index) => [
  '국산', '제네시스', `모델${index}`, `세부${index}`, '기본형', '2020-01', '현재', '맞음 · 확인',
]);
const parsed = parseVehicleMasterSheet([headers, ...filler]);
assert.equal(parsed.length, 50);

const sheetRows = [
  { ...parsed[0], maker: '제네시스', model: 'G80', subModel: 'G80 RG3', trim: '' },
  { ...parsed[1], maker: '기아', model: 'K5', subModel: 'K5 DL3', trim: '노블레스' },
  { ...parsed[2], maker: '제네시스', model: 'G80', subModel: 'G80 RG3', trim: '스포츠' },
  { ...parsed[3], maker: '제네시스', model: 'GV70', subModel: 'GV70', trim: '' },
];
const encarRows: EncarReferenceRow[] = [
  { id: 'encar-g80', manufacturer: '제네시스', model: 'G80', sub_model: 'G80 (RG3)', trim: '기본', fuel: '가솔린', displacement_l: 2.5 },
  { id: 'encar-k5', manufacturer: '기아', model: 'K5', sub_model: 'K5 3세대', gen_code: 'DL3', trim: '노블레스', fuel: '가솔린' },
  { id: 'encar-gv70', manufacturer: '제네시스', model: 'GV70', sub_model: 'GV70', trim: '기본', fuel: '가솔린' },
];
const built = buildVehicleMaster({ sheetRows, encarRows });
assert.equal(built.blockers.length, 0);
assert.equal(built.entries[0].trim, '기본형');
assert.equal(built.entries[0].evidence.googleSheet.trimDefaulted, true);
assert.equal(built.entries[0].evidence.encar.status, 'exact');
assert.equal(built.entries[1].evidence.encar.status, 'exact');
assert.equal(built.entries[0].facts.variants[0].fuel, '가솔린');
assert.equal(built.entries[2].evidence.encar.status, 'same-submodel');
assert.deepEqual(built.entries[2].facts.variants, [], '트림이 다르면 세부모델 제원을 추정해 붙이면 안 됨');
assert.equal(Object.hasOwn(built.entries[0], 'fuel'), false, '연료는 5단계 계층이 아니라 facts여야 함');
assert.equal(built.entries[3].subModel, '기본형', '모델과 같은 세부모델은 F03 발행 규칙상 기본형이어야 함');
assert.equal(built.entries[3].evidence.googleSheet.sourceNames.subModel, 'GV70', 'Google Sheet 원문명은 근거로 보존해야 함');
assert.equal(built.entries[3].evidence.googleSheet.canonicalProjectionApplied, true);
console.log('PASS Google Sheet 채택명 + Encar 괄호/기아 세대명 대조');
console.log('PASS 빈 트림은 ERP5 투영에서 기본형');
console.log('PASS 모델=세부모델은 발행명만 기본형, Sheet 원문은 근거로 보존');
console.log('PASS 연료·배기량·구동·인승·배터리는 계층 밖 facts');

const bad = buildVehicleMaster({
  sheetRows: [{ ...sheetRows[0], rowNumber: 99, subModel: 'G80 (RG3) FL', reviews: {} }],
  encarRows,
});
assert.equal(bad.entries[0].subModel, 'G80 RG3 FL');
assert.ok(!bad.blockers.some((value) => value.includes('괄호 표기')));
assert.ok(bad.blockers.some((value) => value.includes('FL 표기')));
assert.ok(bad.blockers.some((value) => value.includes('needs-review')));
console.log('PASS 괄호는 F03 표기로 투영하고 FL·근거 없는 행은 활성화 blocker');
console.log('ERP5 VEHICLE MASTER SSOT 4/4 PASS');
