/**
 * 판매시트 3탭 ↔ ERP/상품찾기 차량번호·핵심값 대조. 읽기 전용.
 * 차번 집합뿐 아니라 상태·차명 축·대여료·보증금까지 모두 같아야 성공한다.
 */
import nextEnv from '@next/env';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EntityRecord } from '../lib/intake/entities';
import { isStockedProduct } from '../lib/domain/product';
import { isContractEngineLocked } from '../lib/domain/sheet-merge';
import {
  hasOpenContractReference,
  indexInventoryRows,
  inventoryPlate,
} from '../lib/domain/sheet-inventory-identity';

nextEnv.loadEnvConfig(process.cwd());
process.env.NEXT_PUBLIC_DATA_BACKEND = 'rtdb';

const [{ firebaseAdminDatabase }, { fetchSalesInventorySheet }, { readContracts, readPartners, readProducts }] = await Promise.all([
  import('../lib/server/firebase-admin'),
  import('../lib/server/sales-inventory-sheet'),
  import('../lib/server/sheet-daily-sync'),
]);

const S = (value: unknown) => String(value ?? '').trim();
const plate = inventoryPlate;
const text = (value: unknown) => S(value).replace(/\s+/g, ' ');
const money = (value: unknown): number | null => {
  const raw = S(value).replace(/,/g, '');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};
const maskedPlate = (value: string) => value.length <= 4 ? '****' : `${value.slice(0, -4)}****`;
const OUT = 'tmp/sheet-erp-parity.json';

const companyId = S(process.env.SHEET_SYNC_COMPANY_ID || 'freepass');
const db = firebaseAdminDatabase();
const partners = await readPartners(db, companyId);
const [fetched, erpState, contracts] = await Promise.all([
  fetchSalesInventorySheet({ partners }),
  readProducts(db, companyId),
  readContracts(db, companyId),
]);

const salesIndex = indexInventoryRows(fetched.products);
const finderIndex = indexInventoryRows(erpState.active.filter(isStockedProduct));
const allErpIndex = indexInventoryRows(erpState.active);
const salesParserDuplicates = fetched.lines.reduce((sum, line) => sum + (line.blockingDuplicateCount ?? line.duplicateCount ?? 0), 0);

type FieldDiff = { field: string; sales: unknown; erp: unknown };
type PlateDiff = { plate: string; provider: string; tab: string; fields: FieldDiff[] };
const valueDiffs: PlateDiff[] = [];
const lockedStatusOverrides: Array<{ plate: string; sales: string; erp: string; contract: string }> = [];

const coreFields: Array<[string, keyof EntityRecord]> = [
  ['상태', 'vehicle_status'],
  ['원본상태', 'status_label_raw'],
  ['상품구분', 'product_type'],
  ['제조사', 'maker'],
  ['모델', 'model'],
  ['세부모델', 'sub_model'],
  ['세부트림', 'trim_name'],
  ['폐지파워트레인', 'variant'],
  ['폐지추가트림', 'trim_extra'],
  ['공급사차명', 'supplier_vehicle_name'],
  ['외장', 'ext_color'],
  ['내장', 'int_color'],
  ['연식', 'year'],
  ['최초등록', 'first_registration_date'],
  ['주행거리', 'mileage'],
  ['연료', 'fuel_type'],
  ['배기량', 'engine_cc'],
  ['차종구분', 'vehicle_class'],
  ['인승', 'seats'],
  ['구동', 'drive_type'],
  ['원산지', 'origin'],
  ['용도', 'usage'],
  ['옵션', 'options'],
  ['사진', 'photo_link'],
  ['위치', 'location'],
  ['정책코드', 'policy_code'],
  ['공급사메모', 'partner_memo'],
  ['소스탭', 'sheet_source_tab'],
  ['소스행', 'sheet_source_row'],
];

function priceTerms(row: EntityRecord): Record<string, Record<string, unknown>> {
  return row.price && typeof row.price === 'object' && !Array.isArray(row.price)
    ? row.price as Record<string, Record<string, unknown>>
    : {};
}

for (const [identity, salesItem] of salesIndex.byIdentity) {
  const erpItem = allErpIndex.byIdentity.get(identity);
  if (!erpItem) continue;
  const p = plate(salesItem.row.car_number || salesItem.row.car_number_snapshot);
  const fields: FieldDiff[] = [];
  const sales = salesItem.row;
  const erp = erpItem.row;
  const engineLocked = isContractEngineLocked(erp);
  for (const [label, key] of coreFields) {
    const left = text(sales[key]);
    const right = text(erp[key]);
    if (left === right) continue;
    if (key === 'vehicle_status' && engineLocked && right === '계약중') {
      lockedStatusOverrides.push({ plate: p, sales: left, erp: right, contract: S(erp.locked_by_contract) });
      continue;
    }
    fields.push({ field: label, sales: left, erp: right });
  }

  const salesPrice = priceTerms(sales);
  const erpPrice = priceTerms(erp);
  const periods = new Set([...Object.keys(salesPrice), ...Object.keys(erpPrice)]);
  for (const period of [...periods].sort()) {
    for (const field of ['rent', 'deposit'] as const) {
      const left = money(salesPrice[period]?.[field]);
      const right = money(erpPrice[period]?.[field]);
      if (left !== right) fields.push({ field: `${period}.${field}`, sales: left, erp: right });
    }
  }
  if (fields.length) {
    valueDiffs.push({
      plate: p,
      provider: S(sales.provider_company_code),
      tab: S(sales.sheet_source_tab),
      fields,
    });
  }
}

