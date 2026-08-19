/**
 * Create the permanent-keyed review adoption companion tab.
 *
 * This never mutates `차종마스터`, the permanent-key registry, the generated
 * artifact, or operational automatic/manual/blocked status.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  VEHICLE_MASTER_REVIEW_ADOPTION_HEADERS,
  VEHICLE_MASTER_REVIEW_ADOPTION_CONTRACT_VERSION,
  VEHICLE_MASTER_REVIEW_ADOPTION_TAB,
  buildVehicleMasterReviewPromotionEntries,
  finalizeVehicleMasterReviewAdoptionRows,
  matchesGoogleSheetHiddenProperty,
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
const arg = (name: string) => S(process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const file = (path: string) => {
  const raw = readFileSync(path, 'utf8');
  return { raw, value: JSON.parse(raw) as Rec, sha256: createHash('sha256').update(raw).digest('hex') };
};
const normalizeRows = (rows: unknown[][], width: number) => rows.map((row) =>
  Array.from({ length: width }, (_, index) => row[index] ?? ''));
const EXPECTED_CONFIRMATION = 'CREATE_VEHICLE_MASTER_REVIEW_ADOPTION_V1';
const EXPECTED_EXECUTION_SUBJECT = 'pyh@teamjpk.com';
const journalPath = 'tmp/vehicle-master-review-adoption-journal.json';
const journalBackupPath = 'tmp/vehicle-master-review-adoption-journal.previous.json';
const executionLockPath = 'tmp/vehicle-master-review-adoption.lock.json';
const atomicReplaceText = (path: string, text: string) => {
  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  const descriptor = openSync(temporaryPath, 'wx');
  try {
    writeFileSync(descriptor, text, { encoding: 'utf8' });
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporaryPath, path);
  } catch (cause) {
    rmSync(temporaryPath, { force: true });
    throw cause;
  }
};
const parseJsonFile = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Rec;
const readPriorJournal = () => {
  const errors: string[] = [];
  for (const path of [journalPath, journalBackupPath]) {
    if (!existsSync(path)) continue;
    try {
      return parseJsonFile(path);
    } catch (cause) {
      errors.push(`${path}:${S((cause as Error).message)}`);
    }
  }
  if (errors.length) throw new Error(`적용 journal과 이전 세대를 모두 읽지 못했습니다: ${errors.join('; ')}`);
  return null;
};
const atomicWriteJournal = (value: Rec) => {
  let previousText = '';
  for (const path of [journalPath, journalBackupPath]) {
    if (!existsSync(path)) continue;
    const candidate = readFileSync(path, 'utf8');
    try {
      JSON.parse(candidate);
      previousText = candidate;
      break;
    } catch {
      // A valid previous generation, if present, is tried next.
    }
  }
  if (previousText) atomicReplaceText(journalBackupPath, previousText);
  atomicReplaceText(journalPath, `${JSON.stringify(value, null, 2)}\n`);
};
const seedJournalGenerations = (value: Rec) => {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  // Both generations are durably seeded before any remote create request.
  atomicReplaceText(journalPath, text);
  atomicReplaceText(journalBackupPath, text);
  const seededCurrent = parseJsonFile(journalPath);
  const seededPrevious = parseJsonFile(journalBackupPath);
  if (JSON.stringify(seededCurrent) !== JSON.stringify(value)
    || JSON.stringify(seededPrevious) !== JSON.stringify(value)) {
    throw new Error('원격 addSheet 전 journal 2세대 seed 재읽기 검증에 실패했습니다.');
  }
};
const APPLY = process.argv.includes('--apply');
const confirmation = arg('confirm');
const approvalReference = arg('approval-reference');
const approvedPlanSha256 = arg('approved-plan-sha256').toLowerCase();
if (!APPLY || confirmation !== EXPECTED_CONFIRMATION) {
  throw new Error(`라이브 쓰기는 --apply --confirm=${EXPECTED_CONFIRMATION}가 함께 있어야 합니다.`);
}
if (!/^[A-Za-z0-9._:-]{8,120}$/.test(approvalReference)) {
  throw new Error('--approval-reference는 직전 사용자 승인에 대응하는 8~120자 영문/숫자 식별자여야 합니다.');
}
if (!/^[0-9a-f]{64}$/.test(approvedPlanSha256)) {
  throw new Error('--approved-plan-sha256에 사용자가 직전 승인한 64자리 계획 SHA-256이 필요합니다.');
}

const planPath = 'tmp/vehicle-master-review-adoption-plan.json';
const plan = file(planPath);
const artifact = file('public/data/vehicle-trim-master.json');
const registryFile = file('data/vehicle-trim-key-registry.json');
const localReviewFile = file('tmp/hyundai-three-model-review.json');
const registry = registryFile.value as unknown as TrimKeyRegistry;
if (plan.sha256 !== approvedPlanSha256) throw new Error('직전 사용자 승인 계획 SHA-256과 현재 계획 파일이 다릅니다.');
if (plan.value.reportType !== 'vehicle_master_review_keyed_adoption_plan_v1'
  || plan.value.contractVersion !== VEHICLE_MASTER_REVIEW_ADOPTION_CONTRACT_VERSION
  || plan.value.mode !== 'dry_run' || Number(plan.value.write) !== 0
  || plan.value.humanApprovalRecorded !== false) {
  throw new Error('승인 전 dry-run 계획 파일 형식이 다릅니다.');
}
const implementation = plan.value.source?.implementation || {};
const implementationPaths = [
  'lib/domain/vehicle-master-review-promotion.ts',
  'lib/domain/vehicle-master-sheet.ts',
  'lib/domain/vehicle-trim-key-contract.ts',
  'scripts/apply-vehicle-master-review-adoption.mts',
] as const;
for (const path of implementationPaths) {
  const current = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (S(implementation[path]) !== current) throw new Error(`승인 계획 이후 구현 파일이 변경됐습니다: ${path}`);
}
if (artifact.sha256 !== S(plan.value.source?.masterArtifactSha256)
  || registryFile.sha256 !== S(plan.value.source?.registrySha256)
  || localReviewFile.sha256 !== S(plan.value.source?.localReviewArtifactSha256)) {
  throw new Error('dry-run 이후 artifact·영구키 레지스트리·로컬 검토 artifact 중 하나가 변경됐습니다.');
}
const sourceSnapshot = file(S(plan.value.source?.sourceSnapshotPath));
if (sourceSnapshot.sha256 !== S(plan.value.source?.sourceSnapshotSha256)) {
  throw new Error('승인 계획의 읽기 전용 원본 스냅샷 해시가 다릅니다.');
}

const approvedSpreadsheetId = S(plan.value.source?.spreadsheetId);
if (approvedSpreadsheetId !== MASTER_SHEET_ID) {
  throw new Error('승인 계획의 spreadsheetId와 현재 차종마스터 상수가 다릅니다.');
}
if (S(plan.value.source?.executionSubject) !== EXPECTED_EXECUTION_SUBJECT) {
  throw new Error('승인 계획의 실행 계정이 허용된 Google Workspace 계정과 다릅니다.');
}

const lockNonce = randomBytes(16).toString('hex');
const lockRecord = {
  schema: 'vehicle_master_review_adoption_execution_lock_v1',
  lockNonce,
  pid: process.pid,
  planSha256: plan.sha256,
  approvedPlanSha256,
  approvalReference,
  acquiredAt: new Date().toISOString(),
};
const processIsAlive = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
};
if (existsSync(executionLockPath)) {
  let staleLock: Rec;
  try {
    staleLock = parseJsonFile(executionLockPath);
  } catch (cause) {
    throw new Error(`기존 실행 lock을 안전하게 읽을 수 없어 중단합니다: ${S((cause as Error).message)}`);
  }
  if (S(staleLock.planSha256) !== plan.sha256
    || S(staleLock.approvedPlanSha256) !== approvedPlanSha256
    || S(staleLock.approvalReference) !== approvalReference) {
    throw new Error('다른 승인 실행의 lock이 남아 있어 자동 인계하지 않습니다.');
  }
  if (processIsAlive(Number(staleLock.pid))) {
    throw new Error(`동일 차종마스터 채택 apply가 이미 실행 중입니다(pid=${Number(staleLock.pid)}).`);
  }
  const staleNonce = S(staleLock.lockNonce);
  if (!/^[0-9a-f]{32}$/.test(staleNonce)) throw new Error('기존 실행 lock nonce가 유효하지 않습니다.');
  renameSync(executionLockPath, `${executionLockPath}.stale-${staleNonce}-${Date.now()}.json`);
}
const lockDescriptor = openSync(executionLockPath, 'wx');
try {
  writeFileSync(lockDescriptor, `${JSON.stringify(lockRecord, null, 2)}\n`, { encoding: 'utf8' });
  fsyncSync(lockDescriptor);
} finally {
  closeSync(lockDescriptor);
}
let ownsExecutionLock = true;
const releaseExecutionLock = () => {
  if (!ownsExecutionLock) return;
  try {
    const current = parseJsonFile(executionLockPath);
    if (S(current.lockNonce) === lockNonce) rmSync(executionLockPath);
  } catch {
    // Leave an ambiguous lock in place; the next run must fail closed.
  }
  ownsExecutionLock = false;
};
process.once('exit', releaseExecutionLock);
const priorJournal = readPriorJournal();

const credentials = JSON.parse(readFileSync(
  S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8',
)) as Rec;
const executionSubject = S(process.env.GOOGLE_WORKSPACE_SUBJECT) || EXPECTED_EXECUTION_SUBJECT;
if (executionSubject !== EXPECTED_EXECUTION_SUBJECT
  || executionSubject !== S(plan.value.source?.executionSubject)) {
  throw new Error('실행 subject가 승인 계획과 정확히 일치하지 않습니다.');
}
const token = (await new JWT({
  email: S(credentials.client_email),
  key: S(credentials.private_key),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  subject: executionSubject,
}).getAccessToken()).token;
if (!token) throw new Error('Sheets 쓰기 토큰이 없습니다.');
const base = `https://sheets.googleapis.com/v4/spreadsheets/${approvedSpreadsheetId}`;
const api = async (url: string, init: RequestInit = {}) => {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => ({})) as Rec;
  if (!response.ok) throw new Error(`Sheets ${response.status}: ${JSON.stringify(body).slice(0, 1000)}`);
  return body;
};
const metadataFields = 'properties(title),sheets(properties(sheetId,title,hidden,gridProperties(rowCount,columnCount,frozenRowCount,hideGridlines)),basicFilter,protectedRanges(description,warningOnly,range,unprotectedRanges,editors(users,groups,domainUsersCanEdit)),conditionalFormats(ranges,booleanRule),developerMetadata(metadataKey,metadataValue,visibility,location))';
const metadata = async () => api(`${base}?fields=${encodeURIComponent(metadataFields)}`);
const readValuesBySheetId = async (sheetId: number, rowCount: number, columnCount: number) => {
  const body = await api(`${base}/values:batchGetByDataFilter`, {
    method: 'POST',
    body: JSON.stringify({
      dataFilters: [{ gridRange: {
        sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: columnCount,
      } }],
      majorDimension: 'ROWS',
      valueRenderOption: 'UNFORMATTED_VALUE',
    }),
  });
  return (body.valueRanges?.[0]?.valueRange?.values || []) as unknown[][];
};
const inspectSheetHeader = async (title: string) => api(
  `${base}?includeGridData=true&ranges=${encodeURIComponent(`'${title}'!A1:AD1`)}&fields=${encodeURIComponent('sheets(properties(sheetId,title),data(columnMetadata(pixelSize),rowMetadata(pixelSize),rowData(values(note,userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)))))')}`,
);
const sheetRecord = (meta: Rec, title: string) => (meta.sheets || []).find((item: Rec) => S(item.properties?.title) === title);
const sheetRecordById = (meta: Rec, sheetId: number) => (meta.sheets || []).find((item: Rec) => Number(item.properties?.sheetId) === sheetId);
const tab = (meta: Rec, title: string) => sheetRecord(meta, title)?.properties;
const hasSheetMetadata = (record: Rec | null | undefined, key: string, value: string) =>
  (record?.developerMetadata || []).some((item: Rec) =>
    S(item.metadataKey) === key && S(item.metadataValue) === value);
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const SHEETS_SERVER_SETTLE_WINDOW_MS = 190_000;
const FINAL_ROLLBACK_SOURCE_PHASES = new Set(['rename_requested', 'renamed', 'verified']);
const AMBIGUOUS_RENAME_PENDING_PHASES = new Set(['rename_requested', 'ambiguous_rename_outcome_unknown']);
const AMBIGUOUS_REHIDE_PENDING_PHASES = new Set(['ambiguous_rehide_requested']);
const enforceAmbiguousOutcomeFence = (
  journal: Rec,
  phases: Set<string>,
  canonicalPhase: string,
  fenceField: string,
  label: string,
) => {
  if (!phases.has(S(journal.phase))) return;
  let fenceStartedAtMs = Number(journal[fenceField] || 0);
  if (!(fenceStartedAtMs > 0)) {
    fenceStartedAtMs = Date.now();
    Object.assign(journal, {
      phase: canonicalPhase,
      phaseAt: new Date().toISOString(),
      [fenceField]: fenceStartedAtMs,
    });
    seedJournalGenerations(journal);
    throw new Error(`${label} 결과불명확 처리창을 지금부터 ${SHEETS_SERVER_SETTLE_WINDOW_MS}ms 동안 고정합니다.`);
  }
  const elapsed = Date.now() - fenceStartedAtMs;
  if (elapsed < SHEETS_SERVER_SETTLE_WINDOW_MS) {
    throw new Error(`${label} 결과불명확 처리창이 끝나지 않았습니다; retryAfterMs=${SHEETS_SERVER_SETTLE_WINDOW_MS - elapsed}`);
  }
};
const requestOwnedStagingCreation = async (
  sheetId: number,
  title: string,
  rowCount: number,
  columnCount: number,
  nonce: string,
) => api(`${base}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({ requests: [
    { addSheet: { properties: {
      sheetId,
      title,
      hidden: true,
      gridProperties: { rowCount, columnCount, frozenRowCount: 1, hideGridlines: true },
      tabColor: { red: 0.16, green: 0.45, blue: 0.72 },
    } } },
    { createDeveloperMetadata: { developerMetadata: {
      metadataKey: 'vehicle_master_review_staging_nonce_v1',
      metadataValue: nonce,
      location: { sheetId },
      visibility: 'DOCUMENT',
    } } },
  ] }),
});
const assertOwnedStagingRecord = (
  meta: Rec,
  sheetId: number,
  title: string,
  rowCount: number,
  columnCount: number,
  nonce: string,
) => {
  const record = sheetRecordById(meta, sheetId);
  const properties = record?.properties || {};
  if (!record || Number(properties.sheetId) !== sheetId || S(properties.title) !== title
    || Number(tab(meta, title)?.sheetId) !== sheetId || properties.hidden !== true
    || Number(properties.gridProperties?.rowCount) !== rowCount
    || Number(properties.gridProperties?.columnCount) !== columnCount
    || !hasSheetMetadata(record, 'vehicle_master_review_staging_nonce_v1', nonce)) {
    throw new Error('숨김 staging 탭의 sheetId·이름·행열·nonce 소유권을 증명하지 못했습니다.');
  }
  return record;
};
const reconcileOwnedStagingCreation = async (
  sheetId: number,
  title: string,
  rowCount: number,
  columnCount: number,
  nonce: string,
  lastDispatchedAtMs: number,
  dispatchCount: number,
  recordSingleDispatch: (dispatchedAtMs: number, nextDispatchCount: number) => void,
) => {
  const pollForOwnedSheet = async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const currentMetadata = await metadata();
      const byId = sheetRecordById(currentMetadata, sheetId);
      if (byId) return assertOwnedStagingRecord(currentMetadata, sheetId, title, rowCount, columnCount, nonce);
      const titleCollision = sheetRecord(currentMetadata, title);
      if (titleCollision) throw new Error('같은 staging 이름을 다른 sheetId가 선점했습니다.');
      await delay(Math.min(4000, 500 * (2 ** attempt)));
    }
    return null;
  };
  const observed = await pollForOwnedSheet();
  if (observed) return observed;

  const elapsedSinceDispatch = lastDispatchedAtMs > 0 ? Date.now() - lastDispatchedAtMs : Number.POSITIVE_INFINITY;
  if (elapsedSinceDispatch < SHEETS_SERVER_SETTLE_WINDOW_MS) {
    throw new Error(`이전 addSheet 처리창이 끝나지 않아 재발행하지 않습니다; retryAfterMs=${SHEETS_SERVER_SETTLE_WINDOW_MS - elapsedSinceDispatch}`);
  }
  if (dispatchCount >= 2) {
    throw new Error('addSheet 단일 재발행도 결과불명확하여 자동으로 세 번째 요청을 보내지 않습니다.');
  }

  const dispatchedAtMs = Date.now();
  recordSingleDispatch(dispatchedAtMs, dispatchCount + 1);
  let dispatchError = '';
  try {
    await requestOwnedStagingCreation(sheetId, title, rowCount, columnCount, nonce);
  } catch (cause) {
    dispatchError = S((cause as Error).message);
  }
  const afterSingleDispatch = await pollForOwnedSheet();
  if (afterSingleDispatch) return afterSingleDispatch;
  throw new Error(`단일 addSheet 재발행 결과를 확정하지 못해 unknown을 유지합니다: ${dispatchError || 'no visible sheet'}`);
};
const deleteOwnedSheetWithReconciliation = async (
  sheetId: number,
  proveOwnership: (record: Rec) => boolean,
  label: string,
) => {
  const observeReappearanceAfterThreeAbsences = async () => {
    for (let confirmation = 0; confirmation < 3; confirmation += 1) {
      await delay(500 * (confirmation + 1));
      const record = sheetRecordById(await metadata(), sheetId);
      if (record) return record;
    }
    return null;
  };
  let lastError = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const currentMetadata = await metadata();
    let record = sheetRecordById(currentMetadata, sheetId);
    if (!record) {
      record = await observeReappearanceAfterThreeAbsences();
      if (!record) return;
    }
    if (!proveOwnership(record)) throw new Error(`${label} sheetId의 이번 실행 소유권을 증명하지 못했습니다.`);
    try {
      await api(`${base}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: [{ deleteSheet: { sheetId } }] }),
      });
    } catch (cause) {
      lastError = S((cause as Error).message);
    }
    await delay(Math.min(4000, 500 * (2 ** attempt)));
  }
  const reappeared = await observeReappearanceAfterThreeAbsences();
  if (!reappeared) return;
  if (!proveOwnership(reappeared)) {
    throw new Error(`${label} 삭제 재조정 중 재등장한 sheetId의 소유권을 증명하지 못했습니다.`);
  }
  throw new Error(`${label} 삭제 결과를 확정하지 못했습니다: ${lastError || 'sheet still visible'}`);
};
const retainOwnedFinalAsStaging = async ({
  sheetId,
  temporaryTitle,
  rowCount,
  columnCount,
  nonce,
  expectedProvenanceMarker,
  recordRehideIntent,
}: {
  sheetId: number;
  temporaryTitle: string;
  rowCount: number;
  columnCount: number;
  nonce: string;
  expectedProvenanceMarker: string;
  recordRehideIntent: (dispatchedAtMs: number) => void;
}) => {
  const classify = (meta: Rec) => {
    const record = sheetRecordById(meta, sheetId);
    if (!record) return { state: 'missing' as const, record: null };
    const properties = record.properties || {};
    const hasExactStagingNonce = hasSheetMetadata(
      record,
      'vehicle_master_review_staging_nonce_v1',
      nonce,
    );
    const isOwnedHiddenStaging = S(properties.title) === temporaryTitle
      && properties.hidden === true
      && Number(properties.gridProperties?.rowCount) === rowCount
      && Number(properties.gridProperties?.columnCount) === columnCount
      && hasExactStagingNonce;
    if (isOwnedHiddenStaging) return { state: 'hidden_staging' as const, record };
    const isOwnedVisibleTarget = S(properties.title) === VEHICLE_MASTER_REVIEW_ADOPTION_TAB
      && matchesGoogleSheetHiddenProperty(properties.hidden, false)
      && Number(properties.gridProperties?.rowCount) === rowCount
      && Number(properties.gridProperties?.columnCount) === columnCount
      && hasExactStagingNonce
      && hasSheetMetadata(record, 'vehicle_master_review_adoption_v1', expectedProvenanceMarker);
    if (isOwnedVisibleTarget) return { state: 'visible_target' as const, record };
    return { state: 'foreign_or_mutated' as const, record };
  };

  let currentMetadata = await metadata();
  let owned = classify(currentMetadata);
  if (owned.state === 'hidden_staging') {
    assertOwnedStagingRecord(currentMetadata, sheetId, temporaryTitle, rowCount, columnCount, nonce);
    return { state: 'hidden_staging' as const, requestError: '' };
  }
  if (owned.state !== 'visible_target') {
    throw new Error(`소유 탭을 숨김 staging으로 보존할 수 없는 상태입니다: ${owned.state}`);
  }
  const titleCollision = sheetRecord(currentMetadata, temporaryTitle);
  if (titleCollision && Number(titleCollision.properties?.sheetId) !== sheetId) {
    throw new Error('소유 탭을 숨김 staging으로 되돌릴 이름이 다른 sheetId에 점유됐습니다.');
  }

  const dispatchedAtMs = Date.now();
  recordRehideIntent(dispatchedAtMs);
  let requestError = '';
  try {
    await api(`${base}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ updateSheetProperties: {
        properties: { sheetId, title: temporaryTitle, hidden: true },
        fields: 'title,hidden',
      } }] }),
    });
  } catch (cause) {
    requestError = S((cause as Error).message);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    currentMetadata = await metadata();
    owned = classify(currentMetadata);
    if (owned.state === 'hidden_staging') {
      assertOwnedStagingRecord(currentMetadata, sheetId, temporaryTitle, rowCount, columnCount, nonce);
      return { state: 'hidden_staging' as const, requestError };
    }
    if (owned.state !== 'visible_target') {
      throw new Error(`re-hide 결과가 소유 상태를 벗어났습니다: ${owned.state}`);
    }
    await delay(Math.min(4000, 500 * (2 ** attempt)));
  }
  return { state: 'visible_target_unknown' as const, requestError };
};

let beforeMetadata = await metadata();
if (S(beforeMetadata.properties?.title) !== S(plan.value.source?.spreadsheetTitle)) {
  throw new Error('승인 계획의 스프레드시트 제목과 실제 쓰기 대상이 다릅니다.');
}
const priorMatchesApproval = Boolean(priorJournal
  && S(priorJournal.planSha256) === plan.sha256
  && S(priorJournal.approvedPlanSha256) === approvedPlanSha256
  && S(priorJournal.approvalReference) === approvalReference);
let recoverySheetId = 0;
let resumeStagingSheetId = 0;
let resumeStagingHasMetadata = false;
let existingTarget = tab(beforeMetadata, VEHICLE_MASTER_REVIEW_ADOPTION_TAB);
if (existingTarget) {
  if (!priorMatchesApproval || ![
    'create_requested', 'create_dispatched', 'create_outcome_unknown', 'created', 'values_writing', 'values_written',
    'metadata_written', 'metadata_verified', 'rename_requested', 'renamed',
    'verified', 'verified_recovered', 'ambiguous_rename_outcome_unknown',
    'ambiguous_rehide_requested', 'ambiguous_resume_failed',
    'recovery_rollback_requested', 'rollback_requested', 'rollback_failed',
  ].includes(S(priorJournal?.phase))
    || Number(priorJournal?.targetSheetId || 0) !== Number(existingTarget.sheetId)) {
    throw new Error('규격채택 탭이 이미 있으며 현재 승인 계획의 복구 대상임을 증명할 수 없습니다.');
  }
  const priorPhase = S(priorJournal?.phase);
  const priorTargetSheetId = Number(priorJournal?.targetSheetId || 0);
  const priorTemporarySheetName = S(priorJournal?.temporarySheetName);
  const priorRunNonce = S(priorJournal?.runNonce);
  const priorProvenanceMarker = S(priorJournal?.provenanceMarker);
  const previouslyVerified = priorPhase === 'verified' || priorPhase === 'verified_recovered';
  const knownFinalRollbackSourcePhase = [
    'rollback_requested', 'rollback_failed', 'recovery_rollback_requested',
  ].includes(priorPhase)
    ? S(priorJournal?.rollbackSourcePhase)
    : priorPhase;
  if (!previouslyVerified) {
    if (!priorTemporarySheetName.startsWith('_staging_vehicle_review_')
      || !/^[0-9a-f]{32}$/.test(priorRunNonce)
      || !/^sha256:[0-9a-f]{64}$/.test(priorProvenanceMarker)
      || Number(priorJournal?.targetRows) !== 2107 || Number(priorJournal?.targetColumns) !== 30) {
      throw new Error('미검증 최종 탭의 journal sheetId·이름·행열·nonce·provenance 소유권 정보가 불완전합니다.');
    }
    if (priorJournal?.ambiguousCreateOrigin !== true
      && !FINAL_ROLLBACK_SOURCE_PHASES.has(knownFinalRollbackSourcePhase)) {
      throw new Error('미검증 최종 탭 rollback journal의 원본 phase가 최종 이름 상태를 허용하지 않습니다.');
    }
    if (priorJournal?.ambiguousCreateOrigin === true) {
      enforceAmbiguousOutcomeFence(
        priorJournal as Rec,
        AMBIGUOUS_RENAME_PENDING_PHASES,
        'ambiguous_rename_outcome_unknown',
        'renameOutcomeFenceStartedAtMs',
        'rename',
      );
      enforceAmbiguousOutcomeFence(
        priorJournal as Rec,
        AMBIGUOUS_REHIDE_PENDING_PHASES,
        'ambiguous_rehide_requested',
        'rehideOutcomeFenceStartedAtMs',
        're-hide',
      );
      const retained = await retainOwnedFinalAsStaging({
        sheetId: priorTargetSheetId,
        temporaryTitle: priorTemporarySheetName,
        rowCount: 2107,
        columnCount: 30,
        nonce: priorRunNonce,
        expectedProvenanceMarker: priorProvenanceMarker,
        recordRehideIntent: (dispatchedAtMs) => {
          Object.assign(priorJournal as Rec, {
            phase: 'ambiguous_rehide_requested',
            phaseAt: new Date().toISOString(),
            lastRehideDispatchedAtMs: dispatchedAtMs,
            rehideOutcomeFenceStartedAtMs: 0,
            ambiguousCreateOrigin: true,
          });
          seedJournalGenerations(priorJournal as Rec);
        },
      });
      if (retained.state !== 'hidden_staging') {
        throw new Error(`미검증 최종 탭의 re-hide 결과를 확정하지 못했습니다: ${retained.requestError || 'final target still visible'}`);
      }
      Object.assign(priorJournal as Rec, {
        phase: 'ambiguous_resume_failed',
        phaseAt: new Date().toISOString(),
        retainedHiddenStaging: true,
        rehideRequestError: retained.requestError,
      });
      atomicWriteJournal(priorJournal as Rec);
    } else {
      const rollbackIntent = {
        ...(priorJournal as Rec),
        phase: 'recovery_rollback_requested',
        phaseAt: new Date().toISOString(),
        rollbackReason: 'unverified_final_recovery',
        rollbackSourcePhase: knownFinalRollbackSourcePhase,
        targetSheetId: priorTargetSheetId,
        ambiguousCreateOrigin: false,
      };
      Object.assign(priorJournal as Rec, rollbackIntent);
      seedJournalGenerations(rollbackIntent);
      await deleteOwnedSheetWithReconciliation(
        priorTargetSheetId,
        (record) => {
          const properties = record.properties || {};
          return S(properties.title) === VEHICLE_MASTER_REVIEW_ADOPTION_TAB
            && matchesGoogleSheetHiddenProperty(properties.hidden, false)
            && Number(properties.gridProperties?.rowCount) === 2107
            && Number(properties.gridProperties?.columnCount) === 30
            && FINAL_ROLLBACK_SOURCE_PHASES.has(knownFinalRollbackSourcePhase)
            && hasSheetMetadata(record, 'vehicle_master_review_staging_nonce_v1', priorRunNonce)
            && hasSheetMetadata(record, 'vehicle_master_review_adoption_v1', priorProvenanceMarker);
        },
        '미검증 최종 규격채택 recovery rollback',
      );
      Object.assign(priorJournal as Rec, {
        phase: 'recovery_rolled_back',
        phaseAt: new Date().toISOString(),
        recoveredSheetId: priorTargetSheetId,
      });
      atomicWriteJournal(priorJournal as Rec);
    }
    beforeMetadata = await metadata();
    existingTarget = tab(beforeMetadata, VEHICLE_MASTER_REVIEW_ADOPTION_TAB);
    if (existingTarget) throw new Error('미검증 최종 규격채택 탭의 선제 보존·rollback 후에도 최종 이름이 남아 있습니다.');
  } else {
    recoverySheetId = Number(existingTarget.sheetId);
  }
}
if (!existingTarget && priorJournal) {
  const priorTargetSheetId = Number(priorJournal.targetSheetId || 0);
  const priorTemporarySheetName = S(priorJournal.temporarySheetName);
  const priorRunNonce = S(priorJournal.runNonce);
  const priorPhase = S(priorJournal.phase);
  const ambiguousCreatePhases = new Set(['create_requested', 'create_dispatched', 'create_outcome_unknown']);
  const cleanupPhases = new Set([
    'created', 'values_writing', 'values_written',
    'metadata_written', 'metadata_verified', 'rename_requested', 'rollback_requested', 'rollback_failed',
  ]);
  const ambiguousOriginResumePhases = new Set([
    'created', 'values_writing', 'values_written', 'metadata_written',
    'metadata_verified', 'rename_requested', 'renamed', 'verified', 'verified_recovered',
    'ambiguous_rename_outcome_unknown', 'ambiguous_rehide_requested', 'ambiguous_resume_failed',
  ]);
  if (priorJournal.ambiguousCreateOrigin !== true && priorPhase === 'recovery_rollback_requested') {
      const priorProvenanceMarker = S(priorJournal.provenanceMarker);
    if (!priorMatchesApproval || priorTargetSheetId <= 0
      || !priorTemporarySheetName.startsWith('_staging_vehicle_review_')
      || !/^[0-9a-f]{32}$/.test(priorRunNonce)
      || !/^sha256:[0-9a-f]{64}$/.test(priorProvenanceMarker)
      || Number(priorJournal.targetRows) !== 2107 || Number(priorJournal.targetColumns) !== 30) {
      throw new Error('미검증 최종 탭 rollback journal의 sheetId·이름·행열·nonce·provenance가 불완전합니다.');
    }
    await deleteOwnedSheetWithReconciliation(
      priorTargetSheetId,
      (record) => {
        const properties = record.properties || {};
        return S(properties.title) === VEHICLE_MASTER_REVIEW_ADOPTION_TAB
          && matchesGoogleSheetHiddenProperty(properties.hidden, false)
          && Number(properties.gridProperties?.rowCount) === 2107
          && Number(properties.gridProperties?.columnCount) === 30
          && FINAL_ROLLBACK_SOURCE_PHASES.has(S(priorJournal.rollbackSourcePhase))
          && hasSheetMetadata(record, 'vehicle_master_review_staging_nonce_v1', priorRunNonce)
          && hasSheetMetadata(record, 'vehicle_master_review_adoption_v1', priorProvenanceMarker);
      },
      '미검증 최종 규격채택 recovery rollback 재조정',
    );
    Object.assign(priorJournal, {
      phase: 'recovery_rolled_back',
      phaseAt: new Date().toISOString(),
      recoveredSheetId: priorTargetSheetId,
    });
    atomicWriteJournal(priorJournal);
    beforeMetadata = await metadata();
  } else if (priorJournal.ambiguousCreateOrigin !== true
    && (priorPhase === 'rollback_requested' || priorPhase === 'rollback_failed')) {
    const priorProvenanceMarker = S(priorJournal.provenanceMarker);
    if (!priorMatchesApproval || priorTargetSheetId <= 0
      || !priorTemporarySheetName.startsWith('_staging_vehicle_review_')
      || !/^[0-9a-f]{32}$/.test(priorRunNonce)
      || !/^sha256:[0-9a-f]{64}$/.test(priorProvenanceMarker)
      || Number(priorJournal.targetRows) !== 2107 || Number(priorJournal.targetColumns) !== 30) {
      throw new Error('즉시 rollback journal의 sheetId·이름·행열·nonce·provenance가 불완전합니다.');
    }
    await deleteOwnedSheetWithReconciliation(
      priorTargetSheetId,
      (record) => {
        const properties = record.properties || {};
        const hiddenOwned = S(properties.title) === priorTemporarySheetName
          && properties.hidden === true
          && Number(properties.gridProperties?.rowCount) === 2107
          && Number(properties.gridProperties?.columnCount) === 30
          && hasSheetMetadata(record, 'vehicle_master_review_staging_nonce_v1', priorRunNonce);
        const finalOwned = S(properties.title) === VEHICLE_MASTER_REVIEW_ADOPTION_TAB
          && matchesGoogleSheetHiddenProperty(properties.hidden, false)
          && Number(properties.gridProperties?.rowCount) === 2107
          && Number(properties.gridProperties?.columnCount) === 30
          && FINAL_ROLLBACK_SOURCE_PHASES.has(S(priorJournal.rollbackSourcePhase))
          && hasSheetMetadata(record, 'vehicle_master_review_staging_nonce_v1', priorRunNonce)
          && hasSheetMetadata(record, 'vehicle_master_review_adoption_v1', priorProvenanceMarker);
        return hiddenOwned || finalOwned;
      },
      '현재 규격채택 rollback 재조정',
    );
    Object.assign(priorJournal, {
      phase: 'rolled_back',
      phaseAt: new Date().toISOString(),
      recoveredSheetId: priorTargetSheetId,
    });
    atomicWriteJournal(priorJournal);
    beforeMetadata = await metadata();
  } else if (priorJournal.ambiguousCreateOrigin === true && !ambiguousOriginResumePhases.has(priorPhase)) {
    throw new Error(`불명확 add 기원 journal phase를 안전한 재개 상태로 인정할 수 없습니다: ${priorPhase || '(empty)'}`);
  } else if (priorJournal.ambiguousCreateOrigin === true) {
    if (!priorMatchesApproval || priorTargetSheetId <= 0
      || !priorTemporarySheetName.startsWith('_staging_vehicle_review_')
      || !/^[0-9a-f]{32}$/.test(priorRunNonce)) {
      throw new Error('불명확 add 기원 staging을 동일 승인·sheetId·이름·nonce로 재개할 수 없습니다.');
    }
    enforceAmbiguousOutcomeFence(
      priorJournal,
      AMBIGUOUS_RENAME_PENDING_PHASES,
      'ambiguous_rename_outcome_unknown',
      'renameOutcomeFenceStartedAtMs',
      'rename',
    );
    enforceAmbiguousOutcomeFence(
      priorJournal,
      AMBIGUOUS_REHIDE_PENDING_PHASES,
      'ambiguous_rehide_requested',
      'rehideOutcomeFenceStartedAtMs',
      're-hide',
    );
    const retained = sheetRecordById(beforeMetadata, priorTargetSheetId);
    if (!retained) throw new Error('불명확 add 기원 staging이 아직 보이지 않아 삭제·신규 실행 없이 중단합니다.');
    assertOwnedStagingRecord(
      beforeMetadata, priorTargetSheetId, priorTemporarySheetName, 2107, 30, priorRunNonce,
    );
    const hasAdoptionMetadata = (retained.developerMetadata || []).some((item: Rec) =>
      S(item.metadataKey) === 'vehicle_master_review_adoption_v1');
    if (!hasAdoptionMetadata && ((retained.developerMetadata || []).length !== 1
      || (retained.protectedRanges || []).length !== 0
      || (retained.conditionalFormats || []).length !== 0
      || retained.basicFilter)) {
      throw new Error('불명확 add 기원 staging의 메타데이터 batch가 원자적 이전/이후 상태가 아닙니다.');
    }
    resumeStagingHasMetadata = hasAdoptionMetadata;
    resumeStagingSheetId = priorTargetSheetId;
  } else if (ambiguousCreatePhases.has(priorPhase)) {
    const priorDispatchCount = Number(priorJournal.createDispatchCount || 0);
    if (!priorMatchesApproval || priorTargetSheetId <= 0
      || !priorTemporarySheetName.startsWith('_staging_vehicle_review_')
      || !/^[0-9a-f]{32}$/.test(priorRunNonce)
      || Number(priorJournal.targetRows) !== 2107 || Number(priorJournal.targetColumns) !== 30
      || !Number.isInteger(priorDispatchCount) || priorDispatchCount < 0 || priorDispatchCount > 2
      || (priorPhase !== 'create_requested' && priorDispatchCount < 1)) {
      throw new Error('결과불명확 addSheet journal을 동일 승인·sheetId·이름·nonce로 복구할 수 없습니다.');
    }
    seedJournalGenerations(priorJournal);
    const observed = sheetRecordById(beforeMetadata, priorTargetSheetId);
    if (observed) {
      assertOwnedStagingRecord(
        beforeMetadata, priorTargetSheetId, priorTemporarySheetName, 2107, 30, priorRunNonce,
      );
    } else {
      await reconcileOwnedStagingCreation(
        priorTargetSheetId,
        priorTemporarySheetName,
        2107,
        30,
        priorRunNonce,
        Number(priorJournal.lastCreateDispatchedAtMs || 0),
        Number(priorJournal.createDispatchCount || 0),
        (dispatchedAtMs, nextDispatchCount) => {
          Object.assign(priorJournal, {
            phase: 'create_dispatched',
            phaseAt: new Date().toISOString(),
            lastCreateDispatchedAtMs: dispatchedAtMs,
            createDispatchCount: nextDispatchCount,
          });
          seedJournalGenerations(priorJournal);
        },
      );
    }
    resumeStagingSheetId = priorTargetSheetId;
    beforeMetadata = await metadata();
    assertOwnedStagingRecord(
      beforeMetadata, priorTargetSheetId, priorTemporarySheetName, 2107, 30, priorRunNonce,
    );
  } else {
    const priorStagingRecord = priorTargetSheetId ? sheetRecordById(beforeMetadata, priorTargetSheetId) : null;
    if (priorStagingRecord) {
      if (!priorMatchesApproval || !cleanupPhases.has(priorPhase)
        || !priorTemporarySheetName.startsWith('_staging_vehicle_review_')
        || !/^[0-9a-f]{32}$/.test(priorRunNonce)) {
        throw new Error('이전 숨김 staging 탭을 현재 승인 실행의 안전한 정리 대상으로 증명하지 못했습니다.');
      }
      await deleteOwnedSheetWithReconciliation(
        priorTargetSheetId,
        (record) => {
          const properties = record.properties || {};
          return S(properties.title) === priorTemporarySheetName && properties.hidden === true
            && Number(properties.gridProperties?.rowCount) === 2107
            && Number(properties.gridProperties?.columnCount) === 30
            && hasSheetMetadata(record, 'vehicle_master_review_staging_nonce_v1', priorRunNonce);
        },
        '이전 숨김 staging',
      );
      beforeMetadata = await metadata();
      atomicWriteJournal({
        ...priorJournal, phase: 'staging_recovered_deleted', phaseAt: new Date().toISOString(),
        recoveredSheetId: priorTargetSheetId,
      });
    } else if (priorTemporarySheetName && tab(beforeMetadata, priorTemporarySheetName)) {
      throw new Error('journal sheetId와 다른 과거 staging 이름 탭이 있어 자동 삭제하지 않습니다.');
    }
  }
}
const masterSheet = tab(beforeMetadata, MASTER_TAB);
const reviewTab = S(plan.value.source?.reviewSheet);
const reviewSheet = tab(beforeMetadata, reviewTab);
if (!masterSheet || Number(masterSheet.sheetId) !== Number(plan.value.source?.masterSheetId)
  || Number(masterSheet.gridProperties?.rowCount) !== Number(plan.value.source?.masterGridRowCount)
  || Number(masterSheet.gridProperties?.columnCount) !== Number(plan.value.source?.masterGridColumnCount)
  || Number(masterSheet.gridProperties?.columnCount) !== 32) throw new Error('차종마스터 메타데이터 CAS 실패');
if (!reviewSheet || Number(reviewSheet.sheetId) !== Number(plan.value.source?.reviewSheetId)
  || Number(reviewSheet.gridProperties?.rowCount) !== Number(plan.value.source?.reviewGridRowCount)
  || Number(reviewSheet.gridProperties?.columnCount) !== Number(plan.value.source?.reviewGridColumnCount)
  || Number(reviewSheet.gridProperties?.columnCount) !== 24) throw new Error('규격검토 메타데이터 CAS 실패');

const sourceSheetContract = {
  master: {
    title: MASTER_TAB,
    sheetId: Number(masterSheet.sheetId),
    rowCount: Number(masterSheet.gridProperties?.rowCount),
    columnCount: Number(masterSheet.gridProperties?.columnCount),
  },
  review: {
    title: reviewTab,
    sheetId: Number(reviewSheet.sheetId),
    rowCount: Number(reviewSheet.gridProperties?.rowCount),
    columnCount: Number(reviewSheet.gridProperties?.columnCount),
  },
};
const assertSourceSheetMetadata = (meta: Rec, stage: string) => {
  if (S(meta.properties?.title) !== S(plan.value.source?.spreadsheetTitle)) {
    throw new Error(`${stage} 스프레드시트 제목 CAS 실패`);
  }
  for (const [kind, expected] of Object.entries(sourceSheetContract)) {
    const byId = sheetRecordById(meta, expected.sheetId)?.properties || {};
    const byTitle = tab(meta, expected.title) || {};
    if (Number(byId.sheetId) !== expected.sheetId || S(byId.title) !== expected.title
      || Number(byId.gridProperties?.rowCount) !== expected.rowCount
      || Number(byId.gridProperties?.columnCount) !== expected.columnCount
      || Number(byTitle.sheetId) !== expected.sheetId) {
      throw new Error(`${stage} ${kind} 원본 탭의 sheetId·이름·행열 CAS 실패`);
    }
  }
};
assertSourceSheetMetadata(beforeMetadata, '쓰기 전');

const [liveMasterValues, liveReviewValues] = await Promise.all([
  readValuesBySheetId(Number(masterSheet.sheetId), Number(masterSheet.gridProperties?.rowCount), 32),
  readValuesBySheetId(Number(reviewSheet.sheetId), Number(reviewSheet.gridProperties?.rowCount), 24),
]);
const masterHeaders = (liveMasterValues[0] || []).map(S);
const keyColumn = masterHeaders.indexOf('트림행키');
if (keyColumn !== 9 || masterHeaders.length !== 32) throw new Error('차종마스터 A:AF 헤더 CAS 실패');
const liveMasterKeyRows = liveMasterValues.slice(1).flatMap((row, index) => {
  const trimRowKey = S(row[keyColumn]);
  return trimRowKey ? [{ trimRowKey, sheetRow: index + 2 }] : [];
});
const reviewHeaders = normalizeRows([liveReviewValues[0] || []], 24)[0].map(S);
const liveReviewRecords = liveReviewValues.slice(1).map((row, index) => ({
  values: normalizeRows([row], 24)[0],
  sheetRow: index + 2,
})).filter((row) => row.values.some((value) => S(value)));
const liveReviewRows = liveReviewRecords.map((row) => row.values);
const liveReviewSheetRows = liveReviewRecords.map((row) => row.sheetRow);

const artifactKeys = new Set((artifact.value.records || []).map((row: Rec) => S(row.trim_row_key)));
const registryKeys = new Set((registry.records || []).map((row) => S(row.code)));
const liveKeys = new Set(liveMasterKeyRows.map((row) => row.trimRowKey));
if (artifactKeys.size !== 5334 || registryKeys.size !== 5334 || liveKeys.size !== 5334
  || [...artifactKeys].some((key) => !registryKeys.has(key) || !liveKeys.has(key))) {
  throw new Error('라이브·artifact·registry 5,334키 집합 CAS 실패');
}
const beforeKeyAudit = auditTrimKeyContract(
  registry,
  trimKeyRecordsFromValues(liveMasterValues, registry.semanticHeaders),
);
if (!beforeKeyAudit.ok) {
  throw new Error(`쓰기 전 영구키 의미계약 위반: ${beforeKeyAudit.issues.slice(0, 10).map((issue) => `${issue.kind}:${issue.code || '-'}`).join(', ')}`);
}
const currentHashes = {
  liveMasterKeySha256: hash(liveMasterKeyRows),
  liveMasterValuesSha256: hash(liveMasterValues),
  liveReviewValuesSha256: hash([reviewHeaders, ...liveReviewRows]),
};
for (const [name, value] of Object.entries(currentHashes)) {
  if (value !== S(plan.value.source?.[name])) throw new Error(`dry-run 이후 라이브 원본 변경: ${name}`);
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
if (JSON.stringify(summary) !== JSON.stringify(plan.value.summary)
  || summary.keyRows !== 2106 || summary.reviewGroups !== 2097
  || summary.singleKeyGroups !== 2088 || summary.twoKeyGroups !== 9 || summary.maxKeysPerGroup !== 2
  || summary.pendingHumanAdoption !== 2086
  || summary.pendingWithoutSelectionQuestions !== 601
  || summary.pendingWithSelectionQuestions !== 1485 || summary.reviewOnly !== 20) {
  throw new Error(`승인 대상 집계 CAS 실패: ${JSON.stringify(summary)}`);
}
if (JSON.stringify(reviewedUsageTiers) !== JSON.stringify({ automatic: 2098, manual: 8, blocked: 0 })
  || JSON.stringify(adoptedUsageTiers) !== JSON.stringify({ automatic: 2078, manual: 8, blocked: 0 })
  || JSON.stringify(reviewedUsageTiers) !== JSON.stringify(plan.value.source?.reviewedUsageTiers)
  || JSON.stringify(adoptedUsageTiers) !== JSON.stringify(plan.value.source?.adoptedUsageTiers)) {
  throw new Error('규격채택 대상의 automatic/manual/blocked 분포가 승인 계획과 다릅니다.');
}
if (VEHICLE_MASTER_REVIEW_ADOPTION_HEADERS.length !== 30) throw new Error('규격채택 30열 계약 실패');
if (JSON.stringify([...VEHICLE_MASTER_REVIEW_ADOPTION_HEADERS]) !== JSON.stringify(plan.value.headers)
  || JSON.stringify(entries) !== JSON.stringify(plan.value.entries)) {
  throw new Error('라이브에서 재계산한 30열 헤더·2,106키 본문이 사용자가 승인한 계획과 다릅니다.');
}

const continuingRun = Boolean(recoverySheetId || resumeStagingSheetId);
const approvedAt = continuingRun ? S(priorJournal?.approvedAt) : new Date().toISOString();
const approvalBasis = [
  `사용자 직전승인:${approvalReference}`,
  `plan_sha256:${plan.sha256}`,
  `review_sha256:${currentHashes.liveReviewValuesSha256}`,
].join(';');
const approvedRows = finalizeVehicleMasterReviewAdoptionRows(entries, approvedAt, approvalBasis);
const targetValues = [[...VEHICLE_MASTER_REVIEW_ADOPTION_HEADERS], ...approvedRows];
const targetRows = targetValues.length;
if (targetRows !== 2107 || targetValues.some((row) => row.length !== 30)) throw new Error('게시 범위 A1:AD2107 계약 실패');
const targetValuesSha256 = hash(targetValues);
const runId = continuingRun ? S(priorJournal?.runId) : `${plan.sha256.slice(0, 12)}-${Date.now()}`;
const runNonce = continuingRun ? S(priorJournal?.runNonce) : randomBytes(16).toString('hex');
if (!/^[0-9a-f]{32}$/.test(runNonce)) throw new Error('규격채택 실행 nonce가 유효하지 않습니다.');
const temporarySheetName = continuingRun
  ? S(priorJournal?.temporarySheetName)
  : `_staging_vehicle_review_${runId}`;
const provenance = JSON.stringify({
  schema: VEHICLE_MASTER_REVIEW_ADOPTION_CONTRACT_VERSION,
  runNonce,
  approvedAt,
  approvalReference,
  approvedPlanSha256,
  executionSubject,
  targetValuesSha256,
  sourceReviewSha256: currentHashes.liveReviewValuesSha256,
  sourceMasterValuesSha256: currentHashes.liveMasterValuesSha256,
  masterArtifactSha256: artifact.sha256,
  registrySha256: registryFile.sha256,
  sourceMasterKeys: 5334,
  adoptedKeys: 2086,
  selectionQuestionKeys: 1485,
  reviewOnlyKeys: 20,
  reviewedUsageTiers,
  adoptedUsageTiers,
  reviewGroups: 2097,
  twoKeyGroups: 9,
  operationalStatusChanges: 0,
});
const provenanceMarker = `sha256:${createHash('sha256').update(provenance).digest('hex')}`;
if (continuingRun && S(priorJournal?.provenanceMarker) !== provenanceMarker) {
  throw new Error('복구 journal의 provenance marker가 현재 승인 실행에서 재계산한 값과 다릅니다.');
}

const expectedWidths = [250, 420, ...Array(4).fill(190), ...Array(24).fill(150)];
const expectedConditionalStatuses = [
  '검토유지',
  '규격구조채택',
  '규격구조채택(선택질문유지)',
].sort();
const verifyTargetStructure = async (
  meta: Rec,
  sheetId: number,
  title: string,
  hidden: boolean,
  stage: string,
) => {
  const record = sheetRecordById(meta, sheetId);
  const properties = record?.properties || {};
  if (!record || Number(properties.sheetId) !== sheetId || S(properties.title) !== title
    || Number(tab(meta, title)?.sheetId) !== sheetId
    || !matchesGoogleSheetHiddenProperty(properties.hidden, hidden)
    || Number(properties.gridProperties?.rowCount) !== targetRows
    || Number(properties.gridProperties?.columnCount) !== 30
    || Number(properties.gridProperties?.frozenRowCount) !== 1
    || properties.gridProperties?.hideGridlines !== true) {
    throw new Error(`${stage} 대상 탭 sheetId·이름·숨김·2107x30 grid 계약 실패`);
  }

  const filter = record.basicFilter?.range || {};
  if (Number(filter.sheetId) !== sheetId || Number(filter.startRowIndex || 0) !== 0
    || Number(filter.endRowIndex) !== targetRows || Number(filter.startColumnIndex || 0) !== 0
    || Number(filter.endColumnIndex) !== 30) {
    throw new Error(`${stage} 대상 탭 전체 필터 계약 실패`);
  }

  const protectedRanges = record.protectedRanges || [];
  const protection = protectedRanges[0] || {};
  const protectedRange = protection.range || {};
  const protectedUsers = (protection.editors?.users || []).map(S).sort();
  const protectedGroups = (protection.editors?.groups || []).map(S).filter(Boolean).sort();
  if (protectedRanges.length !== 1 || S(protection.description) !== '차종마스터 규격채택 정본 보호'
    || Number(protectedRange.sheetId) !== sheetId
    || protectedRange.startRowIndex !== undefined || protectedRange.endRowIndex !== undefined
    || protectedRange.startColumnIndex !== undefined || protectedRange.endColumnIndex !== undefined
    || Number(protection.unprotectedRanges?.length || 0) !== 0 || protection.warningOnly === true
    || JSON.stringify(protectedUsers) !== JSON.stringify([executionSubject])
    || protectedGroups.length !== 0 || protection.editors?.domainUsersCanEdit === true) {
    throw new Error(`${stage} 대상 탭 전체 엄격보호·정확 편집자 계약 실패`);
  }

  const conditionalStatuses = (record.conditionalFormats || []).map((item: Rec) => {
    const ranges = item.ranges || [];
    const range = ranges[0] || {};
    const condition = item.booleanRule?.condition || {};
    if (ranges.length !== 1 || Number(range.sheetId) !== sheetId
      || Number(range.startRowIndex) !== 1 || Number(range.endRowIndex) !== targetRows
      || Number(range.startColumnIndex) !== 2 || Number(range.endColumnIndex) !== 3
      || S(condition.type) !== 'TEXT_EQ' || Number(condition.values?.length) !== 1) return '__INVALID__';
    return S(condition.values?.[0]?.userEnteredValue);
  }).sort();
  if (JSON.stringify(conditionalStatuses) !== JSON.stringify(expectedConditionalStatuses)) {
    throw new Error(`${stage} 대상 탭 조건부서식 범위·상태 계약 실패`);
  }

  const sheetMetadata = record.developerMetadata || [];
  const adoptionMetadata = sheetMetadata.filter((item: Rec) =>
    S(item.metadataKey) === 'vehicle_master_review_adoption_v1'
      && S(item.metadataValue) === provenanceMarker
      && S(item.visibility) === 'DOCUMENT'
      && Number(item.location?.sheetId) === sheetId);
  const stagingMetadata = sheetMetadata.filter((item: Rec) =>
    S(item.metadataKey) === 'vehicle_master_review_staging_nonce_v1'
      && S(item.metadataValue) === runNonce
      && S(item.visibility) === 'DOCUMENT'
      && Number(item.location?.sheetId) === sheetId);
  if (sheetMetadata.length !== 2 || adoptionMetadata.length !== 1 || stagingMetadata.length !== 1) {
    throw new Error(`${stage} 대상 탭 provenance·staging nonce 메타데이터 계약 실패`);
  }

  const inspection = await inspectSheetHeader(title);
  const inspectedSheet = inspection.sheets?.[0];
  const inspectedData = inspectedSheet?.data?.[0] || {};
  const headerCells = inspectedData.rowData?.[0]?.values || [];
  const headerFormatsOk = headerCells.length >= 30 && headerCells.slice(0, 30).every((cell: Rec) => {
    const format = cell.userEnteredFormat || {};
    return format.textFormat?.bold === true
      && format.horizontalAlignment === 'CENTER'
      && format.verticalAlignment === 'MIDDLE'
      && format.wrapStrategy === 'WRAP';
  });
  const widths = (inspectedData.columnMetadata || []).slice(0, 30)
    .map((item: Rec) => Number(item.pixelSize || 0));
  if (Number(inspectedSheet?.properties?.sheetId) !== sheetId
    || S(inspectedSheet?.properties?.title) !== title
    || inspectedData.rowData?.[0]?.values?.[0]?.note !== provenance
    || Number(inspectedData.rowMetadata?.[0]?.pixelSize) !== 42
    || !headerFormatsOk || JSON.stringify(widths) !== JSON.stringify(expectedWidths)) {
    throw new Error(`${stage} 대상 탭 A1 note·헤더서식·행높이·열너비 계약 실패`);
  }
};
const verifyTargetSnapshot = async (sheetId: number, title: string, hidden: boolean, stage: string) => {
  const metadataBeforeRead = await metadata();
  await verifyTargetStructure(metadataBeforeRead, sheetId, title, hidden, `${stage} 재읽기 전`);
  const rawValues = await readValuesBySheetId(sheetId, targetRows, 30);
  const values = normalizeRows(rawValues, 30);
  const metadataAfterRead = await metadata();
  await verifyTargetStructure(metadataAfterRead, sheetId, title, hidden, `${stage} 재읽기 후`);
  if (hash(values) !== targetValuesSha256 || JSON.stringify(values) !== JSON.stringify(targetValues)) {
    throw new Error(`${stage} 대상 탭 A1:AD2107 전체 본문 post-read 불일치`);
  }
};

const verifySourceValues = async (stage: string) => {
  const metadataBeforeReads = await metadata();
  assertSourceSheetMetadata(metadataBeforeReads, `${stage} 재읽기 전`);
  const [masterValues, reviewValues] = await Promise.all([
    readValuesBySheetId(
      sourceSheetContract.master.sheetId,
      sourceSheetContract.master.rowCount,
      sourceSheetContract.master.columnCount,
    ),
    readValuesBySheetId(
      sourceSheetContract.review.sheetId,
      sourceSheetContract.review.rowCount,
      sourceSheetContract.review.columnCount,
    ),
  ]);
  const metadataAfterReads = await metadata();
  assertSourceSheetMetadata(metadataAfterReads, `${stage} 재읽기 후`);
  const normalizedReviewRows = reviewValues.slice(1).map((row) => normalizeRows([row], 24)[0])
    .filter((row) => row.some((value) => S(value)));
  const normalizedReviewHeaders = normalizeRows([reviewValues[0] || []], 24)[0].map(S);
  if (hash(masterValues) !== currentHashes.liveMasterValuesSha256
    || hash([normalizedReviewHeaders, ...normalizedReviewRows]) !== currentHashes.liveReviewValuesSha256) {
    throw new Error(`${stage} 원본 차종마스터 또는 규격검토 전체값 CAS 실패`);
  }
  const sourceAudit = auditTrimKeyContract(registry, trimKeyRecordsFromValues(masterValues, registry.semanticHeaders));
  if (!sourceAudit.ok) throw new Error(`${stage} 영구키 의미계약 위반: ${sourceAudit.issues[0]?.kind}`);
  return metadataAfterReads;
};
const verifyLocalImmutableSources = (stage: string) => {
  if (file(planPath).sha256 !== plan.sha256
    || file(S(plan.value.source?.sourceSnapshotPath)).sha256 !== sourceSnapshot.sha256
    || file('public/data/vehicle-trim-master.json').sha256 !== artifact.sha256
    || file('data/vehicle-trim-key-registry.json').sha256 !== registryFile.sha256
    || file('tmp/hyundai-three-model-review.json').sha256 !== localReviewFile.sha256) {
    throw new Error(`${stage} 승인 plan·snapshot·artifact·registry SHA-256 CAS 실패`);
  }
  for (const path of implementationPaths) {
    const current = createHash('sha256').update(readFileSync(path)).digest('hex');
    if (current !== S(implementation[path])) {
      throw new Error(`${stage} 승인 구현 파일 SHA-256 CAS 실패: ${path}`);
    }
  }
};

const retainAmbiguousOriginSheetForResume = async (
  sheetId: number,
  recordRehideIntent: (dispatchedAtMs: number) => void,
) => retainOwnedFinalAsStaging({
  sheetId,
  temporaryTitle: temporarySheetName,
  rowCount: targetRows,
  columnCount: 30,
  nonce: runNonce,
  expectedProvenanceMarker: provenanceMarker,
  recordRehideIntent,
});

if (recoverySheetId) {
  const ambiguousCreateOrigin = priorJournal?.ambiguousCreateOrigin === true;
  const recordPriorRehideIntent = (dispatchedAtMs: number) => {
    Object.assign(priorJournal as Rec, {
      phase: 'ambiguous_rehide_requested',
      phaseAt: new Date().toISOString(),
      lastRehideDispatchedAtMs: dispatchedAtMs,
      rehideOutcomeFenceStartedAtMs: 0,
      targetSheetId: recoverySheetId,
      provenanceMarker,
      ambiguousCreateOrigin: true,
    });
    seedJournalGenerations(priorJournal as Rec);
  };
  try {
    await verifySourceValues('복구 최종');
    await verifyTargetSnapshot(
      recoverySheetId,
      VEHICLE_MASTER_REVIEW_ADOPTION_TAB,
      false,
      '이전 실행 복구 최종',
    );
    verifyLocalImmutableSources('복구 최종');
  } catch (cause) {
    if (!ambiguousCreateOrigin) throw cause;
    const retained = await retainAmbiguousOriginSheetForResume(recoverySheetId, recordPriorRehideIntent);
    if (retained.state === 'hidden_staging') {
      atomicWriteJournal({
        ...(priorJournal as Rec),
        phase: 'ambiguous_resume_failed',
        phaseAt: new Date().toISOString(),
        failedAt: new Date().toISOString(),
        error: S((cause as Error).message),
        retainedHiddenStaging: true,
        rehideRequestError: retained.requestError,
      });
      throw new Error(`${S((cause as Error).message)}; 불명확 add 기원 최종 탭을 같은 sheetId의 숨김 staging으로 보존했습니다.`);
    }
    throw new Error(`${S((cause as Error).message)}; re-hide 결과불명확 상태를 보존했습니다: ${retained.requestError || 'final target still visible'}`);
  }
  atomicWriteJournal({
    ...priorJournal, phase: 'verified_recovered', phaseAt: new Date().toISOString(),
    recoveredAt: new Date().toISOString(), targetSheetId: recoverySheetId,
  });
  console.log(JSON.stringify({
    mode: 'already_applied_recovered_verified', targetSheetId: recoverySheetId,
    exactRange: `'${VEHICLE_MASTER_REVIEW_ADOPTION_TAB}'!A1:AD${targetRows}`,
    targetValuesSha256, summary, existingMasterCellsMutated: 0,
    registryMutated: false, artifactMutated: false,
  }, null, 2));
  process.exit(0);
}

if (!resumeStagingSheetId && tab(beforeMetadata, temporarySheetName)) {
  throw new Error('이번 실행의 staging 이름이 이미 존재합니다.');
}
const occupiedSheetIds = new Set((beforeMetadata.sheets || []).map((item: Rec) =>
  Number(item.properties?.sheetId)).filter((sheetId: number) => Number.isInteger(sheetId)));
const priorJournalSheetId = Number(priorJournal?.targetSheetId || 0);
if (!resumeStagingSheetId && priorJournalSheetId > 0) occupiedSheetIds.add(priorJournalSheetId);
let requestedSheetId = resumeStagingSheetId
  || Math.trunc(Number.parseInt(hash({ runId, planSha256: plan.sha256 }).slice(0, 8), 16) % 2147483647)
  || 1;
if (!resumeStagingSheetId) {
  while (occupiedSheetIds.has(requestedSheetId)) {
    requestedSheetId = requestedSheetId >= 2147483646 ? 1 : requestedSheetId + 1;
  }
}

const snapshotPath = `tmp/vehicle-master-review-adoption-snapshot-${Date.now()}.json`;
writeFileSync(snapshotPath, `${JSON.stringify({
  capturedAt: new Date().toISOString(),
  planSha256: plan.sha256,
  sourceHashes: currentHashes,
  artifactSha256: artifact.sha256,
  registrySha256: registryFile.sha256,
  targetAbsent: true,
  liveMasterValues,
  liveReviewValues,
}, null, 2)}\n`);
let lastCreateDispatchedAtMs = continuingRun
  ? Number(priorJournal?.lastCreateDispatchedAtMs || 0)
  : 0;
let createDispatchCount = continuingRun
  ? Number(priorJournal?.createDispatchCount || 0)
  : 0;
let lastRenameDispatchedAtMs = continuingRun
  ? Number(priorJournal?.lastRenameDispatchedAtMs || 0)
  : 0;
const journalBase = {
  runId, runNonce, temporarySheetName, approvalReference, approvedAt, approvedPlanSha256,
  planSha256: plan.sha256, sourceHashes: currentHashes, targetValuesSha256, provenanceMarker,
  targetRows, targetColumns: 30, targetSheetId: requestedSheetId, snapshotPath,
  ambiguousCreateOrigin: Boolean(resumeStagingSheetId),
};
if (resumeStagingSheetId && S(priorJournal?.targetValuesSha256) !== targetValuesSha256) {
  throw new Error('결과불명확 staging의 targetValues SHA-256이 현재 승인 실행과 다릅니다.');
}
let currentPhase = resumeStagingSheetId ? S(priorJournal?.phase) : '';
const journalRecord = (phase: string, extra: Rec = {}) => ({
  ...journalBase,
  lastCreateDispatchedAtMs,
  createDispatchCount,
  lastRenameDispatchedAtMs,
  phase,
  phaseAt: new Date().toISOString(),
  ...extra,
});
const writeJournal = (phase: string, extra: Rec = {}) => {
  currentPhase = phase;
  atomicWriteJournal(journalRecord(phase, extra));
};
if (!resumeStagingSheetId) {
  currentPhase = 'create_requested';
  const seed = journalRecord('create_requested');
  seedJournalGenerations(seed);
}

let createdSheetId = requestedSheetId;
try {
  if (resumeStagingSheetId) {
    assertOwnedStagingRecord(
      await metadata(), createdSheetId, temporarySheetName, targetRows, 30, runNonce,
    );
    writeJournal(resumeStagingHasMetadata ? 'metadata_written' : 'created', {
      targetSheetId: createdSheetId,
      resumedFromAmbiguousCreate: true,
      resumedMetadataBatchObserved: resumeStagingHasMetadata,
    });
  } else {
    lastCreateDispatchedAtMs = Date.now();
    createDispatchCount = 1;
    currentPhase = 'create_dispatched';
    seedJournalGenerations(journalRecord('create_dispatched'));
    const created = await requestOwnedStagingCreation(
      requestedSheetId, temporarySheetName, targetRows, 30, runNonce,
    );
    const repliedSheetId = Number(created.replies?.[0]?.addSheet?.properties?.sheetId || 0);
    if (repliedSheetId !== requestedSheetId) throw new Error('사전 지정한 신규 규격채택 sheetId와 응답이 다릅니다.');
    const afterCreateMetadata = await metadata();
    assertOwnedStagingRecord(
      afterCreateMetadata, requestedSheetId, temporarySheetName, targetRows, 30, runNonce,
    );
    if (tab(afterCreateMetadata, VEHICLE_MASTER_REVIEW_ADOPTION_TAB)) {
      throw new Error('신규 staging 생성 중 최종 이름 탭이 별도로 생겼습니다.');
    }
    writeJournal('created', { targetSheetId: createdSheetId });
  }

  if (!resumeStagingHasMetadata) {
  const chunkSize = 250;
  const valueRequests = [];
  for (let start = 0; start < targetValues.length; start += chunkSize) {
    const values = targetValues.slice(start, start + chunkSize);
    valueRequests.push({ updateCells: {
      range: {
        sheetId: createdSheetId,
        startRowIndex: start,
        endRowIndex: start + values.length,
        startColumnIndex: 0,
        endColumnIndex: 30,
      },
      rows: values.map((row) => ({ values: row.map((value) => ({ userEnteredValue:
        typeof value === 'number' ? { numberValue: value }
          : typeof value === 'boolean' ? { boolValue: value }
            : { stringValue: String(value ?? '') },
      })) })),
      fields: 'userEnteredValue',
    } });
  }
  for (const request of valueRequests) {
    await api(`${base}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [request] }),
    });
    writeJournal('values_writing', {
      targetSheetId: createdSheetId,
      completedRows: Number(request.updateCells.range.endRowIndex),
    });
  }
  writeJournal('values_written', { targetSheetId: createdSheetId });

  const statusRange = { sheetId: createdSheetId, startRowIndex: 1, endRowIndex: targetRows, startColumnIndex: 2, endColumnIndex: 3 };
  await api(`${base}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [
      { repeatCell: { range: { sheetId: createdSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 30 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.12, green: 0.23, blue: 0.42 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat' } },
      { repeatCell: { range: { sheetId: createdSheetId, startRowIndex: 1, endRowIndex: targetRows, startColumnIndex: 0, endColumnIndex: 30 }, cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)' } },
      { updateDimensionProperties: { range: { sheetId: createdSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 42 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId: createdSheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 250 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId: createdSheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 420 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId: createdSheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 6 }, properties: { pixelSize: 190 }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId: createdSheetId, dimension: 'COLUMNS', startIndex: 6, endIndex: 30 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } },
      { setBasicFilter: { filter: { range: { sheetId: createdSheetId, startRowIndex: 0, endRowIndex: targetRows, startColumnIndex: 0, endColumnIndex: 30 } } } },
      { addProtectedRange: { protectedRange: { range: { sheetId: createdSheetId }, description: '차종마스터 규격채택 정본 보호', warningOnly: false, editors: { users: [executionSubject] } } } },
      { addConditionalFormatRule: { index: 0, rule: { ranges: [statusRange], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '규격구조채택' }] }, format: { backgroundColor: { red: 0.82, green: 0.94, blue: 0.85 }, textFormat: { foregroundColor: { red: 0.08, green: 0.38, blue: 0.15 }, bold: true } } } } } },
      { addConditionalFormatRule: { index: 1, rule: { ranges: [statusRange], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '규격구조채택(선택질문유지)' }] }, format: { backgroundColor: { red: 1, green: 0.94, blue: 0.75 }, textFormat: { foregroundColor: { red: 0.52, green: 0.31, blue: 0.02 }, bold: true } } } } } },
      { addConditionalFormatRule: { index: 2, rule: { ranges: [statusRange], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '검토유지' }] }, format: { backgroundColor: { red: 0.94, green: 0.84, blue: 0.84 }, textFormat: { foregroundColor: { red: 0.56, green: 0.08, blue: 0.08 }, bold: true } } } } } },
      { updateCells: { range: { sheetId: createdSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, rows: [{ values: [{ note: provenance }] }], fields: 'note' } },
      { createDeveloperMetadata: { developerMetadata: { metadataKey: 'vehicle_master_review_adoption_v1', metadataValue: provenanceMarker, location: { sheetId: createdSheetId }, visibility: 'DOCUMENT' } } },
    ] }),
  });
  writeJournal('metadata_written', { targetSheetId: createdSheetId });
  }
  await verifySourceValues('숨김 staging 검증');
  await verifyTargetSnapshot(createdSheetId, temporarySheetName, true, '숨김 staging 검증');
  verifyLocalImmutableSources('숨김 staging 검증');
  writeJournal('metadata_verified', { targetSheetId: createdSheetId });

  lastRenameDispatchedAtMs = Date.now();
  currentPhase = 'rename_requested';
  seedJournalGenerations(journalRecord('rename_requested', {
    targetSheetId: createdSheetId,
    lastRenameDispatchedAtMs,
  }));
  await api(`${base}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ updateSheetProperties: {
      properties: { sheetId: createdSheetId, title: VEHICLE_MASTER_REVIEW_ADOPTION_TAB, hidden: false },
      fields: 'title,hidden',
    } }] }),
  });
  writeJournal('renamed', { targetSheetId: createdSheetId });
  await verifySourceValues('최종 게시 검증');
  await verifyTargetSnapshot(
    createdSheetId,
    VEHICLE_MASTER_REVIEW_ADOPTION_TAB,
    false,
    '최종 게시 검증',
  );
  verifyLocalImmutableSources('최종 게시 검증');

  writeJournal('verified', { targetSheetId: createdSheetId, summary, verifiedAt: new Date().toISOString() });
  console.log(JSON.stringify({
    mode: 'applied_verified', write: targetRows * 30, targetSheetId: createdSheetId,
    exactRange: `'${VEHICLE_MASTER_REVIEW_ADOPTION_TAB}'!A1:AD${targetRows}`,
    targetValuesSha256, summary, existingMasterCellsMutated: 0,
    registryMutated: false, artifactMutated: false, snapshotPath,
  }, null, 2));
} catch (cause) {
  if (currentPhase === 'create_requested' || currentPhase === 'create_dispatched') {
    let reconciliationError = '';
    let observedOwnedStaging = false;
    try {
      await reconcileOwnedStagingCreation(
        requestedSheetId,
        temporarySheetName,
        targetRows,
        30,
        runNonce,
        lastCreateDispatchedAtMs,
        createDispatchCount,
        (dispatchedAtMs, nextDispatchCount) => {
          lastCreateDispatchedAtMs = dispatchedAtMs;
          createDispatchCount = nextDispatchCount;
          currentPhase = 'create_dispatched';
          seedJournalGenerations(journalRecord('create_dispatched'));
        },
      );
      observedOwnedStaging = true;
    } catch (reconciliationCause) {
      reconciliationError = S((reconciliationCause as Error).message);
    }
    writeJournal('create_outcome_unknown', {
      createOutcomeCheckedAt: new Date().toISOString(),
      observedOwnedStaging,
      lastCreateDispatchedAtMs,
      createDispatchCount,
      error: S((cause as Error).message),
      reconciliationError,
      targetSheetId: requestedSheetId,
    });
    throw new Error(`${S((cause as Error).message)}; addSheet 결과불명확 상태를 보존했습니다: ${reconciliationError || 'owned staging observed'}`);
  }
  if (resumeStagingSheetId) {
    if (currentPhase === 'rename_requested') {
      const renameOutcomeFenceStartedAtMs = Date.now();
      currentPhase = 'ambiguous_rename_outcome_unknown';
      seedJournalGenerations(journalRecord('ambiguous_rename_outcome_unknown', {
        renameOutcomeCheckedAt: new Date().toISOString(),
        renameOutcomeFenceStartedAtMs,
        lastRenameDispatchedAtMs,
        error: S((cause as Error).message),
        targetSheetId: requestedSheetId,
      }));
      throw new Error(`${S((cause as Error).message)}; 불명확 rename 처리창 190초 동안 동일 sheetId를 삭제·재개·re-hide하지 않습니다.`);
    }
    let retained: Awaited<ReturnType<typeof retainAmbiguousOriginSheetForResume>>;
    try {
      retained = await retainAmbiguousOriginSheetForResume(
        requestedSheetId,
        (dispatchedAtMs) => {
          currentPhase = 'ambiguous_rehide_requested';
          seedJournalGenerations(journalRecord('ambiguous_rehide_requested', {
            lastRehideDispatchedAtMs: dispatchedAtMs,
            rehideOutcomeFenceStartedAtMs: 0,
            targetSheetId: requestedSheetId,
            failedAt: new Date().toISOString(),
            error: S((cause as Error).message),
          }));
        },
      );
    } catch (preservationCause) {
      if (currentPhase !== 'ambiguous_rehide_requested') {
        writeJournal('ambiguous_resume_failed', {
          failedAt: new Date().toISOString(),
          error: S((cause as Error).message),
          preservationError: S((preservationCause as Error).message),
          targetSheetId: requestedSheetId,
          retainedHiddenStaging: false,
        });
      }
      throw preservationCause;
    }
    if (retained.state === 'hidden_staging') {
      writeJournal('ambiguous_resume_failed', {
        failedAt: new Date().toISOString(),
        error: S((cause as Error).message),
        targetSheetId: requestedSheetId,
        retainedHiddenStaging: true,
        rehideRequestError: retained.requestError,
      });
      throw new Error(`${S((cause as Error).message)}; 결과불명확 add에서 복구한 탭을 같은 sheetId의 숨김 staging으로 보존했습니다.`);
    }
    throw new Error(`${S((cause as Error).message)}; re-hide 결과불명확 상태를 보존했습니다: ${retained.requestError || 'final target still visible'}`);
  }
  let rollbackError = '';
  const rollbackSheetId = requestedSheetId;
  const rollbackSourcePhase = currentPhase;
  try {
    currentPhase = 'rollback_requested';
    seedJournalGenerations(journalRecord('rollback_requested', {
      rollbackRequestedAt: new Date().toISOString(),
      rollbackSourcePhase,
      error: S((cause as Error).message),
      targetSheetId: rollbackSheetId,
      ambiguousCreateOrigin: false,
    }));
    await deleteOwnedSheetWithReconciliation(
      rollbackSheetId,
      (record) => {
        const properties = record.properties || {};
        const stagingOwned = S(properties.title) === temporarySheetName
          && properties.hidden === true
          && Number(properties.gridProperties?.rowCount) === targetRows
          && Number(properties.gridProperties?.columnCount) === 30
          && hasSheetMetadata(record, 'vehicle_master_review_staging_nonce_v1', runNonce);
        const finalOwned = S(properties.title) === VEHICLE_MASTER_REVIEW_ADOPTION_TAB
          && matchesGoogleSheetHiddenProperty(properties.hidden, false)
          && Number(properties.gridProperties?.rowCount) === targetRows
          && Number(properties.gridProperties?.columnCount) === 30
          && FINAL_ROLLBACK_SOURCE_PHASES.has(rollbackSourcePhase)
          && hasSheetMetadata(record, 'vehicle_master_review_staging_nonce_v1', runNonce)
          && hasSheetMetadata(record, 'vehicle_master_review_adoption_v1', provenanceMarker);
        return stagingOwned || finalOwned;
      },
      '현재 규격채택 rollback',
    );
  } catch (rollbackCause) {
    rollbackError = S((rollbackCause as Error).message);
  }
  const rollbackPhase = rollbackError ? 'rollback_failed' : 'rolled_back';
  writeJournal(rollbackPhase, {
    rolledBackAt: new Date().toISOString(), error: S((cause as Error).message), rollbackError,
    targetSheetId: rollbackSheetId, rollbackSourcePhase,
    ambiguousCreateOrigin: false,
  });
  if (rollbackError) throw new Error(`${S((cause as Error).message)}; rollback failed: ${rollbackError}`);
  throw cause;
}
