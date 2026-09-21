import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { collectPresentation } from '../vendor/freepass-data/scripts/sheet-presentation-online.mjs';
import { planPresentation, specification } from '../vendor/freepass-data/scripts/sheet-presentation.mjs';
import { f86MarkEpochMs } from '../lib/server/f86-audit-checks';

// Deliberately read-only, even with a credential that can write. No source/DB imports.
const path = process.env.GOOGLE_SHEETS_APPLICATION_CREDENTIALS;
if (!path) throw new Error('Sheets credential path required');
const sa = JSON.parse(readFileSync(path, 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
async function api(url: string, options: { method: string }) {
  if (options.method !== 'GET' || !url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/')) throw new Error('Read-only API boundary');
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = (await jwt.getAccessToken()).token;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) return response.json();
    if ((response.status === 429 || response.status >= 500) && attempt < 4) { await new Promise(resolve => setTimeout(resolve, 15000)); continue; }
    throw new Error(`Sheets GET failed HTTP ${response.status}`);
  }
  throw new Error('Sheets read exhausted');
}
for (const workbook of ['F01', 'F86'] as const) {
  const input = await collectPresentation(api, workbook);
  const catalog = input.spreadsheet.sheets.find((s: any) => s.properties.sheetId === specification.workbooks[workbook].primarySheetIds[0]);
  const matched = /^(\d{2}\.\d{2} \d{2}:\d{2}) 상품리스트 /.exec(catalog?.properties.title || '');
  const epoch = matched && f86MarkEpochMs(matched[1], Date.now());
  if (!epoch) throw new Error(`HOLD: ${workbook} catalog timestamp not in current format`);
  const result = planPresentation(input, { workbook, updatedAt: new Date(epoch).toISOString() });
  console.log(JSON.stringify({ workbook, status: result.status, counts: result.counts, changes: result.changes, scope: result.scope }));
  if (result.status !== 'PASS') process.exitCode = 1;
}
