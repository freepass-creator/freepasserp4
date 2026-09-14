import { strict as assert } from 'node:assert';
import { buildPolicyFilterAtom } from '../lib/domain/policy-filter-atom';

for (const raw of ['50만원', '50만 원', '500000', '500,000원', 500000]) {
  const atom = buildPolicyFilterAtom({ own_damage_min_deductible: raw });
  assert.equal(atom.values.own_damage_min_deductible.kind, 'won');
  assert.equal(atom.values.own_damage_min_deductible.won, 500000);
  assert.equal(atom.values.own_damage_min_deductible.display, '50만원');
}

const mixed = buildPolicyFilterAtom({
  age_lowering_cost: '대여료의 10%',
  early_termination_rate_under1y: 0.3,
  annual_mileage: '연간 2만Km',
  own_damage_min_deductible: '협의 필요',
});
assert.deepEqual(mixed.values.age_lowering_cost, { kind: 'rate', status: 'confirmed', display: '대여료의 10%', rate_bps: 1000 });
assert.deepEqual(mixed.values.early_termination_rate_under1y, { kind: 'rate', status: 'normalized', display: '30%', rate_bps: 3000 });
assert.equal(mixed.values.annual_mileage.km_per_year, 20000);
assert.equal(mixed.normalization_status, 'review');
assert.deepEqual(mixed.normalization_review_fields, ['own_damage_min_deductible']);

const states = buildPolicyFilterAtom({ additional_driver_cost: '무료', succession_fee: '불가' });
assert.equal(states.values.additional_driver_cost.kind, 'none');
assert.equal(states.values.succession_fee.kind, 'na');
assert.equal(states.values.additional_driver_cost.won, undefined);

console.log('POLICY FILTER ATOM 13/13 PASS');
