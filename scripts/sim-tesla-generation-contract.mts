import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

type TeslaRecord = {
  trim_row_key: string;
  master_id: string;
  usage_tier: 'automatic' | 'manual' | 'blocked';
  sub_model: string;
  trim: string;
  generation_name: string;
  development_code: string;
  production_start: string;
  production_end: string;
  drivetrain: string;
  seats: number | null;
  trim_aliases: string[];
};

const artifact = JSON.parse(await readFile('public/data/vehicle-trim-master.json', 'utf8')) as {
  records: TeslaRecord[];
};
const tesla = artifact.records.filter((record) => record.trim_row_key.startsWith('mf-087.'));
const byKey = new Map(tesla.map((record) => [record.trim_row_key, record]));
const get = (key: string) => {
  const record = byKey.get(key);
  assert(record, `Tesla 영구키 누락: ${key}`);
  return record;
};

assert.equal(byKey.size, tesla.length, 'Tesla 영구키는 중복될 수 없다.');

for (const key of [
  'mf-087.md-003.sm-모델-3::v01::t01',
  'mf-087.md-003.sm-모델-3::v01::t02',
  'mf-087.md-003.sm-모델-3::v02::t01',
  'mf-087.md-004.sm-모델-y::v01::t02',
  'mf-087.md-004.sm-모델-y::v02::t02',
  'mf-087.md-004.sm-모델-y::v04::t01',
]) {
  assert.equal(get(key).usage_tier, 'blocked', `세대 합본 과매칭 코드는 차단 상태여야 한다: ${key}`);
}

const highland = get('mf-087.md-003.sm-highland__new-model-3::v01::t01');
assert.equal(highland.production_start, '2024-04');
assert.equal(highland.seats, 5);
assert.equal(highland.drivetrain, 'RWD');

const legacyModelY = get('mf-087.md-004.sm-legacy-long-range-2021__model-y-long-range::v01::t01');
const newModelY = get('mf-087.md-004.sm-juniper__new-model-y-premium::v01::t01');
const modelYL = get('mf-087.md-004.sm-model-y-l__model-y-l::v01::t01');
assert.equal(legacyModelY.production_end, '2025-01');
assert.equal(newModelY.production_start, '2025-02');
assert.equal(newModelY.seats, 5);
assert.equal(modelYL.production_start, '2026-07');
assert.equal(modelYL.seats, 6);
assert.notEqual(modelYL.master_id, newModelY.master_id, 'Model Y L은 5인승 리프레시와 별도 차체 코드여야 한다.');

for (const model of ['s', 'x']) {
  const oldPrefix = `mf-087.md-00${model === 's' ? '1' : '2'}.sm-refresh-2023`;
  const newPrefix = `mf-087.md-00${model === 's' ? '1' : '2'}.sm-refresh-2025`;
  assert(tesla.filter((record) => record.master_id.startsWith(oldPrefix)).every((record) => record.production_end === '2025-05'));
  assert(tesla.filter((record) => record.master_id.startsWith(newPrefix)).every((record) => record.production_start === '2025-06'));
}

assert.equal(get('mf-087.md-002.sm-refresh-2023__model-x::v02::t02').usage_tier, 'blocked');
assert.equal(get('mf-087.md-002.sm-refresh-2025__model-x-2025-plus::v02::t01').usage_tier, 'blocked');

for (const record of tesla) {
  const classification = [
    record.sub_model,
    record.trim,
    record.generation_name,
    record.development_code,
    ...record.trim_aliases,
  ].join(' ');
  assert(!/ryzen|intel\s*atom|라이젠/i.test(classification), `CPU 하드웨어를 차종 분류축으로 사용하면 안 된다: ${record.trim_row_key}`);
}

console.log(`PASS Tesla ${tesla.length}행 세대·차체·기간·좌석·CPU 비분류 계약`);
