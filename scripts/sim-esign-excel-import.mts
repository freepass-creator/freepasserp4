import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { importEsignExcel } from '../lib/domain/esign-excel';

function makeBytes(kind: 'personal' | 'corporate') {
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  const put = (address: string, value: string | number) => { ws[address] = { t: typeof value === 'number' ? 'n' : 's', v: value }; };
  put('FZ1', '노란색 칸을 입력해 주세요'); put('FZ3', kind === 'corporate' ? '법인명' : '성명');
  put('FZ10', '차량번호'); put('FZ16', '대여료'); put('FZ17', '대여기간');
  if (kind === 'personal') {
    put('GB3', '테스트 고객'); put('GB4', '서울시'); put('GB5', '보호자'); put('GB6', '카니발'); put('GB7', '옵션'); put('GB8', '디젤'); put('GB9', '검정'); put('GB10', '12가3456');
    put('GB11', '900101-1234567'); put('GB12', '11-22-333333-44'); put('GB13', '010-1234-5678'); put('GB14', 5_000_000); put('GB15', '2회'); put('GB16', 650_000); put('GB17', 48); put('GB18', 100); put('GB19', 2);
    put('GC3', '상호'); put('GE3', '테스트상사'); put('GC5', '사업자번호'); put('GE5', '123-45-67890');
  } else {
    put('GB2', '법인 계약'); put('GB3', '테스트법인'); put('GB4', '서울시'); put('GB7', '그랜저'); put('GB8', '선루프'); put('GB9', '가솔린'); put('GB10', '34나5678'); put('GB12', '123-45-67890'); put('GB15', '010-9876-5432'); put('GB16', 7_000_000); put('GB17', '일시납'); put('GB18', 700_000); put('GB19', 36);
  }
  ws['!ref'] = 'FZ1:GZ30';
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '자동차 렌탈 계약서');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const personal = importEsignExcel(makeBytes('personal'));
assert.equal(personal.templateId, 'SOGONG_PERSONAL_RENT_V1');
assert.equal(personal.form.customerName, '테스트 고객');
assert.equal(personal.form.customerCompanyName, '테스트상사');
assert.equal(personal.form.customerBusinessNumber, '123-45-67890');
assert.equal(personal.form.rentAmount, '650000');
assert.equal(personal.form.annualMileage, '연 20,000km');
assert.doesNotMatch(JSON.stringify(personal), /900101-1234567|11-22-333333-44/);

const corporate = importEsignExcel(makeBytes('corporate'));
assert.equal(corporate.templateId, 'SOGONG_CORPORATE_RENT_V1');
assert.equal(corporate.form.vehicleName, '그랜저');
assert.equal(corporate.form.customerPhone, '010-9876-5432');
assert.equal(corporate.form.rentMonths, '36');

const unknown = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(unknown, XLSX.utils.aoa_to_sheet([['다른 양식']]), 'Sheet1');
assert.throws(() => importEsignExcel(XLSX.write(unknown, { type: 'buffer', bookType: 'xlsx' }) as Buffer), /지원하지 않는 계약서/);

console.log('✓ 전자계약 Excel Adapter: 개인·개인사업자·법인 매핑, 민감정보 제외, 오인식 차단');
