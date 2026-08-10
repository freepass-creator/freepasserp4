import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
const S = (v: unknown) => String(v ?? '').trim();
const ID = process.env.SID || '1V4dqn5e8dtTLjX_wnHx5wOup0arU3TAtsvEvuh0sisY';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.readonly'] });
const token = (await jwt.getAccessToken()).token;
const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ID}?fields=properties.title,sheets.properties&access_token=${token}`)).json();
if (meta.error) { console.log('✗', meta.error.message); process.exit(1); }
console.log(`■ 「${meta.properties.title}」 탭 ${meta.sheets.length}장`);
for (const s of meta.sheets) console.log(`   gid=${String(s.properties.sheetId).padEnd(12)} ${s.properties.title}  (${s.properties.gridProperties?.rowCount}행)`);
const first = meta.sheets[0].properties.title;
const r = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ID}/values/${encodeURIComponent(`'${first}'!A1:AZ6`)}?access_token=${token}`)).json();
const v: string[][] = r.values || [];
console.log(`\n■ 「${first}」 앞 6행`);
v.forEach((row, i) => console.log(`  ${i + 1}행: ${(row || []).slice(0, 16).map(c => S(c).slice(0, 14)).join(' | ')}`));
const d = await (await fetch(`https://www.googleapis.com/drive/v3/files/${ID}?fields=owners(emailAddress),modifiedTime&supportsAllDrives=true&access_token=${token}`)).json();
if (!d.error) console.log(`\n소유자 ${(d.owners||[]).map((o:any)=>o.emailAddress).join(', ')} · 마지막수정 ${S(d.modifiedTime).replace('T',' ').slice(0,16)}`);
