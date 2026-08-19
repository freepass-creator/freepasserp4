/**
 * Keep only 규격채택(규격검토) keys on operational 차종마스터.
 * Full previous ledger → 차종마스터_보관 (hidden). Dry-run default.
 *
 *   npx tsx scripts/apply-vehicle-master-keep-reviewed-only.mts
 *   npx tsx scripts/apply-vehicle-master-keep-reviewed-only.mts --apply \
 *     --confirm=KEEP_REVIEWED_VEHICLE_MASTER_ONLY_V1 \
 *     --approval-reference=…
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  isEligibleAdoptionStatus,
} from '../lib/domain/vehicle-master-adoption-into-master';
import {
  VEHICLE_MASTER_REVIEW_ADOPTION_TAB,
  matchesGoogleSheetHiddenProperty,
} from '../lib/domain/vehicle-master-review-promotion';
import { MASTER_SHEET_ID, MASTER_TAB } from '../lib/domain/vehicle-master-sheet';
import {
  TRIM_KEY_SEMANTIC_HEADERS_V3,
  auditTrimKeyContract,
  trimKeyRecordsFromValues,
  type TrimKeyRegistry,
} from '../lib/domain/vehicle-trim-key-contract';
import { buildVehicleTrimMasterArtifact, type VehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';

type Rec = Record<string, any>;
const S = (value: unknown) => String(value ?? '').trim();
const arg = (name: string) => S(process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3));
const has = (name: string) => process.argv.includes(`--${name}`);
const APPLY = has('apply');
const EXPECTED = 'KEEP_REVIEWED_VEHICLE_MASTER_ONLY_V1';
const ARCHIVE_TAB = '차종마스터_보관';
/** 채택·선택질문유지만(검토유지 제외). --include-review-only 로 검토유지까지. */
const INCLUDE_REVIEW_ONLY = has('include-review-only');

const credentials = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const token = (await new JWT({
  email: S(credentials.client_email),
  key: S(credentials.private_key),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  subject: process.env.GOOGLE_WORKSPACE_SUBJECT || 'pyh@teamjpk.com',
}).getAccessToken()).token;
if (!token) throw new Error('Sheets token missing');
const base = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}`;
const api = async (url: string, init: RequestInit = {}) => {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => ({})) as Rec;
  if (!response.ok) throw new Error(`Sheets ${response.status}: ${JSON.stringify(body).slice(0, 800)}`);
  return body;
};
const getValues = async (tab: string, cols: string) => (
  (await api(`${base}/values/${encodeURIComponent(`'${tab}'!${cols}`)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`) as { values?: unknown[][] }).values || []
);

const meta = await api(`${base}?fields=sheets.properties(sheetId,title,hidden,gridProperties(rowCount,columnCount))`);
const masterSheet = (meta.sheets || []).find((item: Rec) => S(item.properties?.title) === MASTER_TAB)?.properties;
const adoptionSheet = (meta.sheets || []).find((item: Rec) => S(item.properties?.title) === VEHICLE_MASTER_REVIEW_ADOPTION_TAB)?.properties;
let archiveSheet = (meta.sheets || []).find((item: Rec) => S(item.properties?.title) === ARCHIVE_TAB)?.properties;
if (!masterSheet || Number(masterSheet.sheetId) !== 1159482177) throw new Error('차종마스터 sheetId 기준선 불일치');
if (!adoptionSheet) throw new Error('규격채택 탭 없음');

const liveMaster = await getValues(MASTER_TAB, 'A:AF');
const liveAdoption = await getValues(VEHICLE_MASTER_REVIEW_ADOPTION_TAB, 'A:AD');
const headers = (liveMaster[0] || []).map(S);
const keyCol = headers.indexOf('트림행키');
if (keyCol < 0) throw new Error('트림행키 열 없음');
if (headers.includes('파워트레인')) throw new Error('파워트레인 열이 아직 있습니다. 먼저 열 삭제를 끝내세요.');

const adoptHeaders = (liveAdoption[0] || []).map(S);
const adoptKeyCol = adoptHeaders.indexOf('트림행키');
const adoptStatusCol = adoptHeaders.indexOf('규격채택상태');
if (adoptKeyCol < 0 || adoptStatusCol < 0) throw new Error('규격채택 헤더 불완전');

const keepKeys = new Set<string>();
const statusByKey = new Map<string, string>();
for (const row of liveAdoption.slice(1)) {
  const key = S(row[adoptKeyCol]);
  const status = S(row[adoptStatusCol]);
  if (!key) continue;
  statusByKey.set(key, status);
  if (INCLUDE_REVIEW_ONLY || isEligibleAdoptionStatus(status)) keepKeys.add(key);
}

const masterByKey = new Map<string, { row: unknown[]; sheetRow: number }>();
for (let index = 1; index < liveMaster.length; index++) {
  const row = liveMaster[index] || [];
  const key = S(row[keyCol]);
  if (!key) continue;
  if (masterByKey.has(key)) throw new Error(`마스터 키 중복: ${key}`);
  masterByKey.set(key, { row, sheetRow: index + 1 });
}

const keptRows: unknown[][] = [];
const missingKeys: string[] = [];
for (const key of [...keepKeys].sort((a, b) => a.localeCompare(b))) {
  const hit = masterByKey.get(key);
  if (!hit) {
    missingKeys.push(key);
    continue;
  }
  keptRows.push(hit.row.map((cell) => cell ?? ''));
}
const dropCount = masterByKey.size - keptRows.length;
const nextValues = [headers.map((h) => h), ...keptRows];

mkdirSync('tmp', { recursive: true });
const plan = {
  reportType: 'vehicle_master_keep_reviewed_only_v1',
  generatedAt: new Date().toISOString(),
  mode: APPLY ? 'apply' : 'dry_run',
  write: APPLY ? 1 : 0,
  includeReviewOnly: INCLUDE_REVIEW_ONLY,
  archiveTab: ARCHIVE_TAB,
  counts: {
    masterBefore: masterByKey.size,
    adoptionKeepKeys: keepKeys.size,
    keepRows: keptRows.length,
    dropRows: dropCount,
    missingFromMaster: missingKeys.length,
  },
  missingKeysSample: missingKeys.slice(0, 20),
  nextHeader: headers,
};
writeFileSync('tmp/vehicle-master-keep-reviewed-only-plan.json', `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify({ ...plan.counts, mode: plan.mode, archiveTab: ARCHIVE_TAB }, null, 2));

