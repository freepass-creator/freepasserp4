import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type RecordRow = {
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
};

const master = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as { records: RecordRow[] };
const k5 = master.records.filter((row) => row.model === 'K5');
const current2027 = k5.filter((row) => row.trim_row_key.includes('sm-dl3-pe-my2027'));

assert.equal(current2027.length, 18, 'The 2027 K5는 자가용 16개와 렌터카 2개 조합이어야 한다.');
assert.ok(current2027.every((row) => row.production_start === '2026-07' && row.production_end === '현재'));
assert.ok(current2027.every((row) => row.model_year_start === '2027' && row.model_year_end === '현재'));
assert.ok(current2027.every((row) => row.usage_tier === 'automatic'), '공식 근거·고유 식별축을 통과한 신규 연식 코드는 자동 배정 가능해야 한다.');

const privateRows = current2027.filter((row) => !row.trim_row_key.includes('-rent__'));
const rentalRows = current2027.filter((row) => row.trim_row_key.includes('-rent__'));
assert.equal(privateRows.length, 16);
assert.deepEqual(rentalRows.map((row) => row.trim).sort(), ['트렌디', '프레스티지']);
assert.ok(rentalRows.every((row) => row.sub_model.includes('렌터카') && row.powertrain.includes('렌터카')));
assert.ok(privateRows.every((row) => !row.sub_model.includes('렌터카') && !row.powertrain.includes('렌터카')));

const expected = new Map<string, string[]>([
  ['하이브리드 2.0', ['프레스티지', '베스트 셀렉션', '노블레스', '시그니처']],
  ['가솔린 2.0', ['스마트 셀렉션', '프레스티지', '베스트 셀렉션', '노블레스', '시그니처']],
  ['가솔린 1.6T', ['프레스티지', '베스트 셀렉션', '노블레스', '시그니처']],
  ['LPG 2.0', ['프레스티지', '노블레스', '시그니처']],
]);
for (const [powertrain, trims] of expected) {
  assert.deepEqual(privateRows.filter((row) => row.powertrain === powertrain).map((row) => row.trim), trims);
}

const legacyCurrent = k5.filter((row) =>
  row.trim_row_key.startsWith('mf-002.md-001.sm-dl3::')
  || row.trim_row_key.startsWith('mf-002.md-001.sm-dl3-pe-best-selection-2026__'),
);
assert.ok(legacyCurrent.every((row) => row.usage_tier === 'blocked'
  && row.production_end === '현재' && row.model_year_end === '현재'));

console.log('PASS K5 2027 contract: private=16 rental=2 legacy-meaning-preserved-and-blocked=15');
