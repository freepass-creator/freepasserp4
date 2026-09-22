import spec from '../../vendor/freepass-data/contracts/f01-f86-sheet-spec.v1.json';
import { isDepositColumn, isRentColumn } from './sales-sheet-format';
export const SHEET_PRESENTATION = spec;
export type Workbook = keyof typeof spec.workbooks;

export function requireUniquePublicationKeys(keys: string[]) {
  const normalized = keys.map(key => String(key).replace(/[\s-]/g, ''));
  if (normalized.some(key => !key || ['미입력', '미정', '해당없음'].includes(key)) || new Set(normalized).size !== normalized.length) throw new Error('HOLD: missing/duplicate publication vehicle key');
}

export function presentationTitle(label: string, count: number, mark: string): string {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('HOLD: invalid vehicle count');
  if (label === spec.primaryTabs[0].label) {
    if (!/^\d{2}\.\d{2} \d{2}:\d{2}$/.test(mark)) throw new Error('HOLD: MM.DD HH:mm required');
    return `${mark} ${label} ${count}대`;
  }
  return `${label} ${count}대`;
}

/** Read legacy names, but always publish the current contract. */
export function presentationLabel(title: string): string {
  return title.trim().replace(/^\d{2}\.\d{2} \d{2}:\d{2} (?=상품리스트(?: |$))/, '')
    .replace(/ (?:(?:\d{2}\.\d{2} \d{2}:\d{2}(?::\d{2})?) )?(?:· )?\d+대$/, '')
    .replace(/^(?:손오공구독|오공구독)$/, '손오공상품');
}

export function requirePrimaryBindings(workbook: Workbook, sheets: { sheetId: number; title: string; hidden?: boolean }[]) {
  const ids = spec.workbooks[workbook].primarySheetIds;
  if (sheets.some(s => /^오공구독(?: |$)/.test(s.title))) throw new Error('HOLD: retired tab requires reconciliation');
  spec.primaryTabs.forEach((tab, index) => {
    const sheet = sheets.find(s => s.sheetId === ids[index]);
    if (!sheet || sheet.hidden) throw new Error(`HOLD: missing/hidden stable ${workbook} ${tab.label}`);
    if (sheets.some(s => s.sheetId !== sheet.sheetId && presentationLabel(s.title) === tab.label)) throw new Error(`HOLD: duplicate ${tab.label}`);
  });
}

/** Appended after standard/retro formatting, so both publishers use the same values. */
export function presentationFormatRequests(workbook: Workbook, sheetId: number, label: string, headers: string[]): any[] {
  const tab = spec.primaryTabs.find(t => t.label === label);
  const color = tab?.color ?? spec.supplierTabs.color;
  const rgbColor = Object.fromEntries(['red', 'green', 'blue'].map((key, index) => [key, parseInt(color.slice(1 + index * 2, 3 + index * 2), 16) / 255]));
  const requests: any[] = [{ updateSheetProperties: { properties: { sheetId, tabColorStyle: { rgbColor }, gridProperties: { frozenRowCount: spec.appearance.headerRowsFrozen } }, fields: 'tabColorStyle,gridProperties.frozenRowCount' } }];
  headers.forEach((header, index) => {
    const tabWidths = tab ? (spec.appearance.columnWidthsByTabPx as Record<string, Record<string, number>> | undefined)?.[tab.key] : undefined;
    const width = tabWidths?.[header] ?? (spec.appearance.columnWidthsPx as Record<string, number>)[header];
    const range = { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 };
    if (width) requests.push({ updateDimensionProperties: { range, properties: { pixelSize: width }, fields: 'pixelSize' } });
    if (workbook === 'F86' && (isDepositColumn(header) || isRentColumn(header))) {
      const months = /^(\d+)\s*개월/.exec(header);
      const isVisibleLongTermRent = !!months && Number(months[1]) >= spec.appearance.F86MinimumVisibleFeeMonths;
      requests.push({ updateDimensionProperties: { range, properties: { hiddenByUser: !isVisibleLongTermRent }, fields: 'hiddenByUser' } });
    }
  });
  return requests;
}
