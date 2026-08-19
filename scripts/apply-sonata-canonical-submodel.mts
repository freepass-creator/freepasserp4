/** Guarded migration: Sonata DN8 facelift labels -> `쏘나타 DN8 디 엣지`. */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { buildVehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import {
  auditTrimKeyContract,
  TRIM_KEY_SEMANTIC_HEADERS,
  trimKeyRecordsFromValues,
  type TrimKeyRegistry,
} from '../lib/domain/vehicle-trim-key-contract';
import { MASTER_SHEET_ID, MASTER_TAB } from '../lib/domain/vehicle-master-sheet';

type Rec = Record<string, unknown>;
const APPLY = process.argv.includes('--apply');
const EXPECTED = 25;
const CANONICAL = '쏘나타 DN8 디 엣지';
const ALLOWED_OLD = new Set([
  '쏘나타 디 엣지 하이브리드 DN8',
  '2024~2025 쏘나타 디 엣지 렌터카 DN8',
  '2026 쏘나타 디 엣지 DN8',
  '2026 쏘나타 디 엣지 렌터카 DN8',
  '2026 쏘나타 디 엣지 DN8 S',
  '쏘나타 디 엣지 DN8',
]);
const S = (value: unknown) => String(value ?? '').trim();
const colA1 = (zeroBased: number) => {
  let value = zeroBased + 1;
  let out = '';
  while (value) { value -= 1; out = String.fromCharCode(65 + (value % 26)) + out; value = Math.floor(value / 26); }
  return out;
};

const credentials = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const token = (await new JWT({
  email: S(credentials.client_email), key: S(credentials.private_key),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
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
const range = encodeURIComponent(`'${MASTER_TAB}'!A:AD`);
const getValues = async () => ((await api(`${base}/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`) as { values?: unknown[][] }).values || []);
const before = await getValues();
const headers = (before[0] || []).map(S);
const at = (name: string) => {
  const index = headers.indexOf(name);
  if (index < 0) throw new Error(`Missing header: ${name}`);
  return index;
};
const columns = { key: at('트림행키'), model: at('모델'), sub: at('세부모델'), dev: at('개발코드'), start: at('생산시작') };
const targets = before.slice(1).flatMap((row, index) => {
  const sub = S(row[columns.sub]);
  if (S(row[columns.model]) !== '쏘나타' || S(row[columns.dev]) !== 'DN8'
    || S(row[columns.start]) < '2023-01' || sub === CANONICAL) return [];
  if (!ALLOWED_OLD.has(sub)) throw new Error(`Unexpected Sonata label row ${index + 2}: ${sub}`);
  return [{ sheetRow: index + 2, key: S(row[columns.key]), before: sub, after: CANONICAL }];
});
if (targets.length !== EXPECTED) throw new Error(`Expected ${EXPECTED} targets, got ${targets.length}`);
if (new Set(targets.map((row) => row.key)).size !== EXPECTED) throw new Error('Target key duplicate');

const registryPath = 'data/vehicle-trim-key-registry.json';
const registryBeforeText = readFileSync(registryPath, 'utf8');
const artifactBeforeText = readFileSync('public/data/vehicle-trim-master.json', 'utf8');
const registry = JSON.parse(registryBeforeText) as TrimKeyRegistry;
if (registry.schemaVersion !== 1
  || JSON.stringify(registry.semanticHeaders) !== JSON.stringify([...TRIM_KEY_SEMANTIC_HEADERS])
  || registry.semanticHeaders[3] !== '세부모델') throw new Error('Registry semantic[3] schema mismatch');
const preAudit = auditTrimKeyContract(registry, trimKeyRecordsFromValues(before));
if (!preAudit.ok) throw new Error(`Pre-migration key contract failed: ${preAudit.issues.slice(0, 5).map((x) => `${x.kind}:${x.code}`).join(',')}`);
const registryByKey = new Map(registry.records.map((row) => [row.code, row]));
for (const target of targets) {
  const registered = registryByKey.get(target.key);
  if (!registered || S(registered.semantic[3]) !== target.before) throw new Error(`Registry CAS failed: ${target.key}`);
}

const plan = { mode: APPLY ? 'apply' : 'dry_run', target: CANONICAL, count: targets.length, rows: targets };
writeFileSync('tmp/sonata-canonical-submodel-plan.json', `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
if (!APPLY) { console.log(JSON.stringify({ mode: plan.mode, count: targets.length, old_labels: [...new Set(targets.map((x) => x.before))] }, null, 2)); process.exit(0); }

// Second live read is the compare-and-swap guard immediately before write.
const cas = await getValues();
for (const target of targets) {
  const row = cas[target.sheetRow - 1] || [];
  if (S(row[columns.key]) !== target.key || S(row[columns.sub]) !== target.before) throw new Error(`Live CAS failed row ${target.sheetRow}`);
}
writeFileSync(`tmp/sonata-canonical-submodel-snapshot-${Date.now()}.json`, `${JSON.stringify({ values: cas }, null, 2)}\n`, 'utf8');
const journalPath = 'tmp/sonata-canonical-submodel-journal.json';
writeFileSync(journalPath, `${JSON.stringify({ phase: 'prepared', targets, prepared_at: new Date().toISOString() }, null, 2)}\n`, 'utf8');
let sheetWritten = false;
try {
  await api(`${base}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({
    valueInputOption: 'RAW',
    data: targets.map((target) => ({ range: `'${MASTER_TAB}'!${colA1(columns.sub)}${target.sheetRow}`, values: [[CANONICAL]] })),
  }) });
  sheetWritten = true;
  writeFileSync(journalPath, `${JSON.stringify({ phase: 'sheet_written', targets, at: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  const after = await getValues();
  for (const target of targets) {
    const row = after[target.sheetRow - 1] || [];
    if (S(row[columns.key]) !== target.key || S(row[columns.sub]) !== CANONICAL) throw new Error(`Post-write verification failed row ${target.sheetRow}`);
    registryByKey.get(target.key)!.semantic[3] = CANONICAL;
  }
  registry.capturedAt = new Date().toISOString();
  const postAudit = auditTrimKeyContract(registry, trimKeyRecordsFromValues(after));
  if (!postAudit.ok) throw new Error(`Post-migration key contract failed: ${postAudit.issues.slice(0, 5).map((x) => `${x.kind}:${x.code}`).join(',')}`);
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  const artifact = buildVehicleTrimMasterArtifact(after, MASTER_SHEET_ID, MASTER_TAB);
  writeFileSync('public/data/vehicle-trim-master.json', `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  writeFileSync(journalPath, `${JSON.stringify({ phase: 'complete', targets, at: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ mode: 'applied_verified', written_cells: targets.length, canonical: CANONICAL, key_contract_issues: 0 }, null, 2));
} catch (cause) {
  writeFileSync(registryPath, registryBeforeText, 'utf8');
  writeFileSync('public/data/vehicle-trim-master.json', artifactBeforeText, 'utf8');
  if (sheetWritten) {
    await api(`${base}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({
      valueInputOption: 'RAW',
      data: targets.map((target) => ({ range: `'${MASTER_TAB}'!${colA1(columns.sub)}${target.sheetRow}`, values: [[target.before]] })),
    }) });
    const rolledBack = await getValues();
    if (targets.some((target) => S(rolledBack[target.sheetRow - 1]?.[columns.key]) !== target.key
      || S(rolledBack[target.sheetRow - 1]?.[columns.sub]) !== target.before)) throw new Error(`Rollback verification failed; original error: ${S((cause as Error).message)}`);
  }
  writeFileSync(journalPath, `${JSON.stringify({ phase: 'rolled_back', error: S((cause as Error).message), at: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  throw cause;
}
