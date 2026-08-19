/** 잔여 unreviewed 덤프 — PLAN 오더1 입력 */
import { writeFileSync, readFileSync } from 'node:fs';

const backlog = JSON.parse(readFileSync('tmp/product-master-vehicle-resolution-backlog.json', 'utf8')) as any;
const coverage = JSON.parse(readFileSync('tmp/product-master-vehicle-coverage.json', 'utf8')) as any;
const decisions = JSON.parse(readFileSync('data/product-vehicle-review-decisions.json', 'utf8')) as any;
const decided = new Set((decisions.decisions || []).map((d: any) => String(d.car_number).replace(/\s/g, '')));

const backlogRows: any[] = backlog.rows || [];
const unreviewed = backlogRows.filter((r) => !String(r.resolution_class || '').startsWith('REVIEWED_'));
const byPlate = new Map((coverage.rows || []).map((r: any) => [String(r.car_number || '').replace(/\s/g, ''), r]));

const enriched = unreviewed.map((r) => {
  const plate = String(r.car_number || '').replace(/\s/g, '');
  const cov = byPlate.get(plate) || {};
  return {
    ...r,
    car_number: plate,
    already_decided: decided.has(plate),
    coverage: {
      category: cov.category,
      snap_maker: cov.snap_maker,
      snap_model: cov.snap_model,
      snap_sub_model: cov.snap_sub_model,
      snap_trim: cov.snap_trim,
      snap_code: cov.snap_code || cov.trim_row_key || cov.current_code,
      current_code: cov.current_code || cov.trim_row_key || cov.vehicle_trim_code,
      source_clues: cov.source_clues,
      candidate_keys: cov.candidate_keys,
      candidate_differences: cov.candidate_differences,
      signal_conflicts: cov.signal_conflicts,
      supplier_text: cov.supplier_text || cov.source_text || cov.raw_vehicle,
      provider: cov.provider || cov.provider_company_code,
      year: cov.year || cov.model_year,
      first_reg: cov.first_registered_at || cov.first_reg,
    },
  };
});

const byClass = new Map<string, number>();
for (const r of enriched) byClass.set(r.resolution_class, (byClass.get(r.resolution_class) || 0) + 1);

const out = {
  decided_count: decided.size,
  unreviewed_count: enriched.length,
  by_class: Object.fromEntries([...byClass.entries()].sort((a, b) => b[1] - a[1])),
  rows: enriched,
};
writeFileSync('tmp/unreviewed-102.json', JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({ decided_count: out.decided_count, unreviewed_count: out.unreviewed_count, by_class: out.by_class }, null, 2));
