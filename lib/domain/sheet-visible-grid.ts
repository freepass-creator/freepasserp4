export type SheetGridCell = {
  formattedValue?: string;
  effectiveValue?: {
    stringValue?: string;
    numberValue?: number;
    boolValue?: boolean;
  };
  /** 셀에 걸린 하이퍼링크 — 아이카는 차번 셀에 상세페이지 주소를 건다. */
  hyperlink?: string;
  /** 스마트칩 — 오플은 차번 셀에 구글드라이브 사진 폴더를 칩으로 붙인다. */
  chipRuns?: Array<{ chip?: { richLinkProperties?: { uri?: string } } }>;
};

export type SheetGridData = {
  startRow?: number;
  rowData?: Array<{ values?: SheetGridCell[] }>;
  rowMetadata?: Array<{ hiddenByFilter?: boolean; hiddenByUser?: boolean }>;
};

/**
 * 사진이 실릴 수 있는 호스트.
 *
 * 시트에는 사진 «열»이 없다. 공급사는 차량번호 셀에 링크를 건다 —
 * 아이카는 상세페이지 하이퍼링크, 오플은 드라이브 폴더 스마트칩이다(erp3 도 같은 방식).
 * 셀 «값»만 읽으면 이 링크가 통째로 유실된다. 실측(2026-08-06): v3 208대에 있던 사진이
 * v4 에 0건이었던 이유가 이것이다.
 */
const PHOTO_HOST_RE = /(drive\.google\.com|moderentcar\.co\.kr|photos\.app\.goo\.gl|imgur|cloudfront|amazonaws)/i;

/** 셀에서 사진 링크를 뽑는다. 드라이브는 ?query 를 떼고, 나머지는 유지한다(?v= 가 차량 식별자다). */
export function photoUrlFromCell(cell: SheetGridCell | undefined): string {
  if (!cell) return '';
  const link = String(cell.hyperlink || '');
  if (link && PHOTO_HOST_RE.test(link)) return link.includes('drive.google.com') ? link.split('?')[0] : link;
  for (const run of cell.chipRuns || []) {
    const uri = String(run?.chip?.richLinkProperties?.uri || '');
    if (uri && PHOTO_HOST_RE.test(uri)) return uri.includes('drive.google.com') ? uri.split('?')[0] : uri;
  }
  return '';
}

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
  /** 보이는 행 기준 인덱스 → 그 행에서 발견한 사진 링크. 없는 행은 키가 없다. */
  photoByRow?: Record<number, string>;
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
  const photoByAbsRow = new Map<number, string>();
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
      // 사진 링크는 어느 칸에 걸려 있을지 모른다(대개 차번 칸). 먼저 찾은 것을 그 행의 사진으로 본다.
      for (const cell of rowData[index]?.values || []) {
        const url = photoUrlFromCell(cell);
        if (url) { photoByAbsRow.set(start + index, url); break; }
      }
      const row = (rowData[index]?.values || []).map(cellText);
      while (row.length && !String(row[row.length - 1] || '').trim()) row.pop();
      // 빈 행도 실제 행 경계다. 특히 공급사가 현재 매물 블록 아래에 과거 이력을
      // 보관하는 시트는 빈 행을 제거하면 두 블록이 붙어 과거 매물이 되살아난다.
      // 숨김 행은 위에서 제외하되, 숨김이 아닌 빈 행은 선두/후미 trim 전까지 보존한다.
      byIndex.set(start + index, row);
    }
  }
  // 절대 행번호를 유지한 채 정렬하고, 앞뒤 빈 행을 깎은 «만큼»만 사진 인덱스를 옮긴다.
  // 사진을 행 순서와 따로 담으면 한 칸만 밀려도 남의 차 사진이 붙는다.
  const ordered = [...byIndex.entries()].sort(([a], [b]) => a - b);
  const hasValue = (row: string[]) => row.some((cell) => String(cell || '').trim());
  let head = 0;
  while (head < ordered.length && !hasValue(ordered[head][1])) head++;
  let tail = ordered.length;
  while (tail > head && !hasValue(ordered[tail - 1][1])) tail--;
  const kept = ordered.slice(head, tail);
  const rows = kept.map(([, row]) => row);
  if (!rows.length) throw new Error(`Google Sheet 데이터 없음(${sheet.properties.title || gid})`);
  const photoByRow: Record<number, string> = {};
  kept.forEach(([absRow], i) => {
    const url = photoByAbsRow.get(absRow);
    if (url) photoByRow[i] = url;
  });
  return { rows, title: sheet.properties.title || gid, hiddenRowCount, photoByRow };
}