if (!APPLY) {
  console.log('dry-run — --apply --confirm=KEEP_REVIEWED_VEHICLE_MASTER_ONLY_V1 --approval-reference=…');
  process.exit(0);
}

if (arg('confirm') !== EXPECTED) throw new Error(`--confirm=${EXPECTED} 필요`);
if (!/^[A-Za-z0-9._:-]{8,120}$/.test(arg('approval-reference'))) {
  throw new Error('--approval-reference 8~120자 필요');
}
if (missingKeys.length) throw new Error(`채택 키가 마스터에 없음 ${missingKeys.length}건 — 중단`);
if (keptRows.length < 100) throw new Error(`유지 행이 비정상적으로 적음: ${keptRows.length}`);

const artifactBefore = readFileSync('public/data/vehicle-trim-master.json', 'utf8');
const artifact = JSON.parse(artifactBefore) as VehicleTrimMasterArtifact;
const priorPowertrainByKey = new Map(artifact.records.map((row) => [row.trim_row_key, row.powertrain]));
const snapshotPath = `tmp/vehicle-master-keep-reviewed-only-snapshot-${Date.now()}.json`;
writeFileSync(snapshotPath, `${JSON.stringify({ values: liveMaster }, null, 2)}\n`);

// 1) Archive full ledger
if (!archiveSheet) {
  const created = await api(`${base}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        addSheet: {
          properties: {
            title: ARCHIVE_TAB,
            hidden: true,
            gridProperties: {
              rowCount: Math.max(liveMaster.length + 10, 100),
              columnCount: Math.max(headers.length, 32),
            },
          },
        },
      }],
    }),
  });
  archiveSheet = created.replies?.[0]?.addSheet?.properties;
}
if (!archiveSheet?.sheetId) throw new Error('보관 탭 sheetId 없음');
if (!matchesGoogleSheetHiddenProperty(archiveSheet.hidden, true)) {
  await api(`${base}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        updateSheetProperties: {
          properties: { sheetId: Number(archiveSheet.sheetId), hidden: true },
          fields: 'hidden',
        },
      }],
    }),
  });
}
await api(`${base}/values:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({
    valueInputOption: 'RAW',
    data: [{ range: `'${ARCHIVE_TAB}'!A1`, values: liveMaster }],
  }),
});

// 2) Replace operational master with kept rows only
const clearRes = await fetch(`${base}/values/${encodeURIComponent(`'${MASTER_TAB}'!A:AF`)}:clear`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: '{}',
});
if (!clearRes.ok) throw new Error(`clear failed ${clearRes.status}`);

await api(`${base}/values:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({
    valueInputOption: 'RAW',
    data: [{ range: `'${MASTER_TAB}'!A1`, values: nextValues }],
  }),
});

const after = await getValues(MASTER_TAB, 'A:AF');
const afterKeys = after.slice(1).map((row) => S(row[keyCol])).filter(Boolean);
if (afterKeys.length !== keptRows.length) {
  throw new Error(`반영 후 행수 불일치 ${afterKeys.length} ≠ ${keptRows.length}`);
}
if (afterKeys.some((key) => !keepKeys.has(key))) throw new Error('유지 목록 밖 키가 남음');

const liveRecords = trimKeyRecordsFromValues(after, [...TRIM_KEY_SEMANTIC_HEADERS_V3]);
const nextRegistry: TrimKeyRegistry = {
  schemaVersion: 3,
  spreadsheetId: MASTER_SHEET_ID,
  sheetName: MASTER_TAB,
  capturedAt: new Date().toISOString(),
  semanticHeaders: [...TRIM_KEY_SEMANTIC_HEADERS_V3],
  records: liveRecords,
};
const audit = auditTrimKeyContract(nextRegistry, liveRecords);
if (!audit.ok) throw new Error(`키감사 실패: ${audit.issues.slice(0, 5).map((i) => i.kind).join(',')}`);

writeFileSync('data/vehicle-trim-key-registry.json', `${JSON.stringify(nextRegistry, null, 2)}\n`);
writeFileSync(
  'public/data/vehicle-trim-master.json',
  `${JSON.stringify(buildVehicleTrimMasterArtifact(after, MASTER_SHEET_ID, MASTER_TAB, { priorPowertrainByKey }), null, 2)}\n`,
);

const journal = {
  appliedAt: new Date().toISOString(),
  approvalReference: arg('approval-reference'),
  snapshotPath,
  archiveTab: ARCHIVE_TAB,
  archiveSheetId: Number(archiveSheet.sheetId),
  keepRows: keptRows.length,
  dropRows: dropCount,
  registryCount: nextRegistry.records.length,
};
writeFileSync('tmp/vehicle-master-keep-reviewed-only-journal.json', `${JSON.stringify(journal, null, 2)}\n`);
console.log(JSON.stringify({ mode: 'applied_verified', ...journal, key_contract_issues: 0 }, null, 2));
