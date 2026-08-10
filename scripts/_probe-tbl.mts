import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const t = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const r = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA?fields=sheets(tables)`, { headers: { Authorization: `Bearer ${t}` } })).json();
const tbl = r.sheets?.[0]?.tables?.[0];
console.log('표 id:', tbl?.tableId, '| 이름:', tbl?.name);
for (const c of tbl?.columnProperties || []) {
  const v = (c.dataValidationRule?.condition?.values || []).map((x: any) => x.userEnteredValue);
  if (v.length) console.log(`  ${String(c.columnName).padEnd(10)} ${c.columnType || ''} ${v.length}개  ${v.join(' · ').slice(0, 90)}`);
}
