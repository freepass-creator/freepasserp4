import assert from 'node:assert/strict';
import type { EntityRecord } from '@/lib/intake/entities';
import { findTemplate } from '@/lib/domain/esign-templates';
import {
  additionalDriverCostLabel,
  contractDriverAgeOptions,
  contractRentForAge,
  contractVehicleSnapshot,
  searchContractVehicles,
} from '@/lib/domain/esign-vehicle-selection';

const rentTemplate = findTemplate('freepass-rent-standard');
const subscriptionTemplate = findTemplate('freepass-subscription-insurance-included');
const product = {
  product_code: 'RP012_12가3456', provider_company_code: 'RP012', car_number: '12가3456',
  product_type: '중고렌트', maker: '현대', model: '아반떼', sub_model: 'CN7',
  year: '2026', fuel_type: '가솔린', options: '내비게이션, 후방카메라', mileage: 12000,
  price: { 24: { rent: 700000, deposit: 2000000 }, 36: { rent: 650000, deposit: 3000000 } },
} as EntityRecord;
const subscription = { ...product, product_code: 'RP012_34나5678', car_number: '34나5678', product_type: '중고구독' } as EntityRecord;
const otherProvider = { ...product, product_code: 'RP004_12가3456', provider_company_code: 'RP004' } as EntityRecord;
const noPrice = { ...product, product_code: 'RP012_56다7890', car_number: '56다7890', price: {} } as EntityRecord;
const policy = {
  basic_driver_age: 26,
  driver_age_lowering: '만 21세까지',
  driver_age_upper_limit: '만 70세 이하',
  age_lowering_cost: 100000,
} as EntityRecord;

assert.deepEqual(searchContractVehicles([product, subscription, otherProvider], 'RP012', rentTemplate, '').map((row) => row.product_code), ['RP012_12가3456']);
assert.deepEqual(searchContractVehicles([product, subscription, otherProvider], 'RP012', rentTemplate, '345').map((row) => row.product_code), ['RP012_12가3456']);
assert.deepEqual(searchContractVehicles([product, subscription, otherProvider], 'RP012', rentTemplate, '아반떼').map((row) => row.product_code), ['RP012_12가3456']);
assert.deepEqual(searchContractVehicles([product, subscription], 'RP012', subscriptionTemplate, '5678').map((row) => row.product_code), ['RP012_34나5678']);
assert.deepEqual(searchContractVehicles([product, noPrice], 'RP012', rentTemplate, '').map((row) => row.product_code), ['RP012_12가3456', 'RP012_56다7890']);
const many = Array.from({ length: 12 }, (_, index) => ({
  ...product,
  product_code: `RP012_${String(index + 1).padStart(2, '0')}가0000`,
  car_number: `${String(index + 1).padStart(2, '0')}가0000`,
} as EntityRecord));
assert.equal(searchContractVehicles(many, 'RP012', rentTemplate, '').length, 12);
assert.equal(contractVehicleSnapshot(product).vehicleName.includes('CN7'), true);
assert.deepEqual(contractDriverAgeOptions(policy), [
  { age: 26, label: '만 26세 이상 · 만 70세 이하', surcharge: 0 },
  { age: 21, label: '만 21세 이상 · 만 70세 이하', surcharge: 100000 },
]);
assert.deepEqual(contractDriverAgeOptions({ ...policy, driver_age_lowering: '만 18세까지' }), [
  { age: 26, label: '만 26세 이상 · 만 70세 이하', surcharge: 0 },
]);
assert.deepEqual(contractRentForAge(product, 36, policy, 26), { rent: 650000, deposit: 3000000, ageSurcharge: 0 });
assert.deepEqual(contractRentForAge(product, 36, policy, 21), { rent: 750000, deposit: 3000000, ageSurcharge: 100000 });
assert.equal(contractRentForAge(product, 48, policy, 26), null);
assert.equal(additionalDriverCostLabel(50000), '월 50,000원 / 1인');
assert.equal(additionalDriverCostLabel('월 5만원'), '월 50,000원 / 1인');
assert.equal(additionalDriverCostLabel('무료'), '별도 비용 없음');
console.log('PASS: ERP 차량검색·스냅샷·기간가격·연령하향 대여료');
