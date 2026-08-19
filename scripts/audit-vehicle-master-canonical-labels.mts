/** Read-only audit for display-axis pollution in the last 10 years of vehicle master rows. */
import { readFileSync, writeFileSync } from 'node:fs';
import { canonicalSubModelLabelIssues } from '../lib/domain/vehicle-canonical-v2';

type Row = {
  trim_row_key: string;
  maker: string;
  model: string;
  sub_model: string;
  development_code: string;
  powertrain: string;
  trim: string;
  production_start: string;
  production_end: string;
};

const NOW_YEAR = 2026;
const MIN_YEAR = NOW_YEAR - 10;
const artifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as { records: Row[] };
const S = (value: unknown) => String(value ?? '').trim();
const endYear = (value: unknown) => {
  const text = S(value);
  if (!text || text === '현재') return NOW_YEAR;
  const match = /(?:19|20)\d{2}/.exec(text);
  return match ? Number(match[0]) : NOW_YEAR;
};

type Finding = Row & { issues: string[] };
const findings: Finding[] = [];
for (const row of artifact.records) {
  if (endYear(row.production_end) < MIN_YEAR) continue;
  const sub = S(row.sub_model);
  const issues = canonicalSubModelLabelIssues(sub, row.trim);
  if (issues.length) findings.push({ ...row, issues: [...new Set(issues)] });
}

const issueCounts: Record<string, number> = {};
const makerCounts: Record<string, number> = {};
for (const finding of findings) {
  for (const issue of finding.issues) issueCounts[issue] = (issueCounts[issue] || 0) + 1;
  makerCounts[finding.maker] = (makerCounts[finding.maker] || 0) + 1;
}
const report = {
  generated_at: new Date().toISOString(),
  scope: { production_end_year_gte: MIN_YEAR, source_rows: artifact.records.length },
  affected_rows: findings.length,
  issue_counts: issueCounts,
  maker_counts: Object.fromEntries(Object.entries(makerCounts).sort((a, b) => b[1] - a[1])),
  findings,
};
writeFileSync('tmp/vehicle-master-canonical-label-audit.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ scope: report.scope, affected_rows: report.affected_rows, issue_counts: issueCounts, top_makers: Object.entries(report.maker_counts).slice(0, 15) }, null, 2));
