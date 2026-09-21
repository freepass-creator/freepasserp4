import { SHEET_CONTRACT, salesBannerManifest, sourceTextColumnRule, sourceTextFormatRequests } from './sales-sheet-banner';
import { SALES_PUBLISHED_TAB_PREFIXES, salesTabMatches } from './sheet-contract-identity';

export type SheetContractSnapshot = {
  target: 'F01' | 'F86'; capturedAt: string; revision: string; snapshotId: string;
  coverage: { formulas: boolean; protections: boolean; appsScript: boolean; externalConsumers: boolean };
  /** Full non-owned state (filters, merges, protections, user formatting, etc.). */
  preservedState: unknown;
  tabs: { sheetId: number; index: number; title: string; headers: string[]; rows: unknown[][]; widths: number[]; companyDisplayName?: string }[];
};

/** Same read-only planner for F01 and F86. Unknown evidence never authorizes writes. */
export function planSheetContract(snapshot: SheetContractSnapshot) {
  const holds = Object.entries(snapshot.coverage).filter(([, complete]) => !complete).map(([key]) => `UNVERIFIED:${key}`);
  const tabs = [...snapshot.tabs].sort((a, b) => a.index - b.index);
  for (const [i, key] of SALES_PUBLISHED_TAB_PREFIXES.entries()) {
    const candidates = tabs.filter(t => salesTabMatches(t.title, key));
    if (candidates.length !== 1) holds.push(`HOLD: ${key} identity count ${candidates.length}`);
    if (!tabs[i] || !salesTabMatches(tabs[i].title, key)) holds.push(`HOLD: canonical order ${key}`);
  }
  const entries = tabs.map(t => {
    const canonicalKey = SALES_PUBLISHED_TAB_PREFIXES.find(k => salesTabMatches(t.title, k)) ?? t.companyDisplayName;
    if (!canonicalKey) holds.push(`HOLD: unresolved company ${t.sheetId}`);
    const ci = t.headers.indexOf('차량번호');
    const rows = t.rows.filter(row => row.some(value => String(value ?? '').trim()));
    if (ci < 0 || rows.some(row => !String(row[ci] ?? '').trim())) holds.push(`HOLD: non-vehicle row ${t.sheetId}`);
    return { tab: t, canonicalKey, count: rows.length };
  });
  const identities = entries.flatMap(e => e.canonicalKey ? [e.canonicalKey] : []);
  if (new Set(identities).size !== identities.length) holds.push('HOLD: duplicate canonical identity');
  const manifest = salesBannerManifest({ ...snapshot, tabs: entries.filter(e => e.canonicalKey).map(e => ({ canonicalKey: e.canonicalKey!, count: e.count, companyDisplayName: e.tab.companyDisplayName })) });
  const diff: { sheetId: number; before: string; after: string; count: number; columns: { index: number; header: string; before: number | null; after: number | null; wrapStrategy: string }[] }[] = [];
  const proposedRequests: Record<string, unknown>[] = [];
  let mi = 0;
  for (const entry of entries) {
    if (!entry.canonicalKey) continue;
    const t = entry.tab;
    const after = manifest.tabs[mi++].displayText;
    const columns = t.headers.flatMap((header, index) => {
      const rule = sourceTextColumnRule(header);
      if (!rule) return [];
      const before = t.widths[index];
      if (!Number.isFinite(before) || before <= 0) holds.push(`HOLD: unknown column width ${t.sheetId}:${header}`);
      return [{ index, header, before: before ?? null, after: Number.isFinite(before) && before > 0 ? Math.max(before, rule.minimumPixelSize) : null, wrapStrategy: rule.wrapStrategy }];
    });
    for (const rule of SHEET_CONTRACT.sourceTextColumns) {
      if (t.headers.filter(h => rule.headers.includes(h)).length > 1) holds.push(`HOLD: duplicate source header ${t.sheetId}:${rule.key}`);
      if (SALES_PUBLISHED_TAB_PREFIXES.includes(entry.canonicalKey as any) && !t.headers.some(h => rule.headers.includes(h))) holds.push(`HOLD: missing source header ${t.sheetId}:${rule.key}`);
    }
    diff.push({ sheetId: t.sheetId, before: t.title, after, count: entry.count, columns });
    if (after !== t.title) proposedRequests.push({ updateSheetProperties: { properties: { sheetId: t.sheetId, title: after }, fields: 'title' } });
    if (columns.every(c => c.after !== null)) proposedRequests.push(...sourceTextFormatRequests(t.sheetId, t.headers, t.widths, t.rows.length + 1));
  }
  if (new Set(diff.map(d => d.after)).size !== diff.length) holds.push('HOLD: display title collision');
  return { status: holds.length ? 'HOLD' : 'READY_FOR_REVIEW', holds, manifest, diff, proposedRequests, executableRequests: holds.length ? [] : proposedRequests };
}

export function auditSheetContractReadback(before: SheetContractSnapshot, after: SheetContractSnapshot): string[] {
  const plan = planSheetContract(before);
  const fails = [...plan.holds];
  if (before.target !== after.target || JSON.stringify(before.preservedState) !== JSON.stringify(after.preservedState)) fails.push('HOLD: preserved state changed');
  if (before.tabs.length !== after.tabs.length) fails.push('HOLD: worksheet count changed');
  for (const old of before.tabs) {
    const current = after.tabs.find(t => t.sheetId === old.sheetId);
    const change = plan.diff.find(t => t.sheetId === old.sheetId);
    if (!current || !change) { fails.push(`HOLD: worksheet identity missing ${old.sheetId}`); continue; }
    if (current.index !== old.index || JSON.stringify(current.headers) !== JSON.stringify(old.headers) || JSON.stringify(current.rows) !== JSON.stringify(old.rows)) fails.push(`HOLD: data/formula/order changed ${old.sheetId}`);
    if (current.title !== change.after) fails.push(`HOLD: title mismatch ${old.sheetId}`);
    for (let index = 0; index < old.widths.length; index++) {
      const expected = change.columns.find(c => c.index === index)?.after ?? old.widths[index];
      if (current.widths[index] !== expected) fails.push(`HOLD: width mismatch ${old.sheetId}:${index}`);
    }
  }
  return fails;
}
