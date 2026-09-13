/**
 * ERP4 Firestore products -> ERP5 Firestore versioned product SSOT.
 *
 * 기본은 dry-run. 실제 쓰기는 --apply, 활성 포인터 교체는 --apply --activate가 필요하다.
 * 기존 ERP4/ERP5 컬렉션은 삭제하거나 수정하지 않는다.
 */
import { readFileSync } from 'node:fs';
import { cert, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { JWT } from 'google-auth-library';
import { getSupplierAdapter } from '../lib/adapters';
import { SUPPLIER_SOURCES, type SupplierSourceSpec } from '../lib/adapters/source-registry';
import { exportProductForErp5 } from '../lib/domain/erp5-product-ssot';
import type { FreepassAtom, RawSupplierRow } from '../lib/domain/supplier-adapter';

const APPLY = process.argv.includes('--apply');
const ACTIVATE = process.argv.includes('--activate');
const SKIP_ADAPTERS = process.argv.includes('--skip-adapters');
const versionArg = process.argv.find((arg) => arg.startsWith('--version='));
const VERSION_ID = versionArg?.slice('--version='.length) || new Date().toISOString().replace(/[-:.]/g, '');
const SOURCE_PROJECT_ID = process.env.ERP4_FIREBASE_PROJECT_ID || 'freepasserp3';
const TARGET_PROJECT_ID = process.env.ERP5_FIREBASE_PROJECT_ID || 'erp5-3e2fc';
const SOURCE_COLLECTION = process.env.ERP4_PRODUCT_COLLECTION || 'products';
const VERSIONS_COLLECTION = 'productMasterVersions';
const POINTER_PATH = 'ssotState/products';
if (!/^[A-Za-z0-9._-]{1,120}$/.test(VERSION_ID)) throw new Error(`version ID 형식이 올바르지 않습니다: ${VERSION_ID}`);

type ServiceAccountJson = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

function parseServiceAccount(raw: string, label: string): ServiceAccountJson {
  let parsed: ServiceAccountJson;
  try {
    parsed = JSON.parse(raw) as ServiceAccountJson;
  } catch {
    throw new Error(`${label} 서비스 계정 JSON을 읽을 수 없습니다.`);
  }
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error(`${label} 서비스 계정에 project_id/client_email/private_key가 필요합니다.`);
  }
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  return parsed;
}

function readServiceAccount(options: {
  label: string;
  jsonEnv: string;
  pathEnvs: string[];
  fallbackPath?: string;
  required: boolean;
}): ServiceAccountJson | null {
  const inline = process.env[options.jsonEnv];
  if (inline) return parseServiceAccount(inline, options.label);

  for (const pathEnv of options.pathEnvs) {
    const filePath = process.env[pathEnv];
    if (filePath) return parseServiceAccount(readFileSync(filePath, 'utf8'), options.label);
  }
  if (options.fallbackPath) {
    try {
      return parseServiceAccount(readFileSync(options.fallbackPath, 'utf8'), options.label);
    } catch (error) {
      if (options.required) throw error;
    }
  }
  if (options.required) {
    throw new Error(`${options.label} 서비스 계정이 없습니다. ${options.jsonEnv} 또는 자격증명 파일 경로를 설정하세요.`);
  }
  return null;
}

function assertProject(account: ServiceAccountJson, expected: string, label: string) {
  if (account.project_id !== expected) {
    throw new Error(`${label} 프로젝트 불일치: expected=${expected}, credential=${account.project_id}`);
  }
}

const S = (value: unknown) => String(value ?? '').trim();
const compactPlate = (value: unknown) => S(value).replace(/\s+/g, '');

function findHeaderRow(values: string[][], pricingMode: SupplierSourceSpec['pricingMode']): number {
  for (let index = 0; index < Math.min(values.length, 40); index += 1) {
    const headers = values[index].map(S);
    if (!headers.includes('차량번호') && !headers.includes('차번')) continue;
    const standard = headers.filter((header) => /^(?:단기보증|장기보증|금액보증금|\d+개월(?:\s*반납형)?)$/.test(header)).length;
    if (pricingMode === 'STANDARD_TERMS' && standard >= 4) return index;
    if (pricingMode === 'TERM_MILEAGE_VARIANTS' && headers.filter((header) => /^\d+개월\s*\d+만$/.test(header)).length >= 2) return index;
  }
  return -1;
}

function rowObject(headers: string[], row: string[]): RawSupplierRow {
  const object: RawSupplierRow = {};
  headers.forEach((header, index) => { if (header) object[header] = row[index] ?? ''; });
  return object;
}

