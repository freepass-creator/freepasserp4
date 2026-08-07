import { EMPTY_VEHICLE_FILTER, normalizeVehicleFilter, type VehicleFilter } from '@/lib/domain/product-filters';
import { FILTER_SS } from '@/lib/finder-session';

export type InterestKey = 'recent' | 'fav';
export type FilterBag = {
  periods: Set<number>;
  rent: Set<string>; dep: Set<string>; mile: Set<string>; fuel: Set<string>;
  ptype: Set<string>; credit: Set<string>; perks: Set<string>; promo: Set<string>;
  dyn: Record<string, Set<string>>;
  vehicle: VehicleFilter;
  models: Set<string>;
  sort: string;
  interest: Set<InterestKey>;
};

/** 정렬 옵션 SSOT — 툴바 드롭다운·필터패널 Select 공용. 키는 useFinderResults 정렬 switch와 일치. */
export const FINDER_SORTS: { value: string; label: string }[] = [
  { value: 'asc', label: '대여료 낮은순' },
  { value: 'desc', label: '대여료 높은순' },
  { value: 'dep_asc', label: '보증금 낮은순' },
  { value: 'dep_desc', label: '보증금 높은순' },
  { value: 'mile_asc', label: '주행 짧은순' },
  { value: 'mile_desc', label: '주행 많은순' },
  { value: 'new', label: '연식 최신순' },
  { value: 'old', label: '연식 오래된순' },
];

export type SavedFinderFilters = {
  q: string;
  periods: number[];
  rent: string[]; dep: string[]; mile: string[]; fuel: string[];
  ptype: string[]; credit: string[]; perks: string[]; promo: string[];
  dyn: Record<string, string[]>;
  vehicle: VehicleFilter;
  models: string[];
  sort: string;
};

export function emptyBag(): FilterBag {
  return {
    periods: new Set(), rent: new Set(), dep: new Set(), mile: new Set(), fuel: new Set(),
    ptype: new Set(), credit: new Set(), perks: new Set(), promo: new Set(),
    dyn: {}, vehicle: { ...EMPTY_VEHICLE_FILTER }, models: new Set(), sort: '', interest: new Set(),
  };
}

export function cloneBag(bag: FilterBag): FilterBag {
  const dyn: Record<string, Set<string>> = {};
  for (const [key, values] of Object.entries(bag.dyn)) dyn[key] = new Set(values);
  return {
    periods: new Set(bag.periods), rent: new Set(bag.rent), dep: new Set(bag.dep),
    mile: new Set(bag.mile), fuel: new Set(bag.fuel), ptype: new Set(bag.ptype),
    credit: new Set(bag.credit), perks: new Set(bag.perks), promo: new Set(bag.promo),
    dyn, vehicle: normalizeVehicleFilter(bag.vehicle), models: new Set(bag.models),
    sort: bag.sort, interest: new Set(bag.interest),
  };
}

function setKey(values: Iterable<unknown>): string {
  return [...values].map(String).sort().join('\0');
}

export function sameBag(a: FilterBag, b: FilterBag): boolean {
  if (a.sort !== b.sort || setKey(a.interest) !== setKey(b.interest)) return false;
  const fields = ['periods', 'rent', 'dep', 'mile', 'fuel', 'ptype', 'credit', 'perks', 'promo', 'models'] as const;
  if (fields.some((field) => setKey(a[field]) !== setKey(b[field]))) return false;
  const dynA = Object.keys(a.dyn).filter((key) => a.dyn[key]?.size).sort();
  const dynB = Object.keys(b.dyn).filter((key) => b.dyn[key]?.size).sort();
  if (dynA.length !== dynB.length || dynA.some((key, index) => key !== dynB[index] || setKey(a.dyn[key] || []) !== setKey(b.dyn[key] || []))) return false;
  const va = normalizeVehicleFilter(a.vehicle);
  const vb = normalizeVehicleFilter(b.vehicle);
  return setKey(va.maker) === setKey(vb.maker)
    && setKey(va.model) === setKey(vb.model)
    && setKey(va.sub_model) === setKey(vb.sub_model)
    && setKey(va.variant) === setKey(vb.variant)
    && setKey(va.trim_name) === setKey(vb.trim_name);
}

export function readSavedFilters(): SavedFinderFilters | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(FILTER_SS);
    return raw ? JSON.parse(raw) as SavedFinderFilters : null;
  } catch { return null; }
}

export function writeSavedFilters(filters: SavedFinderFilters): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(FILTER_SS, JSON.stringify(filters)); } catch { /* unavailable */ }
}

export function clearSavedFilters(): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.removeItem(FILTER_SS); } catch { /* unavailable */ }
}

export function setFromArr(values?: string[]): Set<string> {
  return new Set(Array.isArray(values) ? values : []);
}

export function numOr(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
