/** Read-only plan: publish the live review view as a permanent-keyed companion table. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  VEHICLE_MASTER_REVIEW_ADOPTION_HEADERS,
  VEHICLE_MASTER_REVIEW_ADOPTION_CONTRACT_VERSION,
  VEHICLE_MASTER_REVIEW_ADOPTION_TAB,
  buildVehicleMasterReviewPromotionEntries,
  summarizeVehicleMasterReviewPromotion,
} from '../lib/domain/vehicle-master-review-promotion';
import { MASTER_SHEET_ID, MASTER_TAB } from '../lib/domain/vehicle-master-sheet';
import {
  auditTrimKeyContract,
  trimKeyRecordsFromValues,
  type TrimKeyRegistry,
} from '../lib/domain/vehicle-trim-key-contract';

type Rec = Record<string, any>;
const S = (value: unknown) => String(value ?? '').trim();
const C = (value: unknown) => S(value).normalize('NFC').replace(/\s+/g, ' ');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const readJson = (path: string) => {
  const raw = readFileSync(path, 'utf8');
  return { raw, value: JSON.parse(raw) as Rec, sha256: createHash('sha256').update(raw).digest('hex') };
};
const fileSha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const normalizeRows = (rows: unknown[][], width: number) => rows.map((row) =>
  Array.from({ length: width }, (_, index) => row[index] ?? ''));
const EXECUTION_SUBJECT = 'pyh@teamjpk.com';

const localReview = readJson('tmp/hyundai-three-model-review.json');
const artifact = readJson('public/data/vehicle-trim-master.json');
const registry = readJson('data/vehicle-trim-key-registry.json');
const implementation = Object.fromEntries([
  'lib/domain/vehicle-master-review-promotion.ts',
  'lib/domain/vehicle-master-sheet.ts',
  'lib/domain/vehicle-trim-key-contract.ts',
  'scripts/apply-vehicle-master-review-adoption.mts',
].map((path) => [path, fileSha256(path)]));
const reviewTab = S(localReview.value.report?.tab);
if (!reviewTab) throw new Error('로컬 규격검토 artifact에 탭 이름이 없습니다.');

const gwsWindowsShim = process.platform === 'win32'
  ? readFileSync(join(S(process.env.APPDATA), 'npm', 'gws.cmd'), 'utf8').match(/"([^"]+gws\.exe)"/i)?.[1]
  : '';
if (process.platform === 'win32' && !gwsWindowsShim) throw new Error('gws 읽기 전용 실행 파일을 찾을 수 없습니다.');
const gws = (args: string[]) => JSON.parse(execFileSync(
  gwsWindowsShim || 'gws',
  args,
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
)) as Rec;
const readValues = (range: string) => (gws([
  'sheets', 'spreadsheets', 'values', 'get', '--params', JSON.stringify({
    spreadsheetId: MASTER_SHEET_ID,
    range,
    majorDimension: 'ROWS',
    valueRenderOption: 'UNFORMATTED_VALUE',
  }),
  '--format', 'json',
]).values || []) as unknown[][];

const metadata = gws([
  'sheets', 'spreadsheets', 'get', '--params', JSON.stringify({
    spreadsheetId: MASTER_SHEET_ID,
    fields: 'properties(title),sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))',
  }),
  '--format', 'json',
]);
const masterSheet = (metadata.sheets || []).find((item: Rec) => S(item.properties?.title) === MASTER_TAB)?.properties;
const reviewSheet = (metadata.sheets || []).find((item: Rec) => S(item.properties?.title) === reviewTab)?.properties;
const targetSheet = (metadata.sheets || []).find((item: Rec) => S(item.properties?.title) === VEHICLE_MASTER_REVIEW_ADOPTION_TAB)?.properties;
if (!masterSheet || Number(masterSheet.sheetId) !== 1159482177 || Number(masterSheet.gridProperties?.columnCount) !== 32) {
  throw new Error('라이브 차종마스터 sheetId/32열 기준선이 다릅니다.');
}
if (!reviewSheet || Number(reviewSheet.sheetId) !== 271777427 || Number(reviewSheet.gridProperties?.columnCount) !== 24) {
  throw new Error('라이브 규격검토 sheetId/24열 기준선이 다릅니다.');
}
if (targetSheet) throw new Error(`${VEHICLE_MASTER_REVIEW_ADOPTION_TAB} 탭이 이미 있어 자동 덮어쓰기를 차단했습니다.`);

const liveMasterValues = readValues(`'${MASTER_TAB}'!A1:AF${Number(masterSheet.gridProperties?.rowCount)}`);
const liveReviewValues = readValues(`'${reviewTab}'!A1:X${Number(reviewSheet.gridProperties?.rowCount)}`);
const masterHeaders = (liveMasterValues[0] || []).map(S);
const keyColumn = masterHeaders.indexOf('트림행키');
if (keyColumn !== 9 || masterHeaders.length !== 32) throw new Error('라이브 차종마스터 A:AF 헤더가 다릅니다.');
const liveMasterKeyRows = liveMasterValues.slice(1).flatMap((row, index) => {
  const trimRowKey = S(row[keyColumn]);
  return trimRowKey ? [{ trimRowKey, sheetRow: index + 2 }] : [];
});
const reviewWidth = 24;
const reviewHeaders = normalizeRows([liveReviewValues[0] || []], reviewWidth)[0].map(S);
const liveReviewRecords = liveReviewValues.slice(1).map((row, index) => ({
  values: normalizeRows([row], reviewWidth)[0],
  sheetRow: index + 2,
})).filter((row) => row.values.some((value) => S(value)));
const liveReviewRows = liveReviewRecords.map((row) => row.values);
const liveReviewSheetRows = liveReviewRecords.map((row) => row.sheetRow);
const localReviewRows = normalizeRows(localReview.value.rows || [], reviewWidth);
if (JSON.stringify(reviewHeaders) !== JSON.stringify((localReview.value.headers || []).map(S))) {
  throw new Error('라이브 규격검토 헤더와 로컬 고정본이 다릅니다.');
}
if (JSON.stringify(liveReviewRows) !== JSON.stringify(localReviewRows)) {
  throw new Error('라이브 규격검토 값과 로컬 고정본이 다릅니다. 재생성/재검토가 필요합니다.');
}

const artifactKeys = new Set((artifact.value.records || []).map((row: Rec) => S(row.trim_row_key)));
const registryKeys = new Set((registry.value.records || []).map((row: Rec) => S(row.code)));
const liveKeys = new Set(liveMasterKeyRows.map((row) => row.trimRowKey));
if (artifactKeys.size !== Number(artifact.value.row_count)
  || artifactKeys.size !== registryKeys.size
  || artifactKeys.size !== liveKeys.size
  || [...artifactKeys].some((key) => !registryKeys.has(key) || !liveKeys.has(key))) {
  throw new Error('라이브 J열·artifact·영구키 레지스트리의 5,334키 기준판이 다릅니다.');
}
const keyAudit = auditTrimKeyContract(
  registry.value as unknown as TrimKeyRegistry,
  trimKeyRecordsFromValues(liveMasterValues, registry.value.semanticHeaders),
);
if (!keyAudit.ok) {
  throw new Error(`라이브 A:AF 영구키 의미계약 위반: ${keyAudit.issues.slice(0, 10).map((issue) => `${issue.kind}:${issue.code || '-'}`).join(', ')}`);
}

const entries = buildVehicleMasterReviewPromotionEntries({
  reviewHeaders,
  reviewRows: liveReviewRows,
  reviewSheetRows: liveReviewSheetRows,
  liveMasterKeyRows,
  knownArtifactKeys: artifactKeys,
  groupFingerprintForRow: (row) => `sha256:${hash({
    contractVersion: VEHICLE_MASTER_REVIEW_ADOPTION_CONTRACT_VERSION,
    headers: reviewHeaders.slice(0, 18),
    values: row.slice(0, 18).map(C),
  })}`,
});
const summary = summarizeVehicleMasterReviewPromotion(entries);
const artifactByKey = new Map((artifact.value.records || []).map((row: Rec) => [S(row.trim_row_key), row]));
const reviewedUsageTiers = Object.fromEntries(['automatic', 'manual', 'blocked'].map((tier) => [
  tier,
  entries.filter((entry) => S(artifactByKey.get(entry.trimRowKey)?.usage_tier) === tier).length,
]));
const adoptedUsageTiers = Object.fromEntries(['automatic', 'manual', 'blocked'].map((tier) => [
  tier,
  entries.filter((entry) => entry.adoptionStatus === 'pending_human_adoption'
    && S(artifactByKey.get(entry.trimRowKey)?.usage_tier) === tier).length,
]));
if (liveReviewRows.length !== 2097 || summary.keyRows !== 2106
  || summary.reviewGroups !== 2097 || summary.singleKeyGroups !== 2088
  || summary.twoKeyGroups !== 9 || summary.maxKeysPerGroup !== 2
  || summary.pendingHumanAdoption !== 2086
  || summary.pendingWithoutSelectionQuestions !== 601
  || summary.pendingWithSelectionQuestions !== 1485
  || summary.reviewOnly !== 20
  || JSON.stringify(reviewedUsageTiers) !== JSON.stringify({ automatic: 2098, manual: 8, blocked: 0 })
  || JSON.stringify(adoptedUsageTiers) !== JSON.stringify({ automatic: 2078, manual: 8, blocked: 0 })) {
  throw new Error(`현재 채택 기준 건수가 예상과 다릅니다: ${JSON.stringify({ reviewRows: liveReviewRows.length, ...summary })}`);
}
if (VEHICLE_MASTER_REVIEW_ADOPTION_HEADERS.length !== 30
  || entries.some((entry) => entry.targetValues.length !== VEHICLE_MASTER_REVIEW_ADOPTION_HEADERS.length)) {
  throw new Error('규격채택 출력 열 계약이 30열과 다릅니다.');
}

const liveRowByKey = new Map(liveMasterKeyRows.map((row) => [row.trimRowKey, row.sheetRow]));
const capturedRowExactMatches = (registry.value.records || []).filter((row: Rec) =>
  liveRowByKey.get(S(row.code)) === Number(row.capturedSheetRow || 0)).length;
const targetRows = entries.length + 1;
const liveMasterKeySha256 = hash(liveMasterKeyRows);
const liveMasterValuesSha256 = hash(liveMasterValues);
const liveReviewValuesSha256 = hash([reviewHeaders, ...liveReviewRows]);
const sourceSnapshotPath = 'tmp/vehicle-master-review-adoption-source-snapshot.json';
const sourceSnapshotText = `${JSON.stringify({
  reportType: 'vehicle_master_review_adoption_source_snapshot_v1',
  capturedAt: new Date().toISOString(),
  spreadsheetId: MASTER_SHEET_ID,
  masterSheet: MASTER_TAB,
  reviewSheet: reviewTab,
  liveMasterKeySha256,
  liveMasterValuesSha256,
  liveReviewValuesSha256,
  values: liveMasterValues,
  reviewValues: liveReviewValues,
}, null, 2)}\n`;
writeFileSync(sourceSnapshotPath, sourceSnapshotText);
const sourceSnapshotSha256 = createHash('sha256').update(sourceSnapshotText).digest('hex');
const report = {
  reportType: 'vehicle_master_review_keyed_adoption_plan_v1',
  contractVersion: VEHICLE_MASTER_REVIEW_ADOPTION_CONTRACT_VERSION,
  generatedAt: new Date().toISOString(),
  mode: 'dry_run',
  write: 0,
  humanApprovalRecorded: false,
  source: {
    spreadsheetId: MASTER_SHEET_ID,
    spreadsheetTitle: S(metadata.properties?.title),
    executionSubject: EXECUTION_SUBJECT,
    masterSheet: MASTER_TAB,
    masterSheetId: Number(masterSheet.sheetId),
    masterGridRowCount: Number(masterSheet.gridProperties?.rowCount),
    masterGridColumnCount: Number(masterSheet.gridProperties?.columnCount),
    reviewSheet: reviewTab,
    reviewSheetId: Number(reviewSheet.sheetId),
    reviewGridRowCount: Number(reviewSheet.gridProperties?.rowCount),
    reviewGridColumnCount: Number(reviewSheet.gridProperties?.columnCount),
    liveMasterKeySha256,
    liveMasterValuesSha256,
    liveReviewValuesSha256,
    masterArtifactSha256: artifact.sha256,
    registrySha256: registry.sha256,
    localReviewArtifactSha256: localReview.sha256,
    masterKeys: artifactKeys.size,
    reviewRows: liveReviewRows.length,
    registryCapturedRowExactMatches: capturedRowExactMatches,
    registryCapturedRowIgnored: true,
    keyContractIssues: keyAudit.issues.length,
    reviewedUsageTiers,
    adoptedUsageTiers,
    sourceSnapshotPath,
    sourceSnapshotSha256,
    implementation,
  },
  target: {
    createNewSheet: VEHICLE_MASTER_REVIEW_ADOPTION_TAB,
    targetExistsBefore: false,
    sheetRows: targetRows,
    sheetColumns: VEHICLE_MASTER_REVIEW_ADOPTION_HEADERS.length,
    exactRange: `'${VEHICLE_MASTER_REVIEW_ADOPTION_TAB}'!A1:AD${targetRows}`,
    existingMasterCellsMutated: 0,
    registryMutated: false,
    artifactMutated: false,
    operationalStatusesMutated: 0,
  },
  summary,
  approvalEffect: '직전 승인 시 구조확인 2,086키를 규격구조 채택으로 기록(선택질문 없음 601, 선택질문 유지 1,485)하고, 나머지 20키는 채택 승인 필드를 비운 채 검토유지. 운영 확정/자동 등급은 0건 변경.',
  rollback: `신규 ${VEHICLE_MASTER_REVIEW_ADOPTION_TAB} 탭만 삭제. 기존 차종마스터 A:AF·영구키·artifact·운영 상태는 변경하지 않음.`,
  headers: VEHICLE_MASTER_REVIEW_ADOPTION_HEADERS,
  entries,
};
const planPath = 'tmp/vehicle-master-review-adoption-plan.json';
const planText = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(planPath, planText);
const planSha256 = createHash('sha256').update(planText).digest('hex');
console.log(JSON.stringify({
  mode: report.mode,
  write: report.write,
  humanApprovalRecorded: report.humanApprovalRecorded,
  source: report.source,
  target: report.target,
  summary,
  plan: planPath,
  planSha256,
}, null, 2));
