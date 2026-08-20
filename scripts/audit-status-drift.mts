/**
 * 상태가 어디서 갈렸나 — 원본 → 정제시트 → 판매시트 → ERP 4층 대조. 읽기 전용.
 *
 * 대상은 원본과 정제시트가 별도로 있는 4개 미러 공급사다.
 * - RP004 아이카 / RP023 오토플러스 / RP031 이안카: 원본 시트 → 정제시트
 * - RP006 아이언: ironrentcar.com 홈페이지 → 정제시트
 *
 * 상태는 유입 경로와 같은 canonSheetVehicleStatus로 비교한다. 원문 상태는
 * 보고에 함께 남기되, 원문 표기가 다르다는 이유만으로 갈림으로 세지 않는다.
 * 읽기 실패·탭 실패·중복 상태는 부재로 해석하지 않고 미확인으로 남긴다.
 *
 *   npx tsx scripts/audit-status-drift.mts
 *   npx tsx scripts/audit-status-drift.mts --plate=147부1954
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { fetchIronRentcarCatalog } from '../lib/server/ironrentcar-source';
import { MIRROR_SOURCES, type MirrorSource } from '../lib/domain/mirror-sources';
import { canonSheetVehicleStatus } from '../lib/domain/sheet-import';
import { findPlateAndStatusColumns, readSupplierSheet, SHEET_GRID_FIELDS } from '../lib/domain/supplier-sheet-read';
import { isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';
import { pickPublishedSalesTabs } from '../lib/domain/sales-published-tabs';
import { assessStatusPipeline, type StatusObservation } from '../lib/domain/status-drift';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
type StatusRow = {
  raw: string;
  canonical: string;
  location: string;
  updatedAt?: string;
  locked?: boolean;
  provenance?: string;
};
type Layer = {
  label: string;
  rows: Map<string, StatusRow>;
  complete: boolean;
  errors: string[];
  conflicts: Map<string, string>;
};

const S = (value: unknown) => String(value ?? '').trim();
const plateOf = (value: unknown) => S(value).replace(/\s+/g, '');
const arg = (key: string) => (process.argv.find((value) => value.startsWith('--' + key + '=')) || '').slice(key.length + 3);
const ONE = plateOf(arg('plate'));
const SALES_SHEET_ID = S(process.env.SALES_INVENTORY_SHEET_ID || process.env.INVENTORY_EXPORT_SHEET_ID)
  || '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const providerKey = (value: unknown) => S(value)
  .toLowerCase()
  .replace(/\(주\)|（주）/g, '')
  .replace(/[\s()（）[\]{}·._-]+/g, '')
  .replace(/주식회사|유한회사|합자회사|합명회사|렌터카|렌트카|모빌리티|캐피탈/g, '');

/** 판매시트의 공급사 표기는 DB 파트너와 정확히 하나로만 연결한다. */
function providerIndex(partners: EntityRecord[]) {
  const candidates = new Map<string, Set<string>>();
  const add = (label: unknown, code: string) => {
    const key = providerKey(label);
    if (!key) return;
    const codes = candidates.get(key) || new Set<string>();
    codes.add(code);
    candidates.set(key, codes);
  };
  for (const partner of partners) {
    if (partner._deleted === true || partner.deletedAt || S(partner.status) === 'deleted') continue;
    const code = S(partner.partner_code || partner._key);
    if (!code || /영업|sales/i.test(S(partner.partner_type))) continue;
    add(code, code);
    add(partner.name, code);
    add(partner.partner_name, code);
  }
  const out = new Map<string, string>();
  for (const [key, codes] of candidates) if (codes.size === 1) out.set(key, [...codes][0]);
  const aliases: Record<string, string[]> = {
    RP006: ['아이언'],
    RP021: ['빌린카'],
    RP030: ['J&J', '제이앤제이'],
    'PT-0023': ['에스에이', 'SA'],
  };
  const present = new Set(partners.map((partner) => S(partner.partner_code || partner._key)));
  for (const [code, names] of Object.entries(aliases)) {
    if (!present.has(code)) continue;
    for (const name of names) out.set(providerKey(name), code);
  }
  return out;
}

