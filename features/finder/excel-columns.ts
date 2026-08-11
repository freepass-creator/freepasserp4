import type { EntityRecord } from '@/lib/intake/entities';
import { canonProductType, creditDisplay, excelCondSignals, priceList } from '@/lib/domain/product';
import { fuelDisplay, makerDisplay, parseYear, yearDisplay } from '@/lib/domain/vehicle-master-match';
import { excelColFilterMatch } from '@/lib/domain/excel-col-filter';
import { productOptions } from '@/components/product-card-atoms';
import { kmDisplay, man } from '@/lib/format';

export type ColSort = { field: string; dir: 'asc' | 'desc' } | null;

/** 엑셀뷰 전용 주행거리: 999km까지 원단위, 1,000km부터 만 단위 소수 1자리. */
export function excelMileageDisplay(raw: unknown): string {
  const source = String(raw ?? '').trim();
  if (!source) return '';
  const value = Number(source.replace(/,/g, '').replace(/\s*km\s*$/i, '').trim());
  if (!Number.isFinite(value) || value < 0) return kmDisplay(raw);
  if (value < 1000) return `${value.toLocaleString('ko-KR')}km`;
  return `${(value / 10000).toFixed(1)}만`;
}

export function excelColumnValue(product: EntityRecord, key: string): string {
  if (key === 'credit') return creditDisplay(product);
  if (key === 'fuel_type') return fuelDisplay(product.fuel_type) || '';
  if (key === 'maker') return makerDisplay(product.maker) || String(product.maker || '');
  if (key === 'year') return yearDisplay(product.year);
  if (key === 'mileage') return excelMileageDisplay(product.mileage);
  if (key === 'options') return productOptions(product).join(' · ');
  if (key === 'cond') {
    const signals = excelCondSignals(product);
    return signals.length ? signals.map((signal) => signal.label).join('·') : '조건없음';
  }
  if (key === 'provider_name') return String(product.provider_name || product.provider_company_code || '').trim();
  if (key === 'product_type') return canonProductType(product.product_type);
  if (key.startsWith('price:')) {
    const month = Number(key.slice(6));
    const price = priceList(product).find((entry) => entry.m === month);
    return price && price.rent > 0 ? man(price.rent) : '';
  }
  const value = (product as Record<string, unknown>)[key];
  return value == null ? '' : String(value).trim();
}

export function excelColumnValues(product: EntityRecord, key: string): string[] {
  if (key === 'options') return productOptions(product);
  if (key === 'cond') {
    const signals = excelCondSignals(product);
    return signals.length ? signals.map((signal) => signal.label) : ['조건없음'];
  }
  const value = excelColumnValue(product, key);
  return value ? [value] : [];
}

export function excelColumnMatches(product: EntityRecord, key: string, selected: Set<string>): boolean {
  const special = excelColFilterMatch(product, key, selected);
  if (special !== null) return special;
  if (!selected.size) return true;
  return excelColumnValues(product, key).some((value) => selected.has(value));
}

export function excelColumnSortValue(product: EntityRecord, key: string): number | string {
  if (key.startsWith('price:')) {
    const month = Number(key.slice(6));
    return priceList(product).find((entry) => entry.m === month)?.rent ?? 0;
  }
  if (key === 'mileage') return Number(product.mileage) || 0;
  if (key === 'year') return parseYear(product.year);
  return excelColumnValue(product, key);
}

export function isNumericExcelColumn(key: string): boolean {
  return key.startsWith('price:') || key === 'mileage' || key === 'year';
}
