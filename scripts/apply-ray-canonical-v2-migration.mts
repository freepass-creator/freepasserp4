/** Guarded Ray atom migration: sub-model + body configuration + raw source alias. */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { buildVehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import {
  auditTrimKeyContract, TRIM_KEY_SEMANTIC_HEADERS, TRIM_KEY_SEMANTIC_HEADERS_V2,
  trimKeyRecordsFromValues, type TrimKeyRegistry,
} from '../lib/domain/vehicle-trim-key-contract';
import { MASTER_SHEET_ID, MASTER_TAB } from '../lib/domain/vehicle-master-sheet';

type Rec = Record<string, any>;
type Planned = {
  trim_row_key: string; expected_sub_model: string; replacement_sub_model: string;
  body_configuration: string; source_aliases_to_add: string[];
};
const APPLY = process.argv.includes('--apply');
const S = (value: unknown) => String(value ?? '').trim();
const plan = JSON.parse(readFileSync('tmp/ray-canonical-v2-migration-plan.json', 'utf8')) as { rows: Planned[] };
if (plan.rows.length !== 27 || new Set(plan.rows.map((row) => row.trim_row_key)).size !== 27) throw new Error('Ray plan must contain 27 unique permanent keys');

const credentials = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const token = (await new JWT({ email: S(credentials.client_email), key: S(credentials.private_key), scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: process.env.GOOGLE_WORKSPACE_SUBJECT || 'pyh@teamjpk.com' }).getAccessToken()).token;
if (!token) throw new Error('Sheets token missing');
const base = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}`;
const api = async (url: string, init: RequestInit = {}) => {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({})) as Rec;
  if (!response.ok) throw new Error(`Sheets ${response.status}: ${JSON.stringify(body).slice(0, 800)}`);
  return body;
};
const readValues = async () => ((await api(`${base}/values/${encodeURIComponent(`'${MASTER_TAB}'!A:AF`)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`) as { values?: unknown[][] }).values || []);
const metadata = await api(`${base}?fields=${encodeURIComponent('sheets.properties(sheetId,title,gridProperties(columnCount))')}`);
const sheet = (metadata.sheets || []).find((item: Rec) => S(item.properties?.title) === MASTER_TAB)?.properties;
if (!sheet || typeof sheet.sheetId !== 'number' || ![30, 32].includes(Number(sheet.gridProperties?.columnCount))) throw new Error('Expected 30- or 32-column live master grid');

const before = await readValues();
const headers = (before[0] || []).map(S);
const at = (name: string) => { const index = headers.indexOf(name); if (index < 0) throw new Error(`Missing header ${name}`); return index; };
const columns = { key: at('트림행키'), sub: at('세부모델'), body: 30, source: 31 };
const liveByKey = new Map(before.slice(1).map((row, index) => [S(row[columns.key]), { row, sheetRow: index + 2 }]));
const registryPath = 'data/vehicle-trim-key-registry.json';
const artifactPath = 'public/data/vehicle-trim-master.json';
if (headers[30] === '차체구성' && headers[31] === '원문별칭') {
  for (const item of plan.rows) {
    const live = liveByKey.get(item.trim_row_key);
    if (!live || S(live.row[columns.sub]) !== item.replacement_sub_model || S(live.row[columns.body]) !== item.body_configuration || S(live.row[columns.source]) !== item.source_aliases_to_add.join('|')) throw new Error(`Applied-state mismatch ${item.trim_row_key}`);
  }
  const appliedRegistry = JSON.parse(readFileSync(registryPath, 'utf8')) as TrimKeyRegistry;
  const audit = auditTrimKeyContract(appliedRegistry, trimKeyRecordsFromValues(before, appliedRegistry.semanticHeaders));
  if (appliedRegistry.schemaVersion !== 2 || !audit.ok) throw new Error(`Applied registry audit failed ${audit.issues[0]?.kind || ''}`);
  console.log(JSON.stringify({ mode: 'already_applied_verified', keys: 27, registry_schema: 2, key_contract_issues: 0 }, null, 2));
  process.exit(0);
}
if (headers.length !== 30 || headers[29] !== '데이터기준일' || headers[30] || headers[31]) throw new Error(`Expected legacy A:AD header, got ${headers.length} columns`);
const targets = plan.rows.map((item) => {
  const live = liveByKey.get(item.trim_row_key);
  if (!live) throw new Error(`Missing live Ray key ${item.trim_row_key}`);
  if (S(live.row[columns.sub]) !== item.expected_sub_model) throw new Error(`Sub-model CAS mismatch ${item.trim_row_key}`);
  return { ...item, sheetRow: live.sheetRow, sourceAlias: item.source_aliases_to_add.join('|') };
});

const registryBeforeText = readFileSync(registryPath, 'utf8');
const artifactBeforeText = readFileSync(artifactPath, 'utf8');
const registry = JSON.parse(registryBeforeText) as TrimKeyRegistry;
if (registry.schemaVersion !== 1 || JSON.stringify(registry.semanticHeaders) !== JSON.stringify([...TRIM_KEY_SEMANTIC_HEADERS])) throw new Error('Expected registry V1 baseline');
const preAudit = auditTrimKeyContract(registry, trimKeyRecordsFromValues(before, registry.semanticHeaders));
if (!preAudit.ok) throw new Error(`Pre-audit failed ${preAudit.issues[0]?.kind}`);
const registryByKey = new Map(registry.records.map((row) => [row.code, row]));
for (const target of targets) if (S(registryByKey.get(target.trim_row_key)?.semantic[3]) !== target.expected_sub_model) throw new Error(`Registry CAS mismatch ${target.trim_row_key}`);

writeFileSync('tmp/ray-canonical-v2-apply-plan.json', `${JSON.stringify({ mode: APPLY ? 'apply' : 'dry_run', headers: ['차체구성', '원문별칭'], targets }, null, 2)}\n`);
if (!APPLY) { console.log(JSON.stringify({ mode: 'dry_run', keys: targets.length, cells: 83, body_counts: Object.fromEntries(['승용','1인승 밴','2인승 밴'].map((x) => [x, targets.filter((row) => row.body_configuration === x).length])) }, null, 2)); process.exit(0); }

const cas = await readValues();
if ((cas[0] || []).map(S).length !== 30) throw new Error('Header changed before write');
for (const target of targets) {
  const row = cas[target.sheetRow - 1] || [];
  if (S(row[columns.key]) !== target.trim_row_key || S(row[columns.sub]) !== target.expected_sub_model || S(row[columns.body]) || S(row[columns.source])) throw new Error(`Final CAS failed ${target.trim_row_key}`);
}
const snapshotPath = `tmp/ray-canonical-v2-snapshot-${Date.now()}.json`;
writeFileSync(snapshotPath, `${JSON.stringify({ values: cas }, null, 2)}\n`);
const journalPath = 'tmp/ray-canonical-v2-journal.json';
writeFileSync(journalPath, `${JSON.stringify({ phase: 'prepared', snapshotPath, keys: targets.map((x) => x.trim_row_key), at: new Date().toISOString() }, null, 2)}\n`);
let sheetWritten = false;
let columnsAdded = false;
try {
  await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ appendDimension: { sheetId: sheet.sheetId, dimension: 'COLUMNS', length: 2 } }] }) });
  columnsAdded = true;
  const data = [
    { range: `'${MASTER_TAB}'!AE1:AF1`, values: [['차체구성', '원문별칭']] },
    ...targets.flatMap((target) => [
      { range: `'${MASTER_TAB}'!G${target.sheetRow}`, values: [[target.replacement_sub_model]] },
      { range: `'${MASTER_TAB}'!AE${target.sheetRow}:AF${target.sheetRow}`, values: [[target.body_configuration, target.sourceAlias]] },
    ]),
  ];
  await api(`${base}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
  sheetWritten = true;
  const after = await readValues();
  const afterHeaders = (after[0] || []).map(S);
  if (afterHeaders[30] !== '차체구성' || afterHeaders[31] !== '원문별칭') throw new Error('V2 headers post-read failed');
  for (const target of targets) {
    const row = after[target.sheetRow - 1] || [];
    if (S(row[columns.key]) !== target.trim_row_key || S(row[columns.sub]) !== target.replacement_sub_model || S(row[columns.body]) !== target.body_configuration || S(row[columns.source]) !== target.sourceAlias) throw new Error(`Post-read mismatch ${target.trim_row_key}`);
  }

  const nextRegistry: TrimKeyRegistry = {
    ...registry, schemaVersion: 2, capturedAt: new Date().toISOString(), semanticHeaders: [...TRIM_KEY_SEMANTIC_HEADERS_V2],
    records: registry.records.map((row) => ({ ...row, semantic: [...row.semantic, ''] })),
  };
  const nextByKey = new Map(nextRegistry.records.map((row) => [row.code, row]));
  for (const target of targets) { const row = nextByKey.get(target.trim_row_key)!; row.semantic[3] = target.replacement_sub_model; row.semantic[19] = target.body_configuration; }
  const postAudit = auditTrimKeyContract(nextRegistry, trimKeyRecordsFromValues(after, nextRegistry.semanticHeaders));
  if (!postAudit.ok) throw new Error(`Post-audit failed ${postAudit.issues.slice(0, 5).map((x) => `${x.kind}:${x.code}`).join(',')}`);
  writeFileSync(registryPath, `${JSON.stringify(nextRegistry, null, 2)}\n`);
  writeFileSync(artifactPath, `${JSON.stringify(buildVehicleTrimMasterArtifact(after, MASTER_SHEET_ID, MASTER_TAB), null, 2)}\n`);
  writeFileSync(journalPath, `${JSON.stringify({ phase: 'complete', snapshotPath, keys: targets.map((x) => x.trim_row_key), at: new Date().toISOString() }, null, 2)}\n`);
  console.log(JSON.stringify({ mode: 'applied_verified', keys: 27, cells: 83, registry_schema: 2, key_contract_issues: 0, snapshotPath }, null, 2));
} catch (cause) {
  writeFileSync(registryPath, registryBeforeText); writeFileSync(artifactPath, artifactBeforeText);
  if (sheetWritten) {
    await api(`${base}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: targets.map((target) => ({ range: `'${MASTER_TAB}'!G${target.sheetRow}`, values: [[target.expected_sub_model]] })) }) });
  }
  if (columnsAdded) await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: sheet.sheetId, dimension: 'COLUMNS', startIndex: 30, endIndex: 32 } } }] }) });
  writeFileSync(journalPath, `${JSON.stringify({ phase: 'rolled_back', error: S((cause as Error).message), at: new Date().toISOString() }, null, 2)}\n`);
  throw cause;
}
