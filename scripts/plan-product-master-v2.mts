/**
 * Read-only plan for the salesperson-first Product Master layout.
 *
 * This script never writes Google Sheets. It pins the live legacy Product Master,
 * the latest normalized vehicle review tab, and the fresh vehicle-coverage audit,
 * then reports the exact parallel-tab payload and cutover blockers.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEFAULT_PRODUCT_MASTER_SHEET_ID,
  PRODUCT_MASTER_COLUMNS,
  PRODUCT_MASTER_TAB,
} from '../lib/domain/product-master-sheet';
import {
  PRODUCT_MASTER_V2_COLUMNS,
  PRODUCT_MASTER_V2_FROZEN_COLUMNS,
  PRODUCT_MASTER_V2_FROZEN_ROWS,
  PRODUCT_MASTER_V2_PRICE_COLUMNS,
  PRODUCT_MASTER_V2_SOURCE_ALIASES,
  PRODUCT_MASTER_V2_TAB,
  productMasterV2Displacement,
  productMasterV2Display,
  productMasterV2Mileage,
  productMasterV2PriceOrderIssues,
  productMasterV2SalesPolicy,
  productMasterV2SourceValue,
  type ProductMasterV2Column,
} from '../lib/domain/product-master-v2';
import {
  assertFreshProductCoverageReport,
  productCoverageSheetFingerprint,
} from '../lib/domain/product-master-coverage-audit';

type Rec = Record<string, any>;
type Cell = string | number | boolean;

const S = (value: unknown) => String(value ?? '').trim();
const C = (value: unknown) => S(value).normalize('NFC').replace(/\s+/g, ' ');
const hash = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const arg = (name: string, fallback: string) =>
  process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) || fallback;
const coveragePath = resolve(arg('--coverage', 'tmp/product-master-v2-coverage-20260818.json'));
const outputPath = resolve(arg('--out', 'tmp/product-master-v2-plan.json'));

const gwsWindowsShim = process.platform === 'win32'
  ? readFileSync(join(S(process.env.APPDATA), 'npm', 'gws.cmd'), 'utf8').match(/"([^"]+gws\.exe)"/i)?.[1]
  : '';
if (process.platform === 'win32' && !gwsWindowsShim) throw new Error('gws 읽기 전용 실행 파일을 찾을 수 없습니다.');
const gws = (args: string[]) => JSON.parse(execFileSync(
  gwsWindowsShim || 'gws',
  args,
  { encoding: 'utf8', maxBuffer: 96 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
)) as Rec;
const readValues = (range: string, valueRenderOption: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' = 'UNFORMATTED_VALUE') => (gws([
  'sheets', 'spreadsheets', 'values', 'get', '--params', JSON.stringify({
    spreadsheetId: DEFAULT_PRODUCT_MASTER_SHEET_ID,
    range,
    majorDimension: 'ROWS',
    valueRenderOption,
  }), '--format', 'json',
]).values || []) as unknown[][];

const metadata = gws([
  'sheets', 'spreadsheets', 'get', '--params', JSON.stringify({
    spreadsheetId: DEFAULT_PRODUCT_MASTER_SHEET_ID,
    fields: 'properties(title),sheets.properties(sheetId,title,hidden,gridProperties(rowCount,columnCount))',
  }), '--format', 'json',
]);
const drive = gws([
  'drive', 'files', 'get', '--params', JSON.stringify({
    fileId: DEFAULT_PRODUCT_MASTER_SHEET_ID,
    fields: 'id,name,modifiedTime,version,capabilities(canEdit)',
  }), '--format', 'json',
]);
const sheets = (metadata.sheets || []).map((item: Rec) => item.properties || {});
const sourceSheet = sheets.find((item: Rec) => S(item.title) === PRODUCT_MASTER_TAB);
const reviewSheet = sheets.find((item: Rec) => S(item.title) === '차종마스터_규격검토');
const targetSheet = sheets.find((item: Rec) => S(item.title) === PRODUCT_MASTER_V2_TAB);
if (!sourceSheet || Number(sourceSheet.sheetId) !== 679088240) throw new Error('상품마스터 sheetId 기준선이 다릅니다.');
if (!reviewSheet || Number(reviewSheet.sheetId) !== 271777427) throw new Error('차종마스터_규격검토 sheetId 기준선이 다릅니다.');

const productRange = `'${PRODUCT_MASTER_TAB}'!A1:AZ${Number(sourceSheet.gridProperties?.rowCount || 1000)}`;
const productValues = readValues(productRange, 'UNFORMATTED_VALUE');
const productFormattedValues = readValues(productRange, 'FORMATTED_VALUE');
const reviewValues = readValues(`'차종마스터_규격검토'!A1:X${Number(reviewSheet.gridProperties?.rowCount || 2098)}`);
const headers = (productValues[0] || []).map(S);
if (headers.length !== PRODUCT_MASTER_COLUMNS.length
  || PRODUCT_MASTER_COLUMNS.some((column, index) => headers[index] !== column)) {
  throw new Error('라이브 상품마스터 A:AZ 50열 기준선이 다릅니다.');
}
const sourceRows = productValues.slice(1).filter((row) => row.some((cell) => S(cell)));
const sourceFormattedRows = productFormattedValues.slice(1).filter((row) => row.some((cell) => S(cell)));
if (sourceRows.length !== sourceFormattedRows.length
  || sourceRows.some((row, index) => S(row[0]).replace(/\s/g, '') !== S(sourceFormattedRows[index]?.[0]).replace(/\s/g, ''))) {
  throw new Error('상품마스터 원시값·표시값 행 정렬이 다릅니다.');
}

const coverage = JSON.parse(readFileSync(coveragePath, 'utf8')) as Rec;
assertFreshProductCoverageReport(coverage.generated_at, Date.now(), 30 * 60 * 1000);
if (S(coverage.source?.sheet_id) !== DEFAULT_PRODUCT_MASTER_SHEET_ID
  || S(coverage.source?.tab) !== PRODUCT_MASTER_TAB
  || S(coverage.source?.mode) !== 'live_sheet') {
  throw new Error('차종 커버리지 감사가 현재 라이브 상품마스터 정본이 아닙니다.');
}
// 기존 커버리지 감사기는 Sheets API 기본 표시값을 지문화한다. 같은 표현을 사용해
// CAS를 검증하되, 새 표의 금액은 별도로 읽은 숫자 원시값을 보존한다.
const sourceFingerprint = productCoverageSheetFingerprint(sourceFormattedRows, PRODUCT_MASTER_COLUMNS.length);
if (sourceFingerprint !== S(coverage.source?.sheet_fingerprint)) {
  throw new Error('차종 감사 뒤 상품마스터가 변경됐습니다. 커버리지 감사를 다시 실행하세요.');
}

const reviewHeaders = (reviewValues[0] || []).map(S);
const expectedReviewHeaders = [
  '제조국', '제조사', '모델', '세부모델', '세부트림', '연료', '배기량cc', '과급',
  '배터리kWh', '구동', '구동시스템', '인승', '차종분류', '차체형태', '연식시작',
  '연식종료', '생산시작', '생산종료', '기존 세부모델', '공식근거', '기존 트림행키',
  '검증상태', '확인필요항목', '확인질문',
];
if (reviewHeaders.length !== expectedReviewHeaders.length
  || expectedReviewHeaders.some((column, index) => reviewHeaders[index] !== column)) {
  throw new Error('차종마스터_규격검토 A:X 헤더가 최신 규격과 다릅니다.');
}

const masterArtifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as Rec;
const masterRecords = (masterArtifact.records || []) as Rec[];
const masterByKey = new Map(masterRecords.map((row) => [S(row.trim_row_key), row]));
const reviewByKey = new Map<string, Rec>();
for (const row of reviewValues.slice(1)) {
  const profile = {
    maker: row[1], model: row[2], sub_model: row[3], trim: row[4], fuel: row[5],
    engine_cc: row[6], drivetrain: row[9], seats: row[11],
  };
  for (const key of S(row[20]).split('|').map(S).filter(Boolean)) reviewByKey.set(key, profile);
}

const coverageByRow = new Map<number, Rec>((coverage.rows || []).map((row: Rec) => [Number(row.row), row]));
const profileForKey = (key: unknown): Rec | null => {
  const normalized = S(key);
  if (!normalized) return null;
  const master = masterByKey.get(normalized);
  const review = reviewByKey.get(normalized);
  if (!master && !review) return null;
  return { ...(master || {}), ...(review || {}) };
};
const consensus = (profiles: Rec[], field: string): unknown => {
  const values = [...new Map(profiles.map((profile) => [C(profile[field]), profile[field]]).filter(([key]) => key)).values()];
  return values.length === 1 ? values[0] : '';
};
const oldRecord = (row: readonly unknown[]) => Object.fromEntries(
  PRODUCT_MASTER_COLUMNS.map((column, index) => [column, row[index] ?? '']),
) as Record<(typeof PRODUCT_MASTER_COLUMNS)[number], unknown>;

const identitySourceCounts: Record<string, Record<string, number>> = {};
const countSource = (field: string, source: string) => {
  identitySourceCounts[field] ||= {};
  identitySourceCounts[field][source] = (identitySourceCounts[field][source] || 0) + 1;
};
const resolveIdentity = (input: {
  field: string;
  exact?: unknown;
  candidate?: unknown;
  raw?: unknown;
  snap?: unknown;
}): unknown => {
  for (const [source, value] of [
    ['차종코드', input.exact], ['후보공통축', input.candidate], ['공급사원문', input.raw], ['기존정제축', input.snap],
  ] as const) {
    if (S(value)) {
      countSource(input.field, source);
      return value;
    }
  }
  countSource(input.field, '미입력');
  return '미입력';
};

const v2Rows: Cell[][] = [];
let existingAxisConflicts = 0;
let exactCodeProfiles = 0;
let candidateConsensusRows = 0;
let sourceRawMissing = 0;
let partialPricePairs = 0;
const supplierCounts = new Map<string, number>();
const verificationCounts = new Map<string, number>();
const managementCounts = new Map<string, number>();

for (let index = 0; index < sourceRows.length; index += 1) {
  const old = oldRecord(sourceRows[index]);
  const audit = coverageByRow.get(index + 2) || {};
  const raw = old['공급사 원문보존'];
  if (!S(raw)) sourceRawMissing += 1;
  const exact = profileForKey(old['차종코드']);
  if (exact) exactCodeProfiles += 1;
  const candidates = ((audit.candidate_keys || []) as unknown[])
    .map(profileForKey)
    .filter((profile): profile is Rec => Boolean(profile));
  if (!exact && candidates.length) candidateConsensusRows += 1;
  const source = (aliases: readonly string[]) => productMasterV2SourceValue(raw, aliases);
  const axisConflict = Boolean(audit.current_axis_conflict);
  if (axisConflict) existingAxisConflicts += 1;
  const verification = axisConflict ? '검수필요' : S(old['검증상태']);
  const management = axisConflict && S(old['관리상태']) === '운영' ? '검수필요' : S(old['관리상태']);
  const reason = [S(old['검수사유']), axisConflict ? '차종코드·공급사 명시축 불일치' : '']
    .filter(Boolean).join(' · ');

  const maker = resolveIdentity({
    field: '제조사', exact: exact?.maker, candidate: consensus(candidates, 'maker'),
    raw: source(PRODUCT_MASTER_V2_SOURCE_ALIASES.maker), snap: audit.snap_maker,
  });
  const model = resolveIdentity({
    field: '모델', exact: exact?.model, candidate: consensus(candidates, 'model'),
    raw: source(PRODUCT_MASTER_V2_SOURCE_ALIASES.model), snap: audit.snap_model,
  });
  const subModel = resolveIdentity({
    field: '세부모델', exact: exact?.sub_model, candidate: consensus(candidates, 'sub_model'),
    raw: source(PRODUCT_MASTER_V2_SOURCE_ALIASES.subModel), snap: audit.snap_sub_model,
  });
  const trim = resolveIdentity({
    field: '세부트림', exact: exact?.trim, candidate: consensus(candidates, 'trim'),
    raw: source(PRODUCT_MASTER_V2_SOURCE_ALIASES.trim),
  });
  const fuel = resolveIdentity({
    field: '연료', exact: exact?.fuel, candidate: consensus(candidates, 'fuel'),
    raw: source(PRODUCT_MASTER_V2_SOURCE_ALIASES.fuel), snap: audit.audit_axes?.fuel,
  });
  const displacementSeed = exact?.engine_cc
    || consensus(candidates, 'engine_cc')
    || source(PRODUCT_MASTER_V2_SOURCE_ALIASES.displacement)
    || audit.audit_axes?.engine_cc;
  const seats = exact?.seats
    || consensus(candidates, 'seats')
    || source(PRODUCT_MASTER_V2_SOURCE_ALIASES.seats);
  const drivetrain = exact?.drivetrain
    || consensus(candidates, 'drivetrain')
    || source(PRODUCT_MASTER_V2_SOURCE_ALIASES.drivetrain);
  const powertrain = exact?.powertrain || consensus(candidates, 'powertrain');
  const year = source(PRODUCT_MASTER_V2_SOURCE_ALIASES.year) || audit.audit_axes?.year;
  const mileage = source(PRODUCT_MASTER_V2_SOURCE_ALIASES.mileage);
  const policyCode = old['정책코드'];

  const values = new Map<ProductMasterV2Column, Cell>([
    ['차량번호', S(old['차량번호'])],
    ['공급사명', S(old['공급사명'])],
    ['제조사', productMasterV2Display(maker)],
    ['모델', productMasterV2Display(model)],
    ['세부모델', productMasterV2Display(subModel)],
    ['세부트림', productMasterV2Display(trim)],
    ['외장', productMasterV2Display(source(PRODUCT_MASTER_V2_SOURCE_ALIASES.exterior))],
    ['내장', productMasterV2Display(source(PRODUCT_MASTER_V2_SOURCE_ALIASES.interior))],
    ['연식', productMasterV2Display(year)],
    ['주행거리(km)', productMasterV2Mileage(mileage)],
    ['연료', productMasterV2Display(fuel)],
    ['옵션', productMasterV2Display(old['옵션'])],
    ['배기량(cc)', productMasterV2Displacement(displacementSeed)],
    ['차량상태', productMasterV2Display(old['차량상태'])],
    ['상품구분', productMasterV2Display(old['분류'])],
    ['영업정책', productMasterV2SalesPolicy(policyCode)],
    ['검증상태', verification || '미매칭'],
    ['검수사유', reason],
    ['관리상태', management || '검수필요'],
    ['사진링크', S(old['사진링크'])],
    ['입고일자', S(old['입고일자'])],
    ['인승', productMasterV2Display(seats)],
    ['구동방식', productMasterV2Display(drivetrain)],
    ['파워트레인', productMasterV2Display(powertrain)],
    ['정책코드', S(policyCode)],
    ['차종코드', S(old['차종코드'])],
    ['공급사코드', S(old['공급사코드'])],
    ['최종갱신', S(old['최종갱신'])],
    ['원천', S(old['원천'])],
    ['공급사 원문보존', S(raw)],
  ]);
  for (const column of PRODUCT_MASTER_V2_PRICE_COLUMNS) values.set(column, old[column] as Cell ?? '');
  const row = PRODUCT_MASTER_V2_COLUMNS.map((column) => values.get(column) ?? '');
  v2Rows.push(row);
  supplierCounts.set(S(old['공급사명']) || '(미입력)', (supplierCounts.get(S(old['공급사명']) || '(미입력)') || 0) + 1);
  verificationCounts.set(verification || '미매칭', (verificationCounts.get(verification || '미매칭') || 0) + 1);
  managementCounts.set(management || '검수필요', (managementCounts.get(management || '검수필요') || 0) + 1);
  for (let price = 0; price < PRODUCT_MASTER_V2_PRICE_COLUMNS.length; price += 2) {
    const rent = S(values.get(PRODUCT_MASTER_V2_PRICE_COLUMNS[price]));
    const deposit = S(values.get(PRODUCT_MASTER_V2_PRICE_COLUMNS[price + 1]));
    if (Boolean(rent) !== Boolean(deposit)) partialPricePairs += 1;
  }
}

const plates = v2Rows.map((row) => S(row[0]).replace(/\s/g, '')).filter(Boolean);
const duplicatePlates = plates.length - new Set(plates).size;
const requiredVisible = ['제조사', '모델', '세부모델', '세부트림', '외장', '내장', '연식', '주행거리(km)', '연료', '배기량(cc)'] as const;
const missingVisible = Object.fromEntries(requiredVisible.map((column) => {
  const at = PRODUCT_MASTER_V2_COLUMNS.indexOf(column);
  return [column, v2Rows.filter((row) => S(row[at]) === '미입력').length];
}));
const priceOrderIssues = productMasterV2PriceOrderIssues();
const headerFingerprint = hash(PRODUCT_MASTER_V2_COLUMNS);
const outputFingerprint = hash(v2Rows);
const report = {
  reportType: 'product_master_v2_parallel_tab_plan_v1',
  generatedAt: new Date().toISOString(),
  mode: 'dry_run',
  write: 0,
  source: {
    spreadsheetId: DEFAULT_PRODUCT_MASTER_SHEET_ID,
    spreadsheetTitle: S(metadata.properties?.title),
    driveVersion: S(drive.version),
    modifiedTime: S(drive.modifiedTime),
    sourceTab: PRODUCT_MASTER_TAB,
    sourceSheetId: Number(sourceSheet.sheetId),
    sourceRows: sourceRows.length,
    sourceColumns: PRODUCT_MASTER_COLUMNS.length,
    sourceFingerprint,
    sourceUnformattedFingerprint: hash(sourceRows),
    reviewTab: '차종마스터_규격검토',
    reviewSheetId: Number(reviewSheet.sheetId),
    reviewRows: reviewValues.length - 1,
    reviewFingerprint: hash(reviewValues),
    masterArtifactRows: masterRecords.length,
    masterArtifactDataAsOf: S(masterArtifact.data_as_of),
    coveragePath,
    coverageGeneratedAt: S(coverage.generated_at),
  },
  target: {
    strategy: 'parallel_tab_then_cutover',
    tab: PRODUCT_MASTER_V2_TAB,
    targetExistsBefore: Boolean(targetSheet),
    exactRange: `'${PRODUCT_MASTER_V2_TAB}'!A1:BJ${v2Rows.length + 1}`,
    rows: v2Rows.length,
    columns: PRODUCT_MASTER_V2_COLUMNS.length,
    plannedCells: (v2Rows.length + 1) * PRODUCT_MASTER_V2_COLUMNS.length,
    frozenRows: PRODUCT_MASTER_V2_FROZEN_ROWS,
    frozenColumns: PRODUCT_MASTER_V2_FROZEN_COLUMNS,
    existingProductMasterCellsMutated: 0,
    headerFingerprint,
    outputFingerprint,
  },
  validation: {
    rows: v2Rows.length,
    uniquePlates: new Set(plates).size,
    duplicatePlates,
    exactCodeProfiles,
    candidateConsensusRows,
    existingAxisConflicts,
    sourceRawMissing,
    partialPricePairs,
    priceOrderIssues,
    missingVisible,
    identitySourceCounts,
    verificationCounts: Object.fromEntries(verificationCounts),
    managementCounts: Object.fromEntries(managementCounts),
    supplierCounts: Object.fromEntries([...supplierCounts].sort(([a], [b]) => a.localeCompare(b, 'ko'))),
  },
  presentation: {
    visibleOrder: PRODUCT_MASTER_V2_COLUMNS.slice(0, PRODUCT_MASTER_V2_COLUMNS.indexOf('검증상태')),
    managementColumns: PRODUCT_MASTER_V2_COLUMNS.slice(PRODUCT_MASTER_V2_COLUMNS.indexOf('검증상태')),
    columnGroups: [
      { label: '기본 기간 가격', range: 'L:AE', collapsedByDefault: false },
      { label: '예외·인수형 가격', range: 'AF:AQ', collapsedByDefault: true },
      { label: '관리영역', range: 'AW:BJ', collapsedByDefault: true },
    ],
    moneyFormat: '#,##0',
    mileageFormat: '#,##0"km"',
    displacementFormat: '#,##0"cc"',
    missingLabel: '미입력',
    priceNotOfferedLabel: '빈칸 유지',
    conditionalFormatting: [
      '미입력 사양 셀=연한 노랑',
      '검수필요·미매칭 행의 A:B=주황',
      '차종코드·공급사 명시축 충돌 행의 A:B=빨강',
      '대여료·보증금 한쪽만 있는 가격쌍=빨강',
      '출고불가·판매완료·종료 행의 A:B=회색',
    ],
    candidateCellNote: '후보 공통축으로 표시한 셀은 확정 차종코드가 아니며 셀 메모로 출처를 표시',
  },
  cutoverGate: {
    currentRuntimeContract: '상품마스터 A:AZ 50열',
    plannedRuntimeContract: `${PRODUCT_MASTER_V2_TAB} A:BJ 62열`,
    runtimeParserMigrationRequired: true,
    liveWriteRequiresImmediateApproval: true,
    parallelTabCreateBlockers: [
      ...(targetSheet ? [`${PRODUCT_MASTER_V2_TAB} 탭이 이미 존재하므로 자동 덮어쓰기 금지`] : []),
      ...(duplicatePlates ? [`차량번호 중복 ${duplicatePlates}건`] : []),
      ...(priceOrderIssues.length ? priceOrderIssues : []),
    ],
    erpCutoverBlockers: [
      '62열 헤더 기반 파서·50열 역호환 파서 이중검증 미실행',
      '신규 탭 전체 587행 왕복 파싱 diff 미실행',
      '가격쌍 불균형 16건의 해당 기간 제외 회귀검사 미실행',
      ...(existingAxisConflicts ? [`기존 확정 코드 명시축 불일치 ${existingAxisConflicts}건 자동확정 금지`] : []),
    ],
  },
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  mode: report.mode,
  write: report.write,
  source: report.source,
  target: report.target,
  validation: report.validation,
  cutoverGate: report.cutoverGate,
  report: outputPath,
}, null, 2));
