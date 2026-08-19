/**
 * 「ERP4 차종마스터 원천대장」 서식 표준.
 *
 * ★사장님 2026-08-18 —
 *   「차종마스터 전체 글씨 크기가 영업자가 보는 건 아니니까 전체 9로」
 *   「글씨 줄인 애들은 간격도 조정」
 *   「규격검토 페이지 연료랑 제조사 제조국 이런거 구분지어야 할 것들은 글씨 색깔을 좀 다르게」
 *
 * - 글꼴·크기·행 높이는 판매시트 표준(`sales-sheet-format` FONT_DEFAULT · SIZE · rowPx)과 같은 값을 쓴다.
 *   두 문서가 다른 크기로 갈리지 않게 여기서 새 상수를 만들지 않는다.
 * - 구분 열의 색은 **글자색만** 바꾼다(배경은 흰색 유지 — 데이터 영역 중립 규칙). 값별 색은 아래 표가 정본이다.
 *   조건부서식으로 걸어 두므로 값을 고치거나 재발행해도 색이 따라온다.
 * - 이 모듈은 요청(JSON)만 만든다. Sheets API 호출은 호출자가 한다.
 */
import { FONT_DEFAULT, SIZE, rowPx } from './sales-sheet-format';

export const MASTER_FONT = FONT_DEFAULT;
export const MASTER_FONT_SIZE = SIZE;
export const MASTER_ROW_PX = rowPx(SIZE);

type Rec = Record<string, any>;
const hex = (h: string) => {
  const n = parseInt(h.replace('#', ''), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
};

import { MASTER_CATEGORY_COLORS } from './category-colors';
export { MASTER_CATEGORY_COLORS };

/** 글꼴·크기만 덮는 요청 — bold·색·기울임은 유지. */
export function masterFontRequest(sheetId: number, rowCount: number, columnCount: number): Rec {
  return { repeatCell: {
    range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: columnCount },
    cell: { userEnteredFormat: { textFormat: { fontFamily: MASTER_FONT, fontSize: MASTER_FONT_SIZE } } },
    fields: 'userEnteredFormat.textFormat.fontFamily,userEnteredFormat.textFormat.fontSize',
  } };
}

/** 표 탭의 행 높이 — 머리글 포함 전 행을 판매시트 표준 rowPx 로. */
export function masterRowHeightRequest(sheetId: number, endIndex?: number): Rec {
  return { updateDimensionProperties: {
    range: { sheetId, dimension: 'ROWS', startIndex: 0, ...(endIndex ? { endIndex } : {}) },
    properties: { pixelSize: MASTER_ROW_PX }, fields: 'pixelSize',
  } };
}

/**
 * 구분 열 조건부서식(글자색). 머리글 이름으로 열을 찾는다 — 열 순서가 바뀌어도 따라간다.
 * `existingRuleCount` 만큼 기존 규칙을 먼저 지워 멱등하게 만든다(같은 규칙이 겹겹이 쌓이지 않게).
 */
export function masterCategoryColorRequests(input: {
  sheetId: number; headers: string[]; rowCount: number; existingRuleCount?: number;
  columns?: string[]; // 기본: MASTER_CATEGORY_COLORS 에 있는 머리글 전부
}): Rec[] {
  const out: Rec[] = [];
  for (let i = (input.existingRuleCount || 0) - 1; i >= 0; i--) out.push({ deleteConditionalFormatRule: { sheetId: input.sheetId, index: i } });
  const columns = input.columns || Object.keys(MASTER_CATEGORY_COLORS);
  let index = 0;
  for (const name of columns) {
    const col = input.headers.indexOf(name);
    if (col < 0) continue;
    for (const [value, color] of Object.entries(MASTER_CATEGORY_COLORS[name] || {})) {
      out.push({ addConditionalFormatRule: { index: index++, rule: {
        ranges: [{ sheetId: input.sheetId, startRowIndex: 1, endRowIndex: input.rowCount, startColumnIndex: col, endColumnIndex: col + 1 }],
        booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: value }] },
          format: { textFormat: { foregroundColor: hex(color) } } },
      } } });
    }
  }
  return out;
}
