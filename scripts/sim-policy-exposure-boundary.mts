import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicPolicy, sanitizeProductForGuest } from '../lib/domain/public-catalog';

const internal = {
  screening_criteria: '내부심사-비노출',
  credit_grade: '내부등급-비노출',
  commission_clawback_condition: '내부환수-비노출',
};
const policy = publicPolicy({
  ...internal,
  policy_name: '고객용 정책명',
  insurance_included: '포함',
});
const guestProduct = sanitizeProductForGuest('veh_test', {
  product_code: 'veh_test',
  car_number: '차량번호 미정',
  credit_grade: '상품내부등급-비노출',
  price: { 36: { rent: 650_000, deposit: 0 } },
}, internal);

const exposed = JSON.stringify({ policy, guestProduct });
assert.doesNotMatch(exposed, /내부심사-비노출|내부등급-비노출|내부환수-비노출|상품내부등급-비노출/);
assert.equal(policy?.policy_name, '고객용 정책명');
assert.equal(guestProduct.price && (guestProduct.price as Record<string, { rent: number }>)['36'].rent, 650_000);

const supplierSheet = readFileSync('lib/domain/supplier-template-sheet.ts', 'utf8');
// ★심사조건(screening_criteria)은 2026-08-19부터 공급사가 운영정책 시트 맨 앞에서 «자기 정책»으로 적는다(사장님: 무심사·소득확인·신용조회).
//   공급사는 값의 출처라 시트에 있어도 «노출»이 아니다. 손님 화면·계약서로 안 나가는 건 publicPolicy 가 여전히 지킨다(위 assert).
assert.doesNotMatch(supplierSheet, /field:\s*'(credit_grade|commission_clawback_condition)'/);
assert.match(supplierSheet, /name:\s*'심사조건'[^\n]*field:\s*'screening_criteria'/);

console.log('✓ 정책 노출 경계: 고객 계약·공개 카탈로그·공급사 회신표에서 내부 심사·신용·환수값 제외');
