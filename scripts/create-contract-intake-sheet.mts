/**
 * **팀장이 보는 「프리패스 당월 계약접수」를 규격대로 다시 그린다.** 기본 미리보기, 반영은 `--apply`.
 *
 * ★사장님 2026-08-25 「지수가 어떤 탭을 입력하면 심플해지는거지」 → **팀장은 이 탭 하나만 본다.**
 *   ① 계약금이 들어오면 열 칸  ② 차가 인도되면 인도일  ③ 나중에 일이 생기면 상태.
 *   그 뒤로는 아무것도 안 한다. 나머지 여섯 칸은 기계가 채운다.
 *
 * ★**왜 칸이 늘었나** — 「계약서를 우리가 다 하는 건 아니어서 · 기간 대여료 보증금까지는 채워야 하네」.
 *   수수료가 **계약기간 × 렌탈료**(또는 차량가액)로 계산된다. 그 셋이 없으면 청구를 못 만든다.
 *   **렌탈료는 사람이 넣는다** — 업셀링·협상으로 재고 시트 값과 달라진다.
 *   재고 값을 자동으로 넣으면 계약서와 다른 금액으로 정산하게 된다.
 *
 * ★**드롭다운은 「상태」 하나뿐이다**(「상태만 드롭다운이고」).
 *   영업채널은 48가지고 계속 새로 생긴다 — 목록을 만들면 없는 이름마다 경고가 뜬다.
 * ★**상태는 비어 있으면 계약중**이다. 나중에 생기는 사건만 고른다(환수·취소·연장).
 *
 * ★서식이 곧 규격이다 — 차번·연락처는 글자(TEXT), 날짜는 날짜, 돈은 #,##0.
 *   서식을 안 주면 연락처 앞의 0 이 날아가고 날짜가 45,894 로 보인다(실측 2026-08-25).
 * ★값 줄은 안 건드린다 — 머리글·서식만 다시 그린다. 팀장이 적어 둔 것을 지우지 않는다.
 *
 *   npx tsx scripts/create-contract-intake-sheet.mts
 *   npx tsx scripts/create-contract-intake-sheet.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  INTAKE_SHEET_NAME, INTAKE_TAB, INTAKE_COLUMNS, INTAKE_STAFF_COLUMNS,
  INTAKE_STATES, SETTLEMENT_LEDGER_ID,
} from '../lib/domain/settlement-ledger';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const colA1 = (i: number) => { let s = ''; for (let n = i + 1; n > 0;) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const a1 = (t: string) => `'${t.replace(/'/g, "''")}'`;
const ROWS = 300;

type Spec = { width: number; fmt?: Record<string, string>; align?: string; note: string };
/** 칸마다 폭·서식·안내를 한 표로. 흩어 놓으면 하나만 고치고 나머지를 잊는다. */
const COL: Record<string, Spec> = {
  차량번호: { width: 110, fmt: { type: 'TEXT' }, align: 'CENTER', note: '계약금이 들어온 차의 번호. 이걸 적으면 모델명·공급사가 저절로 뜹니다' },
  고객명: { width: 90, align: 'CENTER', note: '계약자 이름' },
  고객연락처: { width: 120, fmt: { type: 'TEXT' }, align: 'CENTER', note: '010-0000-0000. ★글자로 넣습니다 — 숫자로 넣으면 앞의 0이 날아갑니다' },
  영업채널: { width: 120, note: '어디로 나갔나 — 직영이면 「직영」, 제휴면 그 회사 이름. 그냥 적으시면 됩니다' },
  영업담당자: { width: 100, align: 'CENTER', note: '누가 영업했나 — 사람 이름' },
  상품분류: { width: 110, align: 'CENTER', note: '신차렌트 · 중고렌트 · 중고구독 **셋 중 하나**. 수수료가 이걸로 정해집니다' },
  계약기간: { width: 90, fmt: { type: 'NUMBER', pattern: '0"개월"' }, align: 'CENTER', note: '24 · 36 · 48 · 60. ★수수료가 이 값으로 계산됩니다' },
  보증금: { width: 110, fmt: { type: 'NUMBER', pattern: '#,##0' }, note: '계약 보증금' },
  분납여부: { width: 100, align: 'CENTER', note: '일시납 · 2회분납 · 3회분납. ★보증금 분납입니다 — 회차만큼 개월이 지나야 끝납니다' },
  렌탈료: { width: 110, fmt: { type: 'NUMBER', pattern: '#,##0' }, note: '월 대여료. ★계약서에 적힌 **실제** 값 — 재고 시트 값과 다를 수 있습니다' },
  인도완료: { width: 90, align: 'CENTER', note: '차가 나가면 **체크만** 하세요. 체크한 날이 인도일로 박힙니다 — 실제 인도일이 다르면 옆 「인도일」 칸을 고쳐 주세요' },
  인도일: { width: 110, fmt: { type: 'DATE', pattern: 'yyyy-mm-dd' }, align: 'CENTER', note: '체크하면 기계가 박습니다. **실제 인도일이 다를 때만** 손으로 고치세요 — 적힌 값이 이깁니다' },
  상태: { width: 130, align: 'CENTER', note: '**비워 두면 계약중**입니다. 나중에 일이 생겼을 때만 고릅니다 — 환수 · 계약 불가(취소) · 연장' },
  모델명: { width: 150, note: '기계가 채웁니다 — 손대지 마세요' },
  공급사: { width: 110, note: '기계가 채웁니다 — 손대지 마세요' },
  접수일: { width: 110, fmt: { type: 'DATE', pattern: 'yyyy-mm-dd' }, align: 'CENTER', note: '차번을 **처음 적은 날**. 한 번 박히면 안 바뀝니다 — 그 달 실적이 여기서 나옵니다' },
  청구월: { width: 90, fmt: { type: 'DATE', pattern: 'yyyy-mm' }, align: 'CENTER', note: '인도일이 정합니다. 접수월과 다를 수 있습니다 — 8월에 접수해도 인도가 9월이면 9월 청구입니다' },
  분납만료: { width: 110, fmt: { type: 'DATE', pattern: 'yyyy-mm-dd' }, align: 'CENTER', note: '인도일 + 회차개월. 이 날까지 환수가 없으면 끝난 겁니다' },
  확인: { width: 300, note: '기계가 짚어 주는 자리. **비어 있으면 괜찮다는 뜻**입니다. 글이 있으면 그 줄을 봐 주세요 — 고치면 저절로 사라집니다' },
};

