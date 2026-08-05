export type SheetGridCell = {
  formattedValue?: string;
  effectiveValue?: {
    stringValue?: string;
    numberValue?: number;
    boolValue?: boolean;
  };
};

export type SheetGridData = {
  startRow?: number;
  rowData?: Array<{ values?: SheetGridCell[] }>;
  rowMetadata?: Array<{ hiddenByFilter?: boolean; hiddenByUser?: boolean }>;
};

export type SheetsGridResponse = {
  sheets?: Array<{
    properties?: { sheetId?: number; title?: string; hidden?: boolean };
    data?: SheetGridData[];
  }>;
};

export type VisibleSheetTable = {
  rows: string[][];
  title: string;
  hiddenRowCount: number;
};

function cellText(cell: SheetGridCell | undefined): string {
  if (!cell) return '';
  if (cell.formattedValue != null) return String(cell.formattedValue);
  const value = cell.effectiveValue;
  if (!value) return '';
  if (value.stringValue != null) return String(value.stringValue);
  if (value.numberValue != null) return String(value.numberValue);
  if (value.boolValue != null) return value.boolValue ? 'TRUE' : 'FALSE';
  return '';
}

/** Sheets Grid 응답을 행 번호 순으로 합치고 필터·수동 숨김 행을 제거한다. */
export function visibleRowsFromGridResponse(
  body: SheetsGridResponse,
  gid: string,
): VisibleSheetTable {
  const sheet = body.sheets?.find((item) => item.properties?.sheetId === Number(gid));
  if (!sheet?.properties) throw new Error(`Google Sheet 탭 없음(gid ${gid})`);
  if (sheet.properties.hidden) throw new Error(`숨김 탭은 연동할 수 없습니다(${sheet.properties.title || gid})`);

  const byIndex = new Map<number, string[]>();
  let hiddenRowCount = 0;
  for (const grid of sheet.data || []) {
    const start = Number(grid.startRow) || 0;
    const rowData = grid.rowData || [];
    const metadata = grid.rowMetadata || [];
    const length = Math.max(rowData.length, metadata.length);
    for (let index = 0; index < length; index++) {
      const meta = metadata[index];
      if (meta?.hiddenByFilter || meta?.hiddenByUser) {
        if (rowData[index]?.values?.some((cell) => cellText(cell).trim())) hiddenRowCount++;
        continue;
      }
      const row = (rowData[index]?.values || []).map(cellText);
      while (row.length && !String(row[row.length - 1] || '').trim()) row.pop();
      // 빈 행도 실제 행 경계다. 특히 공급사가 현재 매물 블록 아래에 과거 이력을
      // 보관하는 시트는 빈 행을 제거하면 두 블록이 붙어 과거 매물이 되살아난다.
      // 숨김 행은 위에서 제외하되, 숨김이 아닌 빈 행은 선두/후미 trim 전까지 보존한다.
      byIndex.set(start + index, row);
    }
  }
  const rows = [...byIndex.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
  const hasValue = (row: string[]) => row.some((cell) => String(cell || '').trim());
  while (rows.length && !hasValue(rows[0])) rows.shift();
  while (rows.length && !hasValue(rows[rows.length - 1])) rows.pop();
  if (!rows.length) throw new Error(`Google Sheet 데이터 없음(${sheet.properties.title || gid})`);
  return { rows, title: sheet.properties.title || gid, hiddenRowCount };
}
