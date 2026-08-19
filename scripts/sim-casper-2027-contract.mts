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
  engine_cc: number | null;
  turbo: boolean;
  drivetrain: string;
  seats: number | null;
  usage_tier: string;
  market_status: string;
};

const master = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as { records: RecordRow[] };
const casper = master.records.filter((row) => row.model === '캐스퍼');
const current2027 = casper.filter((row) => row.master_id === 'mf-001.md-062.sm-ax1-my2027__casper-2027');

assert.equal(current2027.length, 10);
assert.ok(current2027.every((row) => row.production_start === '2026-07' && row.production_end === '현재'));
assert.ok(current2027.every((row) => row.model_year_start === '2027' && row.model_year_end === '현재'));
assert.ok(current2027.every((row) => row.engine_cc === 998 && row.drivetrain === '2WD' && row.usage_tier === 'automatic'));

const expected = new Map<string, string[]>([
  ['가솔린 1.0', ['스마트', '디 에센셜', '인스퍼레이션']],
  ['가솔린 1.0T', ['스마트', '디 에센셜', '인스퍼레이션']],
  ['가솔린 1.0 VAN', ['스마트', '스마트 초이스']],
  ['가솔린 1.0T VAN', ['스마트', '스마트 초이스']],
]);
for (const [powertrain, trims] of expected) {
  const rows = current2027.filter((row) => row.powertrain === powertrain);
  assert.deepEqual(rows.map((row) => row.trim), trims);
  assert.ok(rows.every((row) => row.seats === (powertrain.includes('VAN') ? 2 : 4)));
  assert.ok(rows.every((row) => row.turbo === powertrain.includes('1.0T')));
}

const previous = casper.filter((row) => row.master_id === 'mf-001.md-062.sm-ax1');
assert.equal(previous.length, 7);
assert.ok(previous.every((row) => row.usage_tier === 'blocked'
  && row.production_end === '현재' && row.model_year_end === '현재'));

console.log('PASS Casper 2027 contract: passenger=6 van=4 previous-meaning-preserved-and-blocked=7');
