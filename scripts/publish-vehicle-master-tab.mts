/**
 * **공급사 시트 21곳에 「차종마스터」 탭을 붙인다** — 원천대장 「차종마스터」 원장(A:AE)을 값 그대로 복사. 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-19 — 「공급사시트에 차종마스터 탭을 다 붙여 넣고」.
 *   · 정본은 원천대장 「차종마스터」 한 곳뿐이다. 이 탭은 **사본**(값만)이라 여기서 고쳐도 아무 데도 안 간다 — 고칠 것은 원천대장에.
 *   · 마스터가 바뀌면 이 도구를 다시 돌린다(탭을 통째로 다시 쓴다).
 *   · 「차종마스터」 는 OUR_NON_INVENTORY_TABS 에 등록돼 재고 탭으로 읽히지 않는다.
 *
 *   npx tsx scripts/publish-vehicle-master-tab.mts                # 미리보기
 *   npx tsx scripts/publish-vehicle-master-tab.mts --who=손오공   # 한 곳만
 *   npx tsx scripts/publish-vehicle-master-tab.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { DEFAULT_PRODUCT_MASTER_SHEET_ID } from '../lib/domain/product-master-sheet';
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
const SOURCE_TAB = '차종마스터';
const TAB = VEHICLE_MASTER_COPY_TAB;

// 원장 읽기
const src = await call(`${SH}/${DEFAULT_PRODUCT_MASTER_SHEET_ID}/values/${encodeURIComponent(`'${SOURCE_TAB}'!A1:AE8000`)}`) as { values?: string[][] };
const rows = (src.values || []).map((r) => r.map(S)).filter((r) => r.some(Boolean));
if (rows.length < 100 || rows[0][8] !== '트림행키') throw new Error(`원천대장 「${SOURCE_TAB}」 형태가 다름(줄 ${rows.length}, I1=${rows[0]?.[8]})`);
const width = Math.max(...rows.map((r) => r.length));
const values = rows.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill('')]);
console.log(`■ 원천대장 「${SOURCE_TAB}」 ${values.length}줄 × ${width}열 (헤더 포함)`);

// 공급사 시트 21곳
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
let books = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)), name: S(f.name) })).sort((a, b) => a.label.localeCompare(b.label));
if (WHO) books = books.filter((b) => b.label.includes(WHO));
console.log(`■ 대상 시트 ${books.length}곳: ${books.map((b) => b.label).join(' · ')}`);
if (!APPLY) { console.log('※ dry-run — --apply 로 각 시트에 「' + TAB + '」 탭을 만들고(있으면 통째로 다시 씀) 값 복사'); process.exit(0); }

for (const b of books) {
  const meta = await call(`${SH}/${b.id}?fields=sheets.properties(sheetId,title,index)`);
  const props = ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec);
  let gid = props.find((p) => S(p.title) === TAB)?.sheetId;
  if (gid === undefined) {
    const added = await call(`${SH}/${b.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, gridProperties: { rowCount: values.length + 20, columnCount: width, frozenRowCount: 1 } } } }] }) });
    gid = added.replies?.[0]?.addSheet?.properties?.sheetId;
  } else {
    await call(`${SH}/${b.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ updateSheetProperties: { properties: { sheetId: gid, gridProperties: { rowCount: values.length + 20, columnCount: width, frozenRowCount: 1 } }, fields: 'gridProperties(rowCount,columnCount,frozenRowCount)' } }] }) });
    await call(`${SH}/${b.id}/values/${encodeURIComponent(`'${TAB}'!A1:AZ${values.length + 500}`)}:clear`, { method: 'POST', body: '{}' });
  }
  await call(`${SH}/${b.id}/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values }) });
  const widths = [60, 60, 60, 50, 60, 80, 170, 120, 300, 200, 60, 50, 110, 70, 70, 70, 60, 60, 60, 80, 70, 50, 60, 40, 70, 260, 200, 300, 80, 120, 200];
  await call(`${SH}/${b.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
    { repeatCell: { range: { sheetId: gid }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE }, wrapStrategy: 'CLIP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat(textFormat,wrapStrategy,verticalAlignment)' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.9, blue: 0.99 }, textFormat: { fontFamily: FONT_DEFAULT, fontSize: SIZE, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
    ...widths.slice(0, width).map((px, i) => ({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })),
    { setBasicFilter: { filter: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: values.length, startColumnIndex: 0, endColumnIndex: width } } } },
    { updateSheetProperties: { properties: { sheetId: gid, index: props.length }, fields: 'index' } },
  ] }) });
  console.log(`   ✓ ${b.label.padEnd(10)} 「${TAB}」 ${values.length}줄 (gid ${gid})`);
  await sleep(400);
}
console.log('■ 끝 — 정본은 원천대장 「차종마스터」. 마스터가 바뀌면 이 도구를 다시 돌린다.');