const serviceAccount = JSON.parse(readFileSync(
  S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json',
  'utf8',
));
const sheetsJwt = new JWT({
  email: serviceAccount.client_email,
  key: serviceAccount.private_key,
  subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const databaseJwt = new JWT({
  email: serviceAccount.client_email,
  key: serviceAccount.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
});

async function getJson(url: string, jwt: JWT): Promise<Rec> {
  for (let attempt = 0; ; attempt++) {
    const token = (await jwt.getAccessToken()).token;
    const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const text = await response.text();
    if (response.ok) return text ? JSON.parse(text) : {};
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      await sleep(Math.min(60_000, 5_000 * 2 ** attempt));
      continue;
    }
    throw new Error(response.status + ' ' + text.slice(0, 180));
  }
}

const emptyLayer = (label: string): Layer => ({
  label,
  rows: new Map<string, StatusRow>(),
  complete: true,
  errors: [],
  conflicts: new Map<string, string>(),
});

function addRow(layer: Layer, plate: string, row: StatusRow) {
  if (ONE && plate !== ONE) return;
  const before = layer.rows.get(plate);
  if (!before) {
    layer.rows.set(plate, row);
    return;
  }
  if (before.canonical === row.canonical && S(row.updatedAt) > S(before.updatedAt)) {
    layer.rows.set(plate, row);
    return;
  }
  if (before.canonical !== row.canonical) {
    layer.conflicts.set(plate, before.location + ' ' + before.raw + ' / ' + row.location + ' ' + row.raw);
  }
}

function statusColumn(header: string[]) {
  const found = findPlateAndStatusColumns(header);
  if (found.status >= 0) return found.status;
  return header.findIndex((value) => ['차량상태', '배차상태', '판매상태', '재고상태', '출고상태']
    .includes(S(value).replace(/\s+/g, '')));
}

async function readSheetLayer(id: string, label: string, partner: EntityRecord): Promise<Layer> {
  const layer = emptyLayer(label);
  try {
    const grid = await getJson(
      'https://sheets.googleapis.com/v4/spreadsheets/' + id + '?includeGridData=true&fields=' + encodeURIComponent(SHEET_GRID_FIELDS),
      sheetsJwt,
    );
    const parsed = readSupplierSheet(grid as never, partner);
    for (const failure of parsed.failures) {
      if (failure.vehicleLike) layer.errors.push(failure.title + ': ' + failure.reason);
    }
    let vehicleTable = 0;
    for (const tab of parsed.tabs) {
      if (isOurNonInventoryTab(tab.title)) continue;
      const header = (tab.table[0] || []).map(S);
      const columns = findPlateAndStatusColumns(header);
      const plateColumn = columns.plate;
      const statusAt = statusColumn(header);
      if (plateColumn < 0) continue;
      vehicleTable++;
      for (const record of tab.table.slice(1)) {
        const plate = plateOf(record[plateColumn]);
        if (!plate) continue;
        const raw = statusAt >= 0 ? S(record[statusAt]) : '';
        addRow(layer, plate, {
          raw,
          canonical: canonSheetVehicleStatus(raw),
          location: tab.title + (statusAt >= 0 ? '' : ' (상태칸 없음)'),
        });
      }
    }
    if (!vehicleTable) layer.errors.push('차량번호 열을 가진 재고 탭 없음');
  } catch (error) {
    layer.errors.push((error as Error).message);
  }
  if (layer.errors.length) layer.complete = false;
  return layer;
}

async function readIronLayer(): Promise<Layer> {
  const layer = emptyLayer('ironrentcar.com');
  try {
    // 동기화가 사용하는 같은 상세 수집기다. 과도한 동시 요청은 홈페이지와 로컬 메모리에 부담이므로 2로 제한한다.
    const catalog = await fetchIronRentcarCatalog({ cacheMs: 0, concurrency: 2 });
    for (const item of catalog.items) {
      const product = item.product as Rec;
      const plate = plateOf(product.car_number);
      if (!plate) continue;
      const raw = item.sold ? '판매완료' : S(product.vehicle_status);
      addRow(layer, plate, {
        raw,
        canonical: item.sold ? '출고불가' : canonSheetVehicleStatus(raw),
        location: item.sourceUrl,
      });
    }
    if (!catalog.complete) {
      layer.errors.push('홈페이지 상세 ' + catalog.errors.length + '건을 못 읽음 — 없는 차를 출고불가로 판정하지 않음');
    }
  } catch (error) {
    layer.errors.push((error as Error).message);
  }
  if (layer.errors.length) layer.complete = false;
  return layer;
}

type SalesLayers = {
  byCode: Map<string, Layer>;
  complete: boolean;
  errors: string[];
};

function layerFor(map: Map<string, Layer>, code: string, label: string) {
  const existing = map.get(code);
  if (existing) return existing;
  const next = emptyLayer(label);
  map.set(code, next);
  return next;
}

async function readSalesLayers(partners: EntityRecord[]): Promise<SalesLayers> {
  const result: SalesLayers = { byCode: new Map<string, Layer>(), complete: true, errors: [] };
  try {
    const meta = await getJson(
      'https://sheets.googleapis.com/v4/spreadsheets/' + SALES_SHEET_ID + '?fields=sheets.properties(title,hidden)',
      sheetsJwt,
    );
    const titles = ((meta.sheets || []) as Rec[])
      .filter((sheet) => !sheet.properties?.hidden)
      .map((sheet) => S(sheet.properties?.title));
    const tabs = pickPublishedSalesTabs(titles);
    if (tabs.length !== 3) result.errors.push('판매시트 발행 탭 3개가 아님: ' + tabs.map((tab) => tab.title).join(' / '));
    const providers = providerIndex(partners);
    for (const tab of tabs) {
      const values = await getJson(
        'https://sheets.googleapis.com/v4/spreadsheets/' + SALES_SHEET_ID + '/values/' + encodeURIComponent("'" + tab.title.replace(/'/g, "''") + "'"),
        sheetsJwt,
      );
      const rows = (values.values || []) as string[][];
      const headerRow = rows.findIndex((row) => row.some((value) => /차량번호|차번/.test(S(value))));
      if (headerRow < 0) {
        result.errors.push(tab.title + ': 차량번호 머리행 없음');
        continue;
      }
      const header = (rows[headerRow] || []).map(S);
      const plateColumn = findPlateAndStatusColumns(header).plate;
      const statusAt = statusColumn(header);
      const providerColumn = header.findIndex((value) => /^(공급사|렌트사|제공사|업체명)$/.test(S(value)));
      if (plateColumn < 0 || providerColumn < 0) {
        result.errors.push(tab.title + ': 차량번호 또는 공급사 열 없음');
        continue;
      }
      for (const row of rows.slice(headerRow + 1)) {
        const plate = plateOf(row[plateColumn]);
        if (!plate) continue;
        const label = S(row[providerColumn]);
        const code = providers.get(providerKey(label)) || '';
        if (!code) {
          result.errors.push(tab.title + ': 공급사 매핑 없음(' + (label || '빈칸') + ')');
          continue;
        }
        const raw = statusAt >= 0 ? S(row[statusAt]) : '';
        addRow(layerFor(result.byCode, code, '판매시트 ' + code), plate, {
          raw,
          canonical: canonSheetVehicleStatus(raw),
          location: tab.title + (statusAt >= 0 ? '' : ' (상태칸 없음)'),
        });
      }
    }
  } catch (error) {
    result.errors.push((error as Error).message);
  }
  if (result.errors.length) result.complete = false;
  for (const layer of result.byCode.values()) {
    if (layer.conflicts.size) {
      result.errors.push(layer.label + ': 같은 차번의 상태 충돌 ' + layer.conflicts.size + '건');
    }
  }
  return result;
}

type ErpLayers = {
  byCode: Map<string, Layer>;
  codesByPlate: Map<string, Set<string>>;
  unassignedPlates: Set<string>;
  partners: EntityRecord[];
  errors: string[];
};

function mergeNodes(v3: Record<string, Rec>, v4: Record<string, Rec>) {
  const merged: Record<string, Rec> = {};
  for (const [key, value] of Object.entries(v3 || {})) merged[key] = { ...value, _key: key };
  for (const [key, value] of Object.entries(v4 || {})) merged[key] = { ...(merged[key] || {}), ...value, _key: key };
  return merged;
}

async function readErpLayers(): Promise<ErpLayers> {
  const byCode = new Map<string, Layer>();
  const codesByPlate = new Map<string, Set<string>>();
  const unassignedPlates = new Set<string>();
  const errors: string[] = [];
  let partners: EntityRecord[] = [];
  try {
    const [products, v4Products, partnerRows, v4PartnerRows] = await Promise.all([
      getJson(DB + '/products.json', databaseJwt),
      getJson(DB + '/v4/products.json', databaseJwt),
      getJson(DB + '/partners.json', databaseJwt),
      getJson(DB + '/v4/partners.json', databaseJwt),
    ]);
    const mergedPartners = mergeNodes(partnerRows, v4PartnerRows);
    partners = Object.values(mergedPartners) as EntityRecord[];
    const mergedProducts = mergeNodes(products, v4Products);
    for (const product of Object.values(mergedProducts)) {
      if (!product || product._deleted === true || product.deletedAt || S(product.status) === 'deleted') continue;
      const plate = plateOf(product.car_number || product.car_number_snapshot);
      if (!plate) continue;
      const code = S(product.provider_company_code || product.partner_code || product.provider_code || product.supplier_code);
      if (!code) {
        // 다른 공급사의 고아 레코드 때문에 네 미러 공급사 감사 전체를 실패로 만들지 않는다.
        // 단, 대조 중인 동일 차번이면 sameCodeLayer에서 미확인으로 막는다.
        unassignedPlates.add(plate);
        continue;
      }
      const codes = codesByPlate.get(plate) || new Set<string>();
      codes.add(code);
      codesByPlate.set(plate, codes);
      const raw = S(product.vehicle_status);
      addRow(layerFor(byCode, code, 'ERP ' + code), plate, {
        raw,
        canonical: raw === '계약중' ? '계약중' : canonSheetVehicleStatus(raw),
        location: S(product._key || product.product_code),
        updatedAt: S(product.updatedAt || product.updated_at),
        locked: !!S(product.locked_by_contract) || raw === '계약중',
        provenance: [S(product.updatedBy), S(product.updatedAt), S(product.sheet_status_owner), S(product.sheet_block_reason)]
          .filter(Boolean).join(' · '),
      });
    }
  } catch (error) {
    errors.push((error as Error).message);
  }
  return { byCode, codesByPlate, unassignedPlates, partners, errors };
}

type Evidence = StatusObservation & {
  raw?: string;
  location?: string;
  provenance?: string;
  note?: string;
};

function evidence(layer: Layer | undefined, plate: string): Evidence {
  if (!layer) return { known: true, present: false };
  const conflict = layer.conflicts.get(plate);
  if (conflict) return { known: false, present: false, note: '같은 차번 상태 충돌: ' + conflict };
  const row = layer.rows.get(plate);
  if (row) {
    return {
      known: true,
      present: true,
      raw: row.raw,
      status: row.canonical,
      location: row.location,
      locked: row.locked,
      provenance: row.provenance,
    };
  }
  if (!layer.complete) return { known: false, present: false, note: layer.errors.join(' / ') };
  return { known: true, present: false };
}

function describe(e: Evidence) {
  if (!e.known) return '미확인' + (e.note ? ' (' + e.note.slice(0, 80) + ')' : '');
  if (!e.present) return '(없음)';
  return (e.raw || '(빈칸)') + ' [' + (e.status || '상태 없음') + ']' + (e.location ? ' @' + e.location : '');
}

function sameCodeLayer(
  layer: Layer | undefined,
  globalCodes: Map<string, Set<string>>,
  unassignedPlates: Set<string>,
  code: string,
  plate: string,
): Evidence {
  if (unassignedPlates.has(plate)) {
    return { known: false, present: false, note: '같은 차번의 ERP 레코드에 공급사 코드가 없음' };
  }
  const codes = globalCodes.get(plate);
  if (codes && !codes.has(code)) {
    return { known: false, present: false, note: '같은 차번이 다른 공급사 코드(' + [...codes].join(', ') + ')로 ERP에 있음' };
  }
  return evidence(layer, plate);
}

console.log('■ 상태가 어디서 갈렸나 — 원본 → 정제시트 → 판매시트 → ERP');
console.log('  범위: 원본과 정제시트가 분리된 4개 공급사(RP004 · RP023 · RP031 · RP006)\n');

const erp = await readErpLayers();
const sales = await readSalesLayers(erp.partners);
const partnerByCode = new Map(erp.partners.map((partner) => [S(partner.partner_code || partner._key), partner]));

type SourceLayers = { source: MirrorSource; origin: Layer; refined: Layer };
const sources: SourceLayers[] = [];
for (const source of MIRROR_SOURCES) {
  const origin = source.kind === 'iron'
    ? await readIronLayer()
    : await readSheetLayer(source.from || '', source.name + ' 원본', partnerByCode.get(source.code) || ({ partner_code: source.code } as EntityRecord));
  // 문패의 원본 탭 gid를 정제시트에 재사용하면 다른 gid를 가리킨다. 표준 정제시트는 코드만 넘겨 generic으로 읽는다.
  const refined = await readSheetLayer(source.to, source.name + ' 정제시트', { partner_code: source.code } as EntityRecord);
  sources.push({ source, origin, refined });
}

type ReportRow = {
  plate: string;
  code: string;
  name: string;
  origin: Evidence;
  refined: Evidence;
  sales: Evidence;
  erp: Evidence;
  boundaries: ReturnType<typeof assessStatusPipeline>['boundaries'];
};
const rows: ReportRow[] = [];
for (const item of sources) {
  const code = item.source.code;
  const salesLayer = sales.byCode.get(code);
  const erpLayer = erp.byCode.get(code);
  const plates = new Set<string>([
    ...item.origin.rows.keys(),
    ...item.refined.rows.keys(),
    ...(salesLayer ? salesLayer.rows.keys() : []),
    ...(erpLayer ? erpLayer.rows.keys() : []),
  ]);
  for (const plate of plates) {
    if (ONE && plate !== ONE) continue;
    const origin = evidence(item.origin, plate);
    const refined = evidence(item.refined, plate);
    const salesEvidence: Evidence = sales.complete
      ? evidence(salesLayer, plate)
      : { known: false, present: false, note: sales.errors.join(' / ') };
    const erpEvidence: Evidence = erp.errors.length
      ? { known: false, present: false, note: erp.errors.join(' / ') }
      : sameCodeLayer(erpLayer, erp.codesByPlate, erp.unassignedPlates, code, plate);
    const assessed = assessStatusPipeline({
      origin,
      refined,
      sales: salesEvidence,
      erp: erpEvidence,
    });
    if (assessed.driftCount || assessed.reviewCount || assessed.unknownCount) {
      rows.push({
        plate,
        code,
        name: item.source.name,
        origin,
        refined,
        sales: salesEvidence,
        erp: erpEvidence,
        boundaries: assessed.boundaries,
      });
    }
  }
}

const driftRows = rows.filter((row) => row.boundaries.some((boundary) => boundary.verdict === 'drift'));
const reviewRows = rows.filter((row) => row.boundaries.some((boundary) => boundary.verdict === 'review'));
const unknownRows = rows.filter((row) => row.boundaries.some((boundary) => boundary.verdict === 'unknown'));
const sourceErrors = sources.flatMap((item) => [
  ...item.origin.errors.map((error) => item.source.name + ' 원본: ' + error),
  ...item.refined.errors.map((error) => item.source.name + ' 정제시트: ' + error),
]);
const globalErrors = [...erp.errors, ...sales.errors, ...sourceErrors];

console.log('■ 상태가 다른 차 ' + driftRows.length + '대 · 검토 필요 ' + reviewRows.length + '대 · 미확인 ' + unknownRows.length + '대');
for (const row of rows) {
  const signals = row.boundaries.filter((boundary) => boundary.verdict !== 'normal');
  console.log('\n   ' + row.plate + '  ' + row.name + ' (' + row.code + ')');
  console.log('      원본 ' + describe(row.origin));
  console.log('      정제 ' + describe(row.refined));
  console.log('      판매 ' + describe(row.sales));
  console.log('      ERP  ' + describe(row.erp) + (row.erp.provenance ? ' · ' + row.erp.provenance : ''));
  for (const signal of signals) {
    const marker = signal.verdict === 'drift' ? '★' : signal.verdict === 'review' ? '△' : '?';
    console.log('      ' + marker + ' ' + signal.reason);
  }
}
if (globalErrors.length) {
  console.log('\n■ 검사 불완전 ' + globalErrors.length + '건 — 없는 차나 원인을 단정하지 않음');
  for (const error of globalErrors.slice(0, 20)) console.log('   ? ' + error.slice(0, 220));
}

writeFileSync('tmp/status-drift.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  scope: sources.map((item) => ({ code: item.source.code, name: item.source.name, kind: item.source.kind })),
  summary: {
    drift_plates: driftRows.length,
    review_plates: reviewRows.length,
    unknown_plates: unknownRows.length,
    incomplete: globalErrors.length,
  },
  errors: globalErrors,
  rows,
}, null, 2) + '\n');
console.log('\n  기록 tmp/status-drift.json · 여기서 고치지 않는다 — 신호만 낸다\n');

// 상태 갈림 자체는 반영을 멈추는 오류가 아니다. 다만 판독 불완전은 0건처럼 기록되면 안 된다.
if (globalErrors.length || unknownRows.length) process.exitCode = 2;
