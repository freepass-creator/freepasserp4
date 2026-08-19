/** 상품마스터 불변: 고정 조회탭에 부분특정 결과와 상태색만 원자 게시한다. */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { JWT } from 'google-auth-library';
import { DEFAULT_PRODUCT_MASTER_SHEET_ID, PRODUCT_MASTER_COLUMNS, PRODUCT_MASTER_TAB, PRODUCT_MASTER_VIEW_TAB } from '../lib/domain/product-master-sheet';
import { productCoverageSheetFingerprint } from '../lib/domain/product-master-coverage-audit';
import {
  classifyProductVehicleMatchView,
  PRODUCT_VEHICLE_MATCH_STATUS_STYLES,
  summarizeProductVehicleMatchView,
} from '../lib/domain/product-vehicle-match-view';
import { productVehicleReviewDecisionMap } from '../lib/domain/product-vehicle-review-decisions';

type Rec = Record<string, any>;
type CanonicalCell = { stringValue?: string; numberValue?: number; boolValue?: boolean; formulaValue?: string } | null;
type TargetSnapshot = {
  sheetId: number;
  title: string;
  gridProperties: Rec;
  conditionalFormats: Rec[];
  cells: CanonicalCell[][];
  stateSha256: string;
};

const APPLY = process.argv.includes('--apply');
// ★2026-08-19 사장님 「상품 차종매칭을 상품마스터로 승격」 — 사람이 보는 탭 이름은 「상품마스터」, 기계 표는 「상품마스터_구버전」(gid 고정)
const TAB = PRODUCT_MASTER_VIEW_TAB;
const SPREADSHEET_TITLE = '프리패스 차종마스터 원천대장';   // 2026-08-19 문서 이름 바뀜(옛 「ERP4 차종마스터 원천대장」)
const SOURCE_SHEET_ID = 679088240;
const TARGET_SHEET_ID = 1357902468;
const TARGET_ROWS = 1000;
const TARGET_COLUMNS = 13;
const TARGET_RANGE = `'${TAB}'!A1:M${TARGET_ROWS}`;
const PLAN_PATH = 'tmp/product-vehicle-match-view-publish-plan.json';
const LOCK_PATH = 'tmp/product-vehicle-match-view-publish.lock';
const CONFIRM_PHRASE = 'WRITE_ONLY_PRODUCT_VEHICLE_MATCH_VIEW';
const PLAN_MAX_AGE_MS = 15 * 60 * 1000;
const EXECUTION_SUBJECT = process.env.GOOGLE_WORKSPACE_SUBJECT || 'pyh@teamjpk.com';
const S = (value: unknown) => String(value ?? '').trim();
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const jsonEqual = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
if (EXECUTION_SUBJECT !== 'pyh@teamjpk.com') throw new Error('승인된 Workspace 실행 주체가 아닙니다.');

const coverageRaw = readFileSync('tmp/product-master-vehicle-coverage.json', 'utf8');
const coverage = JSON.parse(coverageRaw) as Rec;
if (S(coverage.report_type) !== 'product_master_vehicle_coverage_v2_supplier_direct_evidence'
  || S(coverage.source?.evidence_scope) !== 'supplier_direct_prefix_only') {
  throw new Error('supplier-direct coverage v2 보고서가 아니므로 게시를 중단합니다.');
}
const coverageRows = coverage.rows as Rec[];
const expectedRows = Number(coverage.source?.rows || 0);
if (!Number.isInteger(expectedRows) || expectedRows <= 0
  || !Array.isArray(coverageRows) || coverageRows.length !== expectedRows) {
  throw new Error('coverage 원본 행수 불일치');
}

const hierarchyRaw = readFileSync('tmp/product-against-review-master.json', 'utf8');
const hierarchyReport = JSON.parse(hierarchyRaw) as Rec;
if (S(hierarchyReport.report_type) !== 'product_against_normalized_review_master_v2_supplier_direct_evidence'
  || S(hierarchyReport.source?.evidence_scope) !== 'supplier_direct_prefix_only') {
  throw new Error('supplier-direct hierarchy v2 보고서가 아니므로 게시를 중단합니다.');
}
const hierarchyRows = hierarchyReport.details as Rec[];
if (!Array.isArray(hierarchyRows) || hierarchyRows.length !== expectedRows) throw new Error('hierarchy 원본 행수 불일치');
const hierarchyByRow = new Map(hierarchyRows.map((row) => [Number(row.row), row]));
if (hierarchyByRow.size !== expectedRows || coverageRows.some((row) => !hierarchyByRow.has(Number(row.row)))) {
  throw new Error('coverage/hierarchy 상품 행 결합 실패');
}
if (S(hierarchyReport.source?.sheet_fingerprint) !== S(coverage.source?.sheet_fingerprint)
  || S(hierarchyReport.source?.sheet_id) !== DEFAULT_PRODUCT_MASTER_SHEET_ID
  || S(hierarchyReport.source?.tab) !== PRODUCT_MASTER_TAB) {
  throw new Error('coverage/hierarchy 원본 snapshot 불일치');
}

