/** The only live formatting-only executor. No ingest, Firestore, row writes or local apply. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { googleSheetsServiceAccount } from '../lib/server/google-service-account';
import { assertProductionSheetWrite } from '../lib/server/production-sheet-write-gate';
import { planSheetContract, auditSheetContractReadback, type SheetContractSnapshot } from '../lib/domain/sheet-contract-plan';
import { SHEET_CONTRACT } from '../lib/domain/sales-sheet-banner';
import { salesTabMatches, SALES_PUBLISHED_TAB_PREFIXES } from '../lib/domain/sales-published-tabs';

const IDS = { F01: '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs', F86: '1hQtshpWKL4L0zSR3H3UQ36atICtHv9Ka7dQh7d7K5Vg' } as const;
const target = process.env.SHEET_FORMAT_TARGET as keyof typeof IDS;
if (!Object.hasOwn(IDS, target)) throw new Error('HOLD: target outside F01/F86 allowlist');
const id = IDS[target], apply = process.env.SHEET_FORMAT_APPLY === 'true';
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const out = 'tmp/sheet-contract';
mkdirSync(out, { recursive: true });
const save = (name: string, value: unknown) => writeFileSync(`${out}/${target}-${name}.json`, JSON.stringify(value, null, 2));
const stable = (value: any): any => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const trimGrid = (rows: unknown[][]) => {
  const trimmed = rows.map(row => { const copy = [...row]; while (copy.length && copy.at(-1) === '') copy.pop(); return copy; });
  while (trimmed.length && !trimmed.at(-1)?.length) trimmed.pop();
  return trimmed;
};
let writeAttempted = false;

try {
  if (apply && (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || process.env.GITHUB_WORKFLOW !== 'Sheet Contract 표시 전용')) throw new Error('HOLD: live apply requires formatting-only workflow_dispatch');
  if (apply && process.env.SHEET_FORMAT_EXPECTED_REVISION !== revision) throw new Error('HOLD: code revision mismatch');
  const sa = googleSheetsServiceAccount();
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly'] });
  const api = async (url: string, body?: unknown): Promise<any> => {
    const token = (await jwt.getAccessToken()).token;
    const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`HOLD: Google API ${response.status} (${body ? 'write' : 'read'}); no automatic retry`);
    return response.json();
  };
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
  const read = async () => {
    const driveUrl = `https://www.googleapis.com/drive/v3/files/${id}?fields=id,version,modifiedTime,mimeType`;
    const before = await api(driveUrl);
    const sheet = await api(`${base}?includeGridData=true`);
    const drive = await api(driveUrl);
    if (before.version !== drive.version || before.modifiedTime !== drive.modifiedTime) throw new Error('HOLD: concurrent drift during snapshot');
    if (sheet.spreadsheetId !== id || drive.id !== id || drive.mimeType !== 'application/vnd.google-apps.spreadsheet') throw new Error('HOLD: spreadsheet identity mismatch');
    return { sheet, drive, hash: hash({ sheet, drive }) };
  };
  const before = await read();
  const capturedAt = apply ? String(process.env.SHEET_FORMAT_EXPECTED_TIMESTAMP || '') : new Date().toISOString();
  const age = Date.now() - Date.parse(capturedAt);
  if (!Number.isFinite(age) || age < 0 || age > 90 * 60_000) throw new Error('HOLD: missing/stale reviewed timestamp');
  const referenceAudit = JSON.parse(readFileSync('contracts/sheets/reference-audit.json', 'utf8'));
  const refs = referenceAudit.targets?.[id];
  const bound = referenceAudit.status === 'VERIFIED' && refs?.snapshotHash === before.hash && refs?.contractHash === hash(SHEET_CONTRACT);
  const extraHolds: string[] = [];
  if (before.sheet.namedFunctions?.length) extraHolds.push('HOLD: named functions require dependency review');
  const normalized: SheetContractSnapshot = {
    target, revision, capturedAt, snapshotId: before.hash, preservedState: {},
    coverage: { formulas: true, protections: true, appsScript: bound && refs.appsScript === 'VERIFIED_NO_TITLE_DEPENDENCY', externalConsumers: bound && refs.externalConsumers === 'VERIFIED_NO_TITLE_DEPENDENCY' },
    tabs: [],
  };
  // Scan all tabs including hidden/user tabs; INDIRECT/IMPORTRANGE and ordinary references fail closed.
  for (const sheet of before.sheet.sheets || []) {
    if ((sheet.protectedRanges || []).length) extraHolds.push(`HOLD: protected range requires conflict review ${sheet.properties.sheetId}`);
    if (JSON.stringify(sheet.filterViews || []).includes('CUSTOM_FORMULA') || JSON.stringify(sheet.basicFilter || {}).includes('CUSTOM_FORMULA')) extraHolds.push(`HOLD: filter formula requires dependency review ${sheet.properties.sheetId}`);
    if (JSON.stringify(sheet.conditionalFormats || []).includes('CUSTOM_FORMULA')) extraHolds.push(`HOLD: conditional formula requires dependency review ${sheet.properties.sheetId}`);
    for (const grid of sheet.data || []) for (const row of grid.rowData || []) for (const cell of row.values || []) {
      if (cell.userEnteredValue?.formulaValue) extraHolds.push(`HOLD: formula requires dependency review on sheetId ${sheet.properties.sheetId}`);
      if (cell.dataValidation?.condition?.type === 'CUSTOM_FORMULA') extraHolds.push(`HOLD: validation formula requires dependency review ${sheet.properties.sheetId}`);
    }
    const p = sheet.properties;
    if (p.hidden) continue;
    if (p.sheetType !== 'GRID' || sheet.data?.length !== 1) { extraHolds.push(`HOLD: unsupported grid ${p.sheetId}`); continue; }
    const grid = sheet.data[0];
    if ((grid.startRow || 0) !== 0 || (grid.startColumn || 0) !== 0) { extraHolds.push(`HOLD: partial grid ${p.sheetId}`); continue; }
    const valueOf = (c: any) => c.userEnteredValue?.formulaValue ?? c.userEnteredValue?.stringValue ?? c.userEnteredValue?.numberValue ?? c.userEnteredValue?.boolValue ?? '';
    const rows = trimGrid((grid.rowData || []).map((row: any) => (row.values || []).map(valueOf)));
    const headers = (rows[0] || []).map(String);
    if (!headers.includes('차량번호')) { extraHolds.push(`HOLD: unexpected visible user tab ${p.sheetId}`); continue; }
    const fixed = SALES_PUBLISHED_TAB_PREFIXES.some(k => salesTabMatches(p.title, k));
    const oldCompany = /^([\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*?) (?:· )?\d+대$/u.exec(p.title)?.[1];
    normalized.tabs.push({ sheetId: p.sheetId, index: p.index, title: p.title, headers, rows: rows.slice(1),
      widths: (grid.columnMetadata || []).map((c: any) => c.pixelSize), companyDisplayName: fixed ? undefined : oldCompany });
  }
  normalized.coverage.formulas = !extraHolds.some(h => /formula|unsupported grid|partial grid/.test(h));
  normalized.coverage.protections = !extraHolds.some(h => /protected/.test(h));
  const plan = planSheetContract(normalized);
  const holds = [...plan.holds, ...new Set(extraHolds)];
  if (apply && before.hash !== process.env.SHEET_FORMAT_EXPECTED_HASH) holds.push('HOLD: expected snapshot hash mismatch');
  const rollback: any[] = [];
  for (const change of plan.diff) {
    const sheet = before.sheet.sheets.find((s: any) => s.properties.sheetId === change.sheetId);
    rollback.push({ updateSheetProperties: { properties: { sheetId: change.sheetId, title: change.before }, fields: 'title' } });
    for (const col of change.columns) {
      if (col.before != null) rollback.push({ updateDimensionProperties: { range: { sheetId: change.sheetId, dimension: 'COLUMNS', startIndex: col.index, endIndex: col.index + 1 }, properties: { pixelSize: col.before }, fields: 'pixelSize' } });
      // Restore wrapping exactly, including originally unset fields. No value/formula is included.
      const rowData = sheet.data[0].rowData || [];
      const endRow = normalized.tabs.find(t => t.sheetId === change.sheetId)!.rows.length + 1;
      for (let r = 0; r < endRow; r++) {
        const wrap = rowData[r]?.values?.[col.index]?.userEnteredFormat?.wrapStrategy;
        rollback.push({ repeatCell: { range: { sheetId: change.sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: col.index, endColumnIndex: col.index + 1 }, cell: { userEnteredFormat: wrap ? { wrapStrategy: wrap } : {} }, fields: 'userEnteredFormat.wrapStrategy' } });
      }
    }
  }
  save('plan', { status: holds.length ? 'HOLD' : 'READY_FOR_REVIEW', snapshotHash: before.hash, driveRevision: before.drive.version, modifiedTime: before.drive.modifiedTime, ...plan.manifest, diff: plan.diff, holds, requests: holds.length ? [] : plan.proposedRequests });
  save('rollback', { status: 'REQUIRES_SEPARATE_APPROVAL_AND_CURRENT_POSTSTATE_HASH', requests: rollback });
  if (holds.length) throw new Error(holds.join('; '));
  if (!apply) { save('receipt', { status: 'DRY_RUN', writes: 0, revision, snapshotHash: before.hash }); process.exit(0); }
  const immediatelyBefore = await read();
  if (immediatelyBefore.hash !== before.hash) throw new Error('HOLD: concurrent drift before apply');
  assertProductionSheetWrite(target, 'Sheet Contract formatting-only');
  writeAttempted = true;
  await api(`${base}:batchUpdate`, { requests: plan.proposedRequests }); // Exactly one mutation, no retry.
  const after = await read();
  const stripOwned = (raw: any) => {
    const copy = structuredClone(raw);
    for (const sheet of copy.sheets || []) {
      // Derived CellData may appear when a previously empty cell is formatted.
      // Preserve userEnteredValue/Format, validation, notes, runs and all sheet-level state.
      for (const grid of sheet.data || []) for (const row of grid.rowData || []) for (const cell of row.values || []) {
        delete cell.effectiveFormat; delete cell.effectiveValue; delete cell.formattedValue;
      }
      const change = plan.diff.find(d => d.sheetId === sheet.properties.sheetId);
      if (!change) continue;
      delete sheet.properties.title;
      for (const grid of sheet.data || []) for (const col of change.columns) {
        if (grid.columnMetadata?.[col.index]) delete grid.columnMetadata[col.index].pixelSize;
        const endRow = normalized.tabs.find(t => t.sheetId === change.sheetId)!.rows.length + 1;
        for (const row of (grid.rowData || []).slice(0, endRow)) {
          const cell = row.values?.[col.index];
          if (cell?.userEnteredFormat) delete cell.userEnteredFormat.wrapStrategy;
          if (cell?.effectiveFormat) delete cell.effectiveFormat.wrapStrategy;
        }
      }
    }
    // API omits empty/default objects; canonicalize those after removing the owned fields.
    const clean = (v: any): any => {
      if (Array.isArray(v)) { const a = v.map(clean); while (a.length && (a.at(-1) == null || (typeof a.at(-1) === 'object' && !Object.keys(a.at(-1)).length))) a.pop(); return a; }
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]).filter(([, x]) => x != null && (typeof x !== 'object' || Object.keys(x as object).length)));
      return v;
    };
    return clean(copy);
  };
  const fails: string[] = [];
  if (hash(stripOwned(before.sheet)) !== hash(stripOwned(after.sheet))) fails.push('HOLD: non-owned state changed (values/formulas/order/filter/protection/format)');
  for (const change of plan.diff) {
    const sheet = after.sheet.sheets.find((s: any) => s.properties.sheetId === change.sheetId);
    if (sheet?.properties.title !== change.after) fails.push(`HOLD: title readback ${change.sheetId}`);
    for (const col of change.columns) {
      if (sheet?.data?.[0]?.columnMetadata?.[col.index]?.pixelSize !== col.after) fails.push(`HOLD: width readback ${change.sheetId}:${col.index}`);
      const endRow = normalized.tabs.find(t => t.sheetId === change.sheetId)!.rows.length + 1;
      for (let row = 0; row < endRow; row++) {
        if (sheet?.data?.[0]?.rowData?.[row]?.values?.[col.index]?.userEnteredFormat?.wrapStrategy !== 'CLIP') fails.push(`HOLD: wrap readback ${change.sheetId}:${col.index}:${row}`);
      }
    }
  }
  normalized.preservedState = hash(stripOwned(before.sheet));
  const afterNormalized: SheetContractSnapshot = { ...normalized, preservedState: hash(stripOwned(after.sheet)), tabs: normalized.tabs.map(old => {
    const sheet = after.sheet.sheets.find((s: any) => s.properties.sheetId === old.sheetId);
    const grid = sheet?.data?.[0];
    const rows = trimGrid((grid?.rowData || []).map((r: any) => (r.values || []).map((c: any) => c.userEnteredValue?.formulaValue ?? c.userEnteredValue?.stringValue ?? c.userEnteredValue?.numberValue ?? c.userEnteredValue?.boolValue ?? '')));
    // Formatting creates empty trailing CellData; compare semantic values without trailing empties.
    return { ...old, title: sheet?.properties.title, index: sheet?.properties.index, headers: (rows[0] || []).map(String), rows: rows.slice(1), widths: (grid?.columnMetadata || []).map((c: any) => c.pixelSize) };
  }) };
  fails.push(...auditSheetContractReadback(normalized, afterNormalized));
  save('receipt', { status: fails.length ? 'HOLD_AFTER_WRITE' : 'READBACK_PASS', revision, capturedAt, beforeHash: before.hash, afterHash: after.hash, diff: plan.diff, fails, writes: 1 });
  save('rollback', { status: 'REQUIRES_SEPARATE_APPROVAL', expectedCurrentSnapshotHash: after.hash, requests: rollback });
  if (fails.length) throw new Error(fails.join('; '));
} catch (error) {
  save('failure', { status: writeAttempted ? 'HOLD_WRITE_ATTEMPTED_DO_NOT_RETRY' : 'HOLD', revision, target, timestamp: new Date().toISOString(), writeAttempted, reason: (error as Error).message });
  console.error((error as Error).message);
  process.exitCode = 1;
}
