/** ERP5 차종마스터 병합·활성화 경계 회귀검사. 외부 접속/쓰기 없음. */
import assert from 'node:assert/strict';
import { buildVehicleMaster, parseVehicleMasterSheet, requiredVehicleMasterBlockers, type EncarReferenceRow } from '../lib/domain/erp5-vehicle-master-ssot';

const headers = [
  '원산지', '제조사', '모델', '세부모델', '세부트림', '생산시작', '생산종료',
  '모델행키', '세부모델행키', '세부트림행키', '원자ID', '커서 엔카대조', '종합판정',
];
const filler = Array.from({ length: 50 }, (_, index) => [
  '국산', '제네시스', `모델${index}`, `세부${index}`, '기본형', '2020-01', '현재',
  `m-${index}`, `s-${index}`, `t-${index}`, `a-${index}`, '맞음 · 확인', '확정 · 엔카 일치(원자)',
]);
const parsed = parseVehicleMasterSheet([headers, ...filler]);
assert.equal(parsed.length, 50);

const sheetRows = [
  { ...parsed[0], maker: '제네시스', model: 'G80', subModel: 'G80 RG3', trim: '' },
  { ...parsed[1], maker: '기아', model: 'K5', subModel: 'K5 DL3', trim: '노블레스' },
  { ...parsed[2], maker: '제네시스', model: 'G80', subModel: 'G80 RG3', trim: '스포츠' },
  { ...parsed[3], maker: '제네시스', model: 'GV70', subModel: 'GV70', trim: '' },
  { ...parsed[4], maker: '제네시스', model: '더 뉴 G70 슈팅브레이크', subModel: '더 뉴 G70 슈팅브레이크', trim: '스포츠 패키지' },
];
const encarRows: EncarReferenceRow[] = [
  { id: 'encar-g80', manufacturer: '제네시스', model: 'G80', sub_model: 'G80 (RG3)', trim: '기본', fuel: '가솔린', displacement_l: 2.5 },
  { id: 'encar-k5', manufacturer: '기아', model: 'K5', sub_model: 'K5 3세대', gen_code: 'DL3', trim: '노블레스', fuel: '가솔린' },
  { id: 'encar-gv70', manufacturer: '제네시스', model: 'GV70', sub_model: 'GV70', trim: '기본', fuel: '가솔린' },
  { id: 'encar-g70-shooting', manufacturer: '제네시스', model: '더 뉴 G70 슈팅브레이크', sub_model: '더 뉴 G70 슈팅브레이크', trim: '스포츠 패키지', fuel: '가솔린', drivetrain: 'AWD' },
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
assert.equal(built.entries[4].model, '더 뉴 G70 슈팅브레이크', 'G70 슈팅브레이크를 GV70으로 합치면 안 됨');
assert.equal(built.entries[4].subModel, '기본형', 'G70 슈팅브레이크도 모델=세부모델이면 기본형으로 발행해야 함');
assert.equal(built.entries[4].trim, '스포츠 패키지', '확인된 세부트림은 손실 없이 보존해야 함');
assert.equal(built.entries[4].evidence.googleSheet.sourceNames.model, '더 뉴 G70 슈팅브레이크');
assert.equal(built.entries[4].evidence.googleSheet.sourceNames.subModel, '더 뉴 G70 슈팅브레이크');
assert.equal(built.entries[4].evidence.googleSheet.sourceNames.trim, '스포츠 패키지');
assert.notEqual(built.entries[4].id, built.entries[3].id, 'G70 슈팅브레이크와 GV70은 서로 다른 SSOT 원자여야 함');
assert.deepEqual(requiredVehicleMasterBlockers(built.entries), [], 'G80 RG3 기본형 필수 원자 존재');
console.log('PASS Google Sheet 채택명 + Encar 괄호/기아 세대명 대조');
console.log('PASS 빈 트림은 ERP5 투영에서 기본형');
console.log('PASS 모델=세부모델은 발행명만 기본형, Sheet 원문은 근거로 보존');
console.log('PASS G70 슈팅브레이크와 GV70은 별도 원자이며 확인된 세부트림/원문을 보존');
console.log('PASS 연료·배기량·구동·인승·배터리는 계층 밖 facts');

const keyMissing = buildVehicleMaster({
  sheetRows: [{ ...sheetRows[0], rowNumber: 98, modelKey: '', subModelKey: '', trimKey: '', atomKey: '' }],
  encarRows,
});
assert.ok(keyMissing.blockers.some((value) => value.includes('차종 계층키 누락')));
assert.equal(requiredVehicleMasterBlockers(built.entries.filter((entry) => entry.trim !== '기본형')).length, 1);
console.log('PASS 계층키 누락과 G80 RG3 기본형 필수 원자 누락은 활성화 blocker');

const bad = buildVehicleMaster({
  sheetRows: [{ ...sheetRows[0], rowNumber: 99, subModel: 'G80 (RG3) FL', reviews: {} }],
  encarRows,
});
assert.equal(bad.entries[0].subModel, 'G80 RG3 FL');
assert.ok(!bad.blockers.some((value) => value.includes('괄호 표기')));
assert.ok(bad.blockers.some((value) => value.includes('FL 표기')));
assert.ok(bad.blockers.some((value) => value.includes('needs-review')));
console.log('PASS 괄호는 F03 표기로 투영하고 FL·근거 없는 행은 활성화 blocker');

const finalDecision = buildVehicleMaster({
  sheetRows: [{
    ...sheetRows[1],
    rowNumber: 101,
    reviews: { '커서 엔카대조': '맞음', 'Gemini 엔카대조': '못정함', 종합판정: '확정 · 엔카 일치(원자)' },
  }],
  encarRows,
});
assert.equal(finalDecision.entries[0].verification, 'exact-reference');
assert.equal(finalDecision.blockers.length, 0, 'Google 종합판정 확정을 과거 개별 검토 충돌로 뒤집으면 안 됨');
console.log('PASS Google 종합판정 확정은 과거 개별 대조값보다 우선');
console.log('ERP5 VEHICLE MASTER SSOT 8/8 PASS');
