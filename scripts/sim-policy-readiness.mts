import assert from 'node:assert/strict';
import { policyReadiness } from '../lib/domain/policy-tier';
import { policyEditUrl, policySectionForField } from '../lib/domain/policy-navigation';

const salesReady = {
  annual_mileage: '연 2만km',
  basic_driver_age: '만 26세',
  license_period: '1년 이상',
  driver_age_lowering: '불가',
  deposit_installment: '불가',
  rental_region: '전국',
  delivery_fee: '협의',
};

const empty = policyReadiness({}, { esign_contract_enabled: '미사용' });
assert.equal(empty.status, '판매조건 부족');
assert.ok(empty.salesMissing.some((field) => field.key === 'basic_driver_age'));

const ready = policyReadiness(salesReady, { esign_contract_enabled: '미사용' });
assert.equal(ready.status, '완료');
assert.equal(ready.contractRequired, false);

const loweringWithoutCost = policyReadiness(
  { ...salesReady, driver_age_lowering: '만 21세' },
  { esign_contract_enabled: '미사용' },
);
assert.equal(loweringWithoutCost.status, '판매조건 부족');
assert.ok(loweringWithoutCost.salesMissing.some((field) => field.key === 'age_lowering_cost'));

const contractMissing = policyReadiness(salesReady, { esign_contract_enabled: '사용' });
assert.equal(contractMissing.status, '계약조건 부족');
assert.equal(contractMissing.contractRequired, true);
assert.ok(contractMissing.contractMissing.length > 0);

assert.equal(policySectionForField('basic_driver_age'), 'basic');
assert.equal(policySectionForField('annual_mileage'), 'terms');
assert.equal(policySectionForField('injury_deductible'), 'ins');
assert.equal(policySectionForField('late_fee_rate'), 'esign');
const editUrl = new URL(policyEditUrl('POL A/1', 'injury_deductible'), 'http://localhost');
assert.equal(editUrl.pathname, '/policy');
assert.equal(editUrl.searchParams.get('policy'), 'POL A/1');
assert.equal(editUrl.searchParams.get('section'), 'ins');
assert.equal(editUrl.searchParams.get('field'), 'injury_deductible');
assert.equal(editUrl.searchParams.get('edit'), '1');
assert.equal(editUrl.searchParams.get('return'), 'esign');

console.log('sim-policy-readiness: PASS');
