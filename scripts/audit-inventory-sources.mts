/**
 * ERP4 공급사 시트 전수 read-only 감사.
 * 실제 관리자/cron과 같은 fetchAllPartnerSheets 경로를 호출하며 RTDB write는 하지 않는다.
 */
// `--override-virtual`은 운영 roster에 없는 공급원을 메모리에만 주입해 검증한다.
import { readFileSync } from 'node:fs';
import { sign } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import nextEnv from '@next/env';
import {
  fetchAllPartnerSheets,
  findSheetSyncExistingConflicts,
  partnerSourceReadiness,
  sheetSyncCommitBlockReason,
} from '../lib/domain/sheet-sync-all';
import { applySheetConflictResolutions } from '../lib/domain/sheet-conflict-resolution';
import { buildPriceChangesValue } from '../lib/domain/sheet-conflict-report';
import { findPlateHeaderRow, SHEET_ADAPTERS } from '../lib/domain/sheet-adapters';
import { isExactRealPlate, TEMP_PLATE_RE } from '../lib/domain/product';
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

async function visibleTable(
  url: string,
  gid?: string,
  options: SheetTableFetchOptions = {},
): Promise<string[][]> {
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
  // hyperlink·chipRuns — 차번 셀 사진 링크. 서버 google-sheet-visible 과 동일 필드.
  const fields = [
    'sheets(properties(sheetId,title,hidden)',
    'data(startRow,rowData(values(formattedValue,effectiveValue,hyperlink,chipRuns(chip(richLinkProperties(uri))))),rowMetadata(hiddenByFilter,hiddenByUser)))',
  ].join(',');
  const body = await getJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&ranges=${encodeURIComponent(a1Title)}&fields=${encodeURIComponent(fields)}`,
  );
  const result = visibleRowsFromGridResponse(body, gid);
  if (options.onPhotoByPlate && result.photoByPlate) {
    options.onPhotoByPlate(result.photoByPlate);
  }
  return result.rows;
}

async function fetchTable(
  url: string,
  gid?: string,
  options: SheetTableFetchOptions = {},
): Promise<string[][]> {
  if (options.visibleRowsOnly) return visibleTable(url, gid, options);
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
  let target = partnerRows.find((partner) => String(partner.partner_code || partner._key || '') === overrideCode);
  if (!target && process.argv.includes('--override-virtual')) {
    target = {
      _key: overrideCode,
      partner_code: overrideCode,
      name: overrideCode,
      partner_name: overrideCode,
      partner_type: '공급사',
      status: 'active',
    } as EntityRecord;
    partnerRows.push(target);
  }
  if (!target) {
    throw new Error(`공급사 설정 없음(${overrideCode}) — 운영 write 없이 원본만 검증하려면 --override-virtual 사용`);
  }
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
  const targets = partnerRows.filter((partner) => /아이카|이안카|아이언|렌트존/i.test(
    `${String(partner.name || '')} ${String(partner.partner_name || '')}`,
  ));
  console.log('\n아이카·이안카·아이언·렌트존 공급사 설정 · 쓰기 없음');
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
    const malformedRows = prepared.slice(1).flatMap((row, rowOffset) => {
      const expected = String(row[preparedPlateColumn] || '').trim();
      if (!expected || isExactRealPlate(expected)) return [];
      const otherPlateColumns = row.flatMap((cell, column) => isExactRealPlate(cell) ? [column] : []);
      return [{
        row: rowOffset + headerRow + 2,
        expectedKind: /^https?:\/\//i.test(expected) ? 'url' : 'text',
        otherPlateColumns,
        nonEmptyColumns: row.flatMap((cell, column) => String(cell || '').trim() ? [column] : []),
      }];
    });
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
    if (malformedRows.length) console.log(`       비정상 행 구조(값 마스킹): ${JSON.stringify(malformedRows.slice(0, 12))}`);
  }
}

console.log(`\n공급사 시트 ${fetched.lines.length}곳 · 실제 ERP4 동기화 경로 · 쓰기 없음\n`);
for (const line of fetched.lines) {
  const readiness = partnerSourceReadiness(line);
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
    `개별판정 ${readiness.status === 'ready' ? '반영가능' : readiness.status === 'review' ? `확인필요(${readiness.reasons.join('·')})` : `차단(${readiness.reasons.join('·')})`}`,
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

// ── 차번 크로스체크 — 실차번 / 임시번호(100신·번호미정 신차) / 그 외 ─────────────────
{
  const plateOf = (row: EntityRecord) => String(row.car_number || '').replace(/\s/g, '');
  const isTemp = (row: EntityRecord) => {
    const plate = plateOf(row);
    return row.is_pending_plate === true || TEMP_PLATE_RE.test(plate);
  };
  type Bucket = { real: number; temp: number; other: number; plates: Set<string>; tempPlates: Set<string> };
  const empty = (): Bucket => ({ real: 0, temp: 0, other: 0, plates: new Set(), tempPlates: new Set() });
  const total = empty();
  const per = new Map<string, Bucket>();
  for (const line of fetched.lines) {
    const bucket = empty();
    for (const row of line.products) {
      const plate = plateOf(row);
      if (isTemp(row)) {
        bucket.temp += 1;
        if (plate) bucket.tempPlates.add(plate);
        total.temp += 1;
        if (plate) total.tempPlates.add(plate);
      } else if (isExactRealPlate(plate)) {
        bucket.real += 1;
        bucket.plates.add(plate);
        total.real += 1;
        total.plates.add(plate);
      } else {
        bucket.other += 1;
        total.other += 1;
      }
    }
    per.set(line.code, bucket);
  }
  console.log('\n══ 차번 크로스체크 (반영분만 · 출고불가·계약중 제외 후) ══');
  console.log('  공급사                 실차번  임시번호  기타  실차번고유  임시고유');
  for (const line of fetched.lines) {
    const b = per.get(line.code) || empty();
    if (!b.real && !b.temp && !b.other) continue;
    const label = `${line.code} ${line.label}`.padEnd(22).slice(0, 22);
    console.log(
      `  ${label} ${String(b.real).padStart(6)} ${String(b.temp).padStart(8)} ${String(b.other).padStart(4)}`
      + ` ${String(b.plates.size).padStart(10)} ${String(b.tempPlates.size).padStart(8)}`,
    );
  }
  const realDup = total.real - total.plates.size;
  const tempDup = total.temp - total.tempPlates.size;
  console.log(
    `\n  합계  실차번 ${total.real}대(고유 ${total.plates.size}`
    + `${realDup > 0 ? ` · 중복표기 ${realDup}` : ''})`
    + ` · 임시번호 ${total.temp}대(고유 ${total.tempPlates.size}`
    + `${tempDup > 0 ? ` · 중복표기 ${tempDup}` : ''})`
    + ` · 기타 ${total.other}`
    + ` · 총 ${total.real + total.temp + total.other}대`,
  );
  console.log('  ※ 임시번호 = 시트 번호미정·구매예정 신차에 붙인 100신NNNN (실번호 아님, 재고엔 포함)');
  console.log('  ※ 아이언 홈페이지(RP006)는 시트 roster 밖 — 별도 홈페이지 검증 숫자와 합산');

  // ERP에 이미 저장된 매물과 대조 (부재차단·미반영분 포함해 임시번호가 남아 있는지)
  const productsV4 = await db.ref('v4/products').get();
  const erpRows = Object.entries((productsV4.val() || {}) as Record<string, EntityRecord>)
    .map(([key, row]) => ({ ...row, _key: key }))
    .filter((row) => row && typeof row === 'object'
      && row._deleted !== true
      && !row.deletedAt
      && String(row.status || '') !== 'deleted');
  let erpReal = 0;
  let erpTemp = 0;
  let erpOther = 0;
  const erpTempByProv = new Map<string, number>();
  for (const row of erpRows) {
    const plate = plateOf(row);
    const prov = String(row.provider_company_code || row.partner_code || '?');
    if (isTemp(row)) {
      erpTemp += 1;
      erpTempByProv.set(prov, (erpTempByProv.get(prov) || 0) + 1);
    } else if (isExactRealPlate(plate)) erpReal += 1;
    else erpOther += 1;
  }
  console.log('\n══ ERP v4 활성 매물 차번 (저장본 · 시트 반영 전 상태) ══');
  console.log(
    `  활성 ${erpRows.length} · 실차번 ${erpReal} · 임시번호 ${erpTemp} · 기타 ${erpOther}`,
  );
  if (erpTempByProv.size) {
    const bits = [...erpTempByProv.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code, n]) => `${code} ${n}`);
    console.log(`  임시번호 공급사별: ${bits.join(' · ')}`);
  } else {
    console.log('  임시번호 0 — 저장본에도 번호미정(100신) 매물 없음');
  }
  console.log(
    `  대조: 시트반영 ${total.real + total.temp} (실 ${total.real}+임 ${total.temp})`
    + ` vs ERP활성 ${erpRows.length} (실 ${erpReal}+임 ${erpTemp}+기 ${erpOther})`,
  );
}

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

  // `--conflict-detail` — 차단 사유를 요약이 아니라 «어느 차 무엇 때문인지»로 펼친다.
  // 사유 문자열만 보면 운영자가 원본에서 무엇을 고쳐야 할지 알 수 없어 매번 재조사를 반복하게 된다.
  if (process.argv.includes('--conflict-detail')) {
    const raw = findSheetSyncExistingConflicts(fetched, activeProducts, deletedProducts);
    // 미리보기·커밋 경계·일일동기화와 **같은 판정**(2026-08-07 이후 SSOT = buildPriceChangesValue).
    const priceChangesValue = buildPriceChangesValue({
      conflicts: raw,
      existing: activeProducts,
      deleted: deletedProducts,
      incoming: fetched.products,
      contracts: [...mergedContracts.values()],
      providerCodes: fetched.lines.map((line) => line.code),
    });
    const resolved = applySheetConflictResolutions({
      conflicts: raw, resolutions, existing: activeProducts, contracts: [...mergedContracts.values()],
      priceChangesValue,
    }).conflicts;

    // 승인이 필요한 건과 자동 통과한 건을 갈라 보여준다. 예전엔 이 판정이 화면에만 있어
    // 「화면에선 승인할 것도 없는데 반영은 막히는」 데드락이 났다(2026-08-07 수정).
    const rawMissing = raw.missingPricePeriods || [];
    const stillBlocking = resolved.missingPricePeriods || [];
    const autoPassed = rawMissing.filter((item) => !stillBlocking.includes(item));
    console.log('\n■ 가격기간 누락 — 승인이 필요한가');
    console.log(`   원본 충돌                                    ${rawMissing.length}건`);
    console.log(`   자동 통과(금액 무변화·승인 이력)               ${autoPassed.length}건`);
    console.log(`   ★남은 차단 — 승인 필요                        ${stillBlocking.length}건`);
    for (const item of stillBlocking.slice(0, 20)) {
      console.log(`       ${item}${priceChangesValue(item) ? ' · 금액 변경 있음(승인 후보)' : ' · 계약보호 등 다른 사유'}`);
    }
    console.log('\n충돌 상세 · 승인 반영 후 (괄호는 승인 전 원본 건수)');
    for (const [label, key] of [
      ['활성 중복차번', 'activeTwins'],
      ['공급사 간 차번 소유 충돌', 'crossProviderPlateConflicts'],
      ['삭제매물 재등장', 'deletedCollisions'],
      ['공급사 미확정 삭제이력 충돌', 'unownedDeletedMatches'],
      ['수기 출고불가 해제 후보', 'manualReactivations'],
      ['임시번호→실차번 연결 후보', 'pendingIdentityTransitions'],
      ['번호미정 식별자 변경 후보', 'pendingIdentityDrifts'],
      ['임시번호 신원서명 불일치', 'pendingSignatureConflicts'],
      ['기존 가격기간 누락', 'missingPricePeriods'],
      ['공급사 미확정 기존차 충돌', 'unownedLegacyMatches'],
      ['수기 출고불가 보존(차단 아님)', 'manualHoldsPreserved'],
    ] as const) {
      const after = (resolved[key] || []) as string[];
      const before = (raw[key] || []) as string[];
      if (!before.length && !after.length) continue;
      console.log(`\n  ■ ${label} — ${after.length}건 (${before.length})`);
      for (const item of after.slice(0, 60)) console.log(`       ${item}`);
      if (after.length > 60) console.log(`       … 그 외 ${after.length - 60}건`);
    }
  }
}

process.exit(blockReason || requiredBlockReason || planBlocked ? 1 : 0);
