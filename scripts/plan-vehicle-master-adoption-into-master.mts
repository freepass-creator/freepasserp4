/**
 * Dry-run: 규격채택 → 운영 차종마스터 이름 승격 + 파워트레인 열 제거 계획.
 *
 * 쓰기 없음. 스냅샷 또는 라이브 시트 읽기.
 *
 *   npx tsx scripts/plan-vehicle-master-adoption-into-master.mts
 *   npx tsx scripts/plan-vehicle-master-adoption-into-master.mts --master-snapshot=… --adoption-snapshot=…
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  VEHICLE_MASTER_ADOPTION_INTO_MASTER_CONTRACT_VERSION,
  VEHICLE_MASTER_HEADERS_WITH_POWERTRAIN,
  buildAdoptionIntoMasterPlan,
  dropPowertrainColumnFromValues,
} from '../lib/domain/vehicle-master-adoption-into-master';
import { VEHICLE_MASTER_REVIEW_ADOPTION_TAB } from '../lib/domain/vehicle-master-review-promotion';
import { MASTER_SHEET_ID, MASTER_TAB } from '../lib/domain/vehicle-master-sheet';
import { composePowertrainLabel, resolvePowertrainLabel } from '../lib/domain/vehicle-powertrain-label';
import {
  TRIM_KEY_SEMANTIC_HEADERS_V3,
  auditTrimKeyContract,
  trimKeyRecordsFromValues,
  type TrimKeyRegistry,
} from '../lib/domain/vehicle-trim-key-contract';
import type { VehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import { buildVehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';

type Rec = Record<string, any>;
const S = (value: unknown) => String(value ?? '').trim();
const arg = (name: string) => S(process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileSha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

const readJsonMatrix = (path: string): unknown[][] => {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown[][] | { values?: unknown[][] };
  return Array.isArray(parsed) ? parsed : parsed.values || [];
};

async function fetchSheetValues(range: string): Promise<unknown[][]> {
  const credentialPath = S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json';
  const serviceAccount = JSON.parse(readFileSync(credentialPath, 'utf8')) as Rec;
  const subject = S(process.env.GOOGLE_WORKSPACE_SUBJECT) || 'pyh@teamjpk.com';
  const token = (await new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    subject,
  }).getAccessToken()).token;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json().catch(() => ({})) as Rec;
    if (response.ok) return (body.values || []) as unknown[][];
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 2_000 * 2 ** attempt)));
      continue;
    }
    throw new Error(body?.error?.message || `Google Sheets HTTP ${response.status}`);
  }
}

const masterSnapshot = arg('master-snapshot');
const adoptionSnapshot = arg('adoption-snapshot');
const masterValues = masterSnapshot
  ? readJsonMatrix(masterSnapshot)
  : await fetchSheetValues(`'${MASTER_TAB.replace(/'/g, "''")}'!A:AF`);
const adoptionValues = adoptionSnapshot
  ? readJsonMatrix(adoptionSnapshot)
  : await fetchSheetValues(`'${VEHICLE_MASTER_REVIEW_ADOPTION_TAB.replace(/'/g, "''")}'!A:AD`);

const plan = buildAdoptionIntoMasterPlan({ masterValues, adoptionValues });
const artifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as VehicleTrimMasterArtifact;
const registry = JSON.parse(readFileSync('data/vehicle-trim-key-registry.json', 'utf8')) as TrimKeyRegistry;
const priorPowertrainByKey = new Map(artifact.records.map((row) => [row.trim_row_key, row.powertrain]));

const headers = (masterValues[0] || []).map(S);
const ptCol = headers.indexOf('파워트레인');
const keyCol = headers.indexOf('트림행키');
const fuelCol = headers.indexOf('연료');
const dispCol = headers.indexOf('표시배기량(L)');
const turboCol = headers.indexOf('터보');
const driveCol = headers.indexOf('구동방식');
const batCol = headers.indexOf('배터리(kWh)');

let powertrainExact = 0;
let powertrainPriorPreserve = 0;
let powertrainComposeOnly = 0;
let powertrainEmpty = 0;
const powertrainDiffSamples: Rec[] = [];

for (const row of masterValues.slice(1)) {
  const key = S(row[keyCol]);
  if (!key) continue;
  const sheetLabel = ptCol >= 0 ? S(row[ptCol]) : '';
  const prior = priorPowertrainByKey.get(key) || '';
  const turboRaw = S(row[turboCol]);
  const composed = composePowertrainLabel({
    fuel: row[fuelCol],
    displacement_l: row[dispCol],
    turbo: turboRaw === '예' ? true : turboRaw === '아니오' ? false : null,
    drivetrain: row[driveCol],
    battery_kwh: row[batCol],
  });
  const resolved = resolvePowertrainLabel({
    sheetLabel: '',
    priorLabel: prior,
    axes: {
      fuel: row[fuelCol],
      displacement_l: row[dispCol],
      turbo: turboRaw === '예' ? true : turboRaw === '아니오' ? false : null,
      drivetrain: row[driveCol],
      battery_kwh: row[batCol],
    },
  });
  if (!sheetLabel) {
    powertrainEmpty++;
  } else if (composed === sheetLabel) {
    powertrainExact++;
  } else if (resolved === sheetLabel || prior === sheetLabel) {
    powertrainPriorPreserve++;
    if (powertrainDiffSamples.length < 20) {
      powertrainDiffSamples.push({ key, sheetLabel, composed, prior });
    }
  } else {
    powertrainComposeOnly++;
    if (powertrainDiffSamples.length < 20) {
      powertrainDiffSamples.push({ key, sheetLabel, composed, prior, resolved });
    }
  }
}

const dropped = dropPowertrainColumnFromValues(masterValues);
const rebuilt = buildVehicleTrimMasterArtifact(dropped, MASTER_SHEET_ID, MASTER_TAB, { priorPowertrainByKey });
let labelRegression = 0;
for (const row of rebuilt.records) {
  const prior = priorPowertrainByKey.get(row.trim_row_key) || '';
  if (prior && prior !== row.powertrain) labelRegression++;
}

const liveKeyAudit = auditTrimKeyContract(
  registry,
  trimKeyRecordsFromValues(masterValues, registry.semanticHeaders),
);

mkdirSync('tmp', { recursive: true });
const report = {
  reportType: 'vehicle_master_adoption_into_master_plan_v1',
  contractVersion: VEHICLE_MASTER_ADOPTION_INTO_MASTER_CONTRACT_VERSION,
  generatedAt: new Date().toISOString(),
  mode: 'dry_run',
  write: 0,
  humanApprovalRecorded: false,
  source: {
    spreadsheetId: MASTER_SHEET_ID,
    masterTab: MASTER_TAB,
    adoptionTab: VEHICLE_MASTER_REVIEW_ADOPTION_TAB,
    masterSnapshot: masterSnapshot || null,
    adoptionSnapshot: adoptionSnapshot || null,
    masterValuesSha256: hash(masterValues),
    adoptionValuesSha256: hash(adoptionValues),
    artifactSha256: fileSha256('public/data/vehicle-trim-master.json'),
    registrySha256: fileSha256('data/vehicle-trim-key-registry.json'),
    implementation: Object.fromEntries([
      'lib/domain/vehicle-master-adoption-into-master.ts',
      'lib/domain/vehicle-powertrain-label.ts',
      'lib/domain/vehicle-trim-master.ts',
      'lib/domain/vehicle-trim-key-contract.ts',
      'scripts/apply-vehicle-master-adoption-into-master.mts',
    ].map((path) => [path, existsSync(path) ? fileSha256(path) : null])),
  },
  plan: {
    eligibleKeys: plan.eligibleKeys,
    nameChangeKeys: plan.nameChangeKeys,
    namePatchCells: plan.namePatches.length,
    originFlagCells: plan.originFlags.length,
    semanticDriftCells: plan.semanticDrift.length,
    skippedReviewOnly: plan.skippedReviewOnly,
    skippedMissingKey: plan.skippedMissingKey,
    structuralGuarantees: plan.structuralGuarantees,
    dropPowertrainColumn: plan.dropPowertrainColumn,
    namePatchesSample: plan.namePatches.slice(0, 30),
    semanticDriftSample: plan.semanticDrift.slice(0, 30),
    originFlagsSample: plan.originFlags.slice(0, 20),
  },
  powertrain: {
    note: '열 제거 후 prior artifact 라벨 보존. 원자축 합성은 신규·빈칸용.',
    sheetHasPowertrainColumn: ptCol >= 0,
    expectedLegacyHeaders: VEHICLE_MASTER_HEADERS_WITH_POWERTRAIN.length,
    liveHeaderCount: headers.length,
    composeExactMatch: powertrainExact,
    priorPreservesSheetLabel: powertrainPriorPreserve,
    emptySheetLabel: powertrainEmpty,
    other: powertrainComposeOnly,
    labelRegressionAfterDropWithPrior: labelRegression,
    samples: powertrainDiffSamples,
    nextRegistrySemanticHeaders: [...TRIM_KEY_SEMANTIC_HEADERS_V3],
  },
  keyAuditBefore: {
    ok: liveKeyAudit.ok,
    issueCount: liveKeyAudit.issues.length,
    sample: liveKeyAudit.issues.slice(0, 10),
  },
  applyGate: {
    defaultScope: 'name_patches_only + drop_powertrain_column',
    atomicPatchesRequireExplicitApproval: true,
    registryRebaselineRequired: true,
    confirmToken: 'APPLY_VEHICLE_MASTER_ADOPTION_INTO_MASTER_V1',
  },
};

const outPath = 'tmp/vehicle-master-adoption-into-master-plan.json';
const text = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(outPath, text);
const patchesPath = 'tmp/vehicle-master-adoption-into-master-patches.json';
writeFileSync(patchesPath, `${JSON.stringify({
  namePatches: plan.namePatches,
  originFlags: plan.originFlags,
  semanticDrift: plan.semanticDrift,
}, null, 2)}\n`);

console.log(`PASS — dry-run plan → ${outPath}`);
console.log(`  eligible ${plan.eligibleKeys} · name keys ${plan.nameChangeKeys} · name cells ${plan.namePatches.length}`);
console.log(`  semantic_drift cells ${plan.semanticDrift.length} · origin flags ${plan.originFlags.length}`);
console.log(`  powertrain: composeExact ${powertrainExact} · priorPreserve ${powertrainPriorPreserve} · empty ${powertrainEmpty} · regression ${labelRegression}`);
console.log(`  plan sha256 ${createHash('sha256').update(text).digest('hex')}`);
console.log(`  patches → ${patchesPath}`);
if (!liveKeyAudit.ok) {
  console.log(`  ⚠ live key audit issues ${liveKeyAudit.issues.length} (승격 apply 전 별도 게이트)`);
}
