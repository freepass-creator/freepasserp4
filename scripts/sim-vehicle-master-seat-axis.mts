import assert from 'node:assert/strict';
import { pickConfirmedMasterCode, readMasterSheet } from '../lib/domain/vehicle-master-sheet';

const rows = [
  ['관리상태', '검증상태', '제조사', '모델', '세부모델', '파워트레인', '세부트림', '트림행키', '마스터ID', '연료', '정확배기량(cc)', '구동방식', '인승', '배터리(kWh)'],
  ['확정', '확정', '기아', '카니발', '더 뉴 카니발 KA4', '디젤 2.2', '노블레스', 'mf-ka4::v01::t01', 'mf-ka4', '디젤', '2151', '2WD', '7', ''],
  ['확정', '확정', '기아', '카니발', '더 뉴 카니발 KA4', '디젤 2.2', '노블레스', 'mf-ka4::v02::t01', 'mf-ka4', '디젤', '2151', '2WD', '9', ''],
];
const book = readMasterSheet(rows);
assert.equal(
  pickConfirmedMasterCode(book, '기아', '카니발', '더 뉴 카니발 KA4', '디젤 2.2', '노블레스', '디젤', '2151').code,
  '',
  '인승이 없으면 자동 확정하지 않는다',
);
assert.equal(
  pickConfirmedMasterCode(book, '기아', '카니발', '더 뉴 카니발 KA4', '디젤 2.2', '노블레스', '디젤', '2151', { seats: 7 }).code,
  'mf-ka4::v01::t01',
);
assert.equal(
  pickConfirmedMasterCode(book, '기아', '카니발', '더 뉴 카니발 KA4', '디젤 2.2', '노블레스', '디젤', '2151', { seats: 9 }).code,
  'mf-ka4::v02::t01',
);
console.log('PASS vehicle master seat axis');

