/**
 * 공급사 정제/제공시트에서 나간 결과가 세 갈래에 같은 차량으로 도착했는지 읽기 전용으로 대조한다.
 *   1) ERP: scripts/audit-sheet-erp-parity.mts가 담당
 *   2) ~~공급사 파일 「상품시트」~~ — **폐지(2026-08-21 탭 규격 통일).** 탭이 없는 것이 정상이라
 *      「없음」을 문제로 세지 않는다. 되살리면 SUPPLIER_PREVIEW_RETIRED 를 false 로.
 *   3) 영업채널(현재 천이컴퍼니): 이 파일에서 공급사 재고와 카드의 차량·표시값을 대조
 *
 * 이 감사기는 Google API GET만 사용한다. 시트·ERP를 수정하지 않는다.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { pickPublishedSalesTabs } from '../lib/domain/sales-published-tabs';
import { SALES_SHEET_ID } from '../lib/domain/legacy-sheets';
import { SUPPLIER_PREVIEW_TAB, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

/**
 * ★공급사 시트 「상품시트」 탭 폐지(사장님 2026-08-21 — 「재고탭이랑 운영정책 공지사항 회사정보 이거만 있을거야」).
 *   탭이 없어도 문제로 세지 않는다. 되살리려면 false 로 바꾸고 run-daily ⓪·④ 를 되돌린다.
 */
const SUPPLIER_PREVIEW_RETIRED = true;
import { parsePublishedSalesMapping } from '../lib/domain/sales-sheet-mapping';
import { publishedSalesColumns } from '../lib/domain/sales-published-tabs';
import {
  buildSupplierPreviewValues,
  compareSheetMatrices,
  normalizeSupplierLabel,
  supplierSalesLabel,
  type SupplierPreviewBlock,
} from '../lib/domain/supplier-preview-parity';
import {
  buildCard,
  cardPolicy,
  CARD_EXCLUDE,
  CHANNELS,
  S,
  toCardVehicle,
  type Rec,
} from '../lib/domain/channel-card-sheet';

const credentials = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: credentials.client_email,
  key: credentials.private_key,
  // Workspace 도메인 위임에 이미 등록된 기존 자동화 범위다. 감사기 자체는 아래 call()의 GET만 사용한다.
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const PARTNER_REGISTRY_ID = '1TpYMQh9yxMjww7OjxIkQIC79Uig4tKJamkFeTxjtr68';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function call(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const { token } = await jwt.getAccessToken();
    const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    const text = await response.text();
    if (response.ok) return text ? JSON.parse(text) : {};
    if ((response.status === 429 || response.status >= 500) && attempt < 6) {
      await sleep(Math.min(60_000, 5_000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${response.status} ${text.slice(0, 400)}`);
  }
}

const values = async (id: string, range: string): Promise<string[][]> =>
  (await call(`${SHEETS}/${id}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`)).values || [];
const assertBelowRowCap = (grid: string[][], cap: number, label: string) => {
  if (grid.length >= cap) throw new Error(`${label} 조회가 ${cap}행 상한에 닿음 — 범위를 늘리지 않으면 성공 판정 금지`);
};

type SalesBlock = SupplierPreviewBlock & { links: Map<number, string> };

async function salesBySupplier(): Promise<{ tabs: string[]; blocks: Map<string, SalesBlock[]> }> {
  const meta = await call(`${SHEETS}/${SALES_SHEET_ID}?fields=sheets.properties(title,hidden)`);
  const tabs = pickPublishedSalesTabs((meta.sheets || []).filter((sheet: Rec) => !sheet.properties.hidden).map((sheet: Rec) => S(sheet.properties.title)));
  const handover = await values(SALES_SHEET_ID, "'AI 인계'!A1:C400");
  const baseColumns = parsePublishedSalesMapping(handover).columns;
  const blocks = new Map<string, SalesBlock[]>();
  for (const tab of tabs) {
    const grid = await values(SALES_SHEET_ID, `'${tab.title.replace(/'/g, "''")}'!A1:CZ2000`);
    assertBelowRowCap(grid, 2000, `판매시트 ${tab.title}`);
    const header = (grid[0] || []).map(S);
    const expectedHeader = publishedSalesColumns(tab.prefix, baseColumns);
    const firstHeaderDiff = Array.from({ length: Math.max(header.length, expectedHeader.length) }, (_, index) => index)
      .find((index) => header[index] !== expectedHeader[index]);
    if (firstHeaderDiff !== undefined) {
      throw new Error(`판매시트 ${tab.title} 열 규격 불일치 — 실제 ${header.length}열 · 기대 ${expectedHeader.length}열 · 첫 차이 ${firstHeaderDiff + 1}열(${header[firstHeaderDiff] || '없음'} ≠ ${expectedHeader[firstHeaderDiff] || '없음'})`);
    }
    const supplierIndex = header.indexOf('공급사');
    const plateIndex = header.indexOf('차량번호');
    if (supplierIndex < 0 || plateIndex < 0) continue;
    for (const row of grid.slice(1)) {
      if (!S(row[plateIndex])) continue;
      const label = supplierSalesLabel(row[supplierIndex]);
      const list = blocks.get(label) || [];
      let block = list.find((item) => item.prefix === tab.prefix);
      if (!block) {
        block = { prefix: tab.prefix, header, rows: [], links: new Map() };
        list.push(block);
        blocks.set(label, list);
      }
      block.rows.push(row.map(S));
    }
  }
  return { tabs: tabs.map((tab) => tab.title), blocks };
}

