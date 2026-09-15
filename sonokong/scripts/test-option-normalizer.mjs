import assert from 'node:assert/strict';
import { normalizePlate, tcarDetailFromHtml, tcarDetailMatchesPlate, tcarPaidOptionNames as pick, uniqueTcarSaleMatch } from '../lib/option-normalizer.mjs';

assert.equal(pick([{ name: '파노라마 선루프', amount: 1_200_000 }]), '파노라마 선루프');
assert.equal(
  pick([{ name: '드라이브 와이즈 (750,000원)' }, { name: '스노우화이트펄', amount: 80_000 }]),
  '드라이브 와이즈, 스노우화이트펄',
);
assert.equal(pick([{ PAID_OPT_NM: '컴포트', PAID_OPT_AMT: 600_000 }]), '컴포트');
assert.equal(pick(null), '');
assert.equal(pick('차량 설명문\n파노라마 선루프'), '');

console.log('티카 유료옵션 규격화: 5/5 PASS');

const jsonData = JSON.stringify({
  carData: { carId: '12345', plateNumber: '12가 3456' },
  paidOptList: [{ PAID_OPT_NM: '드라이브와이즈', PAID_OPT_AMT: 900000 }],
}).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
assert.deepEqual(tcarDetailFromHtml(`<input type="hidden" id="jsonData" value="${jsonData}">`)?.paidOptList, [
  { PAID_OPT_NM: '드라이브와이즈', PAID_OPT_AMT: 900000 },
]);
assert.equal(tcarDetailFromHtml('<html></html>'), null);
assert.equal(normalizePlate('12가 3456'), '12가3456');
assert.equal(normalizePlate('12가-3456'), '12가3456');
assert.equal(tcarDetailMatchesPlate({ carData: { plateNumber: '12가 3456' } }, '12가3456'), true);
assert.equal(tcarDetailMatchesPlate({ carData: { plateNumber: '99나9999' } }, '12가3456'), false);
assert.equal(uniqueTcarSaleMatch({ result: { data: [{ carId: 7, plateNumber: '12가 3456' }] } }, '12가3456')?.carId, 7);
assert.equal(uniqueTcarSaleMatch({ result: { data: [] } }, '12가3456'), null);
assert.equal(uniqueTcarSaleMatch({ result: { data: [{ carId: 7, plateNumber: '12가3456' }, { carId: 8, plateNumber: '12가3456' }] } }, '12가3456'), null);

console.log('티카 상세 원문·차량번호 매칭: 9/9 PASS');

// 검사자료가 먼저 나오고 옛 번호판이 달라도 현재 차량정보를 사용한다.
assert.equal(tcarDetailMatchesPlate({ formData: { checkInfo: { carData: { plateNumber: '99나9999' } }, carInfo: { plateNumber: '12가3456', carId: '7' } } }, '12가3456'), true);
assert.equal(tcarDetailMatchesPlate({ formData: { checkInfo: { carData: { plateNumber: '12가3456' } }, carInfo: { plateNumber: '99나9999' } } }, '12가3456'), false);
assert.equal(tcarDetailMatchesPlate({ formData: { checkInfo: { carData: { plateNumber: '12가3456' } } } }, '12가3456'), false);
assert.equal(tcarDetailMatchesPlate({ formData: { carInfo: { plateNumber: '' } }, carData: { plateNumber: '12가3456' } }, '12가3456'), false);
console.log('현재 차량정보 우선·검사자료 배제: 4/4 PASS');