const GUIDE: [string, string][] = [
  ['이 시트는', '프리패스 당월 계약접수 — 계약된 차를 알려 주는 곳'],
  ['넣는 사람', '강지수 팀장'],
  ['', ''],
  ['── 언제 무엇을 넣나', ''],
  ['① 계약금이 들어오면', '차량번호 · 고객명 · 고객연락처 · 영업채널 · 영업담당자 · 상품분류 · 계약기간 · 보증금 · 분납여부 · 렌탈료 (열 칸)'],
  ['② 차가 인도되면', '「인도완료」에 **체크만** 하세요. 날짜는 기계가 박습니다'],
  ['   인도일이 다르면', '옆 「인도일」 칸을 고쳐 주세요 — 적힌 값이 이깁니다. ★월말 인도를 다음 달에 체크하면 청구월이 밀립니다'],
  ['③ 나중에 일이 생기면', '「상태」에서 고릅니다 — 환수 · 계약 불가(취소) · 연장. **평소엔 비워 둡니다**'],
  ['', ''],
  ['── 기계가 채우는 것', ''],
  ['모델명 · 공급사', '차번을 적으면 저절로 뜹니다. **안 뜨면 차번이 틀렸거나 우리 재고에 없는 차입니다**'],
  ['접수일', '차번을 **처음 적은 날**이 박히고 안 바뀝니다 — 그 달 실적이 여기서 나옵니다'],
  ['청구월', '인도일이 정합니다. 8월에 접수해도 인도가 9월이면 9월 청구입니다'],
  ['분납만료', '인도일 + 회차개월. 이 날까지 환수가 없으면 끝난 겁니다'],
  ['', ''],
  ['── 왜 이 칸들이 필요한가', ''],
  ['상품분류 · 계약기간 · 렌탈료', '수수료가 이 셋으로 계산됩니다. 비면 청구를 못 만듭니다'],
  ['렌탈료', '★계약서에 적힌 **실제** 값. 재고 시트 값과 다를 수 있습니다(업셀링·협상)'],
  ['', ''],
  ['── 색이 뜻하는 것', ''],
  ['연노랑', '팀장님이 적는 자리'],
  ['회색', '기계가 채우는 자리 — 손대지 마세요'],
  ['주황(확인)', '**비어 있으면 괜찮다는 뜻**입니다. 글이 있으면 그 줄만 봐 주세요'],
  ['빨간 차번', '위에 이미 적힌 차번입니다 — 같은 차를 두 번 올린 것이니 지워 주세요'],
];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string, init?: RequestInit): Promise<any> => {
  const tok = (await jwt.getAccessToken()).token;
  const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 220)}`);
  return r.json();
};

const q = `name = '${INTAKE_SHEET_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
const existing = (found.files || [])[0];
const staff = INTAKE_STAFF_COLUMNS as readonly string[];

