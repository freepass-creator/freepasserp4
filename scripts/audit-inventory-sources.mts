/**
 * ERP4 공급사 시트 전수 read-only 감사.
 * 실제 관리자/cron과 같은 fetchAllPartnerSheets 경로를 호출하며 RTDB write는 하지 않는다.
 */
import { readFileSync } from 'node:fs';
import { sign } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import nextEnv from '@next/env';
import {
  fetchAllPartnerSheets,
  sheetSyncCommitBlockReason,
} from '../lib/domain/sheet-sync-all';
import { findPlateHeaderRow, SHEET_ADAPTERS } from '../lib/domain/sheet-adapters';
import { isExactRealPlate } from '../lib/domain/product';
import { AUTOPLUS_GID_MAIN, AUTOPLUS_GID_PROMO } from '../lib/domain/sheet-autoplus';
import { canonSheetVehicleStatus } from '../lib/domain/sheet-import';
import { planDailySheetSync } from '../lib/domain/sheet-daily-sync';
import type { SheetConflictResolution } from '../lib/domain/sheet-conflict-resolution';
import {
  parseDelimited,
  type SheetTableFetchOptions,
} from '../lib/domain/sheet-import';
import { extractGoogleSheetId, resolveGoogleSheetCsvUrl } from '../lib/domain/sheet-url';
import { visibleRowsFromGridResponse, type SheetsGridResponse } from '../lib/domain/sheet-visible-grid';
import type { EntityRecord } from '../lib/intake/entities';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

nextEnv.loadEnvConfig(process.cwd());

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const localEnv = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).flatMap((line) => {
    if (!line.trim() || /^\s*#/.test(line)) return [];
    const index = line.indexOf('=');
    if (index < 1) return [];
    return [[line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, '')]];
  }),
);
const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(localEnv.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });

let token = '';

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
async function sheetsToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = String(sa.token_uri || 'https://oauth2.googleapis.com/token');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = sign('RSA-SHA256', Buffer.from(unsigned), String(sa.private_key)).toString('base64url');
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(body.error_description || `Google OAuth ${response.status}`);
  return body.access_token;
}

