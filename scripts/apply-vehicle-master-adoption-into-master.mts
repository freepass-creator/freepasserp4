/**
 * Apply 규격채택 → 차종마스터 이름 승격 + 파워트레인 열 삭제.
 *
 * 기본 = dry-run (계획 재검증만). 라이브 쓰기는 Claude/사람 게이트 후:
 *
 *   npx tsx scripts/apply-vehicle-master-adoption-into-master.mts
 *   npx tsx scripts/apply-vehicle-master-adoption-into-master.mts --apply \
 *     --confirm=APPLY_VEHICLE_MASTER_ADOPTION_INTO_MASTER_V1 \
 *     --approval-reference=… --approved-plan-sha256=…
 *
 * `--include-atomic` 없으면 semantic_drift(원자축)는 쓰지 않는다.
 * `--hide-review-tab` 이면 「차종마스터_규격검토」를 숨긴다.
 * `--skip-column-drop` 이면 이름 패치만(파워트레인 열 유지).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  VEHICLE_MASTER_ADOPTION_INTO_MASTER_CONTRACT_VERSION,
  VEHICLE_MASTER_HEADERS_WITHOUT_POWERTRAIN,
  applyNamePatchesToMasterValues,
  buildAdoptionIntoMasterPlan,
  dropPowertrainColumnFromValues,
  type AdoptionIntoMasterCellPatch,
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
const hashText = (text: string) => createHash('sha256').update(text).digest('hex');
const hashJson = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const colA1 = (zeroBased: number) => {
  let value = zeroBased + 1;
  let out = '';
  while (value) {
    value -= 1;
    out = String.fromCharCode(65 + (value % 26)) + out;
    value = Math.floor(value / 26);
  }
  return out;
};

const EXPECTED_CONFIRMATION = 'APPLY_VEHICLE_MASTER_ADOPTION_INTO_MASTER_V1';
const APPLY = has('apply');
const INCLUDE_ATOMIC = has('include-atomic');
const HIDE_REVIEW = has('hide-review-tab');
const SKIP_COLUMN_DROP = has('skip-column-drop');
const planPath = 'tmp/vehicle-master-adoption-into-master-plan.json';

if (!existsSync(planPath)) {
  throw new Error(`${planPath} 없음. 먼저 plan-vehicle-master-adoption-into-master.mts 를 실행하세요.`);
}
const planRaw = readFileSync(planPath, 'utf8');
const planSha = hashText(planRaw);
const planDoc = JSON.parse(planRaw) as Rec;
if (planDoc.reportType !== 'vehicle_master_adoption_into_master_plan_v1'
  || planDoc.contractVersion !== VEHICLE_MASTER_ADOPTION_INTO_MASTER_CONTRACT_VERSION
  || planDoc.mode !== 'dry_run' || Number(planDoc.write) !== 0) {
  throw new Error('계획 파일 형식이 dry-run 승격 계획이 아닙니다.');
}

const patchesFile = JSON.parse(readFileSync('tmp/vehicle-master-adoption-into-master-patches.json', 'utf8')) as {
  namePatches: AdoptionIntoMasterCellPatch[];
  originFlags: AdoptionIntoMasterCellPatch[];
  semanticDrift: AdoptionIntoMasterCellPatch[];
};

const namePatches = patchesFile.namePatches || [];
const atomicPatches = INCLUDE_ATOMIC ? (patchesFile.semanticDrift || []) : [];
const patches = [...namePatches, ...atomicPatches];

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'dry_run',
  planSha256: planSha,
  namePatchCells: namePatches.length,
  atomicPatchCells: atomicPatches.length,
  includeAtomic: INCLUDE_ATOMIC,
  dropPowertrainColumn: !SKIP_COLUMN_DROP,
  hideReviewTab: HIDE_REVIEW,
  confirmRequired: EXPECTED_CONFIRMATION,
}, null, 2));

if (!APPLY) {
  console.log('dry-run only — 라이브 쓰기는 --apply --confirm=… --approval-reference=… --approved-plan-sha256=…');
  process.exit(0);
}

const confirmation = arg('confirm');
const approvalReference = arg('approval-reference');
const approvedPlanSha256 = arg('approved-plan-sha256').toLowerCase();
if (confirmation !== EXPECTED_CONFIRMATION) {
  throw new Error(`--confirm=${EXPECTED_CONFIRMATION} 가 필요합니다.`);
}
if (!/^[A-Za-z0-9._:-]{8,120}$/.test(approvalReference)) {
  throw new Error('--approval-reference는 8~120자 영문/숫자 식별자여야 합니다.');
}
if (approvedPlanSha256 !== planSha) {
  throw new Error('approved-plan-sha256 이 현재 계획 파일 SHA와 다릅니다.');
}

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

const meta = await api(`${base}?fields=sheets.properties(sheetId,title,hidden,gridProperties(rowCount,columnCount))`);
const masterSheet = (meta.sheets || []).find((item: Rec) => S(item.properties?.title) === MASTER_TAB)?.properties;
const adoptionSheet = (meta.sheets || []).find((item: Rec) => S(item.properties?.title) === VEHICLE_MASTER_REVIEW_ADOPTION_TAB)?.properties;
const reviewSheet = (meta.sheets || []).find((item: Rec) => S(item.properties?.title) === '차종마스터_규격검토')?.properties;
if (!masterSheet || Number(masterSheet.sheetId) !== 1159482177) {
  throw new Error('라이브 차종마스터 sheetId 기준선이 다릅니다.');
}
if (!adoptionSheet) throw new Error('규격채택 탭이 없습니다.');

const getValues = async (tab: string, cols: string) => (
  (await api(`${base}/values/${encodeURIComponent(`'${tab}'!${cols}`)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`) as { values?: unknown[][] }).values || []
);

const liveMaster = await getValues(MASTER_TAB, 'A:AF');
const liveAdoption = await getValues(VEHICLE_MASTER_REVIEW_ADOPTION_TAB, 'A:AD');
const rebuiltPlan = buildAdoptionIntoMasterPlan({ masterValues: liveMaster, adoptionValues: liveAdoption });
if (rebuiltPlan.namePatches.length !== namePatches.length
  || hashJson(rebuiltPlan.namePatches) !== hashJson(namePatches)) {
  throw new Error('라이브 재계산 이름 패치가 승인 계획과 다릅니다. plan을 다시 뽑으세요.');
}
if (INCLUDE_ATOMIC && hashJson(rebuiltPlan.semanticDrift) !== hashJson(patchesFile.semanticDrift || [])) {
  throw new Error('라이브 재계산 semantic_drift 가 승인 패치와 다릅니다.');
}

const artifactBeforeText = readFileSync('public/data/vehicle-trim-master.json', 'utf8');
const registryBeforeText = readFileSync('data/vehicle-trim-key-registry.json', 'utf8');
const artifact = JSON.parse(artifactBeforeText) as VehicleTrimMasterArtifact;
const priorPowertrainByKey = new Map(artifact.records.map((row) => [row.trim_row_key, row.powertrain]));
const registry = JSON.parse(registryBeforeText) as TrimKeyRegistry;

mkdirSync('tmp', { recursive: true });
const snapshotPath = `tmp/vehicle-master-adoption-into-master-snapshot-${Date.now()}.json`;
writeFileSync(snapshotPath, `${JSON.stringify({ values: liveMaster, adoptionValues: liveAdoption }, null, 2)}\n`);

// CAS: structural key + expected from-value (원자축은 계획과 같은 정규화로 견준다)
const headers = (liveMaster[0] || []).map(S);
const casFrom = (patch: AdoptionIntoMasterCellPatch, liveValue: unknown) => {
  const text = S(liveValue).normalize('NFC').replace(/\s+/g, ' ');
  if (patch.kind !== 'atomic') return text;
  if (patch.column === '터보') {
    if (text === '예' || text === '터보' || /^t$/i.test(text)) return '예';
    if (text === '아니오' || text === '없음' || text === 'naturally aspirated' || text === 'NA') return '아니오';
    return text;
  }
  if (patch.column === '정확배기량(cc)' || patch.column === '인승' || patch.column === '배터리(kWh)') {
    return S(liveValue).replace(/,/g, '');
  }
  return text;
};
for (const patch of patches) {
  const live = liveMaster[patch.sheetRow - 1] || [];
  if (S(live[headers.indexOf('트림행키')]) !== patch.trimRowKey) {
    throw new Error(`CAS 키 불일치 ${patch.trimRowKey} row ${patch.sheetRow}`);
  }
  if (casFrom(patch, live[patch.columnIndex]) !== patch.from) {
    throw new Error(`CAS 값 불일치 ${patch.trimRowKey} ${patch.column}: ${S(live[patch.columnIndex])} ≠ ${patch.from}`);
  }
}

let sheetWritten = false;
let columnDropped = false;
const writePatches = async (rows: AdoptionIntoMasterCellPatch[], field: 'to' | 'from') => {
  const chunkSize = 400;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    await api(`${base}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: chunk.map((patch) => ({
          range: `'${MASTER_TAB}'!${colA1(patch.columnIndex)}${patch.sheetRow}`,
          values: [[field === 'to' ? patch.to : patch.from]],
        })),
      }),
    });
  }
};
try {
  if (patches.length) {
    await writePatches(patches, 'to');
    sheetWritten = true;
  }

  let after = await getValues(MASTER_TAB, 'A:AF');
  for (const patch of patches) {
    if (casFrom(patch, after[patch.sheetRow - 1]?.[patch.columnIndex]) !== patch.to) {
      throw new Error(`Post-write 실패 ${patch.trimRowKey} ${patch.column}`);
    }
  }

  if (!SKIP_COLUMN_DROP) {
    const ptIndex = (after[0] || []).map(S).indexOf('파워트레인');
    if (ptIndex < 0) throw new Error('파워트레인 열이 이미 없습니다.');
    await api(`${base}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [{
          deleteDimension: {
            range: {
              sheetId: Number(masterSheet.sheetId),
              dimension: 'COLUMNS',
              startIndex: ptIndex,
              endIndex: ptIndex + 1,
            },
          },
        }],
      }),
    });
    columnDropped = true;
    after = await getValues(MASTER_TAB, 'A:AF');
    if ((after[0] || []).map(S).includes('파워트레인')) {
      throw new Error('파워트레인 열 삭제 후에도 헤더에 남아 있습니다.');
    }
    if (JSON.stringify((after[0] || []).map(S).slice(0, VEHICLE_MASTER_HEADERS_WITHOUT_POWERTRAIN.length))
      !== JSON.stringify([...VEHICLE_MASTER_HEADERS_WITHOUT_POWERTRAIN])) {
      // Allow AE/AF presence; require prefix match without powertrain
      const expected = [...VEHICLE_MASTER_HEADERS_WITHOUT_POWERTRAIN];
      const got = (after[0] || []).map(S);
      if (got.length !== expected.length || got.some((h, i) => h !== expected[i])) {
        throw new Error(`열 삭제 후 헤더가 계약과 다릅니다: ${got.join('|')}`);
      }
    }
  }

  if (HIDE_REVIEW && reviewSheet) {
    const alreadyHidden = matchesGoogleSheetHiddenProperty(reviewSheet.hidden, true);
    if (!alreadyHidden) {
      await api(`${base}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({
          requests: [{
            updateSheetProperties: {
              properties: { sheetId: Number(reviewSheet.sheetId), hidden: true },
              fields: 'hidden',
            },
          }],
        }),
      });
    }
  }

  const finalValues = SKIP_COLUMN_DROP ? after : dropPowertrainColumnFromValues(after);
  // 열 유지(양식 그대로)면 기존 semanticHeaders로 재등록. 열 삭제 시에만 V3.
  const semanticHeaders = SKIP_COLUMN_DROP
    ? [...registry.semanticHeaders]
    : [...TRIM_KEY_SEMANTIC_HEADERS_V3];
  const liveRecords = trimKeyRecordsFromValues(finalValues, semanticHeaders);
  const nextRegistry: TrimKeyRegistry = {
    schemaVersion: SKIP_COLUMN_DROP ? registry.schemaVersion : 3,
    spreadsheetId: MASTER_SHEET_ID,
    sheetName: MASTER_TAB,
    capturedAt: new Date().toISOString(),
    semanticHeaders,
    records: liveRecords,
  };
  const postAudit = auditTrimKeyContract(nextRegistry, liveRecords);
  if (!postAudit.ok) {
    throw new Error(`Post-audit 실패: ${postAudit.issues.slice(0, 5).map((i) => `${i.kind}:${i.code || '-'}`).join(', ')}`);
  }
  writeFileSync('data/vehicle-trim-key-registry.json', `${JSON.stringify(nextRegistry, null, 2)}\n`);
  writeFileSync(
    'public/data/vehicle-trim-master.json',
    `${JSON.stringify(buildVehicleTrimMasterArtifact(finalValues, MASTER_SHEET_ID, MASTER_TAB, { priorPowertrainByKey }), null, 2)}\n`,
  );

  const journal = {
    appliedAt: new Date().toISOString(),
    approvalReference,
    planSha256: planSha,
    namePatchCells: namePatches.length,
    atomicPatchCells: atomicPatches.length,
    columnDropped,
    hideReviewTab: HIDE_REVIEW,
    snapshotPath,
    registrySchemaVersion: nextRegistry.schemaVersion,
  };
  writeFileSync('tmp/vehicle-master-adoption-into-master-journal.json', `${JSON.stringify(journal, null, 2)}\n`);
  console.log(JSON.stringify({ mode: 'applied_verified', ...journal, key_contract_issues: 0 }, null, 2));
} catch (cause) {
  writeFileSync('data/vehicle-trim-key-registry.json', registryBeforeText);
  writeFileSync('public/data/vehicle-trim-master.json', artifactBeforeText);
  if (sheetWritten && !columnDropped) {
    await writePatches(patches, 'from').catch(() => undefined);
  }
  throw cause;
}

void applyNamePatchesToMasterValues;
