/**
 * 상품마스터에 이미 박힌 차종코드 → 현재 차종마스터(artifact) 이름칸으로
 * 「차종마스터 적용값」만 재동기화하는 계획. 코드·잠금·돈 칸은 건드리지 않는다.
 */
import {
  PRODUCT_MASTER_COLUMNS,
  productMasterVehicleName,
} from './product-master-sheet';
import type { VehicleTrimMasterRecord } from './vehicle-trim-master';

const S = (value: unknown) => String(value ?? '').trim();
const plate = (value: unknown) => S(value).replace(/\s/g, '');

export type ProductMasterAppliedNamePatch = {
  row: number;
  car_number: string;
  code: string;
  before: string;
  after: string;
};

export type ProductMasterAppliedNamePlan = {
  coded: number;
  unchanged: number;
  patches: ProductMasterAppliedNamePatch[];
  missing_keys: Array<{ row: number; car_number: string; code: string }>;
  non_automatic: Array<{ row: number; car_number: string; code: string; tier: string }>;
};

export function planProductMasterAppliedNamesFromTrim(input: {
  values: unknown[][];
  byKey: Map<string, VehicleTrimMasterRecord>;
}): ProductMasterAppliedNamePlan {
  const col = (name: (typeof PRODUCT_MASTER_COLUMNS)[number]) => PRODUCT_MASTER_COLUMNS.indexOf(name);
  const patches: ProductMasterAppliedNamePatch[] = [];
  const missing_keys: ProductMasterAppliedNamePlan['missing_keys'] = [];
  const non_automatic: ProductMasterAppliedNamePlan['non_automatic'] = [];
  let coded = 0;
  let unchanged = 0;

  input.values.slice(1).forEach((row, index) => {
    const code = S(row[col('차종코드')]);
    if (!code) return;
    coded += 1;
    const car_number = plate(row[col('차량번호')]);
    const sheetRow = index + 2;
    const master = input.byKey.get(code);
    if (!master) {
      missing_keys.push({ row: sheetRow, car_number, code });
      return;
    }
    if (master.usage_tier !== 'automatic'
      || master.management_status !== '확정'
      || master.verification_status !== '확정') {
      non_automatic.push({
        row: sheetRow, car_number, code, tier: `${master.usage_tier}/${master.management_status}/${master.verification_status}`,
      });
      return;
    }
    const after = productMasterVehicleName({
      maker: master.maker,
      model: master.model,
      subModel: master.sub_model,
      powertrain: master.powertrain,
      trim: master.trim,
    });
    const before = S(row[col('차종마스터 적용값')]);
    if (!after) return;
    if (before === after) {
      unchanged += 1;
      return;
    }
    patches.push({ row: sheetRow, car_number, code, before, after });
  });

  return { coded, unchanged, patches, missing_keys, non_automatic };
}
