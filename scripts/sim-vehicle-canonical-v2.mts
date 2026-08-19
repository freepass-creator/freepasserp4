import assert from 'node:assert/strict';
import {
  canonicalSubModelLabelIssues,
  composeCanonicalSubModel,
  composeVehicleDisplay,
  validateCanonicalVariant,
  type VehicleVariantAtoms,
} from '../lib/domain/vehicle-canonical-v2';

const base: VehicleVariantAtoms = {
  canonicalId: 'vv-hy-son-dn8-edge-lpg20-rent-biz1',
  makerId: 'mf-001', modelId: 'md-018', makerName: '현대', modelName: '쏘나타',
  generationId: 'gen-sonata-8', generationName: '8세대', developmentCode: 'DN8',
  phase: 'facelift', phaseName: '디 엣지', phaseNamePosition: 'suffix',
  powertrainId: 'pt-lpg-1999', powertrainName: 'LPG 2.0', fuel: 'LPG', engineCc: 1999, batteryKwh: null,
  drivetrain: '2WD', seats: 5, salesType: 'rental', salesTypeName: '렌터카',
  trimId: 'trim-business-1', trimName: 'Business 1',
  productionFrom: '2023-05', productionTo: '현재', modelYearFrom: '2024', modelYearTo: '현재',
};

assert.equal(composeCanonicalSubModel(base), '쏘나타 DN8 디 엣지');
assert.equal(composeCanonicalSubModel({ ...base, phase: 'initial', phaseName: '', phaseNamePosition: 'none' }), '쏘나타 DN8');
assert.equal(composeCanonicalSubModel({
  ...base, modelId: 'md-avante', modelName: '아반떼', developmentCode: 'CN7',
  generationId: 'gen-avante-7', generationName: '7세대', phaseName: '더 뉴', phaseNamePosition: 'prefix',
}), '더 뉴 아반떼 CN7');
assert.equal(composeVehicleDisplay(base), '쏘나타 DN8 디 엣지 LPG 2.0 렌터카 Business 1');
assert.equal(
  composeVehicleDisplay(base, { includeDrivetrain: true }),
  '쏘나타 DN8 디 엣지 LPG 2.0 2WD 렌터카 Business 1',
);
assert.equal(
  composeVehicleDisplay(base, { includeSeats: true }),
  '쏘나타 DN8 디 엣지 LPG 2.0 5인승 렌터카 Business 1',
);
assert.equal(
  composeVehicleDisplay({ ...base, bodyConfiguration: '2인승 밴' }, { includeBodyConfiguration: true }),
  '쏘나타 DN8 디 엣지 LPG 2.0 2인승 밴 렌터카 Business 1',
);
assert.deepEqual(validateCanonicalVariant(base), []);
assert.ok(validateCanonicalVariant({ ...base, phaseName: '2026 디 엣지' }).some((issue) => issue.includes('연식')));
assert.ok(validateCanonicalVariant({ ...base, modelName: '쏘나타 렌터카' }).some((issue) => issue.includes('판매유형')));
assert.deepEqual(canonicalSubModelLabelIssues('쏘나타 DN8 디 엣지', 'Business 1'), []);
assert.deepEqual(
  canonicalSubModelLabelIssues('The 2026 Ray EV 4인승 승용', '에어'),
  ['MODEL_YEAR', 'POWERTRAIN', 'BODY_OR_SEAT_SPEC'],
);
assert.deepEqual(canonicalSubModelLabelIssues('더 뉴 레이 TAM', '프레스티지'), []);
assert.ok(canonicalSubModelLabelIssues('2026 쏘나타 디 엣지 렌터카 DN8', 'Business 1').includes('MODEL_YEAR'));
assert.ok(canonicalSubModelLabelIssues('2026 쏘나타 디 엣지 렌터카 DN8', 'Business 1').includes('SALES_USE'));
assert.notEqual(composeVehicleDisplay(base), composeVehicleDisplay({ ...base, canonicalId: 'vv-2', trimId: 'trim-business-2', trimName: 'Business 2' }));

console.log('PASS vehicle canonical v2 — initial/facelift prefix/suffix, atom display, invalid-label gates');
