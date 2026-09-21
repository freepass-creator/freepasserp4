import { sourceTextColumnRule, sourceTextFormatRequests } from '../domain/sales-sheet-banner';

/** Read only header row and column metadata before any publisher mutation. */
export async function readSourceTextWidths(api: (url: string) => Promise<any>, spreadsheetId: string, sheets: any[]) {
  const ranges = sheets.map(s => `ranges=${encodeURIComponent(`'${String(s.properties.title).replace(/'/g, "''")}'!1:1`)}`).join('&');
  if (!ranges) return new Map<number, Map<string, number>>();
  const fields = 'sheets(properties(sheetId),data(startColumn,columnMetadata(pixelSize),rowData(values(formattedValue,userEnteredValue))))';
  const result = await api(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?includeGridData=true&${ranges}&fields=${encodeURIComponent(fields)}`);
  const out = new Map<number, Map<string, number>>();
  for (const sheet of result.sheets || []) {
    const widths = new Map<string, number>();
    for (const grid of sheet.data || []) {
      const cells = grid.rowData?.[0]?.values || [];
      cells.forEach((cell: any, index: number) => {
        const header = String(cell.formattedValue ?? cell.userEnteredValue?.stringValue ?? '');
        const rule = sourceTextColumnRule(header);
        if (!rule) return;
        const width = grid.columnMetadata?.[index]?.pixelSize;
        if (!Number.isFinite(width) || width <= 0 || widths.has(rule.key)) throw new Error(`HOLD: unknown/duplicate source column ${header}`);
        widths.set(rule.key, width);
      });
    }
    out.set(Number(sheet.properties.sheetId), widths);
  }
  for (const sheet of sheets) if (!out.has(Number(sheet.properties.sheetId))) throw new Error('HOLD: missing worksheet column metadata');
  return out;
}

export function publisherSourceTextRequests(sheetId: number, headers: string[], previous?: Map<string, number>, isNewSheet = false) {
  if (!previous && !isNewSheet && headers.some(sourceTextColumnRule)) throw new Error('HOLD: existing worksheet widths unavailable');
  const widths = headers.map(header => {
    const rule = sourceTextColumnRule(header);
    if (!rule) return 0;
    if (previous && !previous.has(rule.key)) throw new Error(`HOLD: source column missing ${header}`);
    return previous?.get(rule.key) ?? rule.minimumPixelSize;
  });
  return sourceTextFormatRequests(sheetId, headers, widths);
}
