import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { importSalesInventorySheet } from '../lib/domain/sales-inventory-sheet';
import type { EntityRecord } from '../lib/intake/entities';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import { planDailySheetSync } from '../lib/domain/sheet-daily-sync';

const raw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
const entries = Array.isArray(raw) ? raw : raw.entries || [];
const partners: EntityRecord[] = [
  { _key: 'PT-0023', partner_code: 'PT-0023', name: '주식회사 에스에이렌터카', partner_type: '공급사', last_sheet_rows: 10 },
  { _key: 'RP006', partner_code: 'RP006', name: '(주)아이언렌트카', partner_type: 'provider' },
];
const table = [
  ['차량번호', '상태', '상품', '제조사', '차종', '세부모델', '파워', '트림', '주행', '12개월', '공급사', '정책코드', '배기량'],
  ['109호4733', '출고가능', '중고렌트', '기아', '니로', '디 올 뉴 니로 SG2', '하이브리드 1.6', '프레스티지', '9,200km', '640,000\n1,500,000', '에스에이', 'POL-0043', '1,600'],
  ['109호4734', '계약중', '중고렌트', '기아', '니로', '디 올 뉴 니로 SG2', '하이브리드 1.6', '프레스티지', '0.1만km', '640,000\n0', '아이언', 'POL-0047', '미입력'],
];

const fetched = importSalesInventorySheet({
  table,
  partners,
  entries,
  tabTitle: '상품리스트 08.12 · 2대',
  tabGid: '775885293',
});
assert.equal(fetched.products.length, 2);
assert.equal(fetched.sourceKind, 'sales_inventory');
const sa = fetched.products.find((product) => product.provider_company_code === 'PT-0023');
const iron = fetched.products.find((product) => product.provider_company_code === 'RP006');
assert.equal(sa?.mileage, '9200');
assert.equal(sa?.engine_cc, '1600');
assert.equal(sa?.variant, '하이브리드 1.6');
assert.deepEqual(sa?.price, { '12': { rent: 640000, deposit: 1500000 } });
assert.equal(sa?.policy_code, 'POL-0043');
assert.equal(sa?.sheet_source_row, 2);
assert.equal(iron?.mileage, '1000');
assert.equal(iron?.sheet_source_row, 3);
assert.equal(iron?.vehicle_status, '계약중');
assert.deepEqual(iron?.price, { '12': { rent: 640000, deposit: 0 } });

const blocked = planDailySheetSync({ fetched, existing: [], deleted: [], partners });
assert.equal(blocked.ok, false);
assert.match(blocked.blockReason, /계약 엔진과 일치하지 않습니다/);
const allowed = planDailySheetSync({
  fetched,
  existing: [{ ...iron, _key: iron?.product_code, locked_by_contract: 'CT-1' } as EntityRecord],
  deleted: [],
  partners,
});
assert.equal(allowed.blockReason.includes('계약 엔진'), false);

const priorSaRows = Array.from({ length: 6 }, (_, index): EntityRecord => ({
  _key: `PT-0023_OLD-${index}`,
  product_code: `PT-0023_OLD-${index}`,
  provider_company_code: 'PT-0023',
  car_number: `OLD-${index}`,
  vehicle_status: '출고가능',
}));
const canonicalDecrease = planDailySheetSync({
  fetched: importSalesInventorySheet({
    table: [
      table[0],
      table[1],
      ['109호4735', ...table[1].slice(1)],
      ['109호4736', ...table[1].slice(1)],
      ['109호4737', ...table[1].slice(1)],
    ],
    partners,
    entries,
    tabTitle: '상품리스트',
    tabGid: '1',
  }),
  existing: [{ ...sa, _key: sa?.product_code }, ...priorSaRows] as EntityRecord[],
  deleted: [],
  partners,
});
assert.equal(canonicalDecrease.ok, true);
assert.equal(canonicalDecrease.counts.absentGuarded, 0);
assert.equal(canonicalDecrease.counts.absentBlocked, 6);

const missingProvider = planDailySheetSync({
  fetched: importSalesInventorySheet({
    table: [table[0], table[1]],
    partners,
    entries,
    tabTitle: '상품리스트',
    tabGid: '1',
  }),
  existing: [{ ...sa, _key: sa?.product_code }, {
    _key: 'RP006_STALE',
    product_code: 'RP006_STALE',
    provider_company_code: 'RP006',
    car_number: 'STALE-1',
    vehicle_status: '출고가능',
  }] as EntityRecord[],
  deleted: [],
  partners,
});
assert.equal(missingProvider.ok, true);
assert.equal(missingProvider.counts.absentBlocked, 1);

assert.throws(() => importSalesInventorySheet({
  table: [table[0], [...table[1].slice(0, 10), '알수없는공급사', ...table[1].slice(11)]],
  partners,
  entries,
  tabTitle: '상품리스트',
  tabGid: '1',
}), /공급사 매칭 실패/);

console.log('sim-sales-inventory-sheet: PASS');
