/**
 * **공급사 「차종마스터」 탭을 엔카 차종마스터 파일에 연동한다.** IMPORTRANGE 한 칸. 값을 복사하지 않는다.
 *
 *   정본 파일 = ENCAR_MASTER_SHEET_ID. 원본이 바뀌면 공급사 탭도 같이 바뀐다.
 *   첫 연동 때 시트에서 「액세스 허용」이 한 번 필요할 수 있다(pyh@teamjpk.com).
 * ⚠ 라이브 원천대장 「차종마스터」(mf-) 는 읽지도 쓰지도 않는다.
 *
 *   npx tsx scripts/publish-vehicle-master-tab.mts
 *   npx tsx scripts/publish-vehicle-master-tab.mts --who=손오공
 *   npx tsx scripts/publish-vehicle-master-tab.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { assertNotLiveVehicleMasterWrite } from '../lib/domain/legacy-sheets';
import { ENCAR_MASTER_IMPORT_FORMULA, ENCAR_MASTER_SHEET_ID, ENCAR_MASTER_URL } from '../lib/domain/encar-master-sheet';
import { SHEET_NAME_MATCH, VEHICLE_MASTER_COPY_TAB, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { FONT_DEFAULT, SIZE } from '../lib/domain/sales-sheet-format';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const WHO = (process.argv.find((a) => a.startsWith('--who=')) || '').slice(6);
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const TAB = VEHICLE_MASTER_COPY_TAB;
assertNotLiveVehicleMasterWrite(ENCAR_MASTER_SHEET_ID, 'link from');

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
let books = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)), name: S(f.name) }))
  .filter((b) => !/\[구버전[·・]?폐기\]/.test(b.name))
  .sort((a, b) => a.label.localeCompare(b.label));
if (WHO) books = books.filter((b) => b.label.includes(WHO));
console.log(`■ 엔카 차종마스터 연동(IMPORTRANGE) ${APPLY ? '반영' : '미리보기'} — ${books.length}곳`);
console.log(`   원본 ${ENCAR_MASTER_URL}`);
console.log(`   수식 ${ENCAR_MASTER_IMPORT_FORMULA}`);
if (!APPLY) { console.log('※ dry-run — --apply 로 각 시트 「차종마스터」 탭 A1 에 연동 수식을 넣는다(값 복사 없음)'); process.exit(0); }

for (const b of books) {
  assertNotLiveVehicleMasterWrite(b.id, 'link onto');
  const meta = await call(`${SH}/${b.id}?fields=sheets.properties(sheetId,title,index)`);
  const props = ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec);
  let gid = props.find((p) => S(p.title) === TAB)?.sheetId;
  if (gid === undefined) {
    const added = await call(`${SH}/${b.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, gridProperties: { rowCount: 5000, columnCount: 28, frozenRowCount: 1 } } } }] }) });
    gid = added.replies?.[0]?.addSheet?.properties?.sheetId;
  } else {
    await call(`${SH}/${b.id}/values/${encodeURIComponent(`'${TAB}'!A1:AZ5000`)}:clear`, { method: 'POST', body: '{}' });
  }
  await call(`${SH}/${b.id}/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [[ENCAR_MASTER_IMPORT_FORMULA]] }),
  });
  await call(`${SH}/${b.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
    { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.78, green: 0.89, blue: 0.98 }, textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
    { updateSheetProperties: { properties: { sheetId: gid, index: props.length }, fields: 'index' } },
  ] }) });
  console.log(`   ✓ ${b.label.padEnd(10)} 「${TAB}」 연동`);
  await sleep(250);
}
console.log('■ 끝 — 정본은 엔카 차종마스터 파일 하나. 원본이 바뀌면 탭도 따라간다.');
