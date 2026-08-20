/** 상품마스터 원본을 건드리지 않고 차종 변환·상태만 보여 주는 내부 조회 탭. */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  DEFAULT_PRODUCT_MASTER_SHEET_ID,
  PRODUCT_MASTER_COLUMNS,
  PRODUCT_MASTER_TAB,
} from '../lib/domain/product-master-sheet';

type Rec = Record<string, unknown>;
const APPLY = process.argv.includes('--apply');
const REFRESH = process.argv.includes('--refresh');
const VIEW_TAB = '상품 차종매칭';
const VIEW_SHEET_ID = 1357902468;
const headers = [
  '확인', '차량번호', '공급사', '공급사 제공 차량정보', '차종마스터 변환값',
  '매칭상태', '상품 운영상태', '차량상태', '변경·검수 내용', '차종코드', '상품마스터 최종갱신',
];
const sourceHeaders = [
  '차량번호', '공급사명', '공급사 입력 차명', '차종마스터 적용값', '검증상태',
  '관리상태', '차량상태', '검수사유', '차종코드', '최종갱신',
];
const sourceColumns = ['A', 'B', 'C', 'D', 'E', 'J', 'H', 'F', 'AT', 'AV'];
const columnIndex = (label: string) => [...label].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;

const credentials = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8')) as Rec;
const token = (await new JWT({
  email: String(credentials.client_email),
  key: String(credentials.private_key),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  subject: process.env.GOOGLE_WORKSPACE_SUBJECT || 'pyh@teamjpk.com',
}).getAccessToken()).token;
if (!token) throw new Error('Sheets 토큰을 얻지 못했습니다.');
const base = `https://sheets.googleapis.com/v4/spreadsheets/${DEFAULT_PRODUCT_MASTER_SHEET_ID}`;
async function api(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => ({})) as Rec;
  if (!response.ok) throw new Error(`Sheets ${response.status}: ${JSON.stringify(body).slice(0, 800)}`);
  return body;
}

