/**
 * 공급사 차량가+옵션을 제조사 공식 가격표와 대조해 이미 존재하는 후보 중
 * 정확히 한 행만 가리키는 결정을 만든다. 읽기 전용이며 결과는 guarded writer의
 * 입력 형식으로 tmp에만 저장한다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFreshProductCoverageReport,
  isTrustedProductCoverageSourceMode,
} from '../lib/domain/product-master-coverage-audit';
import {
  decideRayOfficialPriceEvidence,
  RAY_2027_OFFICIAL_PRICE_RULES,
  RAY_2027_OFFICIAL_SOURCE,
} from '../lib/domain/product-master-official-price-evidence';
import type { VehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';

type Rec = Record<string, unknown>;
type CoverageRow = {
  row: number;
  car_number: string;
  provider: string;
  verification: string;
  current_code: string;
  category: string;
  candidate_keys: string[];
  signal_conflicts: string[];
  audit_axes: Rec;
  source_clues: Rec;
  source_fingerprint: string;
};
type CoverageReport = {
  report_type: string;
  generated_at: string;
  source: Rec;
  master: Rec;
  rows: CoverageRow[];
};

const S = (value: unknown) => String(value ?? '').trim();
const coveragePath = resolve(process.argv.find((arg) => arg.startsWith('--coverage='))?.slice(11)
  || 'tmp/product-master-vehicle-coverage.json');
const outputPath = resolve(process.argv.find((arg) => arg.startsWith('--out='))?.slice(6)
  || 'tmp/product-master-official-price-evidence.json');

const coverage = JSON.parse(readFileSync(coveragePath, 'utf8')) as CoverageReport;
if (!isTrustedProductCoverageSourceMode(S(coverage.source.mode))) throw new Error('라이브 상품마스터 감사 보고서가 아님');
if (coverage.report_type !== 'product_master_vehicle_coverage_v1') throw new Error('지원하지 않는 커버리지 보고서 규격');
assertFreshProductCoverageReport(coverage.generated_at);
const master = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as VehicleTrimMasterArtifact;
const byKey = new Map(master.records.map((record) => [record.trim_row_key, record]));

const decisions = coverage.rows.flatMap((row) => {
  const match = decideRayOfficialPriceEvidence(row, byKey);
  if (!match) return [];
  const { rule } = match;
  return [{
    row: row.row,
    car_number: row.car_number,
    expected_current_code: row.current_code,
    expected_verification: row.verification,
    expected_source_fingerprint: row.source_fingerprint,
    replacement_code: rule.target,
    decision: 'SAFE_CANDIDATE',
    conflicts: [],
    evidence: { rule_id: rule.id, calculation: rule.calculation, ...RAY_2027_OFFICIAL_SOURCE },
  }];
});

const rayUnresolved = coverage.rows.filter((row) => (
  S((row as unknown as { snap_model?: string }).snap_model) === '레이'
  && row.category !== '확정 코드 정상'
));
const decidedRows = new Set(decisions.map((decision) => decision.row));
const reviewQueue = rayUnresolved.filter((row) => !decidedRows.has(row.row)).map((row) => ({
  row: row.row,
  category: row.category,
  reason: !S(row.source_clues.trim)
    ? 'TRIM_MISSING'
    : row.provider !== 'RP004'
      ? 'PRICE_TYPE_UNVERIFIED'
      : 'OFFICIAL_EXACT_RECONCILIATION_FAILED',
  source_fingerprint: row.source_fingerprint,
}));

const duplicateRows = decisions.map((decision) => decision.row)
  .filter((row, index, rows) => rows.indexOf(row) !== index);
if (duplicateRows.length) throw new Error(`공식 가격 규칙이 같은 행을 중복 결정: ${duplicateRows.join(',')}`);

const report = {
  generated_at: new Date().toISOString(),
  coverage_generated_at: coverage.generated_at,
  source: coverage.source,
  master: coverage.master,
  report_type: 'official_price_evidence_v1',
  official_source: RAY_2027_OFFICIAL_SOURCE,
  rule_count: RAY_2027_OFFICIAL_PRICE_RULES.length,
  ray_unresolved_before: rayUnresolved.length,
  matched_rows: decisions.length,
  ray_review_queue_after: reviewQueue.length,
  patch_candidates: decisions,
  review_queue: reviewQueue,
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  ray_unresolved_before: rayUnresolved.length,
  matched_rows: decisions.length,
  rows: decisions.map((row) => row.row),
  ray_review_queue_after: reviewQueue.length,
  review_reasons: Object.fromEntries([...new Set(reviewQueue.map((row) => row.reason))]
    .map((reason) => [reason, reviewQueue.filter((row) => row.reason === reason).length])),
  output: outputPath,
}, null, 2));
