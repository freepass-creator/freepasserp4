/** Promote only official-source, fully specified, unambiguous current or recent-used trim rows. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JWT } from 'google-auth-library';
import { buildVehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import { auditTrimKeyContract, trimKeyRecordsFromValues, type TrimKeyRegistry } from '../lib/domain/vehicle-trim-key-contract';
import { MASTER_SHEET_ID, MASTER_TAB } from '../lib/domain/vehicle-master-sheet';
import { planOperationalPromotions } from '../lib/domain/vehicle-trim-operational-policy';

type Rec = Record<string, any>;
const S = (value: unknown) => String(value ?? '').trim();
const apply = process.argv.includes('--apply');
const outputPath = fileURLToPath(new URL('../public/data/vehicle-trim-master.json', import.meta.url));
const registryPath = fileURLToPath(new URL('../data/vehicle-trim-key-registry.json', import.meta.url));

async function authToken() {
  const credentialPath = S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json';
  const serviceAccount = JSON.parse(readFileSync(credentialPath, 'utf8')) as Rec;
  return (await new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    subject: S(process.env.GOOGLE_WORKSPACE_SUBJECT) || 'pyh@teamjpk.com',
  }).getAccessToken()).token;
}

async function fetchValues(token: string): Promise<string[][]> {
  const range = `'${MASTER_TAB.replace(/'/g, "''")}'!A:AD`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({})) as Rec;
  if (!response.ok) throw new Error(body?.error?.message || `Google Sheets HTTP ${response.status}`);
  return (body.values || []) as string[][];
}

function rowRuns(rows: number[]) {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const runs: Array<{ start: number; end: number }> = [];
  for (const row of sorted) {
    const last = runs.at(-1);
    if (last && last.end + 1 === row) last.end = row;
    else runs.push({ start: row, end: row });
  }
  return runs;
}

async function main() {
  const token = await authToken();
  if (!token) throw new Error('Google Sheets access token을 발급하지 못했습니다.');
  let values = await fetchValues(token);
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as TrimKeyRegistry;
  const keyAudit = auditTrimKeyContract(registry, trimKeyRecordsFromValues(values));
  if (!keyAudit.ok) throw new Error(`영구키 계약 위반 ${keyAudit.issues.length}건: ${keyAudit.issues.slice(0, 100).map((issue) => `${issue.kind}:${issue.code || '-'}`).join(', ')}`);

  const artifact = buildVehicleTrimMasterArtifact(values, MASTER_SHEET_ID, MASTER_TAB);
  const plan = planOperationalPromotions(artifact.records);
  const selectedKeys = new Set(plan.selected.map((record) => record.trim_row_key));
  const header = (values[0] || []).map(S);
  const codeIndex = header.indexOf('트림행키');
  const managementIndex = header.indexOf('관리상태');
  const verificationIndex = header.indexOf('검증상태');
  if ([codeIndex, managementIndex, verificationIndex].some((index) => index < 0)) throw new Error('필수 열을 찾지 못했습니다.');
  const rows = values.flatMap((row, index) => selectedKeys.has(S(row[codeIndex])) ? [index + 1] : []);
  if (rows.length !== selectedKeys.size) throw new Error(`선정 키와 시트 행 수 불일치: ${selectedKeys.size}/${rows.length}`);

  const makerCounts: Record<string, number> = {};
  const modelCounts: Record<string, number> = {};
  const rejectedMakerCounts: Record<string, number> = {};
  const rejectedModelCounts: Record<string, number> = {};
  for (const record of plan.selected) makerCounts[record.maker] = (makerCounts[record.maker] || 0) + 1;
  for (const record of plan.selected) {
    const key = `${record.maker} ${record.model}`;
    modelCounts[key] = (modelCounts[key] || 0) + 1;
  }
  for (const record of plan.rejected) rejectedMakerCounts[record.maker] = (rejectedMakerCounts[record.maker] || 0) + 1;
  for (const record of plan.rejected) {
    const key = `${record.maker} ${record.model}`;
    rejectedModelCounts[key] = (rejectedModelCounts[key] || 0) + 1;
  }
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'plan',
    selected: plan.selected.length,
    held_for_ambiguity: plan.heldForAmbiguity.length,
    rejected_manual: plan.rejected.length,
    failure_counts: plan.failureCounts,
    maker_counts: makerCounts,
    model_counts: modelCounts,
    rejected_maker_counts: rejectedMakerCounts,
    rejected_model_counts: rejectedModelCounts,
    row_runs: rowRuns(rows),
  }, null, 2));
  if (!apply) return;

  const data = rows.map((row) => ({ range: `'${MASTER_TAB}'!A${row}:B${row}`, values: [['확정', '확정']] }));
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
  const body = await response.json().catch(() => ({})) as Rec;
  if (!response.ok) throw new Error(body?.error?.message || `Google Sheets write HTTP ${response.status}`);

  values = await fetchValues(token);
  const after = buildVehicleTrimMasterArtifact(values, MASTER_SHEET_ID, MASTER_TAB);
  const afterByKey = new Map(after.records.map((record) => [record.trim_row_key, record]));
  const mismatches = plan.selected.filter((record) => afterByKey.get(record.trim_row_key)?.usage_tier !== 'automatic');
  if (mismatches.length) throw new Error(`승격 재조회 불일치 ${mismatches.length}행`);
  const afterAudit = auditTrimKeyContract(registry, trimKeyRecordsFromValues(values));
  if (!afterAudit.ok) throw new Error(`승격 후 영구키 계약 위반 ${afterAudit.issues.length}건`);
  writeFileSync(outputPath, `${JSON.stringify(after, null, 2)}\n`, 'utf8');
  console.log(`PASS operational promotion ${plan.selected.length} rows; automatic ${after.automatic_assignable_count}; manual ${after.manual_assignable_count}; blocked ${after.blocked_count}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
