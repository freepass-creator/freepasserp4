import assert from 'node:assert/strict';
import { exportRow, HEADERS, TABLE_COLUMNS } from '../lib/domain/inventory-sheet-export';

const forbiddenHeaders = [
  '심사', '심사기준', '신용등급', '수수료환수', '보험', '보상한도', '면책금',
  '자차면책금', '개인운전범위', '사업자운전범위', '정책명', '정책코드',
];
for (const header of forbiddenHeaders) {
  assert.equal(HEADERS.includes(header), false, `숨김 원본에 금지 열이 남음: ${header}`);
  assert.equal(TABLE_COLUMNS.includes(header), false, `표시 표에 금지 열이 남음: ${header}`);
}

const secrets = [
  '내부심사-비밀', '내부신용-비밀', '환수조건-비밀', '보험약관-비밀', 'POL-SECRET',
  'VIN-SECRET-123', 'ACCOUNT-SECRET-456', 'COST-SECRET-789', 'COMMISSION-SECRET-321',
];
const row = exportRow({
  product_code: 'P-1', car_number: '11가1111', vehicle_status: '출고가능', product_type: '중고렌트',
  maker: '현대', model: '그랜저',
  vin: secrets[5], account_number: secrets[6], vehicle_price: secrets[7],
  price: { '36': { rent: 500000, deposit: 0, commission: secrets[8] } },
  _policy: {
    policy_code: secrets[4], policy_name: '내부정책-비밀', screening_criteria: secrets[0],
    credit_grade: secrets[1], commission_clawback_condition: secrets[2],
    injury_compensation_limit: secrets[3], basic_driver_age: '만 26세',
    driver_age_lowering: '만 21세', age_lowering_cost: '월 5만원', license_period: '1년 이상',
    annual_mileage: '2만km', deposit_installment: '3회', rental_region: '전국', delivery_fee: '협의',
  },
}, '테스트공급사');
const payload = row.map(String).join('|');
for (const secret of secrets) assert.equal(payload.includes(secret), false, `판매 시트 payload에 내부값 노출: ${secret}`);
assert.equal(row.length, HEADERS.length, '판매 시트 행과 헤더 열 수가 다름');

console.log('sim-inventory-sheet-exposure: PASS');
