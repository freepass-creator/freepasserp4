import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { MASTER_SHEET_ID } from '../lib/domain/vehicle-master-sheet';

const target = '기아_규격검토';
const credentials = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
const token = (await new JWT({
  email: String(credentials.client_email || ''),
  key: String(credentials.private_key || ''),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  subject: process.env.GOOGLE_WORKSPACE_SUBJECT || 'pyh@teamjpk.com',
}).getAccessToken()).token;
if (!token) throw new Error('Sheets token missing');
const base = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}`;
const metadataResponse = await fetch(`${base}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${token}` } });
const metadata = await metadataResponse.json();
if (!metadataResponse.ok) throw new Error(JSON.stringify(metadata));
const sheet = (metadata.sheets || []).find((item: any) => String(item.properties?.title || '') === target);
if (!sheet) {
  console.log(JSON.stringify({ mode: 'no_op', target }));
  process.exit(0);
}
const sheetId = sheet.properties.sheetId;
if (!Number.isInteger(sheetId)) throw new Error('Invalid target sheet id');
const deleteResponse = await fetch(`${base}:batchUpdate`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ requests: [{ deleteSheet: { sheetId } }] }),
});
const deleted = await deleteResponse.json();
if (!deleteResponse.ok) throw new Error(JSON.stringify(deleted));
const verifyResponse = await fetch(`${base}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${token}` } });
const verify = await verifyResponse.json();
if (!verifyResponse.ok) throw new Error(JSON.stringify(verify));
if ((verify.sheets || []).some((item: any) => String(item.properties?.title || '') === target)) throw new Error('Delete verification failed');
console.log(JSON.stringify({ mode: 'deleted_verified', target, sheetId }));
