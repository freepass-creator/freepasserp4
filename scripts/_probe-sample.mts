import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const t = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const ID = '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA';
const api = `https://sheets.googleapis.com/v4/spreadsheets/${ID}`;
const meta = await (await fetch(`${api}?fields=properties.title,sheets(properties(title,sheetId,gridProperties))`, { headers: { Authorization: `Bearer ${t}` } })).json();
console.log('제목:', meta.properties?.title);
for (const s of meta.sheets || []) console.log(`  탭 ${s.properties.title} (gid ${s.properties.sheetId})`);
const first = meta.sheets?.[0]?.properties?.title;
const v = await (await fetch(`${api}/values/${encodeURIComponent(first)}!A1:BZ4`, { headers: { Authorization: `Bearer ${t}` } })).json();
for (const [i, row] of (v.values || []).entries()) console.log(`행${i + 1}: ${(row as string[]).join(' | ')}`);
