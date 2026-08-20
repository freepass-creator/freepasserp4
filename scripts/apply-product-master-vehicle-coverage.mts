/** Codex 승인 후 실행할 상품마스터 차종코드 guarded writer. 기본은 dry-run. */
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { JWT } from 'google-auth-library';
import {
  DEFAULT_PRODUCT_MASTER_SHEET_ID,
  PRODUCT_MASTER_COLUMNS,
  PRODUCT_MASTER_TAB,
  productMasterVehicleName,
} from '../lib/domain/product-master-sheet';
import type { VehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import {
  assertFreshProductCoverageReport,
  isTrustedProductCoverageSourceMode,
  parseProductCoverageRowSelection,
  productCoveragePostWriteIssues,
  productCoverageRowFingerprint,
  productCoverageSheetFingerprint,
} from '../lib/domain/product-master-coverage-audit';

type Rec = Record<string, unknown>;
type Candidate = {
  row: number; car_number: string; expected_current_code: string; expected_verification: string;
  expected_source_fingerprint: string;
  replacement_code: string; decision: string; conflicts: string[];
};
const S = (value: unknown) => String(value ?? '').trim();
const plate = (value: unknown) => S(value).replace(/\s/g, '');
const APPLY = process.argv.includes('--apply');
const ONLY_EMPTY = process.argv.includes('--only-empty');
const arg = (name: string, fallback: string) =>
  (process.argv.find((value) => value.startsWith(`--${name}=`)) || '').slice(name.length + 3) || fallback;
const ROWS = parseProductCoverageRowSelection(arg('rows', ''));
const reportPath = resolve(arg('report', 'tmp/product-master-vehicle-coverage.json'));
const snapshotPath = resolve(arg('snapshot', `tmp/product-master-vehicle-patch-snapshot-${Date.now()}.json`));
const sheetId = arg('sheet', DEFAULT_PRODUCT_MASTER_SHEET_ID);
const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
  report_type?: string; generated_at?: string; source?: Rec; master?: Rec; patch_candidates?: Candidate[];
};
if (!isTrustedProductCoverageSourceMode(S(report.source?.mode))) throw new Error('직전 보고서가 신뢰 가능한 라이브 소스가 아님');
// v2(supplier_direct_evidence)의 SAFE_CANDIDATE 는 「단일 자동후보(승인대기)」다 — 사람 검토 뒤 이 writer 로 반영한다(2026-08-18).
if (!['product_master_vehicle_coverage_v1', 'product_master_vehicle_coverage_v2_supplier_direct_evidence', 'official_price_evidence_v1'].includes(S(report.report_type))) {
  throw new Error('지원하지 않는 상품 차종 감사 보고서 규격');
}
assertFreshProductCoverageReport(report.generated_at);
if (S(report.source?.sheet_id) !== sheetId || S(report.source?.tab) !== PRODUCT_MASTER_TAB) {
  throw new Error('감사 보고서와 반영 대상 Sheet/탭 불일치');
}
const candidates = (report.patch_candidates || []).filter((row) => row.decision === 'SAFE_CANDIDATE'
  && (!ONLY_EMPTY || !row.expected_current_code)
  && (!ROWS.size || ROWS.has(row.row)));
if (!candidates.length) {
  console.log(JSON.stringify({ mode: APPLY ? 'apply-noop' : 'dry-run-noop', candidates: 0, cells: 0, sheet_write: 0 }));
  process.exit(0);
}
if ((report.patch_candidates || []).some((row) => row.decision === 'SAFE_CANDIDATE' && row.conflicts?.length)) {
  throw new Error('SAFE_CANDIDATE에 signal conflict가 포함됨');
}
if (candidates.some((row) => !row.expected_source_fingerprint)) throw new Error('SAFE_CANDIDATE 원문 지문 누락');
if (new Set(candidates.map((row) => row.row)).size !== candidates.length
  || new Set(candidates.map((row) => row.car_number)).size !== candidates.length) {
  throw new Error('SAFE_CANDIDATE 행번호 또는 차량번호 중복');
}

