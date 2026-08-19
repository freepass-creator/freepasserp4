/** Read-only exact plan. Does not call Sheets and never writes master data. */
import { readFileSync, writeFileSync } from 'node:fs';
import type { VehicleBodyConfiguration, VehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';

const artifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as VehicleTrimMasterArtifact;
const targets: Record<string, string> = {
  'mf-002.md-058.sm-tam__new-레이-tam': '더 뉴 레이 TAM',
  'mf-002.md-058.sm-tam__new-레이-tam__van': '더 뉴 레이 TAM',
  'mf-002.md-058.sm-tam-my2026__ray-product': '더 뉴 기아 레이 TAM',
  'mf-002.md-058.sm-tam-ray-gas-2027-korea__the-2027-ray': '더 뉴 기아 레이 TAM',
};

const bodyOf = (subModel: string, powertrain: string, seats: number | null): VehicleBodyConfiguration => {
  const text = `${subModel} ${powertrain}`;
  if (/1\s*인승\s*밴/i.test(text)) return '1인승 밴';
  // JS의 ASCII \b는 한글 `밴` 경계를 인식하지 못하므로 사용하지 않는다.
  if (/2\s*인승\s*밴|밴/i.test(text) && seats === 2) return '2인승 밴';
  if (/승용/i.test(text) || (seats != null && seats >= 4)) return '승용';
  throw new Error(`차체구성 단정 불가: ${subModel} / ${powertrain} / ${seats ?? '-'}`);
};

const rows = artifact.records.filter((row) => targets[row.master_id]).map((row) => ({
  trim_row_key: row.trim_row_key,
  expected_sub_model: row.sub_model,
  replacement_sub_model: targets[row.master_id],
  body_configuration: bodyOf(row.sub_model, row.powertrain, row.seats),
  source_aliases_to_add: [row.sub_model],
  preserved: {
    master_id: row.master_id, powertrain: row.powertrain, trim: row.trim,
    production_start: row.production_start, production_end: row.production_end,
    model_year_start: row.model_year_start, model_year_end: row.model_year_end,
    fuel: row.fuel, drivetrain: row.drivetrain, seats: row.seats,
  },
}));

const keyCount = new Set(rows.map((row) => row.trim_row_key)).size;
if (keyCount !== rows.length) throw new Error('Ray V2 계획에 중복 영구키가 있습니다.');
const bodyCounts = Object.fromEntries(['승용', '1인승 밴', '2인승 밴'].map((body) => [body, rows.filter((row) => row.body_configuration === body).length]));
const report = {
  report_type: 'ray_canonical_v2_migration_plan', generated_at: new Date().toISOString(),
  write: 0,
  prerequisites: ['차체구성 열', '원문별칭 열', 'semantic registry V2', 'CAS snapshot/rollback', '587대 coverage before/after'],
  counts: { rows: rows.length, permanent_keys_preserved: keyCount, ...bodyCounts },
  rows,
};
writeFileSync('tmp/ray-canonical-v2-migration-plan.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ write: report.write, counts: report.counts, sub_models: [...new Set(rows.map((row) => `${row.expected_sub_model} -> ${row.replacement_sub_model}`))] }, null, 2));