const meta = await api(`${base}?includeGridData=false&fields=sheets(properties(sheetId,title))`) as {
  sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
};
const existingView = (meta.sheets || []).find((sheet) => sheet.properties?.title === VIEW_TAB);
if (existingView && !REFRESH) {
  throw new Error(`${VIEW_TAB} 탭이 이미 존재합니다. 기존 탭을 자동 덮어쓰지 않습니다.`);
}
if (!existingView && (meta.sheets || []).some((sheet) => sheet.properties?.sheetId === VIEW_SHEET_ID)) {
  throw new Error(`예정 sheetId ${VIEW_SHEET_ID}가 이미 사용 중입니다.`);
}
const source = await api(`${base}/values/${encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A1:AZ`)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`) as { values?: unknown[][] };
const sourceRows = source.values || [];
const liveHeaders = (sourceRows[0] || []).map((value) => String(value ?? '').trim());
if (PRODUCT_MASTER_COLUMNS.some((header, index) => liveHeaders[index] !== header)) {
  throw new Error('상품마스터 A:AZ 헤더가 코드 정본과 다릅니다.');
}
if (sourceColumns.some((column, index) => liveHeaders[columnIndex(column)] !== sourceHeaders[index])) {
  throw new Error('조회 탭 원본 열 매핑이 실제 헤더와 다릅니다.');
}
const sourceCount = sourceRows.slice(1).filter((row) => String(row[0] ?? '').trim()).length;
const selected = sourceColumns.map((column) => column === 'D'
  // 연식·출시기간은 매칭 경계용 내부 원자다. 사람이 보는 변환값에는
  // 모델·세대·동력계·트림만 남기고 선두 MY 표기를 노출하지 않는다.
  ? `REGEXREPLACE('${PRODUCT_MASTER_TAB}'!D2:D,"^20[0-9]{2}([ ]*~[ ]*20[0-9]{2})?[ ]+","")`
  : `'${PRODUCT_MASTER_TAB}'!${column}2:${column}`).join(',');
const formula = `=ARRAYFORMULA(FILTER({IF((('${PRODUCT_MASTER_TAB}'!E2:E<>"확정")+('${PRODUCT_MASTER_TAB}'!J2:J<>"운영"))>0,"확인 필요","정상"),${selected}},'${PRODUCT_MASTER_TAB}'!A2:A<>""))`;
const plan = { mode: APPLY ? 'apply' : 'dry_run', source: `${PRODUCT_MASTER_TAB}!A:AZ`, sourceCount, viewTab: VIEW_TAB, columns: headers };
if (!APPLY) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

const dark = { red: 0.0902, green: 0.1451, blue: 0.3294 };
if (REFRESH) {
  if (existingView?.properties?.sheetId !== VIEW_SHEET_ID) throw new Error('기존 조회 탭 sheetId가 정본과 다릅니다.');
  await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{
    updateCells: {
      range: { sheetId: VIEW_SHEET_ID, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 },
      rows: [{ values: [{ userEnteredValue: { formulaValue: formula } }] }], fields: 'userEnteredValue',
    },
  }] }) });
  const refreshed = await api(`${base}/values/${encodeURIComponent(`'${VIEW_TAB}'!A1:K1000`)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`) as { values?: unknown[][] };
  const refreshedRows = (refreshed.values || []).slice(1);
  const leadingYear = refreshedRows.filter((row) => /^20\d{2}(?:\s*~\s*20\d{2})?\s+/.test(String(row[4] ?? ''))).length;
  if (refreshedRows.length !== sourceCount || leadingYear) throw new Error(`조회 탭 갱신 검증 실패: ${refreshedRows.length}/${sourceCount}, year=${leadingYear}`);
  console.log(JSON.stringify({ ...plan, mode: 'refreshed_verified', resultCount: refreshedRows.length, leadingYear }, null, 2));
  process.exit(0);
}
const requests: Rec[] = [
  { addSheet: { properties: { sheetId: VIEW_SHEET_ID, title: VIEW_TAB, gridProperties: { rowCount: 1000, columnCount: 11, frozenRowCount: 1, frozenColumnCount: 2, hideGridlines: true } } } },
  { updateCells: { range: { sheetId: VIEW_SHEET_ID, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 }, rows: [{ values: headers.map((value) => ({ userEnteredValue: { stringValue: value }, note: value === '상품마스터 최종갱신' ? '상품마스터 행의 마지막 갱신값' : undefined })) }], fields: 'userEnteredValue,note' } },
  { updateCells: { range: { sheetId: VIEW_SHEET_ID, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 }, rows: [{ values: [{ userEnteredValue: { formulaValue: formula } }] }], fields: 'userEnteredValue' } },
  { repeatCell: { range: { sheetId: VIEW_SHEET_ID, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 }, cell: { userEnteredFormat: { backgroundColor: dark, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 10 } } }, fields: 'userEnteredFormat' } },
  { repeatCell: { range: { sheetId: VIEW_SHEET_ID, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 11 }, cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP', textFormat: { fontFamily: 'Roboto', fontSize: 9 } } }, fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat)' } },
  { updateDimensionProperties: { range: { sheetId: VIEW_SHEET_ID, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } },
  ...[90, 105, 130, 390, 390, 95, 110, 110, 260, 220, 125].map((pixelSize, index) => ({ updateDimensionProperties: { range: { sheetId: VIEW_SHEET_ID, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 }, properties: { pixelSize }, fields: 'pixelSize' } })),
  { addConditionalFormatRule: { index: 0, rule: { ranges: [{ sheetId: VIEW_SHEET_ID, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 1 }], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '확인 필요' }] }, format: { textFormat: { foregroundColor: { red: 0.725, green: 0.11, blue: 0.11 }, bold: true } } } } } },
  { addConditionalFormatRule: { index: 1, rule: { ranges: [{ sheetId: VIEW_SHEET_ID, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 1 }], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '정상' }] }, format: { textFormat: { foregroundColor: { red: 0.086, green: 0.396, blue: 0.204 }, bold: true } } } } } },
];
if (requests.some((request) => Object.keys(request).length !== 1)) throw new Error('batch request shape 오류');
await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
const after = await api(`${base}/values/${encodeURIComponent(`'${VIEW_TAB}'!A1:K1000`)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`) as { values?: unknown[][] };
const values = after.values || [];
const resultCount = values.slice(1).filter((row) => String(row[1] ?? '').trim()).length;
if (JSON.stringify((values[0] || []).slice(0, 11)) !== JSON.stringify(headers)) throw new Error('생성 후 헤더 검증 실패');
if (resultCount !== sourceCount) throw new Error(`생성 후 행수 불일치: ${resultCount}/${sourceCount}`);
if (values.slice(1).some((row) => row.length > 11)) throw new Error('생성 후 출력 열수 초과');
console.log(JSON.stringify({ ...plan, mode: 'applied_verified', resultCount, sheetId: VIEW_SHEET_ID }, null, 2));
