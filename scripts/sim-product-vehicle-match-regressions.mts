import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyProductVehicleMatchView, summarizeProductVehicleMatchView } from '../lib/domain/product-vehicle-match-view';

type Rec = Record<string, any>;
const coverage = JSON.parse(readFileSync('tmp/product-master-vehicle-coverage.json', 'utf8')) as Rec;
const hierarchy = JSON.parse(readFileSync('tmp/product-against-review-master.json', 'utf8')) as Rec;
assert.equal(coverage.report_type, 'product_master_vehicle_coverage_v2_supplier_direct_evidence');
assert.equal(hierarchy.report_type, 'product_against_normalized_review_master_v2_supplier_direct_evidence');
assert.equal(coverage.source.evidence_scope, 'supplier_direct_prefix_only');
assert.equal(hierarchy.source.evidence_scope, 'supplier_direct_prefix_only');
assert.equal(coverage.source.sheet_fingerprint, hierarchy.source.sheet_fingerprint);
assert.equal(coverage.source.rows, 587);
// 카테고리 수치는 코드 반영 때마다 움직인다 — 특정 시점 값(411/48)을 못 박지 않고 합계·양수만 본다(2026-08-18).
assert.ok(Number(coverage.counts['확정 코드 정상']) > 0);
assert.equal(Object.values(coverage.counts as Record<string, number>).reduce((a, b) => a + Number(b), 0), 587);

const coverageByRow = new Map<number, Rec>(coverage.rows.map((row: Rec) => [Number(row.row), row]));
const hierarchyByRow = new Map<number, Rec>(hierarchy.details.map((row: Rec) => [Number(row.row), row]));
const at = (row: number) => ({ coverage: coverageByRow.get(row)!, hierarchy: hierarchyByRow.get(row)! });
const trimArtifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as Rec;
const trimByKey = new Map<string, Rec>(trimArtifact.records.map((row: Rec) => [row.trim_row_key, row]));

for (const row of coverage.rows.filter((item: Rec) => item.category === '확정 코드 정상')) {
  assert.ok(trimByKey.has(row.current_code), `strict current key must exist: row ${row.row}`);
  assert.ok(row.candidate_keys.includes(row.current_code), `strict current key must be in supplier-direct candidates: row ${row.row}`);
}
const confirmedPropertyByAxis: Record<string, string> = {
  sub_model: 'subModel', trim: 'trim', fuel: 'fuel', engine_cc: 'engineCc', drive: 'drive', seats: 'seats',
};
for (const row of hierarchy.details) {
  for (const axis of row.partial_resolution.conflictAxes || []) {
    assert.ok(!row.partial_resolution.confirmed[confirmedPropertyByAxis[axis]], `conflicting axis must not be confirmed: row ${row.row}/${axis}`);
  }
  if (row.partial_resolution.statusLabel === '계층 단일 특정') {
    assert.deepEqual(row.partial_resolution.unresolvedAxes, []);
    assert.doesNotMatch(row.partial_resolution.display, /미확정|\(입력\)|충돌/);
  }
  if (row.partial_source_conflict) {
    assert.ok(['계층 다중매칭', '계층 무매칭', '식별축 부족'].includes(row.hierarchy_category));
    assert.equal(row.hierarchy_candidate, null);
  }
}

{
  const row = at(188);
  // 2026-08-18 사람 승인으로 코드가 박혔다 — 승인 전(승인대기)·후(확정 정상) 둘 다 허용하되 키는 같은 하나여야 한다.
  assert.ok(['단일 자동후보(승인대기)', '확정 코드 정상'].includes(row.coverage.category), row.coverage.category);
  assert.deepEqual(row.coverage.candidate_keys, ['mf-012.md-003.sm-g60::v01::t02']);
  if (row.coverage.category === '확정 코드 정상') assert.equal(row.coverage.current_code, 'mf-012.md-003.sm-g60::v01::t02');
  assert.match(row.coverage.audit_axes.trim_evidence, /reviewed alias/);
  assert.equal(row.hierarchy.category, '무매칭', 'hierarchy-only recovery must not rewrite exact review classification');
  assert.equal(row.hierarchy.hierarchy_category, '계층 단일매칭');
  assert.equal(row.hierarchy.partial_resolution.confirmed.subModel, '5시리즈 G60');
  assert.equal(row.hierarchy.partial_resolution.confirmed.trim, '520i M 스포츠');
}

