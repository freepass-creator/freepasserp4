export type RawSupplierRow = Record<string, unknown>;

export type RentTerm = 1 | 6 | 12 | 24 | 36 | 48 | 60;

export type AtomSource = {
  supplierCode: string;
  supplierName?: string;
  spreadsheetId?: string;
  tab?: string;
  row?: number;
  adapter: string;
  adapterVersion: string;
};

export type FieldProvenance = Record<
  string,
  {
    sourceHeader: string;
    sourceValue: string;
    transformation?: string;
  }
>;

/**
 * 월 대여료에서 보증금을 산출하는 공급사 정책 원자.
 * 숫자 보증금과 달리 "어떻게 계산하는가" 자체를 SSOT에 보존한다.
 */
export type DepositPolicy =
  | {
      code: 'SONOGONG_RENT_X_YEARS_MAX3';
      kind: 'YEAR_MULTIPLE_CAPPED';
      label: string;
      monthsPerYear: 12;
      maxMultiplier: 3;
    }
  | {
      code: 'AUTOPLUS_DOMESTIC_X2' | 'AUTOPLUS_IMPORT_12_X3_18P_X6';
      kind: 'TERM_MULTIPLIER';
      label: string;
      defaultMultiplier?: number;
      multiplierByTerm?: Readonly<Record<number, number>>;
    };

/**
 * 공급사가 기간 외에 연주행거리까지 가격축으로 쓰는 경우를 위한 원자.
 * 예: 오토플러스 `12개월2만`과 `12개월3만`은 같은 12개월 가격이 아니다.
 * 어댑터는 둘 중 하나를 임의로 고르지 않고 각각 보존한다.
 */
export type RentVariant = {
  termMonths: number;
  annualKm?: number;
  amount: number;
  sourceHeader: string;
};

export type FreepassAtom = {
  source: AtomSource;
  plateNumber?: string;
  vin?: string;
  status?: string;
  productType?: string;
  maker?: string;
  model?: string;
  subModel?: string;
  trim?: string;
  rawName?: string;
  year?: string;
  km?: number;
  fuel?: string;
  displacement?: number;
  shortDeposit?: number;
  longDeposit?: number;
  /** 고정 숫자가 아니라 기간/월대여료에 따라 계산되는 보증금 정책. */
  depositPolicy?: DepositPolicy;
  /** 기간 하나만으로 의미가 완전한 표준 대여료. */
  rent: Partial<Record<RentTerm, number>>;
  /** 기간+연주행거리 등 추가 가격축이 있는 대여료. */
  rentVariants?: RentVariant[];
  provenance: FieldProvenance;
};

export type AdapterIssue = {
  level: 'warning' | 'error';
  code: string;
  message: string;
  field?: string;
};

export type AdapterResult = {
  atom: FreepassAtom;
  issues: AdapterIssue[];
};

export interface SupplierAdapter {
  readonly sourceCode: string;
  readonly adapterName: string;
  readonly version: string;
  adapt(raw: RawSupplierRow, source?: Partial<AtomSource>): AdapterResult;
}

export const text = (v: unknown): string => String(v ?? '').trim();

export const compactPlate = (v: unknown): string => text(v).replace(/\s+/g, '');

export function explicitMoney(v: unknown): number | undefined {
  const raw = text(v);
  if (!raw || /^(?:-|—|―|x|불가|불가능|없음|미운영|미판매|해당없음|n\/a)$/i.test(raw)) return undefined;
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function explicitNumber(v: unknown): number | undefined {
  const raw = text(v);
  if (!raw) return undefined;
  const digits = raw.replace(/[^\d.]/g, '');
  if (!digits) return undefined;
  const n = Number(digits);
  return Number.isFinite(n) ? n : undefined;
}

export function withProvenance(
  provenance: FieldProvenance,
  field: string,
  sourceHeader: string,
  sourceValue: unknown,
  transformation?: string,
): void {
  const value = text(sourceValue);
  if (!value) return;
  provenance[field] = { sourceHeader, sourceValue: value, ...(transformation ? { transformation } : {}) };
}
