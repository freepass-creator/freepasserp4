/** Aggregate-only final gate for the latest live product-master coverage audit. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isTrustedProductCoverageSourceMode } from '../lib/domain/product-master-coverage-audit';

type Report = {
  report_type?: string;
  source: { rows: number; mode: string; evidence_scope?: string };
  counts: Record<string, number>;
  gates: Record<string, number>;
  patch_candidates: unknown[];
  rows: Array<{ category: string; signal_conflicts?: string[] }>;
};
const arg = (name: string, fallback = '') =>
  (process.argv.find((value) => value.startsWith(`--${name}=`)) || '').slice(name.length + 3) || fallback;
const reportPath = arg('report', 'tmp/product-master-vehicle-coverage.json');
const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
assert.equal(report.report_type, 'product_master_vehicle_coverage_v2_supplier_direct_evidence', 'supplier-direct coverage v2만 최종 게이트로 인정합니다.');
assert.equal(report.source.evidence_scope, 'supplier_direct_prefix_only', '정제 꼬리가 배제된 직접 원문 증거만 인정합니다.');
assert.ok(
  isTrustedProductCoverageSourceMode(report.source.mode),
  '직전 라이브 API 또는 Workspace 커넥터 스냅샷 감사만 최종 게이트로 인정합니다.',
);
assert.equal(report.source.rows, 587, '상품마스터 기준 차량 수가 달라졌습니다.');
assert.equal(Object.values(report.counts).reduce((sum, count) => sum + count, 0), 587, '분류 합계가 587대와 다릅니다.');
assert.equal(report.gates.blocked_key_references, 0, '차단키 참조가 남았습니다.');
assert.equal(report.gates.nonexistent_key_references, 0, '존재하지 않는 키 참조가 남았습니다.');
assert.equal(report.patch_candidates.length, 0, '검토되지 않은 단일 자동후보가 남았습니다.');
assert.equal(report.counts['단일 자동후보(승인대기)'] || 0, 0, '승인대기 단일후보가 남았습니다.');
assert.equal(report.counts['확정 코드 명시축 불일치'] || 0, 0, '잘못된 1:1 확정 코드가 남았습니다.');
assert.equal(report.rows.filter((row) => row.category === '확정 코드 명시축 불일치').length, 0);
console.log(JSON.stringify({
  pass: true,
  products: report.source.rows,
  confirmed: report.counts['확정 코드 정상'] || 0,
  review_queue: {
    no_candidate: report.counts['안전 후보 없음'] || 0,
    multi_candidate: report.counts['다중 자동후보'] || 0,
    manual_candidate: report.counts['수동후보 있음'] || 0,
    source_conflict: report.counts['원천 입력 충돌'] || 0,
  },
  blocked_key_references: 0,
  wrong_one_to_one: 0,
}, null, 2));
