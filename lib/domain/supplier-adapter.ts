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
  rent: Partial<Record<RentTerm, number>>;
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
