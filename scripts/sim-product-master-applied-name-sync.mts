import assert from 'node:assert/strict';
import { planProductMasterAppliedNamesFromTrim } from '../lib/domain/product-master-applied-name-sync';
import { PRODUCT_MASTER_COLUMNS } from '../lib/domain/product-master-sheet';
import type { VehicleTrimMasterRecord } from '../lib/domain/vehicle-trim-master';

const blank = () => Array.from({ length: PRODUCT_MASTER_COLUMNS.length }, () => '');
const set = (row: string[], name: (typeof PRODUCT_MASTER_COLUMNS)[number], value: string) => {
  row[PRODUCT_MASTER_COLUMNS.indexOf(name)] = value;
};

const master: VehicleTrimMasterRecord = {
  trim_row_key: 'mf-001.md-018.sm-dn8::v02::t02',
  maker: '현대',
  model: '쏘나타',
  sub_model: '쏘나타 DN8 더 엣지',
  powertrain: '가솔린 1.6T',
  trim: '프리미엄',
  usage_tier: 'automatic',
  management_status: '확정',
  verification_status: '확정',
} as unknown as VehicleTrimMasterRecord;

const rowOk = blank();
set(rowOk, '차량번호', '161하1337');
set(rowOk, '차종코드', master.trim_row_key);
set(rowOk, '차종마스터 적용값', '쏘나타 더 엣지 DN8 · 가솔린 1.6T · 프리미엄');

const rowSame = blank();
set(rowSame, '차량번호', '161하1340');
set(rowSame, '차종코드', master.trim_row_key);
set(rowSame, '차종마스터 적용값', '쏘나타 DN8 더 엣지 · 가솔린 1.6T · 프리미엄');

const rowMissing = blank();
set(rowMissing, '차량번호', '162허2357');
set(rowMissing, '차종코드', 'mf-gone::v01::t01');
set(rowMissing, '차종마스터 적용값', '옛이름');

const plan = planProductMasterAppliedNamesFromTrim({
  values: [PRODUCT_MASTER_COLUMNS as unknown as string[], rowOk, rowSame, rowMissing],
  byKey: new Map([[master.trim_row_key, master]]),
});

assert.equal(plan.coded, 3);
assert.equal(plan.unchanged, 1);
assert.equal(plan.patches.length, 1);
assert.equal(plan.patches[0]?.after, '쏘나타 DN8 더 엣지 · 가솔린 1.6T · 프리미엄');
assert.equal(plan.missing_keys.length, 1);
assert.equal(plan.missing_keys[0]?.car_number, '162허2357');
console.log('sim-product-master-applied-name-sync: PASS');
