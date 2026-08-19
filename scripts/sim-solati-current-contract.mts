import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

type RecordRow = {
  trim_row_key: string;
  master_id: string;
  management_status: string;
  usage_tier: 'automatic' | 'manual' | 'blocked';
  model: string;
  sub_model: string;
  powertrain: string;
  trim: string;
  engine_cc: number | null;
  turbo: boolean | null;
  drivetrain: string;
  seats: number | null;
  evidence_url: string;
};

const artifact = JSON.parse(await readFile('public/data/vehicle-trim-master.json', 'utf8')) as {
  records: RecordRow[];
};
const rows = artifact.records.filter((record) => record.trim_row_key.includes('__solati-'));
const oldRows = rows.filter((record) => !record.master_id.endsWith('-2497'));
const currentRows = rows.filter((record) => record.master_id.endsWith('-2497'));

assert.equal(oldRows.length, 4, '배기량 공란 기존 쏠라티 영구키는 4개여야 한다.');
assert(oldRows.every((record) => record.engine_cc === null));
assert(oldRows.every((record) => record.management_status === '제외' && record.usage_tier === 'blocked'));

assert.equal(currentRows.length, 4, '2,497cc 신규 쏠라티 영구키는 4개여야 한다.');
assert(currentRows.every((record) => record.usage_tier === 'automatic'));
assert(currentRows.every((record) => record.engine_cc === 2497));
assert(currentRows.every((record) => record.turbo === true));
assert(currentRows.every((record) => record.drivetrain === 'RWD'));
assert.deepEqual([...new Set(currentRows.map((record) => record.seats))].sort(), [15, 16]);
assert.deepEqual(
  currentRows.filter((record) => record.seats === 15).map((record) => record.trim).sort(),
  ['디럭스', '럭셔리', '스탠다드'],
);
assert.deepEqual(currentRows.filter((record) => record.seats === 16).map((record) => record.trim), ['디럭스']);
assert(currentRows.every((record) => /eVGT/.test(record.powertrain)));
assert(currentRows.every((record) => record.evidence_url.endsWith('/solati-catalog.pdf')));

console.log('PASS 쏠라티 기존 4키 차단 + 2,497cc eVGT 신규 4키 계약');
