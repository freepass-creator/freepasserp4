import assert from 'node:assert/strict';
import { excelMileageDisplay } from '../features/finder/excel-columns';
import { excelFitPlan } from '../components/ui/table';

assert.equal(excelMileageDisplay(0), '0km');
assert.equal(excelMileageDisplay(999), '999km');
assert.equal(excelMileageDisplay(1000), '0.1만');
assert.equal(excelMileageDisplay(1001), '0.1만');
assert.equal(excelMileageDisplay(12450), '1.2만');
assert.equal(excelMileageDisplay('32,600km'), '3.3만');
assert.equal(excelMileageDisplay(''), '');
const plan = excelFitPlan({ availPx: 5000, mode: 'full', months: [12, 24, 36], hasOpts: true });
assert.equal(plan.show.has('model'), false);
assert.equal(plan.show.has('sub_model'), true);
assert.equal(plan.show.has('variant'), true);
assert.equal(plan.show.has('trim_name'), true);
console.log('엑셀 주행거리·제원 열 11/11 PASS');
