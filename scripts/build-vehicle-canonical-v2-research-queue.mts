/** Build a deterministic research queue from the actual product-master coverage report. */
import { readFileSync, writeFileSync } from 'node:fs';

type ProductRow = {
  snap_maker?: string;
  snap_model?: string;
  source_code_clue?: { maker?: string; model?: string } | null;
};
const report = JSON.parse(readFileSync('tmp/product-master-vehicle-coverage.json', 'utf8')) as { rows: ProductRow[] };
const counts = new Map<string, { maker: string; model: string; products: number }>();
for (const row of report.rows) {
  const maker = String(row.snap_maker || row.source_code_clue?.maker || '').trim();
  const model = String(row.snap_model || row.source_code_clue?.model || '').trim();
  if (!maker || !model) continue;
  const key = `${maker}\u0000${model}`;
  const current = counts.get(key) || { maker, model, products: 0 };
  current.products += 1;
  counts.set(key, current);
}
const queue = [...counts.values()]
  .sort((a, b) => b.products - a.products || a.maker.localeCompare(b.maker, 'ko') || a.model.localeCompare(b.model, 'ko'))
  .map((item, index) => ({
    priority: index + 1,
    ...item,
    status: 'research_required',
    required_sources: ['manufacturer_official', 'carnoon_new', 'carnoon_used', 'encar_used'],
    required_gates: [
      'generation_phase_boundary',
      'canonical_sub_model',
      'powertrain_required',
      'official_selectable_drivetrain',
      'official_selectable_seats',
      'sales_type',
      'trim',
      'display_collision_zero',
    ],
  }));
const output = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  source: 'tmp/product-master-vehicle-coverage.json',
  product_count: report.rows.length,
  model_count: queue.length,
  queue,
};
writeFileSync('tmp/vehicle-canonical-v2-research-queue.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ product_count: output.product_count, model_count: output.model_count, top: queue.slice(0, 20) }, null, 2));