const reviewRaw = readFileSync('tmp/hyundai-three-model-review.json', 'utf8');
const reviewArtifactSha256 = sha256(reviewRaw);
if (S(hierarchyReport.review?.artifact_sha256) !== reviewArtifactSha256) {
  throw new Error('hierarchy 규격검토본 artifact 변경 — 재감사 필요');
}
const trimArtifactRaw = readFileSync('public/data/vehicle-trim-master.json', 'utf8');
const trimArtifactSha256 = sha256(trimArtifactRaw);
if (S(coverage.master?.artifact_sha256) !== trimArtifactSha256) {
  throw new Error('coverage 이후 영구키 artifact 변경 — 재감사 필요');
}
const trimArtifact = JSON.parse(trimArtifactRaw) as { records?: Rec[] };
const trimByKey = new Map((trimArtifact.records || []).map((record) => [S(record.trim_row_key), record]));

if (hierarchyReport.gates?.total_matches_source !== true
  || Number(hierarchyReport.gates?.review_unknown_class) !== 0
  || Number(hierarchyReport.gates?.production_sort_violations) !== 0
  || Number(hierarchyReport.gates?.invalid_year_inference) !== 0
  || Number(hierarchyReport.gates?.invalid_registration_default_inference) !== 0
  || Number(hierarchyReport.gates?.invalid_hierarchy_evidence_resolution) !== 0
  || Number(hierarchyReport.gates?.invalid_partial_resolution) !== 0
  || Number(hierarchyReport.gates?.invalid_partial_source_conflict) !== 0
  || Number(hierarchyReport.gates?.invalid_blocked_partial_reference) !== 0) {
  throw new Error('hierarchy 추론 회귀 게이트 실패');
}

const credentials = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const token = (await new JWT({
  email: S(credentials.client_email),
  key: S(credentials.private_key),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  subject: EXECUTION_SUBJECT,
}).getAccessToken()).token;
if (!token) throw new Error('Sheets token missing');
const base = `https://sheets.googleapis.com/v4/spreadsheets/${DEFAULT_PRODUCT_MASTER_SHEET_ID}`;
const api = async (url: string, init: RequestInit = {}) => {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({})) as Rec;
  if (!response.ok) throw new Error(`Sheets ${response.status}: ${JSON.stringify(body).slice(0, 600)}`);
  return body;
};

const readSpreadsheetMetadata = async () => {
  const metadata = await api(`${base}?includeGridData=false&fields=properties(title),sheets(properties(sheetId,title,gridProperties))`);
  if (S(metadata.properties?.title) !== SPREADSHEET_TITLE) throw new Error('승인된 spreadsheet title 불일치');
  const sourceSheet = (metadata.sheets || []).find((sheet: Rec) => Number(sheet.properties?.sheetId) === SOURCE_SHEET_ID);
  const targetSheet = (metadata.sheets || []).find((sheet: Rec) => Number(sheet.properties?.sheetId) === TARGET_SHEET_ID);
  if (S(sourceSheet?.properties?.title) !== PRODUCT_MASTER_TAB) throw new Error('상품마스터 고정 sheetId/title 불일치');
  if (S(targetSheet?.properties?.title) !== TAB) throw new Error('조회탭 고정 sheetId/title 불일치');
  if ((metadata.sheets || []).filter((sheet: Rec) => S(sheet.properties?.title) === TAB).length !== 1) {
    throw new Error('조회탭 title 유일성 실패');
  }
  return { source: sourceSheet.properties as Rec, target: targetSheet.properties as Rec };
};

