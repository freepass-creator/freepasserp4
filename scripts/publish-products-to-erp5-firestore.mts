/**
 * 공급사 원천 Google Sheets + Google 상품마스터 -> 독립 ERP5 Firestore 상품 SSOT.
 * ERP3/ERP4 products는 읽지 않는다. 기본 dry-run, --apply는 ERP5 검증본 저장,
 * --activate는 모든 대조 blocker가 0일 때만 활성 포인터를 바꾼다.
 */
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { cert, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { JWT } from 'google-auth-library';
import { getSupplierAdapter } from '../lib/adapters';
import { SUPPLIER_SOURCES, type SupplierSourceSpec } from '../lib/adapters/source-registry';
import { composeProductForErp5, type Erp5ProductComposition } from '../lib/domain/erp5-product-ssot';
import {
  DEFAULT_PRODUCT_MASTER_SHEET_ID,
  PRODUCT_MASTER_GID,
  PRODUCT_MASTER_MANUAL_TAB,
  PRODUCT_MASTER_TAB,
} from '../lib/domain/product-master-sheet';
import { applyProductMasterManualGate, importProductMasterSheet } from '../lib/domain/product-master-import';
import { adoptedSpecByKey } from '../lib/domain/product-vehicle-normalization';
import { loadProductVehicleReviewDecisions } from '../lib/domain/product-vehicle-review-decisions';
import { VEHICLE_MASTER_REVIEW_ADOPTION_TAB } from '../lib/domain/vehicle-master-review-promotion';
import type { VehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import type { AdapterIssue, FreepassAtom, RawSupplierRow } from '../lib/domain/supplier-adapter';
import { ssotContentHash } from '../lib/domain/ssot-content-hash';

const APPLY = process.argv.includes('--apply');
const ACTIVATE = process.argv.includes('--activate');
const arg = (name: string) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3) || '';
const VERSION_ID = arg('version') || new Date().toISOString().replace(/[-:.]/g, '');
const TARGET_PROJECT_ID = process.env.ERP5_FIREBASE_PROJECT_ID || 'erp5-3e2fc';
const VEHICLE_MASTER_VERSION_ID = arg('vehicle-version') || process.env.ERP5_VEHICLE_MASTER_VERSION_ID || '';
const PRODUCT_MASTER_SHEET_ID = process.env.PRODUCT_MASTER_SHEET_ID || DEFAULT_PRODUCT_MASTER_SHEET_ID;
const VERSIONS_COLLECTION = 'productMasterVersions';
if (!/^[A-Za-z0-9._-]{1,120}$/.test(VERSION_ID)) throw new Error(`version ID 형식 오류: ${VERSION_ID}`);
if (!/^[A-Za-z0-9_-]+$/.test(PRODUCT_MASTER_SHEET_ID)) throw new Error('상품마스터 Sheet ID 형식 오류');
if (ACTIVATE) throw new Error('직접 활성화는 금지합니다. 검증 draft 저장 후 promote-erp5-release.mts를 사용하세요.');
if (VEHICLE_MASTER_VERSION_ID && !/^[A-Za-z0-9._-]{1,120}$/.test(VEHICLE_MASTER_VERSION_ID)) {
  throw new Error('vehicle-version ID 형식 오류');
}

type ServiceAccountJson = { project_id?: string; client_email?: string; private_key?: string };
type SourceItem = { spec: SupplierSourceSpec; atom: FreepassAtom; issues: AdapterIssue[] };
type SheetTab = { gid: string; title: string; hidden: boolean; index: number };

const S = (value: unknown) => String(value ?? '').trim();
const compactPlate = (value: unknown) => S(value).replace(/\s+/g, '');
const productKey = (provider: unknown, plate: unknown) => `${S(provider).toUpperCase()}|${compactPlate(plate)}`;
const a1 = (title: string) => `'${title.replace(/'/g, "''")}'`;

function parseServiceAccount(raw: string, label: string): ServiceAccountJson {
  let parsed: ServiceAccountJson;
  try { parsed = JSON.parse(raw) as ServiceAccountJson; } catch { throw new Error(`${label} 서비스 계정 JSON 오류`); }
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) throw new Error(`${label} 서비스 계정 필드 부족`);
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  return parsed;
}

