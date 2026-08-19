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
import { SHEET_NAME_MATCH, SUPPLIER_PREVIEW_TAB, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { buildSalesFormatRequests, columnWidths, rgb, LINK, FONT, SIZE, ITALIC } from '../lib/domain/sales-sheet-format';
import { SALES_SHEET_ID } from '../lib/domain/legacy-sheets';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '').toLowerCase();
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

/** 판매시트 「공급사」 표기 → 공급사 시트 라벨(다르게 적힌 것만) */
const SUPPLIER_ALIAS: Record<string, string> = { SA: '에스에이', 'J&J': '제이앤제이렌트카', 에코: '에코렌트카', 경진: '경진렌트카', 오토플러스: '오토플러스' };
const labelOf = (salesName: string) => SUPPLIER_ALIAS[S(salesName)] || S(salesName);

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
// ── 공급사 시트 목록
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const suppliers = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), name: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
const stamp = tabs.map((t) => t.title.replace(/^.*?(\d\d\.\d\d \d\d:\d\d).*$/, '$1'))[0] || '';
console.log(`■ 공급사 시트 「${SUPPLIER_PREVIEW_TAB}」 탭 ${APPLY ? '반영' : '미리보기'} — 판매시트 ${tabs.map((t) => t.title).join(' + ')} → ${suppliers.length}곳`);
const unmatched = [...bySupplier.keys()].filter((l) => !suppliers.some((s) => norm(s.name) === norm(l)));
if (unmatched.length) console.log(`  ⚠ 시트를 못 찾은 공급사 표기: ${unmatched.join(' · ')}`);
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
  const values: string[][] = []; const linkCells: { row: number; col: number; plate: string; url: string }[] = [];
  const first = blocks[0];
  const columns = first ? first.header : ['공급사', '차량번호', '(발행된 판매시트에 이 공급사 줄이 없습니다 — 출고불가만 있거나 아직 발행 전)'];
  if (!first) values.push(columns);
  blocks.forEach((b, bi) => {
    if (bi > 0) values.push([]);
    values.push(b.header);
    const pi = b.header.indexOf('차량번호');
    b.rows.forEach((r, k) => { const rowIdx = values.length; values.push(r); const url = b.links.get(k); if (url) linkCells.push({ row: rowIdx, col: pi, plate: S(r[pi]), url }); });
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