console.log(`■ 팀장이 보는 시트 「${INTAKE_SHEET_NAME}」 — ${INTAKE_COLUMNS.length}칸\n`);
console.log(`   ${existing ? `이미 있다 — ${S(existing.id)}` : '새로 만든다'}`);
console.log(`   팀장 ${staff.length}칸  ${staff.join(' · ')}`);
console.log(`   기계 ${INTAKE_COLUMNS.length - staff.length}칸  ${INTAKE_COLUMNS.filter((c) => !staff.includes(c)).join(' · ')}`);
console.log(`   드롭다운 — 상태만(${INTAKE_STATES.join(' · ')})`);
console.log(`\n   정산원장으로 나른다 — ${SETTLEMENT_LEDGER_ID.slice(0, 12)}…`);
if (!APPLY) { console.log('\n  (미리보기다 — 반영하려면 --apply)\n'); process.exit(0); }

let id = existing ? S(existing.id) : '';
if (!id) {
  const made = await api(`${SH}`, { method: 'POST', body: JSON.stringify({
    properties: { title: INTAKE_SHEET_NAME, locale: 'ko_KR', timeZone: 'Asia/Seoul' },
    sheets: [
      { properties: { title: INTAKE_TAB, index: 0, gridProperties: { rowCount: ROWS, columnCount: INTAKE_COLUMNS.length, frozenRowCount: 1 } } },
      { properties: { title: '이 시트는', index: 1, gridProperties: { rowCount: 60, columnCount: 2 } } },
    ],
  }) });
  id = S(made.spreadsheetId);
  console.log(`  ✓ 새 시트 ${id}`);
}
const meta = await api(`${SH}/${id}?fields=sheets.properties(title,sheetId,gridProperties(columnCount))`);
const propOf = (t: string) => (meta.sheets || []).find((s: any) => S(s.properties.title) === t)?.properties;
const gid = propOf(INTAKE_TAB)?.sheetId;
if (gid === undefined) throw new Error(`「${INTAKE_TAB}」 탭이 없다`);

// ★열이 모자라면 먼저 늘린다 — 안 늘리고 쓰면 범위 밖이라 400 이 난다.
const have = Number(propOf(INTAKE_TAB)?.gridProperties?.columnCount || 0);
if (have < INTAKE_COLUMNS.length) {
  await api(`${SH}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{
    appendDimension: { sheetId: gid, dimension: 'COLUMNS', length: INTAKE_COLUMNS.length - have },
  }] }) });
}

await api(`${SH}/${id}/values/${encodeURIComponent(`${a1(INTAKE_TAB)}!A1:${colA1(INTAKE_COLUMNS.length - 1)}1`)}?valueInputOption=RAW`, {
  method: 'PUT', body: JSON.stringify({ values: [[...INTAKE_COLUMNS]] }),
});
if (propOf('이 시트는')) {
  await api(`${SH}/${id}/values/${encodeURIComponent(`'이 시트는'!A1:B${GUIDE.length}`)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ values: GUIDE.map(([k, v]) => [k, v]) }),
  });
}

