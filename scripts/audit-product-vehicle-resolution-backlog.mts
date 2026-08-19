import fs from 'node:fs';
import path from 'node:path';
import { productVehicleReviewDecisionMap, productVehicleReviewDecisionReason } from '../lib/domain/product-vehicle-review-decisions';

type Row = {
  row: number;
  car_number?: string;
  category: string;
  signal_conflicts?: unknown[];
  snap_maker?: string;
  snap_model?: string;
  audit_axes?: Record<string, unknown>;
  source_clues?: Record<string, unknown>;
  source_code_clue?: Record<string, unknown> | null;
  candidate_differences?: Record<string, string[]>;
  candidate_keys?: string[];
};

const S = (value: unknown) => String(value ?? '').trim();

const sourcePath = path.resolve('tmp/product-master-vehicle-coverage.json');
const outputPath = path.resolve('tmp/product-master-vehicle-resolution-backlog.json');
const report = JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as { report_type?: string; generated_at: string; source: Record<string, unknown>; rows: Row[] };
if (report.report_type !== 'product_master_vehicle_coverage_v2_supplier_direct_evidence'
  || S(report.source?.evidence_scope) !== 'supplier_direct_prefix_only') {
  throw new Error('supplier-direct coverage v2 보고서가 아니므로 검토 큐 생성을 중단합니다.');
}

const unresolved = report.rows.filter((row) => row.category !== '확정 코드 정상');
// 사람 검토 결정(3축)이 있는 행은 기계 분류 대신 「검토완료」 축으로 나눈다 — 정본 data/product-vehicle-review-decisions.json.
const decisions = productVehicleReviewDecisionMap();
const classified = unresolved.map((row) => {
  const decided = decisions.get(String(row.car_number ?? '').replace(/\s/g, ''));
  const axes = row.audit_axes || {};
  const clues = row.source_clues || {};
  const differences = row.candidate_differences || {};
  const unread: string[] = [];
  if (S(clues.sub_model) && differences.sub_model?.length) unread.push('sub_model');
  if (S(clues.powertrain) && differences.powertrain?.length) unread.push('powertrain');
  if (S(clues.trim) && differences.trim?.length) unread.push('trim');
  if (S(clues.battery) && differences.battery_kwh?.length) unread.push('battery_kwh');
  if (S(clues.body_or_use) && (differences.seats?.length || differences.sub_model?.length)) unread.push('body_or_use');
  const priceOrOption = Boolean(Number(clues.vehicle_price) || S(clues.option));
  const legacyCode = Boolean(row.source_code_clue);
  const conflicts = row.signal_conflicts || [];
  let resolution_class = 'CLUE_EXTRACTION_RECHECK';
  if (conflicts.length) resolution_class = 'SOURCE_CONFLICT';
  else if (row.category === '안전 후보 없음' && legacyCode) resolution_class = 'LEGACY_CODE_RECONCILIATION';
  else if (row.category === '안전 후보 없음') resolution_class = 'MASTER_KEY_OR_ALIAS_RECHECK';
  else if (row.category === '다중 자동후보' && priceOrOption) resolution_class = 'PRICE_OPTION_LOOKUP_REQUIRED';
  else if (row.category === '다중 자동후보' && legacyCode) resolution_class = 'LEGACY_CODE_RECONCILIATION';
  else if (row.category === '다중 자동후보' && unread.length) resolution_class = 'EXISTING_CLUE_RECHECK';
  else if (row.category === '다중 자동후보') resolution_class = 'CANDIDATE_AXIS_LOOKUP_REQUIRED';
  else if (row.category === '수동후보 있음') resolution_class = 'MASTER_EVIDENCE_REVIEW';
  if (decided) resolution_class = `REVIEWED_${decided.decision}`;
  return {
    row: row.row,
    category: row.category,
    resolution_class,
    maker: row.snap_maker || '',
    model: row.snap_model || '',
    existing_clue_axes: unread,
    clue_presence: {
      sub_model: Boolean(S(clues.sub_model)), powertrain: Boolean(S(clues.powertrain)),
      trim: Boolean(S(clues.trim)), option: Boolean(S(clues.option)),
      vehicle_price: Boolean(Number(clues.vehicle_price)), body_or_use: Boolean(S(clues.body_or_use)),
      transmission: Boolean(S(clues.transmission)), battery: Boolean(S(clues.battery)),
      source_vehicle_code: legacyCode,
    },
    candidate_difference_axes: Object.keys(differences),
    candidate_count: row.candidate_keys?.length || 0,
    reviewed_triple: decided ? { maker: decided.maker, model: decided.model, sub_model: decided.sub_model, trim: decided.trim,
      code: decided.trim_row_key || decided.candidate_key || '', master_action: decided.master_action } : undefined,
    next_action: decided ? productVehicleReviewDecisionReason(decided)
      : resolution_class === 'EXISTING_CLUE_RECHECK'
      ? `공급사 원문에 이미 있는 축 재해석: ${unread.join(', ')}`
      : resolution_class === 'MASTER_KEY_OR_ALIAS_RECHECK'
        ? '공급사 단서와 국내 차종마스터의 누락 키·별칭을 함께 재대조'
        : resolution_class === 'LEGACY_CODE_RECONCILIATION'
          ? '과거 차종코드의 의미축을 현재 영구키와 대조하되 코드 자체는 신뢰하지 않음'
          : resolution_class === 'PRICE_OPTION_LOOKUP_REQUIRED'
            ? '공급사 차량가·옵션을 공식 가격표와 대조해 후보 차이축 확정'
            : resolution_class === 'CANDIDATE_AXIS_LOOKUP_REQUIRED'
              ? `후보 차이축 원천 재조회: ${Object.keys(differences).join(', ')}`
      : resolution_class === 'SOURCE_CONFLICT'
                ? '같은 원본 행의 상충 필드를 재확인하고 충돌 해소 전 자동연결 금지'
                : '차종마스터 수동행의 공식 근거를 재검토',
  };
});

const counts = Object.fromEntries([...new Set(classified.map((row) => row.resolution_class))]
  .sort().map((name) => [name, classified.filter((row) => row.resolution_class === name).length]));
const recheckByModel = Object.entries(classified
  .reduce<Record<string, number>>((acc, row) => {
    const key = `${row.resolution_class} / ${row.maker || '(미상)'} / ${row.model || '(미상)'}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);

const reviewedCount = classified.filter((row) => row.resolution_class.startsWith('REVIEWED_')).length;
const output = {
  generated_at: new Date().toISOString(),
  reviewed: reviewedCount,
  unreviewed: classified.length - reviewedCount,
  input_generated_at: report.generated_at,
  source: report.source,
  policy: {
    priority: ['SOURCE_CONFLICT', 'EXISTING_CLUE_RECHECK', 'LEGACY_CODE_RECONCILIATION', 'MASTER_KEY_OR_ALIAS_RECHECK', 'PRICE_OPTION_LOOKUP_REQUIRED', 'CANDIDATE_AXIS_LOOKUP_REQUIRED', 'MASTER_EVIDENCE_REVIEW'],
    note: '공급사 입력 부족으로 단정하지 않고 기존 원문 단서·마스터 누락·원천 충돌을 분리한다. 과거 코드와 가격은 단서일 뿐 자동확정 근거가 아니다.',
  },
  total_unresolved: classified.length,
  counts,
  recheck_by_model: recheckByModel,
  rows: classified,
};
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ total_unresolved: classified.length, reviewed: reviewedCount, unreviewed: classified.length - reviewedCount, counts, recheck_by_model: recheckByModel.filter(([key]) => !key.startsWith('REVIEWED_')) }, null, 2));