const artifactRaw = readFileSync('public/data/vehicle-trim-master.json', 'utf8');
const artifactHash = createHash('sha256').update(artifactRaw).digest('hex');
if (S(report.master?.artifact_sha256) !== artifactHash) throw new Error('차종마스터 artifact 버전 불일치');
const artifact = JSON.parse(artifactRaw) as VehicleTrimMasterArtifact;
const byKey = new Map(artifact.records.map((row) => [row.trim_row_key, row]));
let releaseLock = () => {};
if (APPLY) {
  const lockPath = resolve(arg('lock', 'tmp/product-master-vehicle-writer.lock'));
  mkdirSync(dirname(lockPath), { recursive: true });
  let lockFd: number;
  try {
    lockFd = openSync(lockPath, 'wx');
  } catch {
    throw new Error(`다른 상품마스터 writer가 실행 중이거나 이전 잠금 확인 필요: ${lockPath}`);
  }
  writeFileSync(lockFd, `${JSON.stringify({
    pid: process.pid, started_at: new Date().toISOString(), report: reportPath,
  })}\n`);
  let released = false;
  releaseLock = () => {
    if (released) return;
    released = true;
    closeSync(lockFd);
    try { unlinkSync(lockPath); } catch { /* 종료 중 이미 정리된 잠금 */ }
  };
  process.once('exit', releaseLock);
}
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const auth = new JWT({ email: S(sa.client_email), key: S(sa.private_key),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const token = (await Promise.race([
  auth.getAccessToken(),
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Google OAuth 30000ms timeout')), 30_000)),
])).token;
const api = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, { ...init, headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}),
  }, signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Sheets HTTP ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) as Rec : {};
};
const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
const range = encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A:AZ`);
const live = await api(`${base}/values/${range}`) as { values?: unknown[][] };
const values = live.values || [];
const headers = (values[0] || []).map(S);
if (headers.length !== PRODUCT_MASTER_COLUMNS.length
  || PRODUCT_MASTER_COLUMNS.some((name, index) => headers[index] !== name)) {
  throw new Error('상품마스터 A:AZ 헤더 불일치');
}
if (S(report.source?.sheet_fingerprint)
  !== productCoverageSheetFingerprint(values.slice(1), PRODUCT_MASTER_COLUMNS.length)) {
  throw new Error('감사 뒤 라이브 상품마스터 전체 내용이 변경됨 — 재감사 필요');
}
const col = (name: (typeof PRODUCT_MASTER_COLUMNS)[number]) => PRODUCT_MASTER_COLUMNS.indexOf(name);
const colName = (index: number) => {
  let n = index + 1, out = '';
  while (n) { out = String.fromCharCode(65 + ((n - 1) % 26)) + out; n = Math.floor((n - 1) / 26); }
  return out;
};
const preflightIdentityIssues = productCoveragePostWriteIssues({
  beforeRows: values.slice(1),
  afterRows: values.slice(1),
  width: PRODUCT_MASTER_COLUMNS.length,
  identityColumn: col('차량번호'),
  patchesByIdentity: new Map(),
});
if (preflightIdentityIssues.length) {
  throw new Error(`반영 전 차량번호 유일성 실패: ${preflightIdentityIssues.join(',')}`);
}
const before: Rec[] = [];
const updates: { range: string; values: string[][] }[] = [];
const patchesByIdentity = new Map<string, Map<number, string>>();
let alreadyApplied = 0;
for (const candidate of candidates) {
  const row = values[candidate.row - 1] || [];
  const actualPlate = plate(row[col('차량번호')]);
  const actualCode = S(row[col('차종코드')]);
  const actualVerification = S(row[col('검증상태')]);
  if (values.slice(1).filter((liveRow) => plate(liveRow[col('차량번호')]) === candidate.car_number).length !== 1) {
    throw new Error(`차량번호가 라이브 상품마스터에서 유일하지 않음 row ${candidate.row}`);
  }
  const master = byKey.get(candidate.replacement_code);
  if (!master || master.usage_tier !== 'automatic' || master.management_status !== '확정'
    || master.verification_status !== '확정') throw new Error(`automatic 확정키 아님: ${candidate.replacement_code}`);
  const applied = productMasterVehicleName({ maker: master.maker, model: master.model,
    subModel: master.sub_model, powertrain: master.powertrain, trim: master.trim });
  if (!applied || !applied.includes(master.trim) || !applied.includes(master.powertrain)) {
    throw new Error(`적용값 생성 불일치: ${candidate.replacement_code}`);
  }
  if (actualPlate === candidate.car_number && actualCode === candidate.replacement_code
    && actualVerification === '확정' && S(row[col('관리상태')]) === '운영'
    && S(row[col('차종마스터 적용값')]) === applied && !S(row[col('검수사유')])) {
    alreadyApplied += 1;
    continue;
  }
  if (actualPlate !== candidate.car_number || actualCode !== candidate.expected_current_code
    || actualVerification !== candidate.expected_verification) {
    throw new Error(`CAS 불일치 row ${candidate.row}: ${actualPlate}/${actualCode}/${actualVerification}`);
  }
  const actualFingerprint = productCoverageRowFingerprint(row, PRODUCT_MASTER_COLUMNS.length);
  if (actualFingerprint !== candidate.expected_source_fingerprint) {
    throw new Error(`원문·가격·옵션·상태 지문 불일치 row ${candidate.row}`);
  }
  before.push({ row: candidate.row, car_number: actualPlate, values: Object.fromEntries([
    '차종마스터 적용값', '검증상태', '검수사유', '관리상태', '차종코드',
  ].map((name) => [name, S(row[col(name as never)])])) });
  const patch: Record<string, string> = {
    '차종마스터 적용값': applied, '검증상태': '확정', '검수사유': '', '관리상태': '운영',
    '차종코드': candidate.replacement_code,
  };
  patchesByIdentity.set(candidate.car_number, new Map(Object.entries(patch)
    .map(([name, value]) => [col(name as never), value])));
  for (const [name, value] of Object.entries(patch)) updates.push({
    range: `'${PRODUCT_MASTER_TAB}'!${colName(col(name as never))}${candidate.row}`,
    values: [[value]],
  });
}
mkdirSync(dirname(snapshotPath), { recursive: true });
writeFileSync(snapshotPath, `${JSON.stringify({ generated_at: new Date().toISOString(), sheet_id: sheetId,
  candidates: candidates.length, before, full_before_values: values, planned_updates: updates }, null, 2)}\n`, 'utf8');
if (!APPLY) {
  console.log(JSON.stringify({ mode: 'dry-run', candidates: candidates.length, cells: updates.length,
    already_applied: alreadyApplied, snapshot: snapshotPath, sheet_write: 0 }, null, 2));
  process.exit(0);
}
if (!updates.length) {
  releaseLock();
  console.log(JSON.stringify({ mode: 'apply-noop', candidates: candidates.length,
    already_applied: alreadyApplied, cells: 0, sheet_write: 0 }, null, 2));
  process.exit(0);
}
await api(`${base}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: updates }) });
const after = await api(`${base}/values/${range}`) as { values?: unknown[][] };
const postWriteIssues = productCoveragePostWriteIssues({
  beforeRows: values.slice(1),
  afterRows: (after.values || []).slice(1),
  width: PRODUCT_MASTER_COLUMNS.length,
  identityColumn: col('차량번호'),
  patchesByIdentity,
});
if (postWriteIssues.length) {
  throw new Error(`적용 직후 전체 행 대조 실패 — snapshot으로 복구 검토 필요: ${postWriteIssues.join(',')}`);
}
for (const candidate of candidates) {
  const row = (after.values || [])[candidate.row - 1] || [];
  if (plate(row[col('차량번호')]) !== candidate.car_number || S(row[col('차종코드')]) !== candidate.replacement_code
    || S(row[col('검증상태')]) !== '확정' || S(row[col('관리상태')]) !== '운영') {
    throw new Error(`적용 후 검증 실패 row ${candidate.row}`);
  }
}
releaseLock();
console.log(JSON.stringify({ mode: 'apply', candidates: candidates.length, cells: updates.length,
  already_applied: alreadyApplied, snapshot: snapshotPath, verified: candidates.length }, null, 2));
