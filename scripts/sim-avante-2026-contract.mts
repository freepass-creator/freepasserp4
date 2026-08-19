import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type Row = {
  trim_row_key: string;
  model: string;
  sub_model: string;
  powertrain: string;
  trim: string;
  production_start: string;
  production_end: string;
  model_year_start: string;
  usage_tier: string;
  engine_cc: number | null;
  drivetrain: string;
  seats: number | null;
};

const data = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as { records: Row[] };
const avante = data.records.filter((row) => row.model === '아반떼');
const general = avante.filter((row) => row.trim_row_key.includes('sm-cn7-lpi-2026__'));
const rental = avante.filter((row) => row.trim_row_key.includes('sm-cn7-lpi-rent-2026__'));

assert.deepEqual(general.map((row) => row.trim), ['모던', '인스퍼레이션']);
assert.deepEqual(rental.map((row) => row.trim), ['스마트', '모던']);
assert.ok(general.every((row) => !row.sub_model.includes('렌터카') && !row.powertrain.includes('렌터카')));
assert.ok(rental.every((row) => row.sub_model.includes('렌터카') && row.powertrain.includes('렌터카')));
assert.ok([...general, ...rental].every((row) =>
  row.production_start === '2025-04'
  && row.production_end === '현재'
  && row.model_year_start === '2026'
  && row.usage_tier === 'automatic'
  && row.engine_cc === 1591
  && row.drivetrain === '2WD'
  && row.seats === 5
));

const legacySmart = avante.find((row) => row.trim_row_key === 'mf-001.md-019.sm-cn7::v03::t01');
assert.ok(legacySmart);
assert.equal(legacySmart.powertrain, 'LPG 1.6');
assert.equal(legacySmart.trim, '스마트');
assert.ok(!legacySmart.sub_model.includes('렌터카'));

console.log('PASS Avante 2026 contract: general-gap=2 rental=2 legacy-general-smart-preserved=1');