function readGoogleAccount(): ServiceAccountJson {
  if (process.env.ERP4_FIREBASE_SERVICE_ACCOUNT_JSON) {
    return parseServiceAccount(process.env.ERP4_FIREBASE_SERVICE_ACCOUNT_JSON, 'Google Sheets 조회');
  }
  for (const path of [process.env.ERP4_GOOGLE_APPLICATION_CREDENTIALS, process.env.GOOGLE_APPLICATION_CREDENTIALS, 'tmp/firebase-auth/sa.json']) {
    if (!path) continue;
    try { return parseServiceAccount(readFileSync(path, 'utf8'), 'Google Sheets 조회'); } catch { /* 다음 경로 */ }
  }
  throw new Error('Google Sheets 조회 서비스 계정이 없습니다. GOOGLE_APPLICATION_CREDENTIALS를 설정하세요.');
}

function readTargetAccount(): ServiceAccountJson {
  if (process.env.ERP5_FIREBASE_WRITER_SERVICE_ACCOUNT_JSON) {
    return parseServiceAccount(process.env.ERP5_FIREBASE_WRITER_SERVICE_ACCOUNT_JSON, 'ERP5 대상 writer');
  }
  if (process.env.ERP5_GOOGLE_APPLICATION_CREDENTIALS) {
    return parseServiceAccount(readFileSync(process.env.ERP5_GOOGLE_APPLICATION_CREDENTIALS, 'utf8'), 'ERP5 대상');
  }
  throw new Error('ERP5 writer 서비스 계정이 없습니다. ERP5_FIREBASE_WRITER_SERVICE_ACCOUNT_JSON을 설정하세요.');
}

function findHeaderRow(values: string[][], pricingMode: SupplierSourceSpec['pricingMode']): number {
  for (let index = 0; index < Math.min(values.length, 40); index += 1) {
    const headers = values[index].map(S);
    if (!headers.includes('차량번호') && !headers.includes('차번')) continue;
    const standard = headers.filter((h) => /^(?:단기보증|장기보증|금액보증금|\d+개월(?:\s*반납형)?)$/.test(h)).length;
    if (pricingMode === 'STANDARD_TERMS' && standard >= 4) return index;
    if (pricingMode === 'TERM_MILEAGE_VARIANTS' && headers.filter((h) => /^\d+개월\s*\d+만$/.test(h)).length >= 2) return index;
  }
  return -1;
}

function rowObject(headers: string[], row: string[]): RawSupplierRow {
  const object: RawSupplierRow = {};
  headers.forEach((header, index) => { if (header) object[header] = row[index] ?? ''; });
  return object;
}

async function googleAccessToken(account: ServiceAccountJson): Promise<string> {
  const token = (await new JWT({
    email: account.client_email,
    key: account.private_key,
    subject: process.env.GOOGLE_WORKSPACE_SUBJECT || 'pyh@teamjpk.com',
    // Workspace 승인 범위. 아래 구현은 GET endpoint만 호출하며 시트 쓰기 API가 없다.
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  }).getAccessToken()).token;
  if (!token) throw new Error('Google Sheets 조회 토큰 발급 실패');
  return token;
}

async function getJson<T>(url: string, token: string, label: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(`${label} 실패: ${body.error?.message || response.status}`);
  return body;
}

