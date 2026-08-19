import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type Row = {
  trim_row_key: string;
  model: string;
  sub_model: string;
  powertrain: string;
  trim: string;
  generation_name: string;
  development_code: string;
  production_start: string;
  production_end: string;
  model_year_start: string;
  usage_tier: string;
  fuel: string;
  engine_cc: number | null;
  turbo: boolean | null;
  drivetrain: string;
  seats: number | null;
};

const data = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as { records: Row[] };
const grandeur = data.records.filter((row) => row.trim_row_key.includes('sm-gn11__the-new-grandeur::'));

assert.equal(grandeur.length, 18);
assert.deepEqual([...new Set(grandeur.map((row) => row.powertrain))], [
  '가솔린 2.5 2WD',
  '가솔린 3.5 2WD',
  '가솔린 3.5 4WD',
  'LPG 3.5 2WD',
  '하이브리드 1.6T 2WD',
]);
assert.deepEqual(grandeur.filter((row) => row.fuel === 'LPG').map((row) => row.trim), ['프리미엄', '익스클루시브']);
assert.deepEqual(grandeur.filter((row) => row.fuel !== 'LPG' && row.drivetrain !== '4WD').reduce<string[]>((trims, row) => {
  if (!trims.includes(row.trim)) trims.push(row.trim);
  return trims;
}, []), ['프리미엄', '익스클루시브', '캘리그래피', '블랙 잉크']);
assert.ok(grandeur.every((row) =>
  row.model === '그랜저'
  && row.sub_model === '그랜저 GN11'
  && row.generation_name === '7세대 부분변경'
  && row.development_code === 'GN11'
  && row.production_start === '2026-05'
  && row.production_end === '현재'
  && row.model_year_start === '2026'
  && row.usage_tier === 'automatic'
  && row.seats === 5
));
assert.ok(grandeur.filter((row) => row.engine_cc === 1598).every((row) => row.turbo === true));
assert.ok(grandeur.filter((row) => row.engine_cc === 2497 || row.engine_cc === 3470).every((row) => row.turbo === false));

console.log('PASS Grandeur 2026 contract: GN11=18 sub=그랜저 GN11 (no 더뉴+코드 중첩)');