const yellow = { red: 1, green: 0.98, blue: 0.86 };
const grey = { red: 0.96, green: 0.96, blue: 0.96 };
const orange = { red: 1, green: 0.95, blue: 0.88 };
const FONT = 'Noto Sans KR';
const reqs: Record<string, unknown>[] = [
  { repeatCell: { range: { sheetId: gid }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10 } } }, fields: 'userEnteredFormat.textFormat(fontFamily,fontSize)' } },
  { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, bold: true }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)' } },
  { updateDimensionProperties: { range: { sheetId: gid, dimension: 'ROWS', startIndex: 1, endIndex: ROWS }, properties: { pixelSize: 24 }, fields: 'pixelSize' } },
];
INTAKE_COLUMNS.forEach((name, i) => {
  const spec = COL[name];
  const mine = staff.includes(name);
  const fmt: Record<string, unknown> = { backgroundColor: name === '확인' ? orange : mine ? yellow : grey };
  const fields = ['backgroundColor'];
  if (spec?.fmt) { fmt.numberFormat = spec.fmt; fields.push('numberFormat'); }
  if (spec?.align) { fmt.horizontalAlignment = spec.align; fields.push('horizontalAlignment'); }
  reqs.push({ repeatCell: {
    range: { sheetId: gid, startRowIndex: 1, endRowIndex: ROWS, startColumnIndex: i, endColumnIndex: i + 1 },
    cell: { userEnteredFormat: fmt }, fields: fields.map((f) => `userEnteredFormat.${f}`).join(','),
  } });
  reqs.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: spec?.width ?? 110 }, fields: 'pixelSize' } });
  if (spec?.note) reqs.push({ updateCells: { rows: [{ values: [{ note: spec.note }] }], fields: 'note', start: { sheetId: gid, rowIndex: 0, columnIndex: i } } });
});
/**
 * ★인도는 **체크 하나**로 받는다. 날짜를 매번 찾아 넣게 하면 안 넣는다.
 *   체크한 날을 기계가 「인도일」에 박고 다시 안 바꾼다(접수일과 같은 규칙).
 */
const iDone = INTAKE_COLUMNS.indexOf('인도완료' as never);
if (iDone >= 0) reqs.push({ setDataValidation: {
  range: { sheetId: gid, startRowIndex: 1, endRowIndex: ROWS, startColumnIndex: iDone, endColumnIndex: iDone + 1 },
  rule: { condition: { type: 'BOOLEAN' } },
} });
const iState = INTAKE_COLUMNS.indexOf('상태' as never);
if (iState >= 0) reqs.push({ setDataValidation: {
  range: { sheetId: gid, startRowIndex: 1, endRowIndex: ROWS, startColumnIndex: iState, endColumnIndex: iState + 1 },
  rule: { condition: { type: 'ONE_OF_LIST', values: (INTAKE_STATES as readonly string[]).map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false },
} });
/**
 * ★같은 차를 두 번 올리면 정산이 두 번 잡힌다. **막지 말고 보이게** 한다 —
 *   막으면 왜 안 되는지 몰라 멈추고, 빨갛게 칠하면 스스로 지운다.
 */
reqs.push({ addConditionalFormatRule: { rule: {
  ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: ROWS, startColumnIndex: 0, endColumnIndex: 1 }],
  booleanRule: {
    condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=AND($A2<>"",COUNTIF($A$2:$A2,$A2)>1)' }] },
    format: { backgroundColor: { red: 1, green: 0.85, blue: 0.85 }, textFormat: { bold: true, foregroundColor: { red: 0.7, green: 0, blue: 0 } } },
  },
}, index: 0 } });
reqs.push({ setBasicFilter: { filter: { range: { sheetId: gid, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: INTAKE_COLUMNS.length } } } });
await api(`${SH}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });

console.log(`  ✓ 머리글 ${INTAKE_COLUMNS.length}칸 · 안내 ${GUIDE.length}줄 · 팀장 연노랑 / 기계 회색 / 확인 주황`);
console.log(`\n  https://docs.google.com/spreadsheets/d/${id}/edit\n`);
