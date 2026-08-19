/** Read-only, product-prioritized audit of ad-hoc vehicle-master lineages. */
import { readFileSync, writeFileSync } from 'node:fs';
import { canonicalSubModelLabelIssues } from '../lib/domain/vehicle-canonical-v2';

type MasterRow = {
  trim_row_key: string; master_id: string; maker: string; model: string;
  sub_model: string; development_code: string; generation_name: string;
  powertrain: string; trim: string; production_start: string; production_end: string;
  model_year_start: string; model_year_end: string; evidence_url: string;
};
type CoverageRow = { current_code?: string; candidate_keys?: string[] };

const master = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as {
  data_as_of: string; records: MasterRow[];
};
const coverage = JSON.parse(readFileSync('tmp/product-master-vehicle-coverage.json', 'utf8')) as {
  generated_at: string; source: { rows: number; sheet_fingerprint?: string }; rows: CoverageRow[];
};

const currentUsage = new Map<string, number>();
const candidateUsage = new Map<string, number>();
for (const row of coverage.rows) {
  if (row.current_code) currentUsage.set(row.current_code, (currentUsage.get(row.current_code) || 0) + 1);
  for (const key of new Set(row.candidate_keys || [])) candidateUsage.set(key, (candidateUsage.get(key) || 0) + 1);
}

const groups = new Map<string, MasterRow[]>();
for (const row of master.records) {
  const key = `${row.maker}\u0000${row.model}\u0000${row.master_id}`;
  groups.set(key, [...(groups.get(key) || []), row]);
}

const findings = [...groups.values()].flatMap((rows) => {
  const issues = [...new Set(rows.flatMap((row) => canonicalSubModelLabelIssues(row.sub_model, row.trim)))];
  if (!issues.length) return [];
  const current_product_count = rows.reduce((sum, row) => sum + (currentUsage.get(row.trim_row_key) || 0), 0);
  const candidate_product_count = rows.reduce((sum, row) => sum + (candidateUsage.get(row.trim_row_key) || 0), 0);
  const first = rows[0];
  return [{
    priority: current_product_count > 0 ? 0 : candidate_product_count > 0 ? 1 : 2,
    maker: first.maker, model: first.model, master_id: first.master_id,
    sub_models: [...new Set(rows.map((row) => row.sub_model))],
    development_codes: [...new Set(rows.map((row) => row.development_code).filter(Boolean))],
    generation_names: [...new Set(rows.map((row) => row.generation_name).filter(Boolean))],
    issues, trim_rows: rows.length, current_product_count, candidate_product_count,
    production_ranges: [...new Set(rows.map((row) => `${row.production_start || '?'}~${row.production_end || '?'}`))],
    model_year_ranges: [...new Set(rows.map((row) => `${row.model_year_start || '?'}~${row.model_year_end || '?'}`))],
    official_evidence_urls: [...new Set(rows.map((row) => row.evidence_url).filter(Boolean))],
    evidence_gaps: [
      !first.development_code && 'DEVELOPMENT_CODE',
      !first.generation_name && 'GENERATION_OR_PHASE',
      rows.some((row) => !row.production_start || !row.production_end) && 'PRODUCTION_PERIOD',
      rows.some((row) => !row.evidence_url) && 'OFFICIAL_EVIDENCE_URL',
    ].filter(Boolean),
    required_action: 'RESEARCH_AND_EXACT_MAP',
  }];
}).sort((a, b) => a.priority - b.priority || b.current_product_count - a.current_product_count ||
  b.candidate_product_count - a.candidate_product_count || a.maker.localeCompare(b.maker, 'ko') || a.model.localeCompare(b.model, 'ko'));

const issue_counts: Record<string, number> = {};
for (const finding of findings) for (const issue of finding.issues) issue_counts[issue] = (issue_counts[issue] || 0) + finding.trim_rows;
const report = {
  report_type: 'vehicle_master_ad_hoc_lineage_audit_v1', generated_at: new Date().toISOString(),
  ssot: { master_data_as_of: master.data_as_of, master_rows: master.records.length,
    product_coverage_generated_at: coverage.generated_at, product_rows: coverage.source.rows,
    product_sheet_fingerprint: coverage.source.sheet_fingerprint || '' },
  policy: { canonical_sub_model: 'official phase/lineage name + development code',
    forbidden_atoms: ['model year', 'release text', 'fuel/powertrain', 'sales use', 'body/seat/drivetrain', 'trim', 'parentheses'],
    apply_gate: 'official evidence + exact old/new map + CAS + registry/artifact/product regression' },
  summary: { affected_master_groups: findings.length,
    affected_trim_rows: findings.reduce((sum, row) => sum + row.trim_rows, 0),
    product_referenced_groups: findings.filter((row) => row.current_product_count > 0).length, issue_counts },
  findings,
};
writeFileSync('tmp/vehicle-master-ad-hoc-lineage-audit.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ summary: report.summary, product_priority: findings.filter((row) => row.priority === 0).slice(0, 25) }, null, 2));
