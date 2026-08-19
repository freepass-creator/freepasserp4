import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type RecordRow = {
  trim_row_key: string;
  master_id: string;
  model: string;
  trim: string;
  production_start: string;
  production_end: string;
  model_year_start: string;
  battery_kwh: number | null;
  drivetrain: string;
  seats: number | null;
  usage_tier: string;
  management_status: string;
};

const master = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as { records: RecordRow[] };
const rows = master.records.filter((row) => row.model === '캐스퍼');
const phased = rows.filter((row) => row.master_id === 'mf-001.md-103.sm-ax1e-phased__casper-electric-phased');

assert.equal(phased.length, 3);
assert.deepEqual(phased.map((row) => [row.trim, row.production_start, row.model_year_start, row.battery_kwh]), [
  ['프리미엄', '2024-10', '2025', 42],
  ['크로스', '2025-02', '2025', 49],
  ['라운지', '2026-03', '2026', 49],
]);
assert.ok(phased.every((row) => row.production_end === '현재' && row.drivetrain === 'FWD' && row.seats === 4));
assert.ok(phased.every((row) => row.usage_tier === 'automatic'));

const legacy = rows.filter((row) => row.master_id === 'mf-001.md-103.sm-ax1e__casper-electric');
const falseEarly = legacy.filter((row) => ['프리미엄', '크로스', '라운지'].includes(row.trim));
const launchInspiration = legacy.filter((row) => row.trim === '인스퍼레이션');
assert.equal(falseEarly.length, 3);
assert.ok(falseEarly.every((row) => row.management_status === '제외' && row.usage_tier === 'blocked'));
assert.equal(launchInspiration.length, 1);
assert.equal(launchInspiration[0]?.production_start, '2024-08');
assert.equal(launchInspiration[0]?.usage_tier, 'automatic');

console.log('PASS Casper Electric phase contract: phased=3 false-early-blocked=3 launch-inspiration-preserved');
