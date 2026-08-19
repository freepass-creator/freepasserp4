/** Guarded SM6 label migration based on Renault official price/catalog lineage. */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { buildVehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import { auditTrimKeyContract, TRIM_KEY_SEMANTIC_HEADERS, trimKeyRecordsFromValues, type TrimKeyRegistry } from '../lib/domain/vehicle-trim-key-contract';
import { MASTER_SHEET_ID, MASTER_TAB } from '../lib/domain/vehicle-master-sheet';

type Rec = Record<string, unknown>;
type Change = { sub?: [string, string]; powertrain?: [string, string]; trim?: [string, string] };
const APPLY = process.argv.includes('--apply');
const CHANGES = new Map<string, Change>([
  ['mf-005.md-010.sm-lfd-sm6-2025-korea__sm6-tce-lpe::v01::t01', { sub: ['SM6 2025 국내형', '더 뉴 SM6 LFD'], powertrain: ['가솔린 1.3T 2WD', '가솔린 1.3T TCe 260'], trim: ['TCe 260 필 [必; Feel]', '필'] }],
  ['mf-005.md-010.sm-lfd-sm6-2025-korea__sm6-tce-lpe::v02::t01', { sub: ['SM6 2025 국내형', '더 뉴 SM6 LFD'], powertrain: ['가솔린 1.8T 2WD', '가솔린 1.8T TCe 300'], trim: ['TCe 300 INSPIRE', '인스파이어'] }],
  ['mf-005.md-010.sm-lfd-sm6-2025-korea__sm6-tce-lpe::v03::t01', { sub: ['SM6 2025 국내형', '더 뉴 SM6 LFD'], powertrain: ['LPG 2.0 2WD', 'LPG 2.0 LPe'], trim: ['LPe 필 [必; Feel]', '필'] }],
  ['mf-005.md-010.sm-lfd::v01::t02', { trim: ['TCe 인스파이어(Inspire)', 'TCe 인스파이어'] }],
  ['mf-005.md-010.sm-lfd::v02::t01', { trim: ['LPe 필(Feel)', 'LPe 필'] }],
  ['mf-005.md-010.sm-lfd::v03::t01', { trim: ['TCe 필(Feel)', 'TCe 필'] }],
]);
const S = (value: unknown) => String(value ?? '').trim();
const colA1 = (zeroBased: number) => { let value = zeroBased + 1; let out = ''; while (value) { value -= 1; out = String.fromCharCode(65 + value % 26) + out; value = Math.floor(value / 26); } return out; };
const credentials = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const token = (await new JWT({ email: S(credentials.client_email), key: S(credentials.private_key), scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: process.env.GOOGLE_WORKSPACE_SUBJECT || 'pyh@teamjpk.com' }).getAccessToken()).token;
if (!token) throw new Error('Sheets token missing');
const base = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}`;
const api = async (url: string, init: RequestInit = {}) => { const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } }); const body = await response.json().catch(() => ({})) as Rec; if (!response.ok) throw new Error(`Sheets ${response.status}: ${JSON.stringify(body).slice(0, 800)}`); return body; };
const range = encodeURIComponent(`'${MASTER_TAB}'!A:AD`);
const getValues = async () => ((await api(`${base}/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`) as { values?: unknown[][] }).values || []);
const before = await getValues();
const headers = (before[0] || []).map(S);
const at = (name: string) => { const index = headers.indexOf(name); if (index < 0) throw new Error(`Missing header: ${name}`); return index; };
const columns = { key: at('트림행키'), sub: at('세부모델'), powertrain: at('파워트레인'), trim: at('세부트림') };
const liveByKey = new Map(before.slice(1).map((row, index) => [S(row[columns.key]), { row, sheetRow: index + 2 }]));
const patches: Array<{ key: string; sheetRow: number; column: number; before: string; after: string }> = [];
for (const [key, change] of CHANGES) {
  const live = liveByKey.get(key); if (!live) throw new Error(`Missing key: ${key}`);
  for (const [field, pair] of [['sub', change.sub], ['powertrain', change.powertrain], ['trim', change.trim]] as const) {
    if (!pair) continue; const column = columns[field];
    if (S(live.row[column]) !== pair[0]) throw new Error(`CAS baseline mismatch ${key} ${field}: ${S(live.row[column])}`);
    patches.push({ key, sheetRow: live.sheetRow, column, before: pair[0], after: pair[1] });
  }
}
if (patches.length !== 12) throw new Error(`Expected 12 cell patches, got ${patches.length}`);
const registryPath = 'data/vehicle-trim-key-registry.json';
const registryBeforeText = readFileSync(registryPath, 'utf8');
const artifactBeforeText = readFileSync('public/data/vehicle-trim-master.json', 'utf8');
const registry = JSON.parse(registryBeforeText) as TrimKeyRegistry;
if (JSON.stringify(registry.semanticHeaders) !== JSON.stringify([...TRIM_KEY_SEMANTIC_HEADERS])) throw new Error('Registry schema mismatch');
const preAudit = auditTrimKeyContract(registry, trimKeyRecordsFromValues(before));
if (!preAudit.ok) throw new Error(`Pre-audit failed: ${preAudit.issues[0]?.kind}`);
const registryByKey = new Map(registry.records.map((record) => [record.code, record]));
const semanticIndex = (column: number) => column === columns.sub ? 3 : column === columns.powertrain ? 4 : 5;
for (const patch of patches) { if (S(registryByKey.get(patch.key)?.semantic[semanticIndex(patch.column)]) !== patch.before) throw new Error(`Registry CAS failed ${patch.key}`); }
writeFileSync('tmp/sm6-canonical-label-plan.json', `${JSON.stringify({ mode: APPLY ? 'apply' : 'dry_run', patches }, null, 2)}\n`, 'utf8');
if (!APPLY) { console.log(JSON.stringify({ mode: 'dry_run', keys: CHANGES.size, cells: patches.length, changes: patches.map(({ key, before: old, after }) => ({ key, old, after })) }, null, 2)); process.exit(0); }
const cas = await getValues();
for (const patch of patches) if (S(cas[patch.sheetRow - 1]?.[columns.key]) !== patch.key || S(cas[patch.sheetRow - 1]?.[patch.column]) !== patch.before) throw new Error(`Live CAS failed ${patch.key}`);
writeFileSync(`tmp/sm6-canonical-label-snapshot-${Date.now()}.json`, `${JSON.stringify({ values: cas }, null, 2)}\n`, 'utf8');
let sheetWritten = false;
try {
  await api(`${base}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: patches.map((patch) => ({ range: `'${MASTER_TAB}'!${colA1(patch.column)}${patch.sheetRow}`, values: [[patch.after]] })) }) });
  sheetWritten = true;
  const after = await getValues();
  for (const patch of patches) {
    if (S(after[patch.sheetRow - 1]?.[columns.key]) !== patch.key || S(after[patch.sheetRow - 1]?.[patch.column]) !== patch.after) throw new Error(`Post-write failed ${patch.key}`);
    registryByKey.get(patch.key)!.semantic[semanticIndex(patch.column)] = patch.after;
  }
  registry.capturedAt = new Date().toISOString();
  const postAudit = auditTrimKeyContract(registry, trimKeyRecordsFromValues(after)); if (!postAudit.ok) throw new Error(`Post-audit failed: ${postAudit.issues[0]?.kind}`);
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  writeFileSync('public/data/vehicle-trim-master.json', `${JSON.stringify(buildVehicleTrimMasterArtifact(after, MASTER_SHEET_ID, MASTER_TAB), null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ mode: 'applied_verified', keys: CHANGES.size, cells: patches.length, key_contract_issues: 0 }, null, 2));
} catch (cause) {
  writeFileSync(registryPath, registryBeforeText, 'utf8'); writeFileSync('public/data/vehicle-trim-master.json', artifactBeforeText, 'utf8');
  if (sheetWritten) await api(`${base}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: patches.map((patch) => ({ range: `'${MASTER_TAB}'!${colA1(patch.column)}${patch.sheetRow}`, values: [[patch.before]] })) }) });
  throw cause;
}
