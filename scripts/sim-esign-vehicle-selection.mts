import assert from 'node:assert/strict';
import type { EntityRecord } from '@/lib/intake/entities';
import { findTemplate } from '@/lib/domain/esign-templates';
import {
  additionalDriverCostLabel,
  contractDriverAgeOptions,
  contractRentForAge,
  contractVehicleSnapshot,
  searchContractVehicles,
  productContractKind,
  resolveVehiclePolicy,
  isBasePolicyLabel,
} from '@/lib/domain/esign-vehicle-selection';

const rentTemplate = findTemplate('freepass-rent-standard');
const subscriptionTemplate = findTemplate('freepass-subscription-insurance-included');
const product = {
  product_code: 'RP012_12가3456', provider_company_code: 'RP012', car_number: '12가3456',
  vehicle_status: '출고가능',
  product_type: '중고렌트', maker: '현대', model: '아반떼', sub_model: 'CN7',
  year: '2026', fuel_type: '가솔린', options: '내비게이션, 후방카메라', mileage: 12000,
  price: { 24: { rent: 700000, deposit: 2000000 }, 36: { rent: 650000, deposit: 3000000 } },
} as EntityRecord;
const subscription = { ...product, product_code: 'RP012_34나5678', car_number: '34나5678', product_type: '중고구독' } as EntityRecord;
const otherProvider = { ...product, product_code: 'RP004_12가3456', provider_company_code: 'RP004' } as EntityRecord;
const noPrice = { ...product, product_code: 'RP012_56다7890', car_number: '56다7890', price: {} } as EntityRecord;
const immediate = { ...product, product_code: 'RP012_78라9012', car_number: '78라9012', vehicle_status: '즉시출고' } as EntityRecord;
const negotiating = { ...product, product_code: 'RP012_90마1234', car_number: '90마1234', vehicle_status: '출고협의' } as EntityRecord;
const contracted = { ...product, product_code: 'RP012_11바5678', car_number: '11바5678', vehicle_status: '계약중' } as EntityRecord;
const locked = { ...product, product_code: 'RP012_22사6789', car_number: '22사6789', locked_by_contract: 'CT-1' } as EntityRecord;
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
assert.deepEqual(
  searchContractVehicles([product, immediate, negotiating, contracted, locked], 'RP012', rentTemplate, '').map((row) => row.product_code),
  ['RP012_12가3456', 'RP012_78라9012'],
);
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
/**
 * ★차량이 정책을 데려온다(사장님 2026-08-20 순서: 회사 → 차량(정책 없으면 정책까지) → 대여료 → 조건).
 *   실측 2026-08-20: 출고가능 276대 중 114대가 정책코드 칸에 시트 라벨 「(프리패스 기본)」을 갖고 있었다 —
 *   그건 정책코드가 아니라 «공급사 고유 정책 없음» 표시라, 그 공급사 정책이 하나뿐일 때만 그것으로 잇고 아니면 사람이 고른다.
 */
assert.equal(isBasePolicyLabel('(프리패스 기본)'), true);
assert.equal(isBasePolicyLabel('프리패스 기본'), true);
assert.equal(isBasePolicyLabel('POL-0020'), false);
assert.equal(productContractKind({ product_type: '중고구독' }), '구독');
assert.equal(productContractKind({ product_type: '신차렌트' }), '렌탈');
assert.equal(productContractKind({}), '렌탈', '상품구분이 비면 렌트로 본다');

const rentPolicy = { policy_code: 'POL-R', policy_type: '신차렌트' };
const subPolicy = { policy_code: 'POL-S', policy_type: '중고구독' };
const twoRent = [rentPolicy, { policy_code: 'POL-R2', policy_type: '신차렌트' }];
// ① 차량의 정책코드가 맞으면 그것
assert.deepEqual(
  resolveVehiclePolicy({ policy_code: 'POL-S', product_type: '중고구독' }, [rentPolicy, subPolicy]),
  { policy: subPolicy, how: '차량 정책' },
);
// ② 「(프리패스 기본)」 — 그 상품구분 정책이 하나뿐이면 그것
assert.equal(resolveVehiclePolicy({ policy_code: '(프리패스 기본)', product_type: '중고구독' }, [rentPolicy, subPolicy]).how, '공급사 정책');
// ③ 후보가 둘이면 찍지 않는다 — 사람이 고른다
assert.deepEqual(resolveVehiclePolicy({ policy_code: '(프리패스 기본)', product_type: '신차렌트' }, twoRent), { policy: null, how: '미정' });
// ④ ERP 에 없는 코드(RP006_WEB 실측)도 미정으로 떨어진다 — 남의 정책을 찍어 넣지 않는다
assert.deepEqual(resolveVehiclePolicy({ policy_code: 'RP006_WEB', product_type: '신차렌트' }, twoRent), { policy: null, how: '미정' });

// 계약서 종류를 아직 모를 때(=회사만 고른 단계) 차량 후보는 상품구분으로 걸러지지 않는다.
assert.deepEqual(
  searchContractVehicles([product, subscription, otherProvider], 'RP012', null, '').map((row) => row.product_code),
  ['RP012_12가3456', 'RP012_34나5678'],
);

console.log('PASS: ERP 차량검색·스냅샷·기간가격·연령하향 대여료 · 차량→정책 승계');
