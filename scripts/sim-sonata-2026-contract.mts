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
  model_year_end: string;
  usage_tier: string;
  engine_cc: number | null;
  drivetrain: string;
  seats: number | null;
};

const data = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as { records: Row[] };
const sonata = data.records.filter((row) => row.model === '쏘나타');
const gap = sonata.filter((row) => row.trim_row_key.includes('sm-dn8-my2026-gap__'));
const rental = sonata.filter((row) => row.trim_row_key.includes('sm-dn8-my2026-rent__'));

assert.equal(gap.length, 2);
assert.deepEqual(gap.map((row) => [row.powertrain, row.trim]), [
  ['가솔린 2.0', '인스퍼레이션'],
  ['LPG 2.0', '프리미엄'],
]);
assert.equal(rental.length, 2);
assert.deepEqual(rental.map((row) => row.trim), ['Business 1', 'Business 2']);
assert.ok(rental.every((row) => row.sub_model === '쏘나타 DN8 디 엣지' && row.powertrain.includes('렌터카')));
assert.ok([...gap, ...rental].every((row) =>
  row.production_start === '2025-09'
  && row.production_end === '현재'
  && row.model_year_start === '2026'
  && row.model_year_end === '현재'
  && row.usage_tier === 'automatic'
  && row.engine_cc === 1999
  && row.drivetrain === '2WD'
  && row.seats === 5
));

const combinedBusiness = sonata.find((row) => row.trim_row_key === 'mf-001.md-018.sm-dn8::v03::t03');
assert.ok(combinedBusiness);
assert.equal(combinedBusiness.production_end, '현재');
assert.equal(combinedBusiness.model_year_end, '현재');
assert.equal(combinedBusiness.usage_tier, 'blocked');

const earlyS = sonata.filter((row) => [
  'mf-001.md-018.sm-dn8__쏘나타-디-엣지-하이브리드-dn8::v01::t01',
  'mf-001.md-018.sm-dn8::v01::t01',
  'mf-001.md-018.sm-dn8::v02::t01',
].includes(row.trim_row_key));
assert.ok(earlyS.every((row) => row.usage_tier === 'blocked'));

console.log('PASS Sonata 2026 contract: gap=2 rental=2 combined-business-meaning-preserved-and-blocked=1 early-S-blocked=3');
