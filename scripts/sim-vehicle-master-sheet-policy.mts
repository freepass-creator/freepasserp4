import assert from 'node:assert/strict';
import { pickConfirmedMasterCode, pickMasterCode, readMasterSheet } from '../lib/domain/vehicle-master-sheet';

const header = [
  '관리상태', '검증상태', '제조사', '모델', '세부모델', '파워트레인', '세부트림',
  '트림행키', '마스터ID', '연료', '정확배기량(cc)', '구동방식', '인승', '배터리(kWh)',
];
const rows = [
  header,
  ['검증중', '1차확인', '현대', '테스트A', 'A1', '가솔린 2.0', '프리미엄', 'mf-test-a::v01::t01', 'mf-test-a', '가솔린', '1999', '2WD', '5', ''],
  ['확정', '확정', '현대', '테스트B', 'B1', '가솔린 2.0', '프리미엄', 'mf-test-b::v01::t01', 'mf-test-b', '가솔린', '1999', '2WD', '5', ''],
  ['제외', '1차확인', '현대', '테스트C', 'C1', '가솔린 2.0', '프리미엄', 'mf-test-c::v01::t01', 'mf-test-c', '가솔린', '1999', '2WD', '5', ''],
];

const book = readMasterSheet(rows);
assert.equal(book.byCode.size, 3, '차단 행도 기존 코드 이력 조회에는 남아야 한다');
assert.equal(book.byCode.get('mf-test-c::v01::t01')?.usageTier, 'blocked');
assert.equal(book.byFive.size, 2, '수동 후보에는 검증중과 확정 행이 들어가야 한다');
assert.equal(book.confirmedByFive.size, 1, '자동 후보에는 확정/확정만 들어가야 한다');

assert.equal(
  pickMasterCode(book, '현대', '테스트A', 'A1', '가솔린 2.0', '프리미엄', '가솔린', '1999').code,
  'mf-test-a::v01::t01',
);
assert.equal(
  pickConfirmedMasterCode(book, '현대', '테스트A', 'A1', '가솔린 2.0', '프리미엄', '가솔린', '1999').code,
  '',
);
assert.equal(
  pickConfirmedMasterCode(book, '현대', '테스트B', 'B1', '가솔린 2.0', '프리미엄', '가솔린', '1999').code,
  'mf-test-b::v01::t01',
);
assert.equal(
  pickMasterCode(book, '현대', '테스트C', 'C1', '가솔린 2.0', '프리미엄', '가솔린', '1999').code,
  '',
);

console.log('PASS vehicle-master-sheet 상태 정책: 수동/자동/차단 분리 및 기존 코드 이력 보존');