async function visibleTable(url: string, gid?: string): Promise<string[][]> {
  const id = extractGoogleSheetId(url);
  if (!id || !gid) throw new Error('숨김 행 제외 연동은 일반 시트 URL과 gid가 필요합니다');
  if (!token) token = await sheetsToken();
  const getJson = async (apiUrl: string): Promise<SheetsGridResponse & { error?: { message?: string } }> => {
    const response = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json().catch(() => ({})) as SheetsGridResponse & { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message || `Google Sheets API ${response.status}`);
    return body;
  };
  const metadata = await getJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden))')}`,
  );
  const target = metadata.sheets?.find((sheet) => sheet.properties?.sheetId === Number(gid));
  if (!target?.properties) throw new Error(`Google Sheet 탭 없음(gid ${gid})`);
  if (target.properties.hidden) throw new Error(`숨김 탭은 연동할 수 없습니다(${target.properties.title || gid})`);
  const a1Title = `'${String(target.properties.title || '').replace(/'/g, "''")}'`;
  const fields = [
    'sheets(properties(sheetId,title,hidden)',
    'data(startRow,rowData(values(formattedValue,effectiveValue)),rowMetadata(hiddenByFilter,hiddenByUser)))',
  ].join(',');
  const body = await getJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&ranges=${encodeURIComponent(a1Title)}&fields=${encodeURIComponent(fields)}`,
  );
  return visibleRowsFromGridResponse(body, gid).rows;
}

async function fetchTable(
  url: string,
  gid?: string,
  options: SheetTableFetchOptions = {},
): Promise<string[][]> {
  if (options.visibleRowsOnly) return visibleTable(url, gid);
  const response = await fetch(resolveGoogleSheetCsvUrl(url, gid), {
    redirect: 'follow',
    headers: { 'User-Agent': 'freepasserp4-inventory-source-audit/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`시트 로드 실패 ${response.status}`);
  const text = await response.text();
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('시트 비공개 또는 로그인 HTML 응답');
  return parseDelimited(text);
}

function rows(raw: unknown): EntityRecord[] {
  return Object.entries((raw || {}) as Record<string, EntityRecord>)
    .filter(([, row]) => row && typeof row === 'object')
    .map(([key, row]) => ({ ...row, _key: key, partner_code: row.partner_code || key }));
}

function mergePartners(v3: EntityRecord[], v4: EntityRecord[]): EntityRecord[] {
  const result = new Map<string, EntityRecord>();
  for (const row of v3) result.set(String(row._key), row);
  for (const row of v4) result.set(String(row._key), { ...(result.get(String(row._key)) || {}), ...row });
  return [...result.values()];
}

const db = getDatabase();
const [v3Partners, v4Partners] = await Promise.all([
  db.ref('partners').get(),
  db.ref('v4/partners').get(),
]);
const partnerRows = mergePartners(rows(v3Partners.val()), rows(v4Partners.val()));
const overrideCode = (process.argv.find((arg) => arg.startsWith('--override-code=')) || '').slice('--override-code='.length).trim();
const overrideUrl = (process.argv.find((arg) => arg.startsWith('--override-url=')) || '').slice('--override-url='.length).trim();
const overrideGids = (process.argv.find((arg) => arg.startsWith('--override-gids=')) || '').slice('--override-gids='.length).trim();
const overrideAdapter = (process.argv.find((arg) => arg.startsWith('--override-adapter=')) || '').slice('--override-adapter='.length).trim();
if (overrideCode && overrideUrl) {
  const target = partnerRows.find((partner) => String(partner.partner_code || partner._key || '') === overrideCode);
  if (!target) throw new Error(`공급사 설정 없음(${overrideCode})`);
  target.sheet_url = overrideUrl;
  target.sheet_gid = overrideGids;
  target.sheet_tab = overrideGids;
  target.adapter_id = overrideAdapter || 'generic';
  if (process.argv.includes('--override-activate')) {
    target._deleted = false;
    target.deletedAt = '';
    target.status = 'active';
    target.partner_type = '공급사';
  }
}
const requiredSupplierCodes = new Set(
  process.argv
    .filter((arg) => arg.startsWith('--require='))
    .flatMap((arg) => arg.slice('--require='.length).split(','))
    .map((code) => code.trim())
    .filter(Boolean),
);
if (process.argv.includes('--list-target-partners')) {
  const targets = partnerRows.filter((partner) => /아이카|이안카|아이언/i.test(
    `${String(partner.name || '')} ${String(partner.partner_name || '')}`,
  ));
  console.log('\n아이카·이안카·아이언 공급사 설정 · 쓰기 없음');
  for (const partner of targets) {
    console.log([
      String(partner.partner_code || partner._key || '(코드없음)'),
      String(partner.name || partner.partner_name || '(이름없음)'),
      `시트=${String(partner.sheet_url || '').trim() ? '있음' : '없음'}`,
      `gid=${String(partner.sheet_gid || partner.sheet_tab || '').trim() || '없음'}`,
      `원본=${String(partner.inventory_source || partner.source_type || '').trim() || '미지정'}`,
      `삭제=${partner._deleted === true || !!partner.deletedAt || String(partner.status || '') === 'deleted' ? '예' : '아니오'}`,
    ].join(' · '));
    if (String(partner.partner_code || partner._key || '') === 'RP031') {
      const sourceFields = Object.entries(partner)
        .filter(([key, value]) => /sheet|url|link|inventory|source/i.test(key) && String(value ?? '').trim())
        .map(([key, value]) => `${key}=${String(value).slice(0, 240)}`);
      console.log(`       연결 관련 필드: ${sourceFields.length ? sourceFields.join(' · ') : '없음'}`);
    }
  }
  if (!targets.length) console.log('일치 공급사 없음');
  if (process.argv.includes('--list-only')) process.exit(0);
}
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
const master = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];
const fetched = await fetchAllPartnerSheets('freepass', master, {
  partnerRows,
  fetchTable,
});
const fetchedCodes = new Set(fetched.lines.map((line) => line.code));
const missingRequired = [...requiredSupplierCodes].filter((code) => !fetchedCodes.has(code));

if (process.argv.includes('--inspect-autoplus')) {
  const autoplus = partnerRows
    .find((partner) => /autoplus|오토플러스|RP023/i.test(
      `${String(partner.partner_code || partner._key || '')} ${String(partner.name || partner.partner_name || '')}`,
    ));
  const url = String(autoplus?.sheet_url || '');
  if (!url) throw new Error('오토플러스 시트 URL 없음');
  console.log('\n오토플러스 원본 블록 점검');
  for (const [label, gid] of [['본', AUTOPLUS_GID_MAIN], ['프로모션', AUTOPLUS_GID_PROMO]] as const) {
    const table = await visibleTable(url, gid);
    const headerRow = findPlateHeaderRow(table);
    const header = table[headerRow] || [];
    const plateColumn = header.findIndex((cell) => /^(차량번호|차번|차번호|등록번호)$/.test(String(cell || '').replace(/\s/g, '')));
    const plateAt = (row: string[]) => String(row?.[plateColumn] || '').replace(/\s/g, '');
    const contiguous: string[] = [];
    for (let index = headerRow + 1; index < table.length; index++) {
      const plate = plateAt(table[index]);
      if (!isExactRealPlate(plate)) break;
      contiguous.push(plate);
    }
    const allPlates = table.slice(Math.max(0, headerRow + 1)).map(plateAt).filter(isExactRealPlate);
    const later = allPlates.slice(contiguous.length);
    console.log(`  ${label} · 헤더 ${headerRow + 1}번째 판독행 · 바로 아래 연속 ${contiguous.length}대 · 전체 번호판행 ${allPlates.length}대 · 후단 ${later.length}대`);
    if (later.length) console.log(`       후단 표본: ${later.slice(0, 8).join(', ')}`);
    const prepared = label === '본'
      ? SHEET_ADAPTERS.autoplus.prepareTable(table)
      : table.slice(headerRow);
    const preparedHeader = prepared[0] || [];
    const preparedPlateColumn = preparedHeader.findIndex((cell) => /^(차량번호|차번|차번호|등록번호)$/.test(String(cell || '').replace(/\s/g, '')));
    const statusColumn = preparedHeader.findIndex((cell) => /^(배차상태|판매상태|상태|재고상태|출고상태|출고현황|즉시출고)$/.test(String(cell || '').replace(/\s/g, '')));
    const statuses = new Map<string, { total: number; excluded: number }>();
    for (const row of prepared.slice(1)) {
      if (!isExactRealPlate(row[preparedPlateColumn])) continue;
      const rawStatus = String(row[statusColumn] || '').trim() || '(빈값)';
      const item = statuses.get(rawStatus) || { total: 0, excluded: 0 };
      item.total++;
      if (canonSheetVehicleStatus(rawStatus) === '출고불가') item.excluded++;
      statuses.set(rawStatus, item);
    }
    console.log(`       상태: ${[...statuses.entries()].map(([status, count]) => `${status} ${count.total}${count.excluded ? `(제외 ${count.excluded})` : ''}`).join(' · ')}`);
  }
}

console.log(`\n공급사 시트 ${fetched.lines.length}곳 · 실제 ERP4 동기화 경로 · 쓰기 없음\n`);
for (const line of fetched.lines) {
  console.log([
    line.ok ? 'PASS' : 'FAIL',
    line.code,
    line.label,
    `원본 ${line.sourceRowCount}`,
    `반영 ${line.imported}`,
    `출고불가제외 ${line.excludedCount}`,
    `가격없음 ${line.noPriceCount}`,
    `무효 ${line.invalidCount}`,
    `중복 ${line.duplicateCount}`,
    line.message,
  ].join(' · '));
  for (const issue of line.issueSamples || []) console.log(`       - ${issue}`);
}
const sourceRows = fetched.lines.reduce((sum, line) => sum + line.sourceRowCount, 0);
const blockReason = sheetSyncCommitBlockReason(fetched);
const requiredBlockReason = missingRequired.length
  ? `필수 공급사 원본 미연결: ${missingRequired.map((code) => {
    const partner = partnerRows.find((row) => String(row.partner_code || row._key || '') === code);
    return `${String(partner?.name || partner?.partner_name || code)}(${code})`;
  }).join(', ')}`
  : '';
console.log(`\n합계 원본 ${sourceRows} · 반영 ${fetched.products.length} · 상태 ${blockReason || requiredBlockReason ? 'BLOCKED' : 'PASS'}`);
if (blockReason || requiredBlockReason) console.log(`차단 사유: ${[blockReason, requiredBlockReason].filter(Boolean).join(' · ')}`);

let planBlocked = false;
if (process.argv.includes('--plan')) {
  const [productsV4, contractsV3, contractsV4, resolutionsV4] = await Promise.all([
    db.ref('v4/products').get(),
    db.ref('contracts').get(),
    db.ref('v4/contracts').get(),
    db.ref('v4/sheet_conflict_resolutions').get(),
  ]);
  const keyedRows = (raw: unknown): EntityRecord[] => Object.entries((raw || {}) as Record<string, EntityRecord>)
    .filter(([, row]) => row && typeof row === 'object')
    .map(([key, row]) => ({ ...row, _key: key, product_code: row.product_code || key }));
  const allProducts = keyedRows(productsV4.val());
  const activeProducts = allProducts.filter((row) => row._deleted !== true && !row.deletedAt && String(row.status || '') !== 'deleted');
  const deletedProducts = allProducts.filter((row) => row._deleted === true || !!row.deletedAt || String(row.status || '') === 'deleted');
  const mergedContracts = new Map<string, EntityRecord>();
  for (const row of keyedRows(contractsV3.val())) mergedContracts.set(String(row._key), row);
  for (const row of keyedRows(contractsV4.val())) {
    const key = String(row._key);
    mergedContracts.set(key, { ...(mergedContracts.get(key) || {}), ...row });
  }
  const resolutions = Object.values((resolutionsV4.val() || {}) as Record<string, SheetConflictResolution>)
    .filter((row) => row && typeof row === 'object');
  const plan = planDailySheetSync({
    fetched,
    existing: activeProducts,
    deleted: deletedProducts,
    partners: partnerRows,
    contracts: [...mergedContracts.values()],
    resolutions,
  });
  console.log('\nERP4 재고 대조 계획 · 쓰기 없음');
  console.log(`  현재 활성 ${activeProducts.length} · 삭제이력 ${deletedProducts.length}`);
  console.log(`  신규 ${plan.counts.created} · 수정 ${plan.counts.updated} · 원본부재 출고불가 ${plan.counts.absentBlocked}`);
  console.log(`  결과 ${plan.ok ? 'PASS' : 'BLOCKED'}${plan.blockReason ? ` · ${plan.blockReason}` : ''}`);
  for (const note of (plan.notes || []).slice(0, 20)) console.log(`       - ${note}`);
  planBlocked = !plan.ok;
}

process.exit(blockReason || requiredBlockReason || planBlocked ? 1 : 0);