const missing = [...salesIndex.byIdentity.keys()].filter((identity) => !finderIndex.byIdentity.has(identity)).map((identity) => {
  const sales = salesIndex.byIdentity.get(identity)!.row;
  const erp = allErpIndex.byIdentity.get(identity)?.row;
  return {
    plate: plate(sales.car_number || sales.car_number_snapshot),
    provider: S(sales.provider_company_code),
    tab: S(sales.sheet_source_tab),
    salesStatus: S(sales.vehicle_status),
    reason: !erp ? 'ERP 없음' : `상품찾기 비노출(${S(erp.vehicle_status) || '상태 빈칸'})`,
  };
});

const extra = [...finderIndex.byIdentity.keys()].filter((identity) => !salesIndex.byIdentity.has(identity)).map((identity) => {
  const erp = finderIndex.byIdentity.get(identity)!.row;
  const locked = isContractEngineLocked(erp);
  return {
    plate: plate(erp.car_number || erp.car_number_snapshot),
    provider: S(erp.provider_company_code),
    erpStatus: S(erp.vehicle_status),
    sheetStatusOwner: S(erp.sheet_status_owner),
    sheetBlockReason: S(erp.sheet_block_reason),
    locked,
    contract: S(erp.locked_by_contract),
    // 판매시트는 출고불가 행을 싣지 않으므로 현재 상위 상태 증거 없이는 자동 예외로 승인하지 않는다.
    verdict: locked ? '상위 시트 출고불가 근거 확인 필요' : '오류',
  };
});

// DB에만 남은 출고불가 행도 정본 집합 밖이면 별도 오류다. 단순히 finder에서 숨겼다는
// 이유로 통과시키면 ERP 재고와 판매시트의 차량번호 집합이 영구히 갈린다. 계약엔진 락은
// 현재 상위 원본의 출고불가 근거까지 확인해야 예외가 되므로 이 감사에서는 fail-closed한다.
const erpOnly = [...allErpIndex.byIdentity.keys()].filter((identity) => !salesIndex.byIdentity.has(identity)).map((identity) => {
  const erp = allErpIndex.byIdentity.get(identity)!.row;
  const locked = isContractEngineLocked(erp);
  const erpPlate = plate(erp.car_number || erp.car_number_snapshot);
  const openContract = hasOpenContractReference(erp, contracts);
  return {
    plate: erpPlate,
    provider: S(erp.provider_company_code),
    erpStatus: S(erp.vehicle_status),
    finderVisible: isStockedProduct(erp),
    locked,
    openContract,
    contract: S(erp.locked_by_contract),
    verdict: locked
      ? '상위 원본 출고불가 근거 확인 필요'
      : openContract ? '진행계약 참조 확인 필요' : 'ERP 정본 집합 초과',
  };
});

const report = {
  at: new Date().toISOString(),
  source: '프리패스 상품리스트 판매시트 3탭',
  counts: {
    sales: salesIndex.byIdentity.size,
    finder: finderIndex.byIdentity.size,
    erpActive: allErpIndex.byIdentity.size,
    salesParserDuplicates,
    erpDuplicates: allErpIndex.duplicates.length,
    missing: missing.length,
    extra: extra.length,
    erpOnly: erpOnly.length,
    valueDiffPlates: valueDiffs.length,
    lockedStatusOverrides: lockedStatusOverrides.length,
  },
  missing,
  extra,
  erpOnly,
  valueDiffs,
  duplicates: { salesParser: salesParserDuplicates, erp: allErpIndex.duplicates },
  lockedStatusOverrides,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n', 'utf8');

console.log(`■ 판매시트 ${report.counts.sales}대 · 상품찾기 ${report.counts.finder}대 · ERP 활성 ${report.counts.erpActive}대`);
console.log(`■ 판매→상품찾기 누락 ${missing.length}대 · 상품찾기→판매 초과 ${extra.length}대`);
console.log(`■ ERP→판매 집합 초과 ${erpOnly.length}대(상품찾기 노출 ${erpOnly.filter((row) => row.finderVisible).length}대)`);
console.log(`■ 핵심값 불일치 ${valueDiffs.length}대 · 판매 중복 ${salesParserDuplicates}건 · ERP 중복 ${allErpIndex.duplicates.length}건`);
console.log(`■ 계약락 상태 예외 ${lockedStatusOverrides.length}대 · 보고 ${OUT}`);
for (const row of missing.slice(0, 12)) console.log(`   누락 ${maskedPlate(row.plate)} · ${row.reason} · ${row.provider}`);
for (const row of extra.slice(0, 12)) console.log(`   초과 ${maskedPlate(row.plate)} · ${row.verdict} · ${row.provider}`);
for (const row of valueDiffs.slice(0, 12)) console.log(`   값 ${maskedPlate(row.plate)} · ${row.fields.map((item) => item.field).join(', ')} · ${row.provider}`);

const failed = !!(salesParserDuplicates || allErpIndex.duplicates.length || missing.length || erpOnly.length || valueDiffs.length);
const { deleteApp, getApps } = await import('firebase-admin/app');
await Promise.all(getApps().map((app) => deleteApp(app)));
process.exit(failed ? 2 : 0);
