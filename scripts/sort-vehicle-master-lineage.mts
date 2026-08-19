/** Group the live vehicle master by lineage without changing permanent-key semantics. */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { auditTrimKeyContract, trimKeyRecordsFromValues, type TrimKeyRegistry } from '../lib/domain/vehicle-trim-key-contract';
import { MASTER_SHEET_ID, MASTER_TAB } from '../lib/domain/vehicle-master-sheet';

type Rec = Record<string, any>;
const APPLY = process.argv.includes('--apply');
const S = (value: unknown) => String(value ?? '').trim();
const credentials = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const token = (await new JWT({
  email: S(credentials.client_email),
  key: S(credentials.private_key),
  scopes: [APPLY ? 'https://www.googleapis.com/auth/spreadsheets' : 'https://www.googleapis.com/auth/spreadsheets.readonly'],
  subject: process.env.GOOGLE_WORKSPACE_SUBJECT || 'pyh@teamjpk.com',
}).getAccessToken()).token;
if (!token) throw new Error('Sheets token missing');
const base = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}`;
const api = async (url: string, init: RequestInit = {}) => {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({})) as Rec;
  if (!response.ok) throw new Error(`Sheets ${response.status}: ${JSON.stringify(body).slice(0, 800)}`);
  return body;
};
const range = encodeURIComponent(`'${MASTER_TAB}'!A:AF`);
const getValues = async () => ((await api(`${base}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMULA`) as { values?: unknown[][] }).values || []);
const metadata = await api(`${base}?fields=${encodeURIComponent('sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))')}`);
const sheet = (metadata.sheets || []).find((item: Rec) => S(item.properties?.title) === MASTER_TAB)?.properties;
if (!sheet || Number(sheet.gridProperties?.columnCount) !== 32) throw new Error('Expected 32-column A:AF master tab');
const before = await getValues();
const headers = (before[0] || []).map(S);
const at = (name: string) => { const index = headers.indexOf(name); if (index < 0) throw new Error(`Missing header: ${name}`); return index; };
const keyColumn = at('트림행키');
const sortColumns = ['제조사', '모델', '세부모델', '생산시작', '파워트레인순번', '트림순번'].map(at);
const keysBefore = before.slice(1).map((row) => S(row[keyColumn])).filter(Boolean);
if (new Set(keysBefore).size !== keysBefore.length || keysBefore.length !== 5_334) throw new Error(`Key baseline mismatch: ${keysBefore.length}`);
const registry = JSON.parse(readFileSync('data/vehicle-trim-key-registry.json', 'utf8')) as TrimKeyRegistry;
const preAudit = auditTrimKeyContract(registry, trimKeyRecordsFromValues(before, registry.semanticHeaders));
if (!preAudit.ok) throw new Error(`Pre-sort key contract failed: ${preAudit.issues[0]?.kind}`);
const plan = { mode: APPLY ? 'apply' : 'dry_run', rows: keysBefore.length, sort_headers: sortColumns.map((index) => headers[index]), sheet_id: sheet.sheetId };
writeFileSync('tmp/vehicle-master-lineage-sort-plan.json', `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
if (!APPLY) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }

const backupName = `_backup_vehicle_master_${Date.now()}`;
const duplicated = await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ duplicateSheet: { sourceSheetId: sheet.sheetId, newSheetName: backupName } }] }) });
const backupSheetId = duplicated.replies?.[0]?.duplicateSheet?.properties?.sheetId;
if (typeof backupSheetId !== 'number') throw new Error('Backup sheet creation failed');
try {
  await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ sortRange: {
    range: { sheetId: sheet.sheetId, startRowIndex: 1, endRowIndex: before.length, startColumnIndex: 0, endColumnIndex: 32 },
    sortSpecs: sortColumns.map((dimensionIndex) => ({ dimensionIndex, sortOrder: 'ASCENDING' })),
  } }] }) });
  const after = await getValues();
  const keysAfter = after.slice(1).map((row) => S(row[keyColumn])).filter(Boolean);
  if (keysAfter.length !== keysBefore.length || keysAfter.some((key) => !new Set(keysBefore).has(key))) throw new Error('Key set changed after sort');
  const postAudit = auditTrimKeyContract(registry, trimKeyRecordsFromValues(after, registry.semanticHeaders));
  if (!postAudit.ok) throw new Error(`Post-sort key contract failed: ${postAudit.issues[0]?.kind}`);
  const seenModels = new Set<string>();
  let previousModel = '';
  for (const row of after.slice(1)) {
    const modelKey = `${S(row[at('제조사')])}\u0000${S(row[at('모델')])}`;
    if (modelKey !== previousModel && seenModels.has(modelKey)) throw new Error(`Model group split after sort: ${modelKey}`);
    seenModels.add(modelKey); previousModel = modelKey;
  }
  await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ deleteSheet: { sheetId: backupSheetId } }] }) });
  console.log(JSON.stringify({ mode: 'applied_verified', rows: keysAfter.length, key_contract_issues: 0, split_model_groups: 0 }, null, 2));
} catch (cause) {
  await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ copyPaste: {
    source: { sheetId: backupSheetId, startRowIndex: 0, endRowIndex: before.length, startColumnIndex: 0, endColumnIndex: 32 },
    destination: { sheetId: sheet.sheetId, startRowIndex: 0, endRowIndex: before.length, startColumnIndex: 0, endColumnIndex: 32 },
    pasteType: 'PASTE_NORMAL', pasteOrientation: 'NORMAL',
  } }] }) });
  throw cause;
}
