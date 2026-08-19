/**
 * 사람 검토 결정(`data/product-vehicle-review-decisions.json`)을 상품마스터에 반영할 계획을 만든다.
 *
 * ★범위는 3축(모델·세부모델·세부트림) — 사장님 2026-08-18 확정. 코드는 3축이 확정되고 알려진 축과
 *   모순 없는 automatic 영구키가 하나일 때만(decision=CODE) 박는다.
 * - 이 스크립트는 읽기 전용이다. 라이브 상품마스터 A:AX 를 읽어 결정별 행·지문을 확인하고,
 *   CODE 결정을 `apply-product-master-vehicle-coverage.mts` 가 받는 guarded 보고서(SAFE_CANDIDATE)로 내보낸다.
 *   실제 write 는 그 writer 가 CAS·스냅샷·재조회를 걸고 한다. 여기서 만든 보고서는 10분 안에 써야 한다.
 * - TRIPLE/PARTIAL/HOLD 는 코드 없이 요약만 낸다. 그 결정은 백로그 감사(`audit-product-vehicle-resolution-backlog`)가
 *   읽어 「검토완료」로 분류하고, 판매시트 발행은 3축 값을 그대로 쓴다.
 *
 *   npx tsx scripts/plan-product-vehicle-review-decisions.mts
 *   npx tsx scripts/apply-product-master-vehicle-coverage.mts --report=tmp/product-vehicle-review-decisions-report.json
 *   npx tsx scripts/apply-product-master-vehicle-coverage.mts --report=tmp/product-vehicle-review-decisions-report.json --apply
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JWT } from 'google-auth-library';
import {
  DEFAULT_PRODUCT_MASTER_SHEET_ID,
  PRODUCT_MASTER_COLUMNS,
  PRODUCT_MASTER_TAB,
} from '../lib/domain/product-master-sheet';
import {
  productCoverageRowFingerprint,
  productCoverageSheetFingerprint,
} from '../lib/domain/product-master-coverage-audit';
import type { VehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import {
  loadProductVehicleReviewDecisions,
  type ProductVehicleReviewDecision,
} from '../lib/domain/product-vehicle-review-decisions';

type Rec = Record<string, unknown>;
const S = (value: unknown) => String(value ?? '').trim();
const plate = (value: unknown) => S(value).replace(/\s/g, '');
const arg = (name: string, fallback: string) =>
  (process.argv.find((value) => value.startsWith(`--${name}=`)) || '').slice(name.length + 3) || fallback;
const outputPath = resolve(arg('out', 'tmp/product-vehicle-review-decisions-report.json'));
const sheetId = arg('sheet', DEFAULT_PRODUCT_MASTER_SHEET_ID);

const decisions = loadProductVehicleReviewDecisions();
const artifactRaw = readFileSync('public/data/vehicle-trim-master.json', 'utf8');
const artifact = JSON.parse(artifactRaw) as VehicleTrimMasterArtifact;
const artifactSha256 = createHash('sha256').update(artifactRaw).digest('hex');
const byKey = new Map(artifact.records.map((row) => [row.trim_row_key, row]));

// 결정 파일 자체 검증 — 코드가 마스터에 실재하고 automatic/확정/확정인지, 3축이 코드와 어긋나지 않는지.
const fileIssues: string[] = [];
const seen = new Set<string>();
for (const d of decisions.decisions) {
  if (seen.has(d.car_number)) fileIssues.push(`차량번호 중복: ${d.car_number}`);
  seen.add(d.car_number);
  if (d.decision === 'CODE') {
    const master = byKey.get(d.trim_row_key);
    if (!master) { fileIssues.push(`${d.car_number}: 코드 없음 ${d.trim_row_key}`); continue; }
    if (master.usage_tier !== 'automatic' || master.management_status !== '확정' || master.verification_status !== '확정') {
      fileIssues.push(`${d.car_number}: automatic 확정키 아님 ${d.trim_row_key} (${master.usage_tier})`);
    }
    if (master.maker !== d.maker || master.model !== d.model) fileIssues.push(`${d.car_number}: 코드의 제조사/모델(${master.maker} ${master.model})과 결정(${d.maker} ${d.model}) 불일치`);
    if (!d.trim) fileIssues.push(`${d.car_number}: CODE 결정인데 세부트림 비어 있음`);
  }
  // candidate_key 는 TRIPLE/PARTIAL 보강 힌트다. 차종마스터 keep-reviewed 이후 원장에서
  // 빠진 키는 CODE 반영을 막지 않고 경고만 남긴다(코드 write 는 trim_row_key 만 본다).
  if (d.candidate_key && !byKey.get(d.candidate_key)) {
    if (d.decision === 'CODE') fileIssues.push(`${d.car_number}: candidate_key 없음 ${d.candidate_key}`);
  }
  if ((d.decision === 'TRIPLE' || d.decision === 'CODE') && !(d.model && d.sub_model && d.trim)) {
    fileIssues.push(`${d.car_number}: ${d.decision} 결정인데 3축이 비어 있음`);
  }
}
if (fileIssues.length) throw new Error(`결정 파일 검증 실패:\n${fileIssues.join('\n')}`);
const orphanCandidateKeys = decisions.decisions
  .filter((d) => d.candidate_key && !byKey.get(d.candidate_key) && d.decision !== 'CODE')
  .map((d) => `${d.car_number}:${d.candidate_key}`);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const auth = new JWT({ email: S(sa.client_email), key: S(sa.private_key),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const token = (await auth.getAccessToken()).token;
const api = async (url: string) => {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Sheets HTTP ${response.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text) as Rec;
};
const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
const live = await api(`${base}/values/${encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A:AX`)}`) as { values?: unknown[][] };
const values = live.values || [];
const headers = (values[0] || []).map(S);
if (headers.length !== PRODUCT_MASTER_COLUMNS.length || PRODUCT_MASTER_COLUMNS.some((name, index) => headers[index] !== name)) {
  throw new Error('상품마스터 A:AX 헤더 불일치');
}
const col = (name: (typeof PRODUCT_MASTER_COLUMNS)[number]) => PRODUCT_MASTER_COLUMNS.indexOf(name);
const width = PRODUCT_MASTER_COLUMNS.length;
const rowsByPlate = new Map<string, number[]>();
values.slice(1).forEach((row, index) => {
  const key = plate(row[col('차량번호')]);
  if (!key) return;
  rowsByPlate.set(key, [...(rowsByPlate.get(key) || []), index + 2]);
});

type Candidate = {
  row: number; car_number: string; expected_current_code: string; expected_verification: string;
  expected_source_fingerprint: string; replacement_code: string; decision: 'SAFE_CANDIDATE'; conflicts: string[];
  review_basis: string;
};
const patchCandidates: Candidate[] = [];
const alreadyApplied: string[] = [];
const notFound: string[] = [];
const summary: Array<Rec> = [];
for (const d of decisions.decisions) {
  const rows = rowsByPlate.get(d.car_number) || [];
  if (rows.length !== 1) { notFound.push(`${d.car_number} (행 ${rows.length}개)`); continue; }
  const rowNumber = rows[0];
  const row = values[rowNumber - 1] || [];
  const currentCode = S(row[col('차종코드')]);
  const verification = S(row[col('검증상태')]);
  summary.push({ row: rowNumber, car_number: d.car_number, decision: d.decision, maker: d.maker, model: d.model,
    sub_model: d.sub_model, trim: d.trim, code: d.trim_row_key || d.candidate_key || '', master_action: d.master_action,
    current_code: currentCode, current_verification: verification });
  if (d.decision !== 'CODE') continue;
  if (currentCode === d.trim_row_key && verification === '확정') { alreadyApplied.push(d.car_number); continue; }
  patchCandidates.push({
    row: rowNumber, car_number: d.car_number, expected_current_code: currentCode, expected_verification: verification,
    expected_source_fingerprint: productCoverageRowFingerprint(row, width), replacement_code: d.trim_row_key,
    decision: 'SAFE_CANDIDATE', conflicts: [], review_basis: d.basis,
  });
}
if (notFound.length) throw new Error(`라이브 상품마스터에서 차량번호를 유일하게 찾지 못함: ${notFound.join(', ')}`);

const counts = Object.fromEntries(['CODE', 'TRIPLE', 'PARTIAL', 'HOLD'].map((kind) =>
  [kind, decisions.decisions.filter((d) => d.decision === kind).length]));
const report = {
  report_type: 'product_master_vehicle_coverage_v1',
  generated_at: new Date().toISOString(),
  reviewer: decisions.reviewed_by,
  scope: decisions.scope,
  source: {
    sheet_id: sheetId, tab: PRODUCT_MASTER_TAB, rows: values.length - 1, mode: 'live_sheet',
    evidence_scope: 'human_review_decisions_v1',
    sheet_fingerprint: productCoverageSheetFingerprint(values.slice(1), width),
  },
  master: { artifact_sha256: artifactSha256, records: artifact.records.length },
  counts: { ...counts, code_patch_candidates: patchCandidates.length, code_already_applied: alreadyApplied.length },
  patch_candidates: patchCandidates,
  decisions: summary,
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: outputPath, counts: report.counts, already_applied: alreadyApplied,
  orphan_candidate_keys: orphanCandidateKeys.length, orphan_candidate_keys_sample: orphanCandidateKeys.slice(0, 20),
  patch: patchCandidates.map((c) => `${c.row} ${c.car_number} ${c.expected_current_code || '(빈칸)'}→${c.replacement_code}`) }, null, 2));