async function loadAdapterAtoms(account: ServiceAccountJson): Promise<{
  byProviderAndPlate: Map<string, FreepassAtom>;
  stats: Record<string, number>;
}> {
  const byProviderAndPlate = new Map<string, FreepassAtom>();
  const stats: Record<string, number> = {};
  const token = (await new JWT({
    email: account.client_email,
    key: account.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  }).getAccessToken()).token;
  if (!token) throw new Error('공급사 원천 Google Sheets 토큰을 발급하지 못했습니다.');

  for (const spec of SUPPLIER_SOURCES) {
    const range = encodeURIComponent(`'${spec.tab.replace(/'/g, "''")}'`);
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spec.spreadsheetId}/values/${range}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`${spec.name} 원천 시트 읽기 실패: ${response.status} ${await response.text()}`);
    const values = ((await response.json()) as { values?: string[][] }).values || [];
    const headerAt = findHeaderRow(values, spec.pricingMode);
    if (headerAt < 0) throw new Error(`${spec.name} 원천에서 차량번호+가격 머리글을 찾지 못했습니다.`);
    const headers = values[headerAt].map(S);
    const adapter = getSupplierAdapter(spec.code);
    let count = 0;
    for (let rowIndex = headerAt + 1; rowIndex < values.length; rowIndex += 1) {
      const result = adapter.adapt(rowObject(headers, values[rowIndex]), {
        supplierCode: spec.code,
        supplierName: spec.name,
        spreadsheetId: spec.spreadsheetId,
        tab: spec.tab,
        row: rowIndex + 1,
      });
      const plate = compactPlate(result.atom.plateNumber);
      if (!plate) continue;
      const key = `${spec.partnerCode}|${plate}`;
      if (byProviderAndPlate.has(key)) throw new Error(`${spec.name} 원천 차량번호 중복: ${plate}`);
      byProviderAndPlate.set(key, result.atom);
      count += 1;
    }
    if (!count) throw new Error(`${spec.name} 원천에서 상품을 한 대도 읽지 못했습니다.`);
    stats[spec.code] = count;
  }
  return { byProviderAndPlate, stats };
}

if (ACTIVATE && !APPLY) throw new Error('--activate는 --apply와 함께 사용해야 합니다.');
if (SOURCE_PROJECT_ID === TARGET_PROJECT_ID) throw new Error('ERP4 원본과 ERP5 대상 프로젝트가 같을 수 없습니다.');

const sourceAccount = readServiceAccount({
  label: 'ERP4 원본',
  jsonEnv: 'ERP4_FIREBASE_SERVICE_ACCOUNT_JSON',
  pathEnvs: ['ERP4_GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_APPLICATION_CREDENTIALS'],
  fallbackPath: 'tmp/firebase-auth/sa.json',
  required: true,
})!;
assertProject(sourceAccount, SOURCE_PROJECT_ID, 'ERP4 원본');

const targetAccount = readServiceAccount({
  label: 'ERP5 대상',
  jsonEnv: 'ERP5_FIREBASE_SERVICE_ACCOUNT_JSON',
  pathEnvs: ['ERP5_GOOGLE_APPLICATION_CREDENTIALS'],
  required: APPLY,
});
if (targetAccount) assertProject(targetAccount, TARGET_PROJECT_ID, 'ERP5 대상');

const sourceApp = initializeApp({ credential: cert(sourceAccount as ServiceAccount) }, `erp4-source-${Date.now()}`);
const sourceDb = getFirestore(sourceApp);
const sourceSnapshot = await sourceDb.collection(SOURCE_COLLECTION).get();
const adapterSnapshot = SKIP_ADAPTERS
  ? { byProviderAndPlate: new Map<string, FreepassAtom>(), stats: {} as Record<string, number> }
  : await loadAdapterAtoms(sourceAccount);

const ignoredFieldCounts = new Map<string, number>();
let productsWithAdapterPricing = 0;
const adapterCoverageBlockers: string[] = [];
const sourceSpecByCode = new Map<string, SupplierSourceSpec>();
for (const spec of SUPPLIER_SOURCES) {
  sourceSpecByCode.set(spec.code.toUpperCase(), spec);
  sourceSpecByCode.set(spec.partnerCode.toUpperCase(), spec);
}
const items = sourceSnapshot.docs.map((document) => {
  const source = document.data();
  const providerCode = S(source.provider_company_code || source.partner_code).toUpperCase();
  const plate = compactPlate(source.car_number);
  const sourceSpec = sourceSpecByCode.get(providerCode);
  const atom = sourceSpec
    ? adapterSnapshot.byProviderAndPlate.get(`${sourceSpec.partnerCode}|${plate}`)
    : undefined;
  if (atom) productsWithAdapterPricing += 1;
  else if (!SKIP_ADAPTERS && sourceSpec && source.listable !== false) {
    adapterCoverageBlockers.push(`${sourceSpec.name}:${plate || document.id}`);
  }
  const exported = exportProductForErp5(source, atom);
  for (const field of exported.ignoredFields) {
    ignoredFieldCounts.set(field, (ignoredFieldCounts.get(field) || 0) + 1);
  }
  return { id: document.id, data: exported.data };
});

