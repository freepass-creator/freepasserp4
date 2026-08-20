/**
 * 상품마스터 live 칸 일일 갱신 — 순수 계획(쓰기 없음).
 * 공급사 파서 산출(importSheetTable product) ↔ 상품마스터 행을 칸 단위로 견준다.
 */
import {
  PRODUCT_MASTER_COLUMNS,
  PRODUCT_MASTER_PERIODS,
  PRODUCT_MASTER_VARIANT_PRICE_COLUMNS,
  isProductMasterLiveColumn,
  productMasterPriceColumns,
} from './product-master-sheet';
import type { EntityRecord } from '@/lib/intake/entities';

const S = (v: unknown) => String(v ?? '').trim();
export const normalizePlate = (v: unknown) => S(v).replace(/\s/g, '');

/** live + 메타(최종갱신·원천) — AI 잠금 칸은 절대 포함하지 않는다. */
export const PRODUCT_MASTER_LIVE_WRITE_COLUMNS = [
  '차량상태',
  '정책코드',
  ...productMasterPriceColumns,
  ...PRODUCT_MASTER_VARIANT_PRICE_COLUMNS,
  '최종갱신',
  '원천',
] as const;

export type ProductMasterLiveCellPatch = {
  column: string;
  columnIndex: number;
  before: string;
  after: string;
};

export type ProductMasterLivePlatePlan = {
  car_number: string;
  provider_code: string;
  kind: 'update' | 'append' | 'absent' | 'blocked' | 'skip';
  rowNumber?: number; // 1-based sheet row (header=1)
  patches: ProductMasterLiveCellPatch[];
  diagnostics: string[];
  expected_updated_at: string;
};

export type ProductMasterLiveProviderSummary = {
  code: string;
  name: string;
  source_plates: number;
  master_plates: number;
  shrink_ratio: number;
  shrink_blocked: boolean;
  manual_blocked: boolean;
  created: number;
  status_changed: number;
  rent_changed: number;
  absent: number;
  blocked: number;
  skipped: number;
  diagnostics: string[];
};

