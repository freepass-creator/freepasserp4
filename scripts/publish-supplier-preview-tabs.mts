/**
 * **공급사 시트마다 「상품시트」 탭 — 발행된 판매시트(상품리스트·손오공구독·오플구독)에서 그 공급사 줄을 그대로 옮겨 놓는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-19 — 「공급사가 입력하는 거랑 상품시트에 올라갈 거를 미리 똑같이 구현해 놓자, 공급사 정제시트에」
 *   · 한 파일 안에서 「재고 탭(공급사 입력) ↔ 상품시트 탭(올라간 값)」을 차량번호별로 바로 대조한다. 값·열·서식은 판매시트와 같다(복사본, 손으로 고치지 않는다).
 *   · 원본은 발행된 판매시트 세 탭 — 여기서 새로 계산하지 않는다(계산이 둘이면 또 갈린다). 발행 뒤(run-daily ④ 끝) 매번 다시 옮긴다.
 *   · 손오공은 렌트(상품리스트 줄)+구독(손오공구독 줄)이 한 탭에 이어 실린다(구독 줄은 요금 블록 머리글이 달라 두 표로 나눠 놓는다). 오토플러스는 오플구독 줄.
 * ★탭 이름 「상품시트」는 재고 탭이 아니다(OUR_NON_INVENTORY_TABS) — 발행기·채우기·감사가 건드리지 않는다.
 *
 *   npx tsx scripts/publish-supplier-preview-tabs.mts
 *   npx tsx scripts/publish-supplier-preview-tabs.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { pickPublishedSalesTabs } from '../lib/domain/sales-published-tabs';
import { SUPPLIER_PREVIEW_TAB, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { buildSupplierPreviewValues, normalizeSupplierLabel, supplierSalesLabel } from '../lib/domain/supplier-preview-parity';
import { buildSalesFormatRequests, columnWidths, rgb, LINK, FONT, SIZE, ITALIC } from '../lib/domain/sales-sheet-format';
import { SALES_SHEET_ID } from '../lib/domain/legacy-sheets';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = normalizeSupplierLabel;
const APPLY = process.argv.includes('--apply');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const PARTNER_REGISTRY_ID = '1TpYMQh9yxMjww7OjxIkQIC79Uig4tKJamkFeTxjtr68';

const labelOf = supplierSalesLabel;

// ── 발행된 세 탭 읽기(값 + 차량번호 링크)
const smeta = await call(`${SH}/${SALES_SHEET_ID}?fields=sheets.properties(title,hidden)`);
const tabs = pickPublishedSalesTabs(((smeta.sheets || []) as Rec[]).filter((s) => !s.properties.hidden).map((s) => S(s.properties.title)));
type Block = { prefix: string; header: string[]; rows: string[][]; links: Map<number, string> };
const bySupplier = new Map<string, Block[]>();
for (const t of tabs) {
  const g = await call(`${SH}/${SALES_SHEET_ID}?includeGridData=true&ranges=${encodeURIComponent(`'${t.title.replace(/'/g, "''")}'!A1:CZ2000`)}&fields=${encodeURIComponent('sheets(data(rowData(values(formattedValue,hyperlink,textFormatRuns))))')}`);
  const rd = (((g.sheets || [])[0]?.data || [])[0]?.rowData || []) as Rec[];
  const grid = rd.map((r) => ((r.values || []) as Rec[]).map((c) => S(c.formattedValue)));
  const header = grid[0] || []; const si = header.indexOf('공급사'); const pi = header.indexOf('차량번호');
  if (si < 0 || pi < 0) continue;
  grid.slice(1).forEach((r, k) => {
    if (!S(r[pi])) return;
    const label = labelOf(r[si]); const list = bySupplier.get(label) || []; let block = list.find((b) => b.prefix === t.prefix);
    if (!block) { block = { prefix: t.prefix, header, rows: [], links: new Map() }; list.push(block); bySupplier.set(label, list); }
    const cell = ((rd[k + 1]?.values || []) as Rec[])[pi]; const link = S(cell?.hyperlink) || S((cell?.textFormatRuns || []).find((x: Rec) => x.format?.link?.uri)?.format?.link?.uri);
    if (link.startsWith('http')) block.links.set(block.rows.length, link);
    block.rows.push(r);
  });
}
// ── 공급사 시트 목록 — 파일명 검색이 아니라 「프리패스 거래처 정리」의 거래중·정제/제공 링크만 쓴다.
// 파일명 검색은 폐기된 경진 문서까지 잡아 실제 반영 대상을 잘못 고를 수 있었다(2026-08-21 실측).
const cellText = (cell: Rec | undefined) => S(cell?.formattedValue);
const cellLink = (cell: Rec | undefined) => S(cell?.hyperlink)
  || S((cell?.textFormatRuns || []).find((run: Rec) => run.format?.link?.uri)?.format?.link?.uri);
const sheetIdFromUrl = (url: string) => /\/spreadsheets\/d\/([^/?#]+)/.exec(url)?.[1] || '';
const registryRanges = ["'공급사'!A2:C100", "'공급사'!L2:M100"];
const registryQuery = registryRanges.map((range) => `ranges=${encodeURIComponent(range)}`).join('&');
const registryFields = 'sheets(data(startRow,startColumn,rowData(values(formattedValue,hyperlink,textFormatRuns))))';
const registry = await call(`${SH}/${PARTNER_REGISTRY_ID}?includeGridData=true&${registryQuery}&fields=${encodeURIComponent(registryFields)}`);
const registryData = registry.sheets?.[0]?.data || [];
const registryLeft = registryData[0]?.rowData || [];
const registryLinks = registryData[1]?.rowData || [];
const linked: { id: string; company: string; code: string }[] = [];
const missingLinks: { company: string; code: string }[] = [];
for (let index = 0; index < Math.max(registryLeft.length, registryLinks.length); index++) {
  const left = registryLeft[index]?.values || [];
  if (cellText(left[0]) !== '거래중') continue;
  const company = cellText(left[1]);
  const code = cellText(left[2]);
  const target = sheetIdFromUrl(cellLink(registryLinks[index]?.values?.[1]));
  if (target) linked.push({ id: target, company, code });
  else missingLinks.push({ company, code });
}
const supplierMap = new Map<string, { id: string; name: string; code: string }>();
const deprecatedLinks: { company: string; code: string; name: string }[] = [];
const duplicateTargetIds: { id: string; companies: string[] }[] = [];
const linkedById = new Map<string, { company: string; code: string }[]>();
for (const item of linked) linkedById.set(item.id, [...(linkedById.get(item.id) || []), { company: item.company, code: item.code }]);
for (const [id, items] of linkedById) {
  if (items.length > 1) duplicateTargetIds.push({ id, companies: items.map((item) => `${item.company}(${item.code})`) });
}
for (const item of linked) {
  const file = await call(`${DRIVE}/${item.id}?fields=id,name&supportsAllDrives=true`);
  const fileName = S(file.name);
  if (/구버전|폐기/.test(fileName)) {
    deprecatedLinks.push({ company: item.company, code: item.code, name: fileName });
    continue;
  }
  supplierMap.set(item.id, { id: item.id, name: supplierSheetLabel(fileName) || item.company, code: item.code });
}
const suppliers = [...supplierMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
const duplicateLabels = suppliers
  .map((supplier) => norm(supplier.name))
  .filter((label, index, all) => all.indexOf(label) !== index);
const stamp = tabs.map((t) => t.title.replace(/^.*?(\d\d\.\d\d \d\d:\d\d).*$/, '$1'))[0] || '';
console.log(`■ 공급사 시트 「${SUPPLIER_PREVIEW_TAB}」 탭 ${APPLY ? '반영' : '미리보기'} — 판매시트 ${tabs.map((t) => t.title).join(' + ')} → 관리대장 링크 ${suppliers.length}곳`);
if (missingLinks.length) console.log(`  ⚠ 거래중이지만 정제/제공 링크가 없는 공급사 ${missingLinks.length}곳: ${missingLinks.map((item) => `${item.company}(${item.code})`).join(' · ')}`);
if (deprecatedLinks.length) console.log(`  ⛔ 거래중 행이 구버전·폐기 문서를 가리킴 ${deprecatedLinks.length}곳: ${deprecatedLinks.map((item) => `${item.company}(${item.code})`).join(' · ')}`);
if (duplicateTargetIds.length) console.log(`  ⛔ 같은 정제/제공 링크가 여러 거래중 행에 중복됨 ${duplicateTargetIds.length}건`);
if (duplicateLabels.length) console.log(`  ⛔ 정규화한 공급사명이 중복됨 ${[...new Set(duplicateLabels)].join(' · ')}`);
const unmatched = [...bySupplier.keys()].filter((l) => !suppliers.some((s) => norm(s.name) === norm(l)));
if (unmatched.length) console.log(`  ⚠ 시트를 못 찾은 공급사 표기: ${unmatched.join(' · ')}`);
const blockingTargetProblems = missingLinks.length + deprecatedLinks.length + duplicateTargetIds.length + duplicateLabels.length + unmatched.length;
if (APPLY && blockingTargetProblems) throw new Error('거래처 관리대장·공급사 매칭 오류를 바로잡기 전에는 상품시트 발행 금지');

// 판매시트에 0대인 대상은 정상 공백일 수 있다. 그러나 기존 상품행이 있으면 별칭 실패 가능성이 있으므로 쓰기 전에 전부 검사한다.
const suspiciousEmptyTargets: string[] = [];
if (APPLY) {
  for (const supplier of suppliers) {
    const blocks = bySupplier.get([...bySupplier.keys()].find((label) => norm(label) === norm(supplier.name)) || '') || [];
    if (blocks.some((block) => block.rows.length)) continue;
    try {
      const current = await call(`${SH}/${supplier.id}/values/${encodeURIComponent(`'${SUPPLIER_PREVIEW_TAB}'!A1:CZ2000`)}`);
      const rows = (current.values || []) as string[][];
      if (rows.length > 1 && !rows.flat().some((cell) => /발행된 판매시트에 이 공급사 줄이 없습니다/.test(S(cell)))) suspiciousEmptyTargets.push(supplier.name);
    } catch (error) {
      if (!/Unable to parse range|400/.test(String((error as Error).message))) throw error;
    }
  }
  if (suspiciousEmptyTargets.length) throw new Error(`판매시트 0대인데 기존 상품행이 있는 공급사: ${suspiciousEmptyTargets.join(' · ')} — 별칭/상태 확인 전 덮어쓰기 금지`);
}
let done = 0;
for (const s of suppliers) {
  const blocks = bySupplier.get([...bySupplier.keys()].find((l) => norm(l) === norm(s.name)) || '') || [];
  const total = blocks.reduce((n, b) => n + b.rows.length, 0);
  console.log(`  ${APPLY ? '✓' : '→'} ${s.name.padEnd(10)} ${blocks.map((b) => `${b.prefix} ${b.rows.length}대`).join(' + ') || '0대'}`);
  if (!APPLY) continue;
  const meta = await call(`${SH}/${s.id}?fields=sheets.properties(sheetId,title,index)`);
  const props = ((meta.sheets || []) as Rec[]).map((x) => x.properties as Rec);
  let gid = props.find((p) => S(p.title) === SUPPLIER_PREVIEW_TAB)?.sheetId as number | undefined;
  if (gid === undefined) {
    const stockIdx = props.find((p) => /재고/.test(S(p.title)))?.index ?? 0;
    const added = await call(`${SH}/${s.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SUPPLIER_PREVIEW_TAB, index: Number(stockIdx) + 1, gridProperties: { rowCount: Math.max(60, total + 20), columnCount: 80 } } } }] }) });
    gid = added.replies?.[0]?.addSheet?.properties?.sheetId;
  }
  // 값: 블록마다 (머리행 + 줄), 블록 사이 빈 줄 하나. 첫 블록 머리행이 표의 머리(서식 기준).
  const linkCells: { row: number; col: number; plate: string; url: string }[] = [];
  const first = blocks[0];
  const columns = first ? first.header : ['공급사', '차량번호', '(발행된 판매시트에 이 공급사 줄이 없습니다 — 출고불가만 있거나 아직 발행 전)'];
  const values = buildSupplierPreviewValues(blocks);
  blocks.forEach((b, bi) => {
    const blockStart = blocks.slice(0, bi).reduce((n, prev, prevIndex) => n + prev.rows.length + 1 + (prevIndex > 0 ? 1 : 0), 0) + (bi > 0 ? 1 : 0);
    const pi = b.header.indexOf('차량번호');
    b.rows.forEach((r, k) => { const rowIdx = blockStart + 1 + k; const url = b.links.get(k); if (url) linkCells.push({ row: rowIdx, col: pi, plate: S(r[pi]), url }); });
  });
  await call(`${SH}/${s.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ updateCells: { range: { sheetId: gid }, fields: 'userEnteredValue' } }] }) });
  await call(`${SH}/${s.id}/values/${encodeURIComponent(`'${SUPPLIER_PREVIEW_TAB}'!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values }) });
  const now = await call(`${SH}/${s.id}?fields=sheets(properties(sheetId,gridProperties(columnCount)),bandedRanges(bandedRangeId),conditionalFormats)`);
  const me = ((now.sheets || []) as Rec[]).find((x) => Number(x.properties?.sheetId) === gid) || {};
  const reqs = buildSalesFormatRequests({ gid: gid as number, columns, headerAt: 0, columnCountNow: Number(me.properties?.gridProperties?.columnCount) || columns.length, bandedRangeIds: ((me.bandedRanges || []) as Rec[]).map((b) => Number(b.bandedRangeId)), conditionalFormatCount: ((me.conditionalFormats || []) as unknown[]).length, widths: columnWidths(columns, values.slice(1)), tabTitle: '상품리스트' });
  // 두 번째 블록(구독) 머리행도 굵게·배경
  blocks.forEach((b, bi) => { if (bi === 0) return; const at = values.findIndex((r, i) => i > 0 && r === b.header); if (at > 0) reqs.push({ repeatCell: { range: { sheetId: gid, startRowIndex: at, endRowIndex: at + 1 }, cell: { userEnteredFormat: { backgroundColor: rgb('EFEFEF'), textFormat: { fontFamily: FONT, fontSize: SIZE, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } }); });
  reqs.push({ updateSheetProperties: { properties: { sheetId: gid, tabColor: rgb('4A86E8') }, fields: 'tabColor' } });
  await call(`${SH}/${s.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
  // 안내 메모(A1) + 사진 링크
  const note = `판매시트에 올라간 이 공급사 줄 그대로(${stamp} 발행). 손으로 고치지 않습니다 — 틀리면 재고 탭(원문)·정제칸을 고치고 다음 발행을 기다리세요.`;
  const linkReqs: Rec[] = [{ repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { note }, fields: 'note' } }];
  const rgbLink = rgb(LINK);
  for (const x of linkCells) linkReqs.push({ updateCells: { range: { sheetId: gid, startRowIndex: x.row, endRowIndex: x.row + 1, startColumnIndex: x.col, endColumnIndex: x.col + 1 }, rows: [{ values: [{ userEnteredValue: { stringValue: x.plate }, textFormatRuns: [{ startIndex: 0, format: { link: { uri: x.url }, foregroundColor: rgbLink, underline: true, italic: ITALIC, fontFamily: FONT, fontSize: SIZE } }] }] }], fields: 'userEnteredValue,textFormatRuns' } });
  for (let i = 0; i < linkReqs.length; i += 200) await call(`${SH}/${s.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: linkReqs.slice(i, i + 200) }) });
  done++; await sleep(600);
}
console.log(APPLY ? `  반영 ${done}곳` : '※ dry-run. 반영은 --apply');
if (!APPLY && blockingTargetProblems) process.exit(2);
