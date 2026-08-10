import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { HANDLED_MAKER_OPTIONS } from '../lib/domain/handled-makers';
import { TEMPLATE_COLUMNS, buildTableUpdateRequest, yearOptions } from '../lib/domain/supplier-template-sheet';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const t = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const ID = '11j_HKRHQzyGPr7a6Snnm2wgXzRgBTC8g0_UjSTJWqHQ';   // 퍼시픽
const api = `https://sheets.googleapis.com/v4/spreadsheets/${ID}`;
const h = { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' };
const meta = await (await fetch(`${api}?fields=sheets(tables(tableId,name,range))`, { headers: h })).json();
const tbl = meta.sheets?.[0]?.tables?.[0];
console.log('표:', JSON.stringify(tbl));
const extras = { 제조사: [...HANDLED_MAKER_OPTIONS], 연식: yearOptions(2026) };
const req = buildTableUpdateRequest(tbl.tableId, TEMPLATE_COLUMNS, extras, 300);
const res = await fetch(`${api}:batchUpdate`, { method: 'POST', headers: h, body: JSON.stringify({ requests: [req] }) });
console.log(res.status, (await res.text()).slice(0, 700));
