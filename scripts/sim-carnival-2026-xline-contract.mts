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
  turbo: boolean | null;
  drivetrain: string;
  seats: number | null;
};

const data = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as { records: Row[] };
const xline = data.records.filter((row) => row.trim_row_key.includes('sm-ka4-pe-xline-2026__'));

assert.equal(xline.length, 4);
assert.deepEqual(xline.map((row) => [row.powertrain, row.seats]), [
  ['가솔린 3.5 2WD', 7],
  ['가솔린 3.5 2WD', 9],
  ['하이브리드 1.6T 2WD', 7],
  ['하이브리드 1.6T 2WD', 9],
]);
assert.deepEqual(xline.filter((row) => row.seats === 7).map((row) => row.production_start), ['2026-05', '2026-05']);
assert.deepEqual(xline.filter((row) => row.seats === 9).map((row) => row.production_start), ['2026-07', '2026-07']);
assert.ok(xline.every((row) =>
  row.model === '카니발'
  && row.sub_model === '2026 카니발 X-Line KA4'
  && row.trim === `X-Line ${row.seats}인승`
  && row.production_end === '현재'
  && row.model_year_start === '2026'
  && row.usage_tier === 'automatic'
  && row.drivetrain === '2WD'
));
assert.ok(xline.filter((row) => row.engine_cc === 3470).every((row) => row.turbo === false));
assert.ok(xline.filter((row) => row.engine_cc === 1598).every((row) => row.turbo === true));
assert.deepEqual(xline.map((row) => row.trim_row_key), [
  'mf-002.md-036.sm-ka4-pe-xline-2026__carnival-x-line::v01::t01',
  'mf-002.md-036.sm-ka4-pe-xline-2026__carnival-x-line::v01::t02',
  'mf-002.md-036.sm-ka4-pe-xline-2026__carnival-x-line::v02::t01',
  'mf-002.md-036.sm-ka4-pe-xline-2026__carnival-x-line::v02::t02',
]);

console.log('PASS Carnival 2026 X-Line contract: 7-seat preserved=2 9-seat added=2');