type SupplierAudit = {
  supplier: string;
  expectedVehicles: number;
  expectedRows: number;
  actualRows: number;
  mismatchedCells: number;
  status: 'ok' | 'mismatch' | 'missing_tab';
};

const cellText = (cell: Rec | undefined) => S(cell?.formattedValue);
const cellLink = (cell: Rec | undefined) => S(cell?.hyperlink)
  || S((cell?.textFormatRuns || []).find((run: Rec) => run.format?.link?.uri)?.format?.link?.uri);
const sheetIdFromUrl = (url: string) => /\/spreadsheets\/d\/([^/?#]+)/.exec(url)?.[1] || '';

type ManagedSupplier = {
  company: string;
  code: string;
  sourceId: string;
  cleanId: string;
  inventory: string;
  sellable: string;
};

/** 거래처 관리대장에서 PII 열을 제외한 A:C·L:M·O:P만 읽는다. */
async function managedSuppliers(): Promise<ManagedSupplier[]> {
  const ranges = ["'공급사'!A2:C100", "'공급사'!L2:M100", "'공급사'!O2:P100"];
  const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join('&');
  const fields = 'sheets(data(startRow,startColumn,rowData(values(formattedValue,hyperlink,textFormatRuns))))';
  const grid = await call(`${SHEETS}/${PARTNER_REGISTRY_ID}?includeGridData=true&${query}&fields=${encodeURIComponent(fields)}`);
  const data = grid.sheets?.[0]?.data || [];
  const left = data[0]?.rowData || [];
  const links = data[1]?.rowData || [];
  const counts = data[2]?.rowData || [];
  const rows: ManagedSupplier[] = [];
  for (let i = 0; i < Math.max(left.length, links.length, counts.length); i++) {
    const a = left[i]?.values || [];
    if (cellText(a[0]) !== '거래중') continue;
    const lm = links[i]?.values || [];
    const op = counts[i]?.values || [];
    rows.push({
      company: cellText(a[1]), code: cellText(a[2]),
      sourceId: sheetIdFromUrl(cellLink(lm[0])), cleanId: sheetIdFromUrl(cellLink(lm[1])),
      inventory: cellText(op[0]), sellable: cellText(op[1]),
    });
  }
  return rows;
}

async function auditSupplierPreviews(sales: Awaited<ReturnType<typeof salesBySupplier>>) {
  const managed = await managedSuppliers();
  const linked = managed.filter((item) => item.cleanId);
  const linkedFiles = await Promise.all(linked.map(async (item) => {
    const file = await call(`${DRIVE}/${item.cleanId}?fields=id,name&supportsAllDrives=true`);
    return { id: item.cleanId, name: S(file.name), supplier: supplierSheetLabel(S(file.name)), company: item.company, code: item.code };
  }));
  const deprecatedLinks = linkedFiles
    .filter((file: Rec) => /구버전|폐기/.test(file.name))
    .map((file: Rec) => ({ company: file.company, code: file.code, name: file.name }));
  const supplierFiles = linkedFiles
    .filter((file: Rec) => !/구버전|폐기/.test(file.name))
    .sort((a: Rec, b: Rec) => a.supplier.localeCompare(b.supplier, 'ko'));
  const duplicateTargetIds = [...new Map(linkedFiles.map((file: Rec) => [file.id, linkedFiles.filter((candidate: Rec) => candidate.id === file.id)] as const)).values()]
    .filter((items) => items.length > 1)
    .map((items) => ({ id: items[0].id, companies: items.map((item: Rec) => `${item.company}(${item.code})`) }));
  const duplicateLabels = supplierFiles
    .map((file: Rec) => normalizeSupplierLabel(file.supplier))
    .filter((label: string, index: number, all: string[]) => all.indexOf(label) !== index);
  const results: SupplierAudit[] = [];
  for (const file of supplierFiles) {
    const salesLabel = [...sales.blocks.keys()].find((label) => normalizeSupplierLabel(label) === normalizeSupplierLabel(file.supplier));
    const blocks = salesLabel ? sales.blocks.get(salesLabel) || [] : [];
    const expected = buildSupplierPreviewValues(blocks);
    let actual: string[][] = [];
    let missing = false;
    try {
      actual = await values(file.id, `'${SUPPLIER_PREVIEW_TAB}'!A1:CZ2000`);
      assertBelowRowCap(actual, 2000, `${file.supplier} 상품시트`);
    }
    catch (error) {
      if (/Unable to parse range|400/.test(String((error as Error).message))) missing = true;
      else throw error;
    }
    const diff = compareSheetMatrices(expected, actual);
    results.push({
      supplier: file.supplier,
      expectedVehicles: blocks.reduce((total, block) => total + block.rows.length, 0),
      ...diff,
      // ★탭을 폐지했으므로 「없음」은 정상이다 — 문제로 세면 매일 빨간 불이 뜬다.
      status: missing ? (SUPPLIER_PREVIEW_RETIRED ? 'ok' : 'missing_tab') : diff.mismatchedCells ? 'mismatch' : 'ok',
    });
  }
  const unmatchedSalesSuppliers = [...sales.blocks.keys()].filter((label) =>
    !supplierFiles.some((file: Rec) => normalizeSupplierLabel(file.supplier) === normalizeSupplierLabel(label)));
  return {
    results,
    unmatchedSalesSuppliers,
    management: {
      trading: managed.length,
      linked: linked.length,
      activeTargets: supplierFiles.length,
      missingLinks: managed.filter((item) => !item.cleanId).map((item) => ({ company: item.company, code: item.code })),
      deprecatedLinks,
      duplicateTargetIds,
      duplicateLabels: [...new Set(duplicateLabels)],
      mirrorSources: managed.filter((item) => item.sourceId && item.sourceId !== item.cleanId).length,
    },
  };
}

type CardAuditRecord = { plate: string; signature: string };
const generatedCellText = (cell: Rec): string => {
  const value = cell?.userEnteredValue || {};
  if (value.stringValue !== undefined) return S(value.stringValue);
  if (value.numberValue !== undefined) return S(value.numberValue);
  if (value.boolValue !== undefined) return S(value.boolValue);
  if (value.formulaValue !== undefined) return S(value.formulaValue);
  return '';
};
const cardMatrixSignature = (matrix: unknown[][]): string => Array.from({ length: 7 }, (_, row) =>
  Array.from({ length: 13 }, (_, col) => S(matrix[row]?.[col]))).flat().join('\u241f');

async function expectedCards(block: (typeof CHANNELS)[number]['tabs'][number]['blocks'][number]): Promise<CardAuditRecord[]> {
  const grid = await values(block.sheetId, `${block.tab}!A1:BB2000`);
  assertBelowRowCap(grid, 2000, `${block.공급사} ${block.tab}`);
  const header = (grid[0] || []).map(S);
  const index = (name: string) => header.indexOf(name);
  const policyGrid = await values(block.sheetId, '운영정책!A1:BB300');
  assertBelowRowCap(policyGrid, 300, `${block.공급사} 운영정책`);
  const policyHeader = (policyGrid[0] || []).map(S);
  const codeIndex = policyHeader.indexOf('정책코드');
  const policyRow = policyGrid.slice(1).find((row) => S(row[codeIndex]) === block.정책코드);
  if (!policyRow) throw new Error(`${block.공급사} 운영정책에 ${block.정책코드} 줄이 없음`);
  const policy = Object.fromEntries(policyHeader.map((name, i) => [name, S(policyRow[i])]).filter(([name]) => name));
  const renderedPolicy = cardPolicy(policy, block.pricer, block.override);
  return grid.slice(1)
    .filter((row) => { const plate = index('차량번호'); return plate >= 0 && S(row[plate]); })
    .filter((row) => !CARD_EXCLUDE.test(S(row[index('상태')])))
    .map((row) => toCardVehicle((name: string) => { const i = index(name); return i < 0 ? '' : row[i]; }, block.pricer))
    .filter((vehicle) => !vehicle.값없음)
    .map((vehicle) => ({
      plate: vehicle.차량번호,
      signature: cardMatrixSignature(buildCard(vehicle, renderedPolicy).map((row) => row.map(generatedCellText))),
    }));
}

function actualCardSignatures(grid: string[][]): CardAuditRecord[] {
  const signatures: CardAuditRecord[] = [];
  for (let row = 0; row < grid.length; row++) {
    if (S(grid[row]?.[0]) !== '소득 증빙') continue;
    const plate = S(grid[row + 1]?.[2]).split(/\r?\n/)[0] || '';
    const matrix = Array.from({ length: 7 }, (_, offset) => Array.from({ length: 13 }, (_, col) => S(grid[row + offset]?.[col])));
    signatures.push({ plate, signature: cardMatrixSignature(matrix) });
  }
  return signatures;
}

type ChannelAudit = { channel: string; tab: string; expectedVehicles: number; actualVehicles: number; mismatchedVehicles: number; status: 'ok' | 'mismatch' };

async function auditChannels(): Promise<ChannelAudit[]> {
  const results: ChannelAudit[] = [];
  for (const channel of CHANNELS) {
    for (const tab of channel.tabs) {
      const expected = (await Promise.all(tab.blocks.map(expectedCards))).flat().sort();
      const targetGrid = await values(channel.문서, `'${tab.title.replace(/'/g, "''")}'!A1:M2000`);
      assertBelowRowCap(targetGrid, 2000, `${channel.이름} ${tab.title}`);
      const actual = actualCardSignatures(targetGrid);
      const group = (records: CardAuditRecord[]) => {
        const map = new Map<string, string[]>();
        for (const record of records) map.set(record.plate, [...(map.get(record.plate) || []), record.signature].sort());
        return map;
      };
      const expectedByPlate = group(expected);
      const actualByPlate = group(actual);
      const plates = new Set([...expectedByPlate.keys(), ...actualByPlate.keys()]);
      let mismatched = 0;
      for (const plate of plates) {
        if (JSON.stringify(expectedByPlate.get(plate) || []) !== JSON.stringify(actualByPlate.get(plate) || [])) mismatched++;
      }
      results.push({ channel: channel.이름, tab: tab.title, expectedVehicles: expected.length, actualVehicles: actual.length, mismatchedVehicles: mismatched, status: mismatched ? 'mismatch' : 'ok' });
    }
  }
  return results;
}

const sales = await salesBySupplier();
const [previews, channels] = await Promise.all([auditSupplierPreviews(sales), auditChannels()]);
const supplierProblems = previews.results.filter((result) => result.status !== 'ok');
const channelProblems = channels.filter((result) => result.status !== 'ok');
const managementProblems = previews.management.missingLinks.length
  + previews.management.deprecatedLinks.length
  + previews.management.duplicateTargetIds.length
  + previews.management.duplicateLabels.length;
const report = {
  checkedAt: new Date().toISOString(),
  salesTabs: sales.tabs,
  supplierSheets: { total: previews.results.length, ok: previews.results.length - supplierProblems.length, results: previews.results, problems: supplierProblems, unmatchedSalesSuppliers: previews.unmatchedSalesSuppliers },
  management: previews.management,
  channels: { total: channels.length, ok: channels.length - channelProblems.length, results: channels },
};
writeFileSync('tmp/pipeline-destinations-audit.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
appendFileSync('tmp/pipeline-destinations-audit.jsonl', `${JSON.stringify(report)}\n`, 'utf8');

console.log(`■ 공급사 상품시트 대조 — ${previews.results.length}곳 중 일치 ${previews.results.length - supplierProblems.length} · 불일치 ${supplierProblems.length} · 판매시트 공급사 미매칭 ${previews.unmatchedSalesSuppliers.length}`);
for (const item of supplierProblems.slice(0, 12)) console.log(`   ★ ${item.supplier}: 기대 ${item.expectedVehicles}대 · 탭 ${item.actualRows}행 · 다른 칸 ${item.mismatchedCells}`);
for (const label of previews.unmatchedSalesSuppliers) console.log(`   ★ 판매시트 공급사 「${label}」에 대응하는 관리 시트를 못 찾음`);
console.log(`■ 거래처 관리대장 — 거래중 ${previews.management.trading} · 정제/제공 링크 ${previews.management.linked} · 안전한 발행 대상 ${previews.management.activeTargets} · 링크 없음 ${previews.management.missingLinks.length} · 구버전 링크 ${previews.management.deprecatedLinks.length} · 별도 원본→정제 ${previews.management.mirrorSources}`);
if (previews.management.deprecatedLinks.length) console.log(`   ⛔ 거래중 행이 구버전·폐기 문서를 가리킴 ${previews.management.deprecatedLinks.length}`);
if (previews.management.duplicateTargetIds.length) console.log(`   ⛔ 같은 정제/제공 링크가 여러 거래중 행에 중복됨 ${previews.management.duplicateTargetIds.length}`);
if (previews.management.duplicateLabels.length) console.log(`   ⛔ 정규화한 공급사명이 중복됨 ${previews.management.duplicateLabels.length}`);
console.log(`■ 천이컴퍼니 대조 — ${channels.length}탭 중 일치 ${channels.length - channelProblems.length} · 불일치 ${channelProblems.length}`);
for (const item of channels) console.log(`   ${item.status === 'ok' ? '✓' : '★'} ${item.tab}: 원본 ${item.expectedVehicles}대 · 천이 ${item.actualVehicles}대 · 다른 카드 ${item.mismatchedVehicles}`);
console.log('■ 세 갈래 중 ERP는 audit-sheet-erp-parity 결과와 합쳐 판정 · 상세 tmp/pipeline-destinations-audit.json');
process.exit(supplierProblems.length || previews.unmatchedSalesSuppliers.length || channelProblems.length || managementProblems ? 2 : 0);