const readAndVerifySource = async () => {
  const metadata = await readSpreadsheetMetadata();
  const response = await api(`${base}/values/${encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A1:AX`)}?majorDimension=ROWS`);
  const values = (response.values || []) as unknown[][];
  const headers = (values[0] || []).map(S);
  if (PRODUCT_MASTER_COLUMNS.some((header, index) => headers[index] !== header)) throw new Error('상품마스터 헤더 불일치');
  const fingerprint = productCoverageSheetFingerprint(values.slice(1), PRODUCT_MASTER_COLUMNS.length);
  if (fingerprint !== S(coverage.source?.sheet_fingerprint)) throw new Error('coverage 이후 상품마스터 변경 — 재감사 필요');
  return { metadata, values, headers, fingerprint };
};

const canonicalEnteredValue = (value: unknown): CanonicalCell => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Rec;
  if (Object.prototype.hasOwnProperty.call(item, 'stringValue')) return { stringValue: String(item.stringValue ?? '') };
  if (Object.prototype.hasOwnProperty.call(item, 'numberValue')) return { numberValue: Number(item.numberValue) };
  if (Object.prototype.hasOwnProperty.call(item, 'boolValue')) return { boolValue: Boolean(item.boolValue) };
  if (Object.prototype.hasOwnProperty.call(item, 'formulaValue')) return { formulaValue: String(item.formulaValue ?? '') };
  return null;
};

const readTargetSnapshot = async (): Promise<TargetSnapshot> => {
  const fields = 'sheets(properties(sheetId,title,gridProperties),conditionalFormats,data(startRow,startColumn,rowData(values(userEnteredValue))))';
  const response = await api(`${base}?includeGridData=true&ranges=${encodeURIComponent(TARGET_RANGE)}&fields=${encodeURIComponent(fields)}`);
  const sheet = response.sheets?.[0];
  if (Number(sheet?.properties?.sheetId) !== TARGET_SHEET_ID || S(sheet?.properties?.title) !== TAB) {
    throw new Error('조회탭 고정 identity post-read 실패');
  }
  const gridProperties = sheet.properties.gridProperties || {};
  if (Number(gridProperties.rowCount) < TARGET_ROWS || Number(gridProperties.columnCount) < TARGET_COLUMNS) {
    throw new Error('조회탭 grid 크기 부족');
  }
  const cells: CanonicalCell[][] = Array.from({ length: TARGET_ROWS }, () => Array(TARGET_COLUMNS).fill(null));
  for (const block of sheet.data || []) {
    const startRow = Number(block.startRow || 0);
    const startColumn = Number(block.startColumn || 0);
    for (let rowOffset = 0; rowOffset < (block.rowData || []).length; rowOffset += 1) {
      const rowIndex = startRow + rowOffset;
      if (rowIndex < 0 || rowIndex >= TARGET_ROWS) continue;
      const rowValues = block.rowData[rowOffset]?.values || [];
      for (let columnOffset = 0; columnOffset < rowValues.length; columnOffset += 1) {
        const columnIndex = startColumn + columnOffset;
        if (columnIndex < 0 || columnIndex >= TARGET_COLUMNS) continue;
        cells[rowIndex][columnIndex] = canonicalEnteredValue(rowValues[columnOffset]?.userEnteredValue);
      }
    }
  }
  const conditionalFormats = (sheet.conditionalFormats || []) as Rec[];
  const state = { sheetId: TARGET_SHEET_ID, title: TAB, gridProperties, conditionalFormats, cells };
  return { ...state, stateSha256: sha256(JSON.stringify(state)) };
};

const sourceRead = await readAndVerifySource();
const values = sourceRead.values;
const liveHeaders = sourceRead.headers;
const col = (name: string) => liveHeaders.indexOf(name);
const liveByPlate = new Map(values.slice(1).map((row) => [S(row[col('차량번호')]).replace(/\s/g, ''), row]));
if (liveByPlate.size !== expectedRows) throw new Error('상품 차량번호 유일성/행수 실패');

const formatMasterRecord = (record: Rec) => [
  S(record.maker), S(record.model), S(record.sub_model), S(record.fuel),
  S(record.fuel) !== '전기' && Number(record.engine_cc || 0) ? `${Number(record.engine_cc).toLocaleString('ko-KR')}cc` : '',
  S(record.drivetrain), Number(record.seats || 0) ? `${Number(record.seats)}인승` : '', S(record.trim),
].filter(Boolean).join(' > ');

const headers = ['운영 확인', '차량번호', '공급사', '공급사 제공 차량정보', '확인 가능한 차종 범위', '차종코드 상태',
  '엄격 판정', '계층 후보 판정', '검토 사유', '상품 운영상태', '차량상태', '차종코드', '상품마스터 최종갱신'];
if (headers.length !== TARGET_COLUMNS) throw new Error('조회탭 출력 열수 계약 불일치');
const reviewByPlate = productVehicleReviewDecisionMap();
const classifications: ReturnType<typeof classifyProductVehicleMatchView>[] = [];
const rows = coverageRows.map((audit) => {
  const plate = S(audit.car_number).replace(/\s/g, '');
  const live = liveByPlate.get(plate);
  if (!live) throw new Error(`상품 행 누락: row ${Number(audit.row)}`);
  const hierarchy = hierarchyByRow.get(Number(audit.row))!;
  const review = reviewByPlate.get(plate) || null;
  const classification = classifyProductVehicleMatchView(audit, hierarchy, review);
  const partial = hierarchy.partial_resolution || {};
  const partialBasis = S(partial.basis);
  const displayCodeStatus = classification.tripleDecisionLabel
    ? classification.codeStatus
    : !classification.strictConfirmed && S(audit.category) === '단일 자동후보(승인대기)'
    ? '자동후보 1개 · 반영 대기'
    : !classification.strictConfirmed && S(audit.category) === '수동후보 있음'
      ? '수동후보 1개 · 운영 검토'
      : !classification.strictConfirmed && partialBasis === 'blocked_master_exact'
        ? '정본 단일후보 · 정책 검토'
        : !classification.strictConfirmed && partialBasis === 'blocked_master_candidates'
          ? '정본 다중후보 · 정책 검토'
          : classification.codeStatus;
  const currentRecord = classification.strictConfirmed ? trimByKey.get(S(audit.current_code)) : null;
  if (classification.strictConfirmed && !currentRecord) throw new Error(`엄격 확정 current_code 영구키 누락: row ${Number(audit.row)}`);
  const decidedScope = review
    ? [S(review.maker), S(review.model), S(review.sub_model), S(review.trim)].filter(Boolean).join(' > ')
    : '';
  const vehicleScope = classification.strictConfirmed
    ? formatMasterRecord(currentRecord!)
    : (decidedScope || S(partial.display));
  if (!vehicleScope) throw new Error(`표시 가능한 차종 범위 누락: row ${Number(audit.row)}`);
  const hierarchyStatus = classification.strictConfirmed
    ? `현재 영구키 계층 확정 · 독립감사:${S(hierarchy.hierarchy_category)}`
    : `${classification.hierarchyStatus} · ${S(partial.statusLabel)} · ${S(hierarchy.hierarchy_category)}`;
  classifications.push(classification);
  return [classification.operatorStatus, S(live[col('차량번호')]), S(live[col('공급사명')]),
    S(live[col('공급사 입력 차명')]), vehicleScope, displayCodeStatus,
    S(audit.category), hierarchyStatus,
    classification.reviewReason || (classification.strictConfirmed ? '' : '근거 부족'),
    S(live[col('관리상태')]), S(live[col('차량상태')]), S(live[col('차종코드')]), S(live[col('최종갱신')])];
});

const counts = summarizeProductVehicleMatchView(classifications);
const partialBasisCounts = hierarchyRows.reduce((acc: Record<string, number>, row) => {
  const basis = S(row.partial_resolution?.basis) || 'missing';
  acc[basis] = (acc[basis] || 0) + 1;
  return acc;
}, {});
const statusCounts = Object.fromEntries(['상품 운영상태', '차량상태'].map((header) => {
  const columnIndex = headers.indexOf(header);
  const valuesByStatus: Record<string, number> = {};
  for (const row of rows) {
    const value = S(row[columnIndex]);
    valuesByStatus[value || '__BLANK__'] = (valuesByStatus[value || '__BLANK__'] || 0) + 1;
  }
  return [header, valuesByStatus];
}));
const allowedStatusKeys = new Set(PRODUCT_VEHICLE_MATCH_STATUS_STYLES.map((style) => `${style.header}|${style.value}`));
const unknownStatusValues = Object.entries(statusCounts).flatMap(([header, valuesByStatus]) => Object.keys(valuesByStatus as Rec)
  .filter((value) => !allowedStatusKeys.has(`${header}|${value}`)).map((value) => `${header}:${value}`));
const statusTotalsValid = Object.values(statusCounts).every((valuesByStatus) => (
  Object.values(valuesByStatus as Rec).reduce((sum: number, count: any) => sum + Number(count || 0), 0) === expectedRows
));
const reportedCategoryTotal = Object.values(coverage.counts || {}).reduce((sum: number, value: any) => sum + Number(value || 0), 0);
const hierarchyCategoryTotal = Object.values(hierarchyReport.hierarchy_counts || {}).reduce((sum: number, value: any) => sum + Number(value || 0), 0);
if (counts.total !== expectedRows || reportedCategoryTotal !== expectedRows || hierarchyCategoryTotal !== expectedRows
  || counts.strictConfirmed !== Number(coverage.counts?.['확정 코드 정상'] || 0)
  || counts.strictConfirmed + counts.strictReview !== counts.total
  || counts.hierarchyLinked + counts.hierarchyReview !== counts.total
  || counts.strictConfirmedWithoutHierarchy !== 0
  || Number(coverage.gates?.blocked_key_references || 0) !== 0
  || Number(coverage.gates?.nonexistent_key_references || 0) !== 0
  || rows.some((row) => !S(row[4]) || !S(row[7]))
  || unknownStatusValues.length > 0 || !statusTotalsValid
  || rows.some((row) => row[0] === '확인 필요' && !row[8])) {
  throw new Error(`엄격/부분특정/상태 합계 게이트 실패: ${unknownStatusValues.join(',')}`);
}

const initialTarget = await readTargetSnapshot();
const lastRow = rows.length + 1;
if (lastRow > TARGET_ROWS) throw new Error('조회탭 고정 출력범위 초과');
const desiredCells: CanonicalCell[][] = Array.from({ length: TARGET_ROWS }, () => Array(TARGET_COLUMNS).fill(null));
for (const [rowIndex, row] of [headers, ...rows].entries()) {
  for (let columnIndex = 0; columnIndex < TARGET_COLUMNS; columnIndex += 1) {
    const value = S(row[columnIndex]);
    desiredCells[rowIndex][columnIndex] = value ? { stringValue: value } : null;
  }
}
const cellData = (cell: CanonicalCell) => cell ? { userEnteredValue: cell } : {};
const rowData = (matrix: CanonicalCell[][]) => matrix.map((row) => ({ values: row.map(cellData) }));
const hexColor = (value: string) => {
  const match = value.match(/^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i);
  if (!match) throw new Error(`잘못된 색상: ${value}`);
  return { red: Number.parseInt(match[1], 16) / 255, green: Number.parseInt(match[2], 16) / 255, blue: Number.parseInt(match[3], 16) / 255 };
};
const expectedRules: Rec[] = [];
// ⚠ 색은 8비트 hex 로만 적는다 — Sheets 는 색을 8비트로 저장하므로 0.05 같은 값은 되읽으면 0.047058824 가 되어
//   post-read 서명 비교가 어긋난다(실측 2026-08-18: 값·규칙은 다 들어갔는데 conditional_formats 불일치로 실패 종료).
const strictColors: Record<string, Rec> = {
  '확정|차종코드 확정|확정 코드 정상|3축확정': hexColor('#0C7238'),
  '확인 필요|검토 필요|트림미확정': hexColor('#D16B05'),
  '원천확인': hexColor('#B71C1C'),
};
for (const [labels, color] of Object.entries(strictColors)) for (const label of labels.split('|')) {
  for (const columnIndex of [0, 5, 6]) expectedRules.push({
    ranges: [{ sheetId: TARGET_SHEET_ID, startRowIndex: 1, endRowIndex: lastRow, startColumnIndex: columnIndex, endColumnIndex: columnIndex + 1 }],
    booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: label }] }, format: { textFormat: { foregroundColor: color, bold: true } } },
  });
}
for (const style of PRODUCT_VEHICLE_MATCH_STATUS_STYLES) {
  const columnIndex = headers.indexOf(style.header);
  if (columnIndex < 0) throw new Error(`상태색 대상 헤더 누락: ${style.header}`);
  expectedRules.push({
    ranges: [{ sheetId: TARGET_SHEET_ID, startRowIndex: 1, endRowIndex: lastRow, startColumnIndex: columnIndex, endColumnIndex: columnIndex + 1 }],
    booleanRule: {
      condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: style.value }] },
      format: { backgroundColor: hexColor(style.background), textFormat: { foregroundColor: hexColor(style.foreground), bold: true } },
    },
  });
}

const cleanObject = (input: Rec) => Object.fromEntries(Object.entries(input || {}).filter(([, value]) => value !== undefined));
const canonicalColor = (input: unknown) => {
  if (!input || typeof input !== 'object') return null;
  const candidate = (input as Rec).rgbColor && typeof (input as Rec).rgbColor === 'object' ? (input as Rec).rgbColor : input as Rec;
  if (!['red', 'green', 'blue', 'alpha'].some((key) => Object.prototype.hasOwnProperty.call(candidate, key))) return null;
  const round = (value: unknown) => Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
  return [round(candidate.red), round(candidate.green), round(candidate.blue),
    Object.prototype.hasOwnProperty.call(candidate, 'alpha') ? round(candidate.alpha) : 1];
};
const ruleSignature = (rule: Rec) => {
  const booleanRule = rule.booleanRule || {};
  const condition = booleanRule.condition || {};
  const format = booleanRule.format || {};
  const textFormat = format.textFormat || {};
  const rangeSignatures = (rule.ranges || []).map((range: Rec) => [
    Number(range.sheetId), Number(range.startRowIndex || 0), Number(range.endRowIndex || 0),
    Number(range.startColumnIndex || 0), Number(range.endColumnIndex || 0),
  ]).sort();
  return JSON.stringify({
    ranges: rangeSignatures,
    condition: {
      type: S(condition.type), values: (condition.values || []).map((value: Rec) => S(value.userEnteredValue)),
      extras: cleanObject(Object.fromEntries(Object.entries(condition).filter(([key]) => !['type', 'values'].includes(key)))),
    },
    format: {
      background: canonicalColor(format.backgroundColorStyle || format.backgroundColor),
      foreground: canonicalColor(textFormat.foregroundColorStyle || textFormat.foregroundColor),
      bold: textFormat.bold === true,
      textExtras: cleanObject(Object.fromEntries(Object.entries(textFormat).filter(([key]) => !['foregroundColor', 'foregroundColorStyle', 'bold'].includes(key)))),
      extras: cleanObject(Object.fromEntries(Object.entries(format).filter(([key]) => !['backgroundColor', 'backgroundColorStyle', 'textFormat'].includes(key)))),
    },
    booleanExtras: cleanObject(Object.fromEntries(Object.entries(booleanRule).filter(([key]) => !['condition', 'format'].includes(key)))),
    ruleExtras: cleanObject(Object.fromEntries(Object.entries(rule).filter(([key]) => !['ranges', 'booleanRule'].includes(key)))),
  });
};
const expectedRuleSignatures = expectedRules.map(ruleSignature).sort();
if (new Set(expectedRuleSignatures).size !== expectedRules.length) throw new Error('조건부서식 규칙 중복 생성');

const buildPublishRequests = (oldRuleCount: number): Rec[] => {
  const requests: Rec[] = [];
  for (let index = oldRuleCount - 1; index >= 0; index -= 1) requests.push({ deleteConditionalFormatRule: { sheetId: TARGET_SHEET_ID, index } });
  requests.push({ updateCells: { start: { sheetId: TARGET_SHEET_ID, rowIndex: 0, columnIndex: 0 }, rows: rowData(desiredCells.slice(0, lastRow)), fields: 'userEnteredValue' } });
  if (lastRow < TARGET_ROWS) requests.push({ repeatCell: { range: { sheetId: TARGET_SHEET_ID, startRowIndex: lastRow, endRowIndex: TARGET_ROWS, startColumnIndex: 0, endColumnIndex: TARGET_COLUMNS }, cell: {}, fields: 'userEnteredValue' } });
  expectedRules.forEach((rule, index) => requests.push({ addConditionalFormatRule: { index, rule } }));
  return requests;
};
const requests = buildPublishRequests(initialTarget.conditionalFormats.length);
const requestKinds = new Set(['deleteConditionalFormatRule', 'updateCells', 'repeatCell', 'addConditionalFormatRule']);
for (const request of requests) {
  const keys = Object.keys(request);
  if (keys.length !== 1 || !requestKinds.has(keys[0])) throw new Error('허용되지 않은 Sheets mutation request');
  const mentionedSheetIds = [...JSON.stringify(request).matchAll(/"sheetId":(\d+)/g)].map((match) => Number(match[1]));
  if (!mentionedSheetIds.length || mentionedSheetIds.some((sheetId) => sheetId !== TARGET_SHEET_ID)) throw new Error('고정 조회탭 밖 mutation request 감지');
}

const implementationPaths = [
  'scripts/publish-product-vehicle-match-view-v2.mts',
  'scripts/audit-product-master-vehicle-coverage.mts',
  'scripts/audit-product-against-review-master.mts',
  'lib/domain/product-master-sheet.ts',
  'lib/domain/product-master-coverage-audit.ts',
  'lib/domain/product-vehicle-match-view.ts',
  'lib/domain/product-vehicle-partial-resolution.ts',
  'lib/domain/product-review-hierarchy-evidence.ts',
  'lib/domain/supplier-preserved-evidence.ts',
  'lib/domain/vehicle-master-format.ts',
];
const readImplementationSha256 = () => Object.fromEntries(implementationPaths.map((path) => [path, sha256(readFileSync(path))]));
const implementationSha256 = readImplementationSha256();
const binding = {
  spreadsheet: { id: DEFAULT_PRODUCT_MASTER_SHEET_ID, title: SPREADSHEET_TITLE, executionSubject: EXECUTION_SUBJECT },
  source: {
    tab: PRODUCT_MASTER_TAB, sheetId: SOURCE_SHEET_ID, rows: expectedRows,
    coverageReportType: S(coverage.report_type), hierarchyReportType: S(hierarchyReport.report_type), evidenceScope: S(coverage.source?.evidence_scope),
    sheetFingerprint: S(coverage.source?.sheet_fingerprint), coverageReportSha256: sha256(coverageRaw), hierarchyReportSha256: sha256(hierarchyRaw),
    reviewArtifactSha256, trimArtifactSha256,
  },
  target: {
    tab: TAB, sheetId: TARGET_SHEET_ID,
    gridRows: Number(initialTarget.gridProperties.rowCount), gridColumns: Number(initialTarget.gridProperties.columnCount),
    affectedValuesRange: TARGET_RANGE, currentAffectedStateSha256: initialTarget.stateSha256,
    currentConditionalFormatRules: initialTarget.conditionalFormats.length,
    proposedValuesSha256: sha256(JSON.stringify(desiredCells)), proposedRows: lastRow, proposedColumns: TARGET_COLUMNS,
    proposedConditionalFormatSha256: sha256(JSON.stringify(expectedRuleSignatures)), proposedConditionalFormatRules: expectedRules.length,
    mutationRequestSha256: sha256(JSON.stringify(requests)),
  },
  implementationSha256,
};
const planSummary = { counts, strictCounts: coverage.counts, hierarchyCounts: hierarchyReport.hierarchy_counts,
  resolutionCounts: hierarchyReport.resolution_counts, partialBasisCounts, statusCounts };
const scope = {
  onlySpreadsheetId: DEFAULT_PRODUCT_MASTER_SHEET_ID, onlyTab: TAB, onlySheetId: TARGET_SHEET_ID,
  valueWrites: TARGET_RANGE,
  conditionalFormatWrites: `조회탭 전체 기존 규칙 ${initialTarget.conditionalFormats.length}개를 승인된 ${expectedRules.length}개로 교체`,
  otherCellFormatWrites: 0, filterWrites: 0, dimensionWrites: 0, addDeleteSheetWrites: 0,
  sourceTabWrites: 0, vehicleMasterWrites: 0, productMasterWrites: 0, permanentCodeWrites: 0, operationalStatusWrites: 0,
};

if (!APPLY) {
  const generatedAt = new Date();
  const plan = {
    reportType: 'product_vehicle_match_view_publish_plan_v2', contractVersion: 2, runId: randomUUID(),
    generatedAt: generatedAt.toISOString(), expiresAt: new Date(generatedAt.getTime() + PLAN_MAX_AGE_MS).toISOString(),
    mode: 'dry_run', write: 0, humanApprovalRecorded: false, requiredConfirmPhrase: CONFIRM_PHRASE,
    binding, summary: planSummary, scope,
  };
  mkdirSync('tmp', { recursive: true });
  const planText = `${JSON.stringify(plan, null, 2)}\n`;
  writeFileSync(PLAN_PATH, planText);
  console.log(JSON.stringify({ mode: 'dry_run_plan_written', planPath: PLAN_PATH, planSha256: sha256(planText),
    expiresAt: plan.expiresAt, rows: rows.length, ...planSummary }, null, 2));
  process.exit(0);
}

const approvedPlanSha256 = S((process.argv.find((value) => value.startsWith('--approved-plan-sha256=')) || '').split('=')[1]);
const approvalReference = S((process.argv.find((value) => value.startsWith('--approval-reference=')) || '').slice('--approval-reference='.length));
const confirmPhrase = S((process.argv.find((value) => value.startsWith('--confirm=')) || '').slice('--confirm='.length));
if (!/^[a-f0-9]{64}$/.test(approvedPlanSha256) || !/^[A-Za-z0-9._:@+-]{8,200}$/.test(approvalReference) || confirmPhrase !== CONFIRM_PHRASE) {
  throw new Error('정확한 승인 plan SHA, approval reference, confirm phrase가 필요합니다.');
}
const approvedPlanRaw = readFileSync(PLAN_PATH, 'utf8');
if (sha256(approvedPlanRaw) !== approvedPlanSha256) throw new Error('사용자 승인 plan SHA 불일치');
const approvedPlan = JSON.parse(approvedPlanRaw) as Rec;
const now = Date.now();
const generatedAtMs = Date.parse(S(approvedPlan.generatedAt));
const expiresAtMs = Date.parse(S(approvedPlan.expiresAt));
if (approvedPlan.reportType !== 'product_vehicle_match_view_publish_plan_v2'
  || Number(approvedPlan.contractVersion) !== 2 || !/^[0-9a-f-]{36}$/i.test(S(approvedPlan.runId))
  || approvedPlan.mode !== 'dry_run' || Number(approvedPlan.write) !== 0 || approvedPlan.humanApprovalRecorded !== false
  || approvedPlan.requiredConfirmPhrase !== CONFIRM_PHRASE
  || !Number.isFinite(generatedAtMs) || !Number.isFinite(expiresAtMs)
  || now < generatedAtMs - 60_000 || now > expiresAtMs || expiresAtMs - generatedAtMs !== PLAN_MAX_AGE_MS
  || !jsonEqual(approvedPlan.binding, binding) || !jsonEqual(approvedPlan.summary, planSummary) || !jsonEqual(approvedPlan.scope, scope)) {
  throw new Error('승인 plan과 현재 원본·대상·산출물·구현·범위 결속 불일치 또는 만료');
}

mkdirSync('tmp', { recursive: true });
const lockNonce = randomUUID();
const lockRecord = { pid: process.pid, nonce: lockNonce, planSha256: approvedPlanSha256, approvalReference };
let lockOwned = false;
try {
  const descriptor = openSync(LOCK_PATH, 'wx');
  try { writeFileSync(descriptor, `${JSON.stringify(lockRecord)}\n`); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  lockOwned = true;
} catch (error) {
  throw new Error(`동시 게시 lock 획득 실패 — 자동 삭제하지 않습니다: ${S((error as Error).message)}`);
}
const releaseLock = () => {
  if (!lockOwned) return;
  try {
    const current = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as Rec;
    if (S(current.nonce) === lockNonce) unlinkSync(LOCK_PATH);
  } catch { /* foreign/corrupt lock is not removed */ }
  lockOwned = false;
};
process.once('exit', releaseLock);

const currentLocalBindingMatches = () => sha256(readFileSync(PLAN_PATH)) === approvedPlanSha256
  && sha256(readFileSync('tmp/product-master-vehicle-coverage.json')) === sha256(coverageRaw)
  && sha256(readFileSync('tmp/product-against-review-master.json')) === sha256(hierarchyRaw)
  && sha256(readFileSync('tmp/hyundai-three-model-review.json')) === reviewArtifactSha256
  && sha256(readFileSync('public/data/vehicle-trim-master.json')) === trimArtifactSha256
  && jsonEqual(readImplementationSha256(), implementationSha256);
const targetOutputIssues = (snapshot: TargetSnapshot) => {
  const issues: string[] = [];
  if (snapshot.sheetId !== TARGET_SHEET_ID || snapshot.title !== TAB) issues.push('identity');
  if (!jsonEqual(snapshot.gridProperties, initialTarget.gridProperties)) issues.push('grid_properties');
  if (!jsonEqual(snapshot.cells, desiredCells)) issues.push('values');
  if (!jsonEqual(snapshot.conditionalFormats.map(ruleSignature).sort(), expectedRuleSignatures)) issues.push('conditional_formats');
  return issues;
};
const buildRestoreRequests = (currentRuleCount: number): Rec[] => {
  const restore: Rec[] = [];
  for (let index = currentRuleCount - 1; index >= 0; index -= 1) restore.push({ deleteConditionalFormatRule: { sheetId: TARGET_SHEET_ID, index } });
  restore.push({ updateCells: { start: { sheetId: TARGET_SHEET_ID, rowIndex: 0, columnIndex: 0 }, rows: rowData(initialTarget.cells), fields: 'userEnteredValue' } });
  initialTarget.conditionalFormats.forEach((rule, index) => restore.push({ addConditionalFormatRule: { index, rule } }));
  return restore;
};
const rollbackPublishedTarget = async () => {
  const first = await readTargetSnapshot();
  if (targetOutputIssues(first).length) throw new Error('rollback 전 조회탭이 게시 산출물과 달라 자동복구 중단');
  const second = await readTargetSnapshot();
  if (targetOutputIssues(second).length || second.stateSha256 !== first.stateSha256) throw new Error('rollback 직전 조회탭 동시변경 감지');
  await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: buildRestoreRequests(second.conditionalFormats.length) }) });
  const restored = await readTargetSnapshot();
  if (restored.stateSha256 !== initialTarget.stateSha256) throw new Error('조회탭 rollback post-read 실패');
};

const snapshotPath = `tmp/product-vehicle-match-view-snapshot-${approvedPlanSha256.slice(0, 12)}-${Date.now()}.json`;
writeFileSync(snapshotPath, `${JSON.stringify({ planSha256: approvedPlanSha256, approvalReference,
  sourceFingerprint: sourceRead.fingerprint, target: initialTarget }, null, 2)}\n`);

let publishedTarget: TargetSnapshot | null = null;
let recoveredAfterDispatchError = false;
try {
  if (!currentLocalBindingMatches()) throw new Error('게시 직전 로컬 승인 결속 변경');
  await readAndVerifySource();
  const prewriteTarget = await readTargetSnapshot();
  if (prewriteTarget.stateSha256 !== initialTarget.stateSha256) throw new Error('승인 후 조회탭 변경 — 게시 중단');
  if (sha256(JSON.stringify(requests)) !== binding.target.mutationRequestSha256) throw new Error('게시 request hash 변경');
  let dispatchError: Error | null = null;
  try { await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) }); } catch (error) { dispatchError = error as Error; }
  publishedTarget = await readTargetSnapshot();
  const outputIssues = targetOutputIssues(publishedTarget);
  if (outputIssues.length) {
    if (dispatchError && publishedTarget.stateSha256 === initialTarget.stateSha256) throw dispatchError;
    throw new Error(`게시 산출물 post-read 불일치: ${outputIssues.join(',')}${dispatchError ? `; dispatch=${dispatchError.message}` : ''}`);
  }
  recoveredAfterDispatchError = Boolean(dispatchError);
  await readAndVerifySource();
  if (!currentLocalBindingMatches()) throw new Error('게시 후 로컬 승인 결속 변경');
} catch (error) {
  let rolledBack = false;
  let rollbackError = '';
  try {
    const current = await readTargetSnapshot();
    if (!targetOutputIssues(current).length) { await rollbackPublishedTarget(); rolledBack = true; }
  } catch (rollbackFailure) { rollbackError = S((rollbackFailure as Error).message); }
  throw new Error(`${S((error as Error).message)}; rolledBack=${rolledBack}; rollbackError=${rollbackError || '없음'}; snapshot=${snapshotPath}`);
} finally {
  releaseLock();
}

const receiptPath = `tmp/product-vehicle-match-view-publish-receipt-${approvedPlanSha256.slice(0, 12)}.json`;
writeFileSync(receiptPath, `${JSON.stringify({ reportType: 'product_vehicle_match_view_publish_receipt_v1',
  appliedAt: new Date().toISOString(), planSha256: approvedPlanSha256, approvalReference, recoveredAfterDispatchError,
  targetStateSha256: publishedTarget?.stateSha256, snapshotPath, binding }, null, 2)}\n`);
console.log(JSON.stringify({ mode: 'published_verified', sheetId: TARGET_SHEET_ID, rows: rows.length, counts,
  hierarchyCounts: hierarchyReport.hierarchy_counts, partialBasisCounts, statusCounts,
  statusFormatRules: PRODUCT_VEHICLE_MATCH_STATUS_STYLES.length, totalConditionalFormatRules: expectedRules.length,
  recoveredAfterDispatchError, snapshotPath, receiptPath }, null, 2));