{
  const row = at(261);
  assert.equal(row.coverage.category, '안전 후보 없음');
  assert.deepEqual(row.coverage.candidate_keys, []);
  assert.equal(row.coverage.audit_axes.drive, '', 'normalized AWD tail must not become supplier-direct evidence');
  assert.equal(row.hierarchy.hierarchy_category, '계층 단일매칭');
  assert.equal(row.hierarchy.partial_resolution.confirmed.trim, 'Long Range');
  assert.deepEqual(row.hierarchy.partial_resolution.unresolvedAxes, []);
}

{
  const row = at(361);
  assert.equal(row.coverage.category, '안전 후보 없음');
  assert.deepEqual(row.coverage.candidate_keys, []);
  assert.equal(row.hierarchy.partial_resolution.basis, 'source_only');
  assert.doesNotMatch(row.hierarchy.partial_resolution.display, /A6 C8|A6 C9/);
}

assert.equal(at(109).hierarchy.partial_resolution.candidateCount, 3);
assert.match(at(109).hierarchy.partial_resolution.display, /더 뉴 기아 레이 TAM.*2인승\/5인승/);
assert.match(at(125).hierarchy.partial_resolution.display, /더 뉴 그랜저 IG/);
assert.equal(at(127).hierarchy.partial_resolution.basis, 'source_only');
assert.equal(at(172).hierarchy.partial_resolution.candidateCount, 4);
assert.match(at(172).hierarchy.partial_resolution.display, /K8 GL3.*5인승.*세부트림 미확정\(4종\)/);
assert.equal(at(477).hierarchy.partial_resolution.candidateCount, 3);
assert.match(at(477).hierarchy.partial_resolution.display, /쿠퍼 C F66\/F65.*5인승/);

const row93 = at(93).hierarchy;
assert.equal(row93.hierarchy_category, '계층 무매칭');
assert.equal(row93.hierarchy_candidate, null);
assert.match(row93.partial_resolution.display, /1,500cc\(입력\)/);
assert.doesNotMatch(row93.partial_resolution.display, /1,998cc/);
for (const rowNumber of [330, 334]) {
  const row = at(rowNumber).hierarchy;
  assert.equal(row.hierarchy_category, '계층 무매칭');
  assert.equal(row.hierarchy_candidate, null);
  assert.ok(row.partial_resolution.conflictAxes.includes('fuel'));
  assert.match(row.partial_resolution.display, /연료 충돌\(입력:하이브리드; 정본후보:가솔린\)/);
}
assert.ok(at(334).hierarchy.partial_resolution.conflictAxes.includes('drive'));
assert.match(at(334).hierarchy.partial_resolution.display, /구동 충돌\(입력:AWD; 정본후보:FWD\)/);
const row587 = at(587).hierarchy;
assert.equal(row587.hierarchy_category, '계층 무매칭');
assert.match(row587.partial_resolution.display, /2,497cc/);
assert.doesNotMatch(row587.partial_resolution.display, /1,998cc/);

const summary = summarizeProductVehicleMatchView(coverage.rows.map((audit: Rec) => classifyProductVehicleMatchView(
  audit,
  hierarchyByRow.get(Number(audit.row))!,
)));
// 확정/검토 수는 코드 반영마다 움직인다 — 불변식만 본다: 합계 587, 확정+검토=587, 계층연결+계층검토=587, 확정인데 계층 없음 0.
assert.equal(summary.total, 587);
assert.equal(summary.strictConfirmed + summary.strictReview, 587);
assert.equal(summary.hierarchyLinked + summary.hierarchyReview, 587);
assert.equal(summary.strictConfirmedWithoutHierarchy, 0);
assert.equal(summary.strictConfirmed, coverage.counts['확정 코드 정상']);

console.log('PASS product vehicle match regressions — direct provenance, partial axes, strict/hierarchy separation');