async function loadSupplierSourceItems(token: string): Promise<{
  items: SourceItem[];
  stats: Record<string, { rows: number; warnings: number; errors: number; invalidRows: number }>;
  blockers: string[];
}> {
  const items: SourceItem[] = [];
  const stats: Record<string, { rows: number; warnings: number; errors: number; invalidRows: number }> = {};
  const blockers: string[] = [];
  const seen = new Set<string>();
  for (const spec of SUPPLIER_SOURCES) {
    const range = encodeURIComponent(a1(spec.tab));
    const body = await getJson<{ values?: string[][] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${spec.spreadsheetId}/values/${range}`,
      token,
      `${spec.name} 원천 시트 읽기`,
    );
    const values = body.values || [];
    const headerAt = findHeaderRow(values, spec.pricingMode);
    if (headerAt < 0) throw new Error(`${spec.name} 원천에서 차량번호+가격 머리글을 찾지 못했습니다.`);
    const headers = values[headerAt].map(S);
    const adapter = getSupplierAdapter(spec.code);
    let rows = 0;
    let warnings = 0;
    let errors = 0;
    let invalidRows = 0;
    for (let rowIndex = headerAt + 1; rowIndex < values.length; rowIndex += 1) {
      const result = adapter.adapt(rowObject(headers, values[rowIndex]), {
        supplierCode: spec.code,
        supplierName: spec.name,
        spreadsheetId: spec.spreadsheetId,
        tab: spec.tab,
        row: rowIndex + 1,
      });
      const plate = compactPlate(result.atom.plateNumber);
      if (!plate) {
        const hasProductMeaning = Boolean(
          result.atom.vin || result.atom.model || result.atom.rawName || result.atom.status
          || Object.keys(result.atom.rent).length || result.atom.rentVariants?.length,
        );
        if (hasProductMeaning) {
          invalidRows += 1;
          blockers.push(`${spec.partnerCode}:row-${rowIndex + 1}:SOURCE_PLATE_MISSING`);
        }
        continue;
      }
      const key = productKey(spec.partnerCode, plate);
      if (seen.has(key)) throw new Error(`${spec.name} 원천 차량번호 중복: ${plate}`);
      seen.add(key);
      warnings += result.issues.filter((issue) => issue.level === 'warning').length;
      errors += result.issues.filter((issue) => issue.level === 'error').length;
      items.push({ spec, atom: result.atom, issues: result.issues });
      rows += 1;
    }
    if (!rows) throw new Error(`${spec.name} 원천에서 상품을 한 대도 읽지 못했습니다.`);
    stats[spec.code] = { rows, warnings, errors, invalidRows };
  }
  return { items, stats, blockers };
}

function preferMasterNamesFromRegistry(): boolean {
  try {
    const registry = JSON.parse(readFileSync('data/vehicle-trim-key-registry.json', 'utf8')) as { schemaVersion?: number };
    return Number(registry.schemaVersion) >= 3;
  } catch { return false; }
}

async function loadProductMaster(token: string): Promise<{
  byProviderAndPlate: Map<string, Record<string, unknown>>;
  manualBlockByProvider: Map<string, string>;
  tab: SheetTab;
  rowCount: number;
}> {
  const metadata = await getJson<{
    sheets?: Array<{ properties?: { sheetId?: number; title?: string; hidden?: boolean; index?: number } }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${PRODUCT_MASTER_SHEET_ID}?fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden,index))')}`,
    token,
    'Google 상품마스터 메타데이터 읽기',
  );
  const tabs: SheetTab[] = (metadata.sheets || []).flatMap((sheet) => {
    const p = sheet.properties;
    return p?.sheetId == null || !p.title ? [] : [{ gid: String(p.sheetId), title: p.title, hidden: p.hidden === true, index: Number(p.index) || 0 }];
  });
  const tab = tabs.find((item) => item.gid === PRODUCT_MASTER_GID) || tabs.find((item) => item.title === PRODUCT_MASTER_TAB);
  if (!tab) throw new Error(`Google 상품마스터 탭 없음(gid ${PRODUCT_MASTER_GID})`);
  if (tab.hidden) throw new Error(`숨김 상품마스터 탭은 게시할 수 없습니다(${tab.title}).`);
  const manualTab = tabs.find((item) => item.title === PRODUCT_MASTER_MANUAL_TAB);
  if (!manualTab || manualTab.hidden) throw new Error(`상품마스터 매뉴얼 탭을 읽을 수 없습니다(${PRODUCT_MASTER_MANUAL_TAB}).`);
  const adoptionTab = tabs.find((item) => item.title === VEHICLE_MASTER_REVIEW_ADOPTION_TAB && !item.hidden);
  const ranges = [
    `${a1(tab.title)}!A1:AZ5000`,
    `${a1(manualTab.title)}!A1:L2000`,
    ...(adoptionTab ? [`${a1(adoptionTab.title)}!A1:AZ5000`] : []),
  ];
  const endpoint = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${PRODUCT_MASTER_SHEET_ID}/values:batchGet`);
  ranges.forEach((range) => endpoint.searchParams.append('ranges', range));
  endpoint.searchParams.set('majorDimension', 'ROWS');
  endpoint.searchParams.set('valueRenderOption', 'FORMATTED_VALUE');
  const body = await getJson<{ valueRanges?: Array<{ values?: unknown[][] }> }>(endpoint.toString(), token, 'Google 상품마스터 값 읽기');
  if (body.valueRanges?.length !== ranges.length) throw new Error('Google 상품마스터 범위 응답 수 불일치');
  const table = (body.valueRanges[0]?.values || []).map((row) => row.map(S));
  const manual = (body.valueRanges[1]?.values || []).map((row) => row.map(S));
  const adopted = adoptionTab ? adoptedSpecByKey((body.valueRanges[2]?.values || []).map((row) => row.map(S))) : undefined;
  const artifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as VehicleTrimMasterArtifact;
  if (!artifact.records?.length) throw new Error('행 단위 차종마스터 artifact 없음');
  let decisions;
  try { decisions = loadProductVehicleReviewDecisions().decisions; } catch { decisions = undefined; }
  const providerCodes = SUPPLIER_SOURCES.map((spec) => spec.partnerCode);
  const fetched = applyProductMasterManualGate(importProductMasterSheet({
    table,
    partners: [],
    trimRecords: artifact.records,
    tabTitle: tab.title,
    tabGid: tab.gid,
    providerCodes,
    knownProviderCodes: providerCodes,
    adopted,
    decisions,
    preferMasterNames: preferMasterNamesFromRegistry(),
  }), manual);
  const byProviderAndPlate = new Map<string, Record<string, unknown>>();
  const manualBlockByProvider = new Map<string, string>();
  for (const line of fetched.lines) {
    if (line.manualBlockReason) manualBlockByProvider.set(line.code.toUpperCase(), line.manualBlockReason);
    for (const product of line.products) {
      const key = productKey(product.provider_company_code, product.car_number);
      if (byProviderAndPlate.has(key)) throw new Error(`Google 상품마스터 중복 키: ${key}`);
      byProviderAndPlate.set(key, product as Record<string, unknown>);
    }
  }
  return { byProviderAndPlate, manualBlockByProvider, tab, rowCount: fetched.products.length };
}

const googleAccount = readGoogleAccount();
const token = await googleAccessToken(googleAccount);
const [sourceSnapshot, masterSnapshot] = await Promise.all([loadSupplierSourceItems(token), loadProductMaster(token)]);
const consumedGoogleKeys = new Set<string>();
const ignoredFieldCounts = new Map<string, number>();
const items: Erp5ProductComposition[] = sourceSnapshot.items.map(({ spec, atom, issues }) => {
  const key = productKey(spec.partnerCode, atom.plateNumber);
  const googleProduct = masterSnapshot.byProviderAndPlate.get(key);
  if (googleProduct) consumedGoogleKeys.add(key);
  const composed = composeProductForErp5({
    spec,
    atom,
    adapterIssues: issues,
    googleProduct,
    googleSheetId: PRODUCT_MASTER_SHEET_ID,
    googleSheetTab: masterSnapshot.tab.title,
    googleSheetGid: masterSnapshot.tab.gid,
    manualBlockReason: masterSnapshot.manualBlockByProvider.get(spec.partnerCode.toUpperCase()),
  });
  composed.ignoredFields.forEach((field) => ignoredFieldCounts.set(field, (ignoredFieldCounts.get(field) || 0) + 1));
  return composed;
});
if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('ERP5 상품 문서 ID 중복');
const googleOnly = [...masterSnapshot.byProviderAndPlate.keys()].filter((key) => !consumedGoogleKeys.has(key));
const sourceOnlyCount = items.filter((item) => item.blockingReasons.includes('GOOGLE_MASTER_MISSING')).length;
const blockers = [
  ...(!VEHICLE_MASTER_VERSION_ID ? ['VERSION:VEHICLE_MASTER_VERSION_NOT_PINNED'] : []),
  ...sourceSnapshot.blockers,
  ...items.flatMap((item) => item.blockingReasons.map((reason) => `${item.id}:${reason}`)),
  ...googleOnly.map((key) => `${key}:GOOGLE_ONLY_WITHOUT_SUPPLIER_SOURCE`),
];
const verificationStates = items.reduce<Record<string, number>>((acc, item) => {
  acc[item.verificationState] = (acc[item.verificationState] || 0) + 1;
  return acc;
}, {});
const listableCount = items.filter((item) => item.data.listable === true).length;
const storedRows = items.map((item) => ({
  id: item.id,
  data: {
    ...item.data,
    _erp5: {
      schemaVersion: 2,
      sourceSystem: 'supplier-adapters+google-product-master',
      sourceKey: item.id,
      versionId: VERSION_ID,
      vehicleMasterVersionId: VEHICLE_MASTER_VERSION_ID,
    },
  },
}));
const contentHash = ssotContentHash(storedRows);

console.log(JSON.stringify({
  mode: APPLY ? (ACTIVATE ? 'apply-and-activate' : 'apply-draft') : 'dry-run',
  sources: {
    supplierRegistry: sourceSnapshot.stats,
    googleProductMaster: { sheetId: PRODUCT_MASTER_SHEET_ID, tab: masterSnapshot.tab.title, gid: masterSnapshot.tab.gid, rows: masterSnapshot.rowCount },
    erp3ProductReads: 0,
  },
  target: `${TARGET_PROJECT_ID}/firestore/${VERSIONS_COLLECTION}/${VERSION_ID}/products`,
  versionId: VERSION_ID,
  vehicleMasterVersionId: VEHICLE_MASTER_VERSION_ID || null,
  contentHash,
  productCount: items.length,
  listableCount,
  verificationStates,
  matchedGoogleRows: consumedGoogleKeys.size,
  sourceOnlyCount,
  googleOnlyCount: googleOnly.length,
  googleOnlySample: googleOnly.slice(0, 20),
  blockerCount: blockers.length,
  blockerSample: blockers.slice(0, 40),
  ignoredFields: Object.fromEntries([...ignoredFieldCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
}, null, 2));

if (ACTIVATE && blockers.length) throw new Error(`상품 SSOT 대조 blocker ${blockers.length}건: ERP5 활성화하지 않습니다.`);
if (!APPLY) {
  console.log('DRY-RUN 완료: Google Sheets, ERP3, ERP5 어디에도 쓰지 않았습니다.');
  process.exit(0);
}

const targetAccount = readTargetAccount();
if (targetAccount.project_id !== TARGET_PROJECT_ID) throw new Error(`ERP5 대상 프로젝트 불일치: expected=${TARGET_PROJECT_ID}, credential=${targetAccount.project_id}`);
if (targetAccount.project_id === googleAccount.project_id) throw new Error('Google Sheets 조회 프로젝트와 ERP5 대상 프로젝트가 같을 수 없습니다.');
const targetApp = initializeApp({ credential: cert(targetAccount as ServiceAccount), projectId: TARGET_PROJECT_ID }, `erp5-product-ssot-${Date.now()}`);
const targetDb = getFirestore(targetApp);
const versionRef = targetDb.collection(VERSIONS_COLLECTION).doc(VERSION_ID);
if ((await versionRef.get()).exists) throw new Error(`이미 존재하는 ERP5 상품 버전: ${VERSION_ID}`);

await versionRef.set({
  schemaVersion: 2,
  status: 'writing',
  sourceSystem: 'supplier-adapters+google-product-master',
  vehicleMasterVersionId: VEHICLE_MASTER_VERSION_ID || null,
  contentHash,
  expectedCount: items.length,
  listableCount,
  blockerCount: blockers.length,
  blockerSample: blockers.slice(0, 100),
  verificationStates,
  comparison: { supplierRows: items.length, googleRows: masterSnapshot.rowCount, matchedRows: consumedGoogleKeys.size, sourceOnlyCount, googleOnlyCount: googleOnly.length, googleOnlySample: googleOnly.slice(0, 100) },
  sources: {
    suppliers: SUPPLIER_SOURCES.map((spec) => ({ code: spec.code, partnerCode: spec.partnerCode, name: spec.name, spreadsheetId: spec.spreadsheetId, tab: spec.tab, adapterRows: sourceSnapshot.stats[spec.code]?.rows || 0 })),
    googleProductMaster: { spreadsheetId: PRODUCT_MASTER_SHEET_ID, tab: masterSnapshot.tab.title, gid: masterSnapshot.tab.gid },
  },
  createdAt: FieldValue.serverTimestamp(),
});

try {
  for (let offset = 0; offset < items.length; offset += 400) {
    const batch = targetDb.batch();
    for (const item of storedRows.slice(offset, offset + 400)) {
      batch.create(versionRef.collection('products').doc(item.id), {
        ...item.data,
        _erp5: { ...(item.data._erp5 as Record<string, unknown>), copiedAt: FieldValue.serverTimestamp() },
      });
    }
    await batch.commit();
    console.log(`WRITE ${Math.min(offset + 400, items.length)}/${items.length}`);
  }
  for (let offset = 0; offset < blockers.length; offset += 400) {
    const batch = targetDb.batch();
    blockers.slice(offset, offset + 400).forEach((reason, index) => {
      batch.create(versionRef.collection('blockers').doc(String(offset + index + 1).padStart(6, '0')), { reason });
    });
    await batch.commit();
  }
} catch (error) {
  try { await versionRef.set({ status: 'invalid', failureCode: 'FIRESTORE_WRITE_FAILED', failedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch { /* 최초 오류 유지 */ }
  throw error;
}

const written = await versionRef.collection('products').get();
if (written.size !== items.length) {
  await versionRef.set({ status: 'invalid', actualCount: written.size }, { merge: true });
  throw new Error(`ERP5 상품 수량 검증 실패: expected=${items.length}, actual=${written.size}`);
}
const readbackHash = ssotContentHash(written.docs.map((document) => ({
  id: document.id,
  data: document.data() as Record<string, unknown>,
})));
if (readbackHash !== contentHash) {
  await versionRef.set({ status: 'invalid', readbackHash }, { merge: true });
  throw new Error(`ERP5 상품 전체 내용 해시 검증 실패: expected=${contentHash}, actual=${readbackHash}`);
}
const samples = new Map<string, Erp5ProductComposition>();
for (const item of items) {
  const pricing = item.data.adapter_pricing as Record<string, unknown> | undefined;
  const code = S(pricing?.sourceCode).toUpperCase();
  if (code && !samples.has(code)) samples.set(code, item);
}
for (const [sourceCode, expected] of samples) {
  const actual = (await versionRef.collection('products').doc(expected.id).get()).data();
  if (!actual
    || !isDeepStrictEqual(actual.adapter_pricing, expected.data.adapter_pricing)
    || !isDeepStrictEqual(actual.offer_terms, expected.data.offer_terms)
    || actual.source_status_raw !== expected.data.source_status_raw
    || actual.google_status_raw !== expected.data.google_status_raw
    || actual._erp5?.sourceSystem !== 'supplier-adapters+google-product-master') {
    await versionRef.set({ status: 'invalid', readbackFailure: sourceCode }, { merge: true });
    throw new Error(`ERP5 원천·상태·가격 read-back 실패: ${sourceCode}`);
  }
}

await versionRef.set({ status: blockers.length ? 'draft' : 'validated', actualCount: written.size, readbackHash, validatedAt: FieldValue.serverTimestamp() }, { merge: true });
console.log(`ERP5 상품 SSOT 검증본 저장 완료: ${VERSION_ID} (${written.size}대)`);