const uniqueIds = new Set(items.map((item) => item.id));
if (uniqueIds.size !== items.length) throw new Error('ERP4 products 문서 ID가 중복되었습니다.');

console.log(JSON.stringify({
  mode: APPLY ? (ACTIVATE ? 'apply-and-activate' : 'apply-draft') : 'dry-run',
  source: `${SOURCE_PROJECT_ID}/firestore/${SOURCE_COLLECTION}`,
  target: `${TARGET_PROJECT_ID}/firestore/${VERSIONS_COLLECTION}/${VERSION_ID}/products`,
  versionId: VERSION_ID,
  productCount: items.length,
  adapters: {
    sourceRows: adapterSnapshot.stats,
    productsWithAdapterPricing,
    coverageBlockers: adapterCoverageBlockers.length,
    coverageBlockerSample: adapterCoverageBlockers.slice(0, 20),
  },
  ignoredFields: Object.fromEntries([...ignoredFieldCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
}, null, 2));

if (ACTIVATE && SKIP_ADAPTERS) throw new Error('--skip-adapters 상태로 상품 SSOT를 활성화할 수 없습니다.');
if (ACTIVATE && adapterCoverageBlockers.length) {
  throw new Error(`판매 가능한 등록 공급사 상품 중 어댑터 원천과 안 맞는 차량 ${adapterCoverageBlockers.length}대: 활성화하지 않습니다.`);
}

if (!APPLY) {
  console.log('DRY-RUN 완료: ERP4와 ERP5에는 쓰지 않았습니다.');
  process.exit(0);
}
if (!targetAccount) throw new Error('ERP5 대상 서비스 계정이 없습니다.');

const targetApp = initializeApp({
  credential: cert(targetAccount as ServiceAccount),
  projectId: TARGET_PROJECT_ID,
}, `erp5-target-${Date.now()}`);
const targetDb = getFirestore(targetApp);
const versionRef = targetDb.collection(VERSIONS_COLLECTION).doc(VERSION_ID);
const existing = await versionRef.get();
if (existing.exists) throw new Error(`이미 존재하는 ERP5 상품 버전입니다: ${VERSION_ID}`);

await versionRef.set({
  schemaVersion: 1,
  status: 'writing',
  sourceProjectId: SOURCE_PROJECT_ID,
  sourceCollection: SOURCE_COLLECTION,
  expectedCount: items.length,
  adapterCoverage: {
    sourceRows: adapterSnapshot.stats,
    matchedProducts: productsWithAdapterPricing,
    blockerCount: adapterCoverageBlockers.length,
    blockerSample: adapterCoverageBlockers.slice(0, 100),
  },
  createdAt: FieldValue.serverTimestamp(),
});

const CHUNK_SIZE = 400;
for (let offset = 0; offset < items.length; offset += CHUNK_SIZE) {
  const batch = targetDb.batch();
  for (const item of items.slice(offset, offset + CHUNK_SIZE)) {
    batch.create(versionRef.collection('products').doc(item.id), {
      ...item.data,
      _erp5: {
        schemaVersion: 1,
        sourceSystem: 'freepasserp4.firestore.products',
        sourceDocumentId: item.id,
        versionId: VERSION_ID,
        copiedAt: FieldValue.serverTimestamp(),
      },
    });
  }
  await batch.commit();
  console.log(`WRITE ${Math.min(offset + CHUNK_SIZE, items.length)}/${items.length}`);
}

const written = await versionRef.collection('products').select().get();
if (written.size !== items.length) {
  await versionRef.set({ status: 'invalid', actualCount: written.size }, { merge: true });
  throw new Error(`ERP5 검증 실패: expected=${items.length}, actual=${written.size}`);
}

await versionRef.set({
  status: ACTIVATE ? 'active' : 'validated',
  actualCount: written.size,
  validatedAt: FieldValue.serverTimestamp(),
}, { merge: true });

if (ACTIVATE) {
  await targetDb.doc(POINTER_PATH).set({
    activeVersionId: VERSION_ID,
    productCount: written.size,
    schemaVersion: 1,
    sourceSystem: 'freepasserp4.firestore.products',
    activatedAt: FieldValue.serverTimestamp(),
  });
}

console.log(`ERP5 상품 SSOT ${ACTIVATE ? '활성화' : '검증본 저장'} 완료: ${VERSION_ID} (${written.size}대)`);
