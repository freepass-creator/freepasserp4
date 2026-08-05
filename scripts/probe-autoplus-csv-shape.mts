/** AutoPlus export/gviz 응답 구조 비교. 값과 로컬 파일은 출력·저장하지 않는다. */
import { readFileSync } from 'node:fs';
import { parseDelimited } from '../lib/domain/sheet-import';
import {
  AUTOPLUS_GID_MAIN,
  AUTOPLUS_GID_PROMO,
  importAutoplusMerged,
} from '../lib/domain/sheet-autoplus';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

const SHEET_ID = '1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U';

async function probe(kind: 'export' | 'gviz', gid: string) {
  const url = kind === 'export'
    ? `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`
    : `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'freepasserp4-autoplus-shape-probe/1.0' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${kind}/${gid}: HTTP ${response.status}`);
  const body = await response.text();
  const table = parseDelimited(body);
  return {
    kind,
    gid,
    bytes: Buffer.byteLength(body),
    rows: table.length,
    maxColumns: Math.max(0, ...table.map((row) => row.length)),
    nonEmptyCells: table.reduce((sum, row) => sum + row.filter((cell) => String(cell).trim()).length, 0),
  };
}

const results = [];
for (const gid of [AUTOPLUS_GID_MAIN, AUTOPLUS_GID_PROMO]) {
  results.push(await probe('export', gid));
  results.push(await probe('gviz', gid));
}

const masterJson = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
const entries = (Array.isArray(masterJson) ? masterJson : masterJson.entries) || [];
const startedAt = performance.now();
const imported = await importAutoplusMerged({
  url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
  providerCode: 'RP023',
  entries,
  depositRule: 'rent_multiple',
  fetchTable: async (_url, gid, options) => {
    if (options?.visibleRowsOnly) {
      throw new Error('CSV export는 숨김 행을 포함하므로 실제 오토플러스 유입 정본이 아닙니다');
    }
    const response = await fetch(
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`,
      { headers: { 'User-Agent': 'freepasserp4-autoplus-export-benchmark/1.0' }, signal: AbortSignal.timeout(30_000) },
    );
    if (!response.ok) throw new Error(`export/${gid}: HTTP ${response.status}`);
    return parseDelimited(await response.text());
  },
});

console.log(JSON.stringify({
  mode: 'READ_ONLY_SHAPE_ONLY',
  results,
  exportImport: {
    elapsedMs: Math.round(performance.now() - startedAt),
    total: imported.total,
    imported: imported.imported,
    excluded: imported.excludedCount,
    noPrice: imported.noPriceCount,
    blockingDuplicates: imported.blockingDuplicateCount,
  },
}, null, 2));
