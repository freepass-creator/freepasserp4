/** Guarded cleanup of product-referenced sub-model labels polluted only by model year. */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { buildVehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import { auditTrimKeyContract, trimKeyRecordsFromValues, type TrimKeyRegistry } from '../lib/domain/vehicle-trim-key-contract';
import { MASTER_SHEET_ID, MASTER_TAB } from '../lib/domain/vehicle-master-sheet';

type Rec = Record<string, any>;
const APPLY = process.argv.includes('--apply');
const S = (value: unknown) => String(value ?? '').trim();
const replacements: Record<string, [string, string]> = {
  'mf-001.md-059.sm-qx1-venue-2025-korea__venue-1.6-ivt': ['2025 베뉴 QX1', '베뉴 QX1'],
  'mf-002.md-065.sm-gl3-pe-my2026__k8-best-product': ['The 2026 K8 GL3', '더 뉴 K8 GL3'],
  'mf-002.md-001.sm-dl3-pe-my2025__k5-2025-lpg': ['2025 더 뉴 K5 DL3', '더 뉴 K5 DL3'],
  'mf-002.md-001.sm-dl3-pe-my2026__k5-best-product': ['The 2026 K5 DL3', '더 뉴 K5 DL3'],
  'mf-002.md-025.sm-nq5-2022-lpg-gravity__sportage-product': ['스포티지 NQ5 2022', '스포티지 NQ5'],
  'mf-001.md-032.sm-nx4-my2023-product__tucson': ['2023 투싼 NX4', '투싼 NX4'],
  'mf-002.md-027.sm-mq4-pe-2024-diesel-gravity__sorento-product': ['더 뉴 쏘렌토 MQ4 2024', '더 뉴 쏘렌토 MQ4'],
};
const credentials = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const token = (await new JWT({ email: S(credentials.client_email), key: S(credentials.private_key), scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: process.env.GOOGLE_WORKSPACE_SUBJECT || 'pyh@teamjpk.com' }).getAccessToken()).token;
if (!token) throw new Error('Sheets token missing');
const base = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}`;
const api = async (url: string, init: RequestInit = {}) => { const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }); const body = await response.json().catch(() => ({})) as Rec; if (!response.ok) throw new Error(`Sheets ${response.status}: ${JSON.stringify(body).slice(0, 500)}`); return body; };
const getValues = async () => ((await api(`${base}/values/${encodeURIComponent(`'${MASTER_TAB}'!A:AF`)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`) as { values?: unknown[][] }).values || []);
const before = await getValues();
const header = (before[0] || []).map(S);
const at = (name: string) => { const i = header.indexOf(name); if (i < 0) throw new Error(`Missing ${name}`); return i; };
const c = { key: at('트림행키'), master: at('마스터ID'), sub: at('세부모델'), body: at('차체구성'), source: at('원문별칭'), seats: at('인승') };
const targets = before.slice(1).flatMap((row, i) => {
  const pair = replacements[S(row[c.master])]; if (!pair) return [];
  if (S(row[c.sub]) === pair[1] && S(row[c.body]) === '승용' && S(row[c.source]).split('|').includes(pair[0])) return [];
  if (S(row[c.sub]) !== pair[0] || S(row[c.body]) || Number(row[c.seats]) < 4) throw new Error(`CAS/body mismatch row ${i + 2}`);
  return [{ sheetRow: i + 2, key: S(row[c.key]), old: pair[0], next: pair[1], oldSource: S(row[c.source]), nextSource: [...new Set([...S(row[c.source]).split('|').filter(Boolean), pair[0]])].join('|') }];
});
if (![0, 10].includes(targets.length)) throw new Error(`Expected 10 targets or applied no-op, got ${targets.length}`);
const registryPath = 'data/vehicle-trim-key-registry.json'; const artifactPath = 'public/data/vehicle-trim-master.json';
const registryText = readFileSync(registryPath, 'utf8'); const artifactText = readFileSync(artifactPath, 'utf8');
const registry = JSON.parse(registryText) as TrimKeyRegistry;
const pre = auditTrimKeyContract(registry, trimKeyRecordsFromValues(before, registry.semanticHeaders)); if (!pre.ok) throw new Error(`Pre-audit ${pre.issues[0]?.kind}`);
if (!targets.length) { console.log(JSON.stringify({ mode: 'already_applied_verified', keys: 10, key_contract_issues: 0 }, null, 2)); process.exit(0); }
const byKey = new Map(registry.records.map((row) => [row.code, row]));
for (const target of targets) if (S(byKey.get(target.key)?.semantic[3]) !== target.old || S(byKey.get(target.key)?.semantic[19])) throw new Error(`Registry CAS ${target.key}`);
writeFileSync('tmp/product-priority-year-label-plan.json', `${JSON.stringify({ mode: APPLY ? 'apply' : 'dry_run', targets }, null, 2)}\n`);
if (!APPLY) { console.log(JSON.stringify({ mode: 'dry_run', keys: targets.length, cells: targets.length * 3 }, null, 2)); process.exit(0); }
const cas = await getValues(); for (const target of targets) if (S(cas[target.sheetRow - 1]?.[c.key]) !== target.key || S(cas[target.sheetRow - 1]?.[c.sub]) !== target.old) throw new Error(`Final CAS ${target.key}`);
const snapshot = `tmp/product-priority-year-label-snapshot-${Date.now()}.json`; writeFileSync(snapshot, `${JSON.stringify({ values: cas }, null, 2)}\n`);
let written = false;
try {
  await api(`${base}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: targets.flatMap((t) => [{ range: `'${MASTER_TAB}'!G${t.sheetRow}`, values: [[t.next]] }, { range: `'${MASTER_TAB}'!AE${t.sheetRow}:AF${t.sheetRow}`, values: [['승용', t.nextSource]] }]) }) }); written = true;
  const after = await getValues(); for (const t of targets) if (S(after[t.sheetRow - 1]?.[c.key]) !== t.key || S(after[t.sheetRow - 1]?.[c.sub]) !== t.next || S(after[t.sheetRow - 1]?.[c.body]) !== '승용' || S(after[t.sheetRow - 1]?.[c.source]) !== t.nextSource) throw new Error(`Post-read ${t.key}`);
  for (const t of targets) { const row = byKey.get(t.key)!; row.semantic[3] = t.next; row.semantic[19] = '승용'; }
  registry.capturedAt = new Date().toISOString(); const post = auditTrimKeyContract(registry, trimKeyRecordsFromValues(after, registry.semanticHeaders)); if (!post.ok) throw new Error(`Post-audit ${post.issues[0]?.kind}`);
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`); writeFileSync(artifactPath, `${JSON.stringify(buildVehicleTrimMasterArtifact(after, MASTER_SHEET_ID, MASTER_TAB), null, 2)}\n`);
  console.log(JSON.stringify({ mode: 'applied_verified', keys: targets.length, cells: targets.length * 3, key_contract_issues: 0, snapshot }, null, 2));
} catch (cause) {
  writeFileSync(registryPath, registryText); writeFileSync(artifactPath, artifactText);
  if (written) await api(`${base}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: targets.flatMap((t) => [{ range: `'${MASTER_TAB}'!G${t.sheetRow}`, values: [[t.old]] }, { range: `'${MASTER_TAB}'!AE${t.sheetRow}:AF${t.sheetRow}`, values: [['', t.oldSource]] }]) }) });
  throw cause;
}