function moneyAtom(value: unknown): number | null {
  const raw = S(value).replace(/,/g, '');
  if (!raw || raw === '-') return null;
  const n = Number(raw.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** 93,000 ≡ 93000. 빈칸·`-` 는 같은 공란. */
export function sameMoneyCell(left: unknown, right: unknown): boolean {
  const a = S(left); const b = S(right);
  const emptyA = !a || a === '-';
  const emptyB = !b || b === '-';
  if (emptyA && emptyB) return true;
  if (emptyA || emptyB) return false;
  const na = moneyAtom(a); const nb = moneyAtom(b);
  if (na == null || nb == null) return a.replace(/\s/g, '') === b.replace(/\s/g, '');
  return na === nb;
}

export function formatMoneyCell(value: unknown): string {
  const n = moneyAtom(value);
  if (n == null || n === 0) return '';
  return String(n);
}

function priceKeyToColumns(key: string): { rent: string; deposit: string } | null {
  const plain = /^(\d+)$/.exec(key);
  if (plain) {
    const months = Number(plain[1]);
    if (!(PRODUCT_MASTER_PERIODS as readonly number[]).includes(months)) return null;
    return { rent: `${months}개월 대여료`, deposit: `${months}개월 보증금` };
  }
  const mileage = /^(\d+)_(3만|2만)$/.exec(key);
  if (mileage) {
    const months = Number(mileage[1]);
    if (mileage[2] === '3만' && [18, 24, 36].includes(months)) {
      return { rent: `${months}개월 3만km 대여료`, deposit: `${months}개월 3만km 보증금` };
    }
    // 오토플러스 기본칸: 12_3만 → 12개월 대여료, 나머지 2만 → N개월 대여료
    if ((PRODUCT_MASTER_PERIODS as readonly number[]).includes(months)) {
      return { rent: `${months}개월 대여료`, deposit: `${months}개월 보증금` };
    }
  }
  const buy = /^(\d+)_인수형$/.exec(key);
  if (buy && [36, 48, 60].includes(Number(buy[1]))) {
    const months = Number(buy[1]);
    return { rent: `인수형 ${months}개월 대여료`, deposit: `인수형 ${months}개월 보증금` };
  }
  return null;
}

/**
 * importSheetTable 상품 → 상품마스터 live 칸 값.
 * 대여료/보증금 한쪽만 있으면 그 기간은 넣지 않고 diagnostics 에 남긴다.
 */
export function liveValuesFromSupplierProduct(
  product: EntityRecord,
  opts?: { today?: string },
): { values: Record<string, string>; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const values: Record<string, string> = {};
  const status = S(product.status_label_raw) || S(product.vehicle_status);
  if (status) values['차량상태'] = status;
  const policy = S(product.policy_code);
  if (policy) values['정책코드'] = policy;
  // ★모델명·차명 — 공급사 시트가 정본(2026-08-20). 상품찾기·ERP 가 이 두 칸을 그대로 쓴다.
  //   importSheetTable 은 「모델명」을 model, 「차명(세부모델+트림)」을 trim_extra(원문)·sub_model 로 담는다.
  const modelName = S(product.model_name_raw) || S(product.model);
  if (modelName) values['모델명'] = modelName;
  const vehicleName = S(product.supplier_vehicle_name) || S(product.trim_extra) || S(product.vehicle_name_raw);
  if (vehicleName) values['차명'] = vehicleName;

  const price = (product.price && typeof product.price === 'object')
    ? product.price as Record<string, { rent?: number; deposit?: number }>
    : {};
  for (const [key, term] of Object.entries(price)) {
    const cols = priceKeyToColumns(key);
    if (!cols) continue;
    const rent = Number(term?.rent);
    const deposit = Number(term?.deposit);
    if (!Number.isFinite(rent) || rent <= 0) {
      diagnostics.push(`${normalizePlate(product.car_number)} ${key} 대여료 없음 — 기간 칸 미반영`);
      continue;
    }
    if (!Number.isFinite(deposit)) {
      diagnostics.push(`${normalizePlate(product.car_number)} ${key} 보증금 한쪽만 — 기간 칸 미반영`);
      continue;
    }
    values[cols.rent] = formatMoneyCell(rent);
    values[cols.deposit] = formatMoneyCell(deposit);
  }

  const today = opts?.today || new Date().toISOString().slice(0, 10);
  values['최종갱신'] = today;
  values['원천'] = S(product.sheet_source_tab)
    ? `공급사시트 ${S(product.sheet_source_tab)}`
    : '공급사시트 일일갱신';
  return { values, diagnostics };
}

export function assertLiveWriteColumns(columns: string[]): void {
  for (const column of columns) {
    if (column === '최종갱신' || column === '원천') continue;
    if (!isProductMasterLiveColumn(column)) {
      throw new Error(`live 쓰기 금지 칸: ${column}`);
    }
  }
}

export function planProductMasterLivePatches(input: {
  headers: string[];
  masterRow: string[];
  rowNumber: number;
  incoming: Record<string, string>;
  diagnostics?: string[];
}): ProductMasterLivePlatePlan {
  const col = (name: string) => input.headers.indexOf(name);
  const plate = normalizePlate(input.masterRow[col('차량번호')]);
  const provider = S(input.masterRow[col('공급사코드')]);
  const expectedUpdated = S(input.masterRow[col('최종갱신')]);
  const patches: ProductMasterLiveCellPatch[] = [];
  const diagnostics = [...(input.diagnostics || [])];

  for (const [column, afterRaw] of Object.entries(input.incoming)) {
    if (column === '최종갱신' || column === '원천') continue;
    const index = col(column);
    if (index < 0) {
      diagnostics.push(`열 없음: ${column}`);
      continue;
    }
    if (!isProductMasterLiveColumn(column)) {
      diagnostics.push(`잠금/비live 칸 스킵: ${column}`);
      continue;
    }
    const before = S(input.masterRow[index]);
    const after = S(afterRaw);
    const money = /대여료|보증금/.test(column);
    if (money ? sameMoneyCell(before, after) : before === after) continue;
    // 들어온 값이 공란이면 기존을 지우지 않는다(한쪽만 있는 기간은 이미 incoming 에서 빠짐).
    if (!after && before) {
      diagnostics.push(`${plate} ${column} 원본 공란 — 기존값 유지`);
      continue;
    }
    patches.push({ column, columnIndex: index, before, after });
  }

  if (patches.length) {
    const updatedIdx = col('최종갱신');
    const originIdx = col('원천');
    if (updatedIdx >= 0) {
      patches.push({
        column: '최종갱신',
        columnIndex: updatedIdx,
        before: expectedUpdated,
        after: S(input.incoming['최종갱신']) || new Date().toISOString().slice(0, 10),
      });
    }
    if (originIdx >= 0 && S(input.incoming['원천'])) {
      const before = S(input.masterRow[originIdx]);
      const after = S(input.incoming['원천']);
      if (before !== after) {
        patches.push({ column: '원천', columnIndex: originIdx, before, after });
      }
    }
  }

  assertLiveWriteColumns(patches.map((p) => p.column));
  return {
    car_number: plate,
    provider_code: provider,
    kind: patches.length ? 'update' : 'skip',
    rowNumber: input.rowNumber,
    patches,
    diagnostics,
    expected_updated_at: expectedUpdated,
  };
}

export function buildAbsentLivePatch(input: {
  headers: string[];
  masterRow: string[];
  rowNumber: number;
  today: string;
}): ProductMasterLivePlatePlan {
  const col = (name: string) => input.headers.indexOf(name);
  const plate = normalizePlate(input.masterRow[col('차량번호')]);
  const provider = S(input.masterRow[col('공급사코드')]);
  const expectedUpdated = S(input.masterRow[col('최종갱신')]);
  const patches: ProductMasterLiveCellPatch[] = [];
  const statusIdx = col('차량상태');
  const originIdx = col('원천');
  const updatedIdx = col('최종갱신');
  const beforeStatus = S(input.masterRow[statusIdx]);
  if (statusIdx >= 0 && beforeStatus !== '출고불가') {
    patches.push({ column: '차량상태', columnIndex: statusIdx, before: beforeStatus, after: '출고불가' });
  }
  const absentOrigin = `원본부재 ${input.today}`;
  if (originIdx >= 0 && S(input.masterRow[originIdx]) !== absentOrigin) {
    patches.push({
      column: '원천', columnIndex: originIdx,
      before: S(input.masterRow[originIdx]), after: absentOrigin,
    });
  }
  if (patches.length && updatedIdx >= 0) {
    patches.push({
      column: '최종갱신', columnIndex: updatedIdx,
      before: expectedUpdated, after: input.today,
    });
  }
  return {
    car_number: plate,
    provider_code: provider,
    kind: 'absent',
    rowNumber: input.rowNumber,
    patches,
    diagnostics: [],
    expected_updated_at: expectedUpdated,
  };
}

/** 신규 미매칭 행(50칸). 차종코드 빈칸 · 관리상태 검수필요. */
export function buildUnmatchedAppendRow(input: {
  car_number: string;
  provider_code: string;
  provider_name: string;
  supplier_vehicle_name: string;
  raw_preserved: string;
  live: Record<string, string>;
  today: string;
}): string[] {
  const row = PRODUCT_MASTER_COLUMNS.map(() => '');
  const set = (name: (typeof PRODUCT_MASTER_COLUMNS)[number], value: string) => {
    const i = PRODUCT_MASTER_COLUMNS.indexOf(name);
    if (i >= 0) row[i] = value;
  };
  set('차량번호', input.car_number);
  set('공급사명', input.provider_name);
  set('공급사 입력 차명', input.supplier_vehicle_name);
  set('차종마스터 적용값', '');
  set('검증상태', '미매칭');
  set('검수사유', '일일갱신 신규 — 차종코드 미부여');
  set('옵션', '');
  set('차량상태', S(input.live['차량상태']) || '출고협의');
  set('분류', '');
  set('관리상태', '검수필요');
  set('사진링크', '');
  set('입고일자', '');
  for (const column of [...productMasterPriceColumns, ...PRODUCT_MASTER_VARIANT_PRICE_COLUMNS]) {
    if (S(input.live[column])) set(column, input.live[column]);
  }
  set('정책코드', S(input.live['정책코드']));
  set('차종코드', '');
  set('공급사코드', input.provider_code);
  set('최종갱신', input.today);
  set('원천', S(input.live['원천']) || '공급사시트 일일갱신(신규)');
  set('공급사 원문보존', input.raw_preserved);
  if (row.length !== PRODUCT_MASTER_COLUMNS.length) throw new Error('append 행 너비 오류');
  return row;
}

export function summarizeProviderPlans(
  code: string,
  name: string,
  plans: ProductMasterLivePlatePlan[],
  sourcePlates: number,
  masterPlates: number,
  manualBlocked: boolean,
  forceShrink: boolean,
): ProductMasterLiveProviderSummary {
  const shrinkRatio = masterPlates > 0 ? Math.max(0, (masterPlates - sourcePlates) / masterPlates) : 0;
  const shrinkBlocked = !forceShrink && masterPlates >= 5 && shrinkRatio >= 0.2;
  const diagnostics: string[] = [];
  if (shrinkBlocked) {
    diagnostics.push(`공급사 ${code} 원본 ${sourcePlates}대 ← 마스터 ${masterPlates}대 (${Math.round(shrinkRatio * 100)}% 감소) — 중단`);
  }
  if (manualBlocked) diagnostics.push(`공급사 ${code} 매뉴얼 자동반영 금지 — 진단만`);
  let created = 0; let statusChanged = 0; let rentChanged = 0; let absent = 0; let blocked = 0; let skipped = 0;
  for (const plan of plans) {
    if (plan.kind === 'append') created++;
    else if (plan.kind === 'absent') absent++;
    else if (plan.kind === 'blocked') blocked++;
    else if (plan.kind === 'skip' || !plan.patches.length) skipped++;
    if (plan.patches.some((p) => p.column === '차량상태')) statusChanged++;
    if (plan.patches.some((p) => /대여료|보증금/.test(p.column))) rentChanged++;
    diagnostics.push(...plan.diagnostics);
  }
  return {
    code, name, source_plates: sourcePlates, master_plates: masterPlates,
    shrink_ratio: shrinkRatio, shrink_blocked: shrinkBlocked, manual_blocked: manualBlocked,
    created, status_changed: statusChanged, rent_changed: rentChanged,
    absent, blocked, skipped, diagnostics,
  };
}
