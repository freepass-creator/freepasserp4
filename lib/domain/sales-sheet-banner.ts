/** Internal worksheet identity is separate from the displayed worksheet title. */
import contract from '../../contracts/sheets/sheet-contract-v1.json';
export const SHEET_CONTRACT = contract;
export const SALES_BANNER_TIME_ZONE = contract.timeZone;
export const DISPLAY_NAMES: Readonly<Record<string, string>> = contract.displayNames;

export function salesBannerMark(timestamp: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
    || !Number.isFinite(Date.parse(timestamp))) throw new Error('HOLD: full ISO 8601 timestamp required');
  const d = new Date(Date.parse(timestamp) + 9 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Company-only worksheets must supply an explicitly resolved display name. */
export function salesSheetBanner(tab: string, count: number, mark: string, companyDisplayName?: string): string {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('HOLD: invalid banner count');
  const display = DISPLAY_NAMES[tab] ?? companyDisplayName;
  if (!display || !/^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*$/u.test(display)) throw new Error('HOLD: unresolved company display name');
  if (tab !== '상품리스트') return `${display} ${count}대`;
  if (!/^(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]) (?:[01]\d|2[0-3]):[0-5]\d$/.test(mark)) throw new Error('HOLD: expected MM-DD HH:MM');
  const [month, day] = mark.slice(0, 5).split('-').map(Number);
  if (new Date(Date.UTC(2000, month - 1, day)).getUTCMonth() !== month - 1) throw new Error('HOLD: invalid calendar date');
  return `${display} ${mark} ${count}대`;
}

export function salesBannerManifest(input: {
  capturedAt: string; revision: string; snapshotId: string;
  tabs: { canonicalKey: string; count: number; companyDisplayName?: string }[];
}) {
  if (!/^[0-9a-f]{40}$/i.test(input.revision) || !input.snapshotId.trim()) throw new Error('HOLD: revision and snapshotId required');
  const mark = salesBannerMark(input.capturedAt);
  return {
    version: 1 as const, capturedAt: input.capturedAt, timeZone: SALES_BANNER_TIME_ZONE,
    revision: input.revision, snapshotId: input.snapshotId,
    contract,
    tabs: input.tabs.map(tab => ({ ...tab, displayText: salesSheetBanner(tab.canonicalKey, tab.count, mark, tab.companyDisplayName) })),
  };
}

export function sourceTextColumnRule(header: string) {
  return contract.sourceTextColumns.find(rule => rule.headers.includes(header));
}

/** Apply last, after either formatter; only width and wrapping are owned here. */
export function sourceTextFormatRequests(sheetId: number, headers: string[], currentWidths: number[], dataEndRow?: number) {
  return headers.flatMap((header, index) => {
    const rule = sourceTextColumnRule(header);
    if (!rule) return [];
    const current = currentWidths[index];
    if (!Number.isFinite(current) || current <= 0) throw new Error(`HOLD: unknown column width ${header}`);
    const range = { sheetId, startColumnIndex: index, endColumnIndex: index + 1 };
    return [
      { updateDimensionProperties: { range: { ...range, dimension: 'COLUMNS' }, properties: { pixelSize: Math.max(current, rule.minimumPixelSize) }, fields: 'pixelSize' } },
      { repeatCell: { range: { ...range, ...(dataEndRow === undefined ? {} : { startRowIndex: 0, endRowIndex: dataEndRow }) }, cell: { userEnteredFormat: { wrapStrategy: rule.wrapStrategy } }, fields: 'userEnteredFormat.wrapStrategy' } },
    ];
  });
}
