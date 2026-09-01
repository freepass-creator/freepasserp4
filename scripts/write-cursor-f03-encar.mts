/**
 * tmp/f03-vs-encar.json → 「커서 엔카대조」만. 이름·지식·클로드 안 씀.
 *
 *   npx tsx scripts/write-cursor-f03-encar.mts
 *   npx tsx scripts/write-cursor-f03-encar.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  ENCAR_MASTER_SHEET_ID,
  ENCAR_MASTER_TAB,
  ENCAR_NAME_COLUMNS,
  loadEncarWorkSheetGrids,
} from '../lib/domain/encar-master-sheet';
import { assertNotLiveVehicleMasterWrite } from '../lib/domain/legacy-sheets';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const SRC = 'tmp/f03-vs-encar.json';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const api = async (url: string, init?: RequestInit) => {
  const tok = (await jwt.getAccessToken()).token;
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await res.json() as Record<string, any>;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};
assertNotLiveVehicleMasterWrite(ENCAR_MASTER_SHEET_ID, 'cursor encar review');
const payload = JSON.parse(readFileSync(SRC, 'utf8')) as {
  tally?: Record<string, number>; liveOk?: number; fails?: string[];
  opinions: { sheetRow: number; 커서: string }[];
};
const colA1 = (i: number) => {
  let t = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); }
  return t;
};
const grids = await loadEncarWorkSheetGrids(api);
const hdr = (grids.names[0] || []).map(S);
if (hdr.slice(0, 7).join('|') !== ENCAR_NAME_COLUMNS.join('|')) throw new Error(hdr.join('|'));
const whoAt = hdr.indexOf('커서 엔카대조');
if (whoAt < 7) throw new Error(`커서 엔카대조 칸 없음: ${hdr.join(' | ')}`);
const tally = payload.tally || {};
console.log(`■ 커서 엔카대조 ${APPLY ? '반영' : '미리보기'} · ${payload.opinions.length}행 · liveOk ${payload.liveOk}`);
Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));
if (payload.fails?.length) console.log(`  실패 ${payload.fails.length}: ${payload.fails.slice(0, 5).join(' · ')}`);
if (!APPLY) {
  console.log('※ dry-run. 반영은 --apply');
  process.exit(0);
}
const SH = `https://sheets.googleapis.com/v4/spreadsheets/${ENCAR_MASTER_SHEET_ID}`;
const data = payload.opinions.map((o) => ({
  range: `'${ENCAR_MASTER_TAB}'!${colA1(whoAt)}${o.sheetRow}`,
  values: [[o.커서]],
}));
for (let i = 0; i < data.length; i += 400) {
  await api(`${SH}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data: data.slice(i, i + 400) }),
  });
  console.log(`  씀 ${Math.min(i + 400, data.length)}/${data.length}`);
}
console.log(`반영 커서 엔카대조 ${data.length}행`);
