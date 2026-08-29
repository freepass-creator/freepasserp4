/**
 * F03 차종마스터 — 이름 7열 오른쪽에 검수·AI 의견칸을 둔다.
 * 이름·기간 값은 안 건드린다. 기본 dry-run. 반영 `--apply`.
 *
 *   npx tsx scripts/ensure-encar-master-review-columns.mts
 *   npx tsx scripts/ensure-encar-master-review-columns.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import {
  ENCAR_MASTER_SHEET_ID,
  ENCAR_MASTER_TAB,
  ENCAR_NAME_COLUMNS,
  ENCAR_REVIEW_COLUMNS,
  ENCAR_REVIEW_VERDICTS,
  loadEncarWorkSheetGrids,
} from '../lib/domain/encar-master-sheet';
import { workBookFromTabs } from '../lib/domain/encar-work-sheet-match';
import { assertNotLiveVehicleMasterWrite } from '../lib/domain/legacy-sheets';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
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
const SH = `https://sheets.googleapis.com/v4/spreadsheets/${ENCAR_MASTER_SHEET_ID}`;
assertNotLiveVehicleMasterWrite(ENCAR_MASTER_SHEET_ID, 'review columns');

const NOTES: Record<(typeof ENCAR_REVIEW_COLUMNS)[number], string> = {
  '클로드 지식검토': `클로드 지식검토. 매뉴얼 규칙. ${ENCAR_REVIEW_VERDICTS.join(' · ')}.`,
  '클로드 엔카대조': `클로드 엔카대조. iNav 원문 1:1. ${ENCAR_REVIEW_VERDICTS.join(' · ')}.`,
  '커서 지식검토': `커서 지식검토. 매뉴얼 규칙. ${ENCAR_REVIEW_VERDICTS.join(' · ')}.`,
  '커서 엔카대조': `커서 엔카대조. iNav 원문 1:1. ${ENCAR_REVIEW_VERDICTS.join(' · ')}.`,
  '코덱스/제미나이 지식검토': `코덱스·제미나이 지식검토. ${ENCAR_REVIEW_VERDICTS.join(' · ')}.`,
  '코덱스/제미나이 엔카대조': `코덱스·제미나이 엔카대조. iNav 원문 1:1. ${ENCAR_REVIEW_VERDICTS.join(' · ')}.`,
};
const OLD_THREE = ['클로드', '커서', '코덱스/제미나이'];

const grids = await loadEncarWorkSheetGrids(api);
const hdr = (grids.names[0] || []).map(S);
const wantName = [...ENCAR_NAME_COLUMNS];
const wantReview = [...ENCAR_REVIEW_COLUMNS];
const nameNow = hdr.slice(0, wantName.length);
if (nameNow.join('|') !== wantName.join('|')) {
  throw new Error(`이름 7열이 다름: ${hdr.join(' | ')}`);
}
const reviewNow = hdr.slice(wantName.length);
const already = reviewNow.slice(0, wantReview.length).join('|') === wantReview.join('|');
const oldThree = reviewNow.slice(0, 3).join('|') === OLD_THREE.join('|') && reviewNow.length <= 4;
const extra = reviewNow.filter((h) => h && !wantReview.includes(h as typeof wantReview[number]) && !OLD_THREE.includes(h));
if (extra.length && !oldThree) throw new Error(`이름 7열 뒤에 모르는 칸: ${extra.join(' · ')}`);

const book = workBookFromTabs(grids);
const sample = book.names[0];
console.log(`■ F03 차종마스터 검수칸 ${APPLY ? '반영' : '미리보기'}`);
console.log(`  지금  ${hdr.join(' | ') || '(7열만)'}`);
console.log(`  목표  ${[...wantName, ...wantReview].join(' | ')}`);
console.log(`  이름행 ${book.names.length} · 예 ${sample.maker} ${sample.sub} / ${sample.trim} · ${sample.start}~${sample.end}`);
if (already) console.log('  머리글 이미 맞음 — 필터만 맞춘다');
else if (oldThree) console.log('  옛 3칸(클로드·커서·코덱스) → 지식/엔카 6칸. 기존 값은 지식칸으로');
else console.log(`  삽입 ${wantReview.join(' · ')}`);

const meta = await api(`${SH}?fields=sheets.properties(sheetId,title,gridProperties)`);
const tab = ((meta.sheets || []) as any[]).find((s) => S(s.properties?.title) === ENCAR_MASTER_TAB)?.properties;
if (!tab) throw new Error('차종마스터 탭 없음');
const gid = tab.sheetId as number;
const rowCount = Number(tab.gridProperties?.rowCount || 1669);
const colCount = Number(tab.gridProperties?.columnCount || 7);

if (!APPLY) {
  console.log('※ dry-run. 반영은 --apply. 이름·기간 칸은 안 씀.');
  process.exit(0);
}

const requests: Record<string, unknown>[] = [];
if (colCount < wantName.length + wantReview.length) {
  requests.push({
    appendDimension: {
      sheetId: gid, dimension: 'COLUMNS',
      length: wantName.length + wantReview.length - colCount,
    },
  });
}
requests.push({
  updateSheetProperties: {
    properties: { sheetId: gid, gridProperties: { frozenRowCount: 1, frozenColumnCount: 0 } },
    fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
  },
});
const headerGray = { red: 0.9372549, green: 0.9372549, blue: 0.9372549 };
const mute = { red: 0.373, green: 0.388, blue: 0.408 };
const start = wantName.length;
const end = start + wantReview.length;
const widths: [number, number][] = [
  [5, 88], [6, 88],
  [7, 100], [8, 180], [9, 100], [10, 180], [11, 100], [12, 180],
];
for (const [i, px] of widths) {
  requests.push({
    updateDimensionProperties: {
      range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: px },
      fields: 'pixelSize',
    },
  });
}
requests.push({
  setBasicFilter: {
    filter: {
      range: {
        sheetId: gid,
        startRowIndex: 0,
        endRowIndex: rowCount,
        startColumnIndex: 0,
        endColumnIndex: end,
      },
    },
  },
});
requests.push({
  repeatCell: {
    range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: start, endColumnIndex: end },
    cell: {
      userEnteredFormat: {
        backgroundColor: headerGray,
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'MIDDLE',
        wrapStrategy: 'WRAP',
        textFormat: { bold: true, fontSize: 9, foregroundColor: mute },
      },
    },
    fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)',
  },
});
requests.push({
  repeatCell: {
    range: { sheetId: gid, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: start, endColumnIndex: end },
    cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP', horizontalAlignment: 'LEFT' } },
    fields: 'userEnteredFormat(wrapStrategy,verticalAlignment,horizontalAlignment)',
  },
});
const list = (values: readonly string[], col: number) => ({
  setDataValidation: {
    range: { sheetId: gid, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: col, endColumnIndex: col + 1 },
    rule: {
      condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: v })) },
      showCustomUi: true,
      strict: false,
    },
  },
});
requests.push(list(ENCAR_REVIEW_VERDICTS, start));
for (let i = 1; i < wantReview.length; i++) requests.push(list(ENCAR_REVIEW_VERDICTS, start + i));
for (let i = 0; i < wantReview.length; i++) {
  requests.push({
    repeatCell: {
      range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: start + i, endColumnIndex: start + i + 1 },
      cell: { note: NOTES[wantReview[i]] },
      fields: 'note',
    },
  });
}

await api(`${SH}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });

const colA1 = (i: number) => {
  let t = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); }
  return t;
};
await api(`${SH}/values/${encodeURIComponent(`'${ENCAR_MASTER_TAB}'!${colA1(start)}1:${colA1(end - 1)}1`)}?valueInputOption=RAW`, {
  method: 'PUT',
  body: JSON.stringify({ values: [wantReview] }),
});

if (oldThree) {
  const body = grids.names.slice(1).map((raw) => {
    const row = (raw || []).map(S);
    return [row[7] || '', '', row[8] || '', '', row[9] || '', ''];
  });
  for (let i = 0; i < body.length; i += 400) {
    const chunk = body.slice(i, i + 400);
    const a = i + 2;
    const b = i + 1 + chunk.length;
    await api(`${SH}/values/${encodeURIComponent(`'${ENCAR_MASTER_TAB}'!${colA1(start)}${a}:${colA1(end - 1)}${b}`)}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: chunk }),
    });
  }
  console.log(`  기존 의견 ${body.length}행 → 지식칸`);
}

const guide = await api(`${SH}/values/${encodeURIComponent("'안내'!A1:B40")}`);
const guideRows = (guide.values || []) as string[][];
const guideAt = guideRows.findIndex((r) => S(r[0]) === '차종마스터');
if (guideAt >= 0) {
  const next = '원산지 · 제조사 · 모델 · 세부모델 · 세부트림 · 생산시작 · 생산종료. 오른쪽 클로드/커서/코덱스 × 지식검토·엔카대조. 지식검토=매뉴얼 규칙, 엔카대조=iNav 원문. 이름 7열은 의견칸에 적지 않는다.';
  await api(`${SH}/values/${encodeURIComponent(`'안내'!B${guideAt + 1}`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [[next]] }),
  });
  console.log(`  안내 「차종마스터」 줄 갱신`);
}

const after = await loadEncarWorkSheetGrids(api);
const afterHdr = (after.names[0] || []).map(S);
const afterBook = workBookFromTabs(after);
const afterSample = afterBook.names[0];
if (afterHdr.slice(0, wantName.length).join('|') !== wantName.join('|')) {
  throw new Error(`반영 후 이름 7열이 깨짐: ${afterHdr.join(' | ')}`);
}
if (afterHdr.slice(wantName.length, wantName.length + wantReview.length).join('|') !== wantReview.join('|')) {
  throw new Error(`반영 후 검수칸이 다름: ${afterHdr.join(' | ')}`);
}
if (afterBook.names.length !== book.names.length) {
  throw new Error(`이름 행수 달라짐 ${book.names.length} → ${afterBook.names.length}`);
}
if (
  afterSample.maker !== sample.maker || afterSample.sub !== sample.sub
  || afterSample.trim !== sample.trim || afterSample.start !== sample.start
) {
  throw new Error(`1행 이름값이 바뀜: ${JSON.stringify(afterSample)}`);
}
console.log(`반영  ${afterHdr.join(' | ')}`);
console.log(`확인  이름 ${afterBook.names.length}행 그대로 · 예 ${afterSample.maker} ${afterSample.sub} / ${afterSample.trim}`);
