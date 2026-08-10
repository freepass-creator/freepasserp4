import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const t = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
for (const [nm, id] of [['손오공','1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA'],['퍼시픽','11j_HKRHQzyGPr7a6Snnm2wgXzRgBTC8g0_UjSTJWqHQ'],['센트로','108K5cWzDa_BBR-LNFxfvbdMc7y5_dzrngzAswuUFRCc']]) {
  const r = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?ranges=${encodeURIComponent('재고!B2')}&fields=sheets(data(rowData(values(dataValidation))),tables)`, { headers: { Authorization: `Bearer ${t}` } })).json();
  const dv = r.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.dataValidation;
  const vals = (dv?.condition?.values || []).map((v: any) => v.userEnteredValue);
  console.log(`${nm}: 상태 드롭다운 ${vals.length}개 [${vals.join(' · ')}] · 표 ${r.sheets?.[0]?.tables?.length || 0}개`);
}
