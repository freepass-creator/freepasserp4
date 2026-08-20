/**
 * Read-only AutoPlus source audit for the product-master workflow.
 *
 * Reads Google Sheets grid metadata so rows hidden by a user or filter are
 * excluded.  CSV exports must never be used for AutoPlus inventory counts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { sign } from 'node:crypto';
import nextEnv from '@next/env';
import {
  importAutoplusTables,
  prepareAutoplusPromoTable,
  AUTOPLUS_GID_MAIN,
  AUTOPLUS_GID_PROMO,
} from '../lib/domain/sheet-autoplus';
import { SHEET_ADAPTERS } from '../lib/domain/sheet-adapters';
import { visibleRowsFromGridResponse, type SheetsGridResponse } from '../lib/domain/sheet-visible-grid';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import {
  autoplusDeposit,
  productMasterSourceRowInfo,
  productMasterSupplierVehicleName,
} from '../lib/domain/product-master-sheet';

nextEnv.loadEnvConfig(process.cwd());

const SHEET_ID = '1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U';
const TARGET_SHEET_ID = '1T_RrErmGoj_yG9S1u7n--2NDolTOw8wA8ROQjPWuAlg';
const MAIN_TITLE = '판매차량리스트';
const PROMO_TITLE = '★★★  전기차(EV6,니로EV 등) 프로모션(수수료 150만원) ★★★';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).flatMap((line) => {
    if (!line.trim() || /^\s*#/.test(line)) return [];
    const index = line.indexOf('=');
    if (index < 1) return [];
    return [[line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, '')]];
  }),
);
const credentials = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  || readFileSync(env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'),
);

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = String(credentials.token_uri || 'https://oauth2.googleapis.com/token');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
    // 상품마스터 정본은 Workspace 사용자 소유다. 앱의 공식 시트 리더와 같은
    // 위임 주체를 써야 감사기만 403으로 갈라지는 계정 분기 사고가 나지 않는다.
    sub: String(process.env.GOOGLE_WORKSPACE_SUBJECT || 'pyh@teamjpk.com').trim(),
  })}`;
  const signature = sign('RSA-SHA256', Buffer.from(unsigned), String(credentials.private_key)).toString('base64url');
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(body.error_description || `OAuth ${response.status}`);
  return body.access_token;
}

async function visibleRows(token: string, gid: string, title: string) {
  const fields = [
    'sheets(properties(sheetId,title,hidden)',
    'data(startRow,rowData(values(formattedValue,effectiveValue,hyperlink,chipRuns(chip(richLinkProperties(uri))))),rowMetadata(hiddenByFilter,hiddenByUser)))',
  ].join(',');
  const a1 = `'${title.replace(/'/g, "''")}'`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?includeGridData=true&ranges=${encodeURIComponent(a1)}&fields=${encodeURIComponent(fields)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(45_000),
  });
  const body = await response.json() as SheetsGridResponse & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `Sheets ${response.status}`);
  return visibleRowsFromGridResponse(body, gid);
}

async function sheetValues(token: string, spreadsheetId: string, range: string): Promise<unknown[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json() as { values?: unknown[][]; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `Sheets values ${response.status}`);
  return body.values || [];
}

const token = await accessToken();
const [mainGrid, promoGrid] = await Promise.all([
  visibleRows(token, AUTOPLUS_GID_MAIN, MAIN_TITLE),
  visibleRows(token, AUTOPLUS_GID_PROMO, PROMO_TITLE),
]);
const masterJson = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
const entries = (Array.isArray(masterJson) ? masterJson : masterJson.entries) || [];
const result = importAutoplusTables({
  mainRaw: mainGrid.rows,
  promoRaw: promoGrid.rows,
  providerCode: 'RP023',
  entries,
  depositRule: 'rent_multiple',
  mainPhotos: mainGrid.photoByPlate,
  promoPhotos: promoGrid.photoByPlate,
  mainGid: AUTOPLUS_GID_MAIN,
  promoGid: AUTOPLUS_GID_PROMO,
  mainTabTitle: MAIN_TITLE,
  promoTabTitle: PROMO_TITLE,
});

const targetValues = process.argv.includes('--compare-target')
  ? await sheetValues(token, TARGET_SHEET_ID, '상품마스터!A1:AZ1000')
  : [];
const normalize = (value: unknown) => String(value ?? '').replace(/\s+/g, '').trim();
const sourceRowsByPlate = new Map<string, { tab: string; headers: string[]; row: string[] }>();
const rememberSourceRows = (table: string[][], tab: string, prefer: boolean) => {
  const headers = table[0] || [];
  const plateIndex = headers.findIndex((header) => normalize(header) === '차량번호');
  if (plateIndex < 0) throw new Error(`오토플러스 차량번호 열 없음(${tab})`);
  for (const row of table.slice(1)) {
    const plate = normalize(row[plateIndex]);
    if (!/^\d{2,3}[가-힣]\d{4}$/.test(plate)) continue;
    if (prefer || !sourceRowsByPlate.has(plate)) sourceRowsByPlate.set(plate, { tab, headers, row });
  }
};
rememberSourceRows(prepareAutoplusPromoTable(promoGrid.rows), PROMO_TITLE, false);
rememberSourceRows(SHEET_ADAPTERS.autoplus.prepareTable(mainGrid.rows, { headerRow: 0 }), MAIN_TITLE, true);
const money = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').replace(/[,\s₩원]/g, '');
  if (!text || ['-', '불가', '없음', 'null'].includes(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};
const targetRows = targetValues.slice(1)
  .map((row, index) => ({ rowNumber: index + 2, row }))
  .filter(({ row }) => normalize(row[46]) === 'RP023');
const sourceByPlate = new Map(result.products.map((product) => [normalize(product.car_number), product]));
const targetByPlate = new Map(targetRows.map((target) => [normalize(target.row[0]), target]));
const missing = [...sourceByPlate.keys()].filter((plate) => !targetByPlate.has(plate));
const historical = [...targetByPlate.keys()].filter((plate) => !sourceByPlate.has(plate));
const priceColumns = [
  ['12_3만', 16, 17],
  ['18_2만', 18, 19],
  ['24_2만', 20, 21],
  ['36_2만', 22, 23],
  ['18_3만', 32, 33],
  ['24_3만', 34, 35],
  ['36_3만', 36, 37],
] as const;
const priceDiffs: Array<Record<string, unknown>> = [];
for (const [plate, product] of sourceByPlate) {
  const target = targetByPlate.get(plate);
  if (!target) continue;
  const price = product.price && typeof product.price === 'object'
    ? product.price as Record<string, { rent?: unknown; deposit?: unknown }>
    : {};
  for (const [key, rentColumn, depositColumn] of priceColumns) {
    const pair = price[key];
    const expectedRent = pair ? money(pair.rent) : null;
    const months = Number(key.split('_')[0]) || 0;
    const parserDeposit = pair ? money(pair.deposit) : null;
    const parserRatio = expectedRent && parserDeposit ? parserDeposit / expectedRent : 0;
    // 원산지는 별도 제조사 사전을 복제하지 않고 공통 유입 파서가 확정한 배율에서
    // 되읽는다. 2배=국산, 3배=수입 외 값은 불확실하므로 기존 계산을 보존한다.
    const origin = parserRatio === 2 ? '국산' : parserRatio === 3 ? '수입' : '';
    // 일반 공급사 유입의 rent_multiple은 수입차를 모든 기간 ×3으로 계산한다.
    // 상품마스터 오토플러스 규격은 수입 12개월 ×3, 18개월 이상 ×6이므로
    // 감사 역시 상품마스터 SSOT 함수를 사용해야 정상 셀을 오류로 세지 않는다.
    const expectedDeposit = pair
      ? (origin && expectedRent
          ? autoplusDeposit({ rent: expectedRent, months, origin })
          : parserDeposit)
      : null;
    const actualRent = money(target.row[rentColumn]);
    const actualDeposit = money(target.row[depositColumn]);
    if (expectedRent !== actualRent || expectedDeposit !== actualDeposit) {
      priceDiffs.push({
        plate,
        key,
        row: target.rowNumber,
        expectedRent,
        expectedDeposit,
        actualRent,
        actualDeposit,
      });
    }
  }
}
const countBy = (column: number) => Object.fromEntries(
  [...targetRows.reduce((counts, target) => {
    const key = String(target.row[column] ?? '(빈칸)');
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map<string, number>())],
);

const audit = {
  at: new Date().toISOString(),
  visibleRows: { main: mainGrid.rows.length, promo: promoGrid.rows.length },
  imported: result.imported,
  main: result.mainN,
  promoOnly: result.promoOnlyN,
  skipped: result.skipped,
  excluded: result.excludedCount,
  noPrice: result.noPriceCount,
  duplicates: result.blockingDuplicateCount,
  byStatus: result.byStatus,
  comparison: {
    target: targetRows.length,
    missing,
    missingRows: missing.map((plate) => {
      const product = sourceByPlate.get(plate);
      return {
        plate,
        status: product?.vehicle_status || '',
        sourceTab: product?.sheet_source_tab || '',
        price: product?.price || {},
      };
    }),
    historical,
    historicalRows: historical.map((plate) => {
      const target = targetByPlate.get(plate)!;
      return {
        plate,
        row: target.rowNumber,
        status: target.row[7] || '',
        inputName: target.row[2] || '',
        verified: target.row[4] || '',
      };
    }),
    priceDiffs,
    targetStatuses: countBy(7),
    targetVerification: countBy(4),
  },
  products: result.products.map((product) => ({
    plate: String(product.car_number || '').replace(/\s/g, ''),
    status: product.vehicle_status || '',
    statusRaw: product.status_label_raw || '',
    inputName: [product.maker, product.model, product.sub_model, product.trim].filter(Boolean).join(' '),
    option: product.option || '',
    photo: product.photo_url || product.photo || '',
    price: product.price || {},
    masterCode: product.vehicle_master_code || product.master_code || '',
    sourceGid: product.sheet_source_gid || '',
    sourceTab: product.sheet_source_tab || '',
    sourceRowInfo: (() => {
      const source = sourceRowsByPlate.get(normalize(product.car_number));
      return source ? productMasterSourceRowInfo(source) : '';
    })(),
    sourceInputSummary: (() => {
      const source = sourceRowsByPlate.get(normalize(product.car_number));
      return source ? productMasterSupplierVehicleName(productMasterSourceRowInfo(source)) : '';
    })(),
  })),
};
const out = (process.argv.find((argument) => argument.startsWith('--out=')) || '').slice('--out='.length).trim();
if (out) writeFileSync(out, JSON.stringify(audit, null, 2), 'utf8');
console.log(JSON.stringify({
  at: audit.at,
  visibleRows: audit.visibleRows,
  imported: audit.imported,
  main: audit.main,
  promoOnly: audit.promoOnly,
  skipped: audit.skipped,
  excluded: audit.excluded,
  noPrice: audit.noPrice,
  duplicates: audit.duplicates,
  byStatus: audit.byStatus,
  comparison: audit.comparison,
  out: out || null,
}, null, 2));
