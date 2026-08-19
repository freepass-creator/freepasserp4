import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type RecordRow = {
  trim_row_key: string;
  master_id: string;
  model: string;
  powertrain: string;
  trim: string;
  production_start: string;
  production_end: string;
  model_year_start: string;
  model_year_end: string;
  usage_tier: string;
  market_status: string;
  fuel: string;
  engine_cc: number | null;
  turbo: boolean;
  drivetrain: string;
  seats: number | null;
};

const master = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as { records: RecordRow[] };
const kona = master.records.filter((row) => row.model === '코나');
const current2027 = kona.filter((row) => row.master_id === 'mf-001.md-055.sm-sx2-my2027__kona-2027');

assert.equal(current2027.length, 18, '2027 코나는 공식 판매 조합 18개여야 한다.');
assert.ok(current2027.every((row) => row.production_start === '2026-04' && row.production_end === '현재'));
assert.ok(current2027.every((row) => row.model_year_start === '2027' && row.model_year_end === '현재'));
assert.ok(current2027.every((row) => row.usage_tier === 'automatic'), '공식 근거·고유 식별축을 통과한 신규 연식 코드는 자동 배정 가능해야 한다.');
assert.ok(current2027.every((row) => row.seats === 5));

const expected = new Map<string, string[]>([
  ['가솔린 1.6T 2WD', ['Modern', 'H-Pick', 'Premium', 'Inspiration', 'Black Exterior', 'N Line']],
  ['가솔린 1.6T 4WD', ['Premium', 'Inspiration', 'Black Exterior', 'N Line']],
  ['가솔린 2.0 2WD', ['Modern', 'H-Pick']],
  ['하이브리드 1.6 2WD', ['Modern', 'H-Pick', 'Premium', 'Inspiration', 'Black Exterior', 'N Line']],
]);
for (const [powertrain, trims] of expected) {
  assert.deepEqual(current2027.filter((row) => row.powertrain === powertrain).map((row) => row.trim), trims);
}

for (const row of current2027) {
  if (row.powertrain.startsWith('가솔린 1.6T')) {
    assert.equal(row.engine_cc, 1598);
    assert.equal(row.turbo, true);
  } else if (row.powertrain.startsWith('가솔린 2.0')) {
    assert.equal(row.engine_cc, 1999);
    assert.equal(row.turbo, false);
  } else {
    assert.equal(row.engine_cc, 1580);
    assert.equal(row.turbo, false);
  }
  assert.equal(row.drivetrain, row.powertrain.endsWith('4WD') ? '4WD' : '2WD');
}

const genericLegacy = kona.filter((row) => row.master_id === 'mf-001.md-055.sm-sx2');
const legacyIceHev = genericLegacy.filter((row) => /::v(?:01|02|03|05|06)::/.test(row.trim_row_key));
const genericElectric = genericLegacy.filter((row) => /::v04::/.test(row.trim_row_key));
const special2025 = kona.filter((row) => row.master_id === 'mf-001.md-055.sm-sx2-hpick-2025__kona-h-pick'
  || row.master_id === 'mf-001.md-055.sm-sx2-black-2025__kona-black-exterior');

assert.equal(legacyIceHev.length, 21);
assert.equal(special2025.length, 6);
assert.ok([...legacyIceHev, ...special2025].every((row) => row.usage_tier === 'blocked'
  && row.production_end === '현재' && row.model_year_end === '현재'));
assert.ok(genericElectric.length > 0 && genericElectric.every((row) => row.production_end === '현재'));
assert.ok(kona.filter((row) => row.master_id.includes('standard-48_6')).every((row) => row.production_end === '현재'));

console.log('PASS KONA 2027 contract: current=18 legacy-meaning-preserved-and-blocked=27 electric-untouched');
