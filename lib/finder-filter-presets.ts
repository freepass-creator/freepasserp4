/**
 * 상품찾기 즐겨찾는 조건 — 필터 축 세트 localStorage.
 * 검색어·정렬·최근/관심은 포함하지 않는다(조건 칩만).
 */
'use client';

import { activeCount, activeFilterHints, EMPTY_VEHICLE_FILTER, normalizeVehicleFilter, type VehicleFilter } from '@/lib/domain/product-filters';
import { cloneBag, emptyBag, sameBag, type FilterBag } from '@/features/finder/filter-state';

export type FinderPresetBag = {
  periods: number[];
  rent: string[]; dep: string[]; mile: string[]; fuel: string[];
  ptype: string[]; credit: string[]; perks: string[]; promo: string[];
  dyn: Record<string, string[]>;
  vehicle: VehicleFilter;
  models: string[];
};

export type FinderFilterPreset = {
  id: string;
  label: string;
  bag: FinderPresetBag;
  at: number;
};

const KEY = 'fp4_finder_presets';
const MAX = 8;
const LABEL_MAX = 40;
const EVT = 'fp:finder-presets';
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) {
    try { cb(); } catch { /* noop */ }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVT));
  }
}

function read(): FinderFilterPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) as FinderFilterPreset[] : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.id === 'string' && x.bag)
      .map((x) => ({
        id: String(x.id),
        label: String(x.label || '조건'),
        bag: normalizeBag(x.bag),
        at: Number(x.at) || 0,
      }));
  } catch {
    return [];
  }
}

function write(list: FinderFilterPreset[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* quota */ }
  notify();
}

function normalizeBag(raw: FinderPresetBag): FinderPresetBag {
  const dyn: Record<string, string[]> = {};
  if (raw?.dyn && typeof raw.dyn === 'object') {
    for (const [key, values] of Object.entries(raw.dyn)) {
      if (Array.isArray(values) && values.length) dyn[key] = values.map(String);
    }
  }
  const vehicle = normalizeVehicleFilter(raw?.vehicle);
  return {
    periods: Array.isArray(raw?.periods) ? raw.periods.map(Number).filter(Number.isFinite) : [],
    rent: Array.isArray(raw?.rent) ? raw.rent.map(String) : [],
    dep: Array.isArray(raw?.dep) ? raw.dep.map(String) : [],
    mile: Array.isArray(raw?.mile) ? raw.mile.map(String) : [],
    fuel: Array.isArray(raw?.fuel) ? raw.fuel.map(String) : [],
    ptype: Array.isArray(raw?.ptype) ? raw.ptype.map(String) : [],
    credit: Array.isArray(raw?.credit) ? raw.credit.map(String) : [],
    perks: Array.isArray(raw?.perks) ? raw.perks.map(String) : [],
    promo: Array.isArray(raw?.promo) ? raw.promo.map(String) : [],
    dyn,
    vehicle,
    models: Array.isArray(raw?.models) ? raw.models.map(String) : [],
  };
}

/** 축만 비교 — sort·interest 무시. */
export function axesBag(bag: FilterBag): FilterBag {
  return { ...cloneBag(bag), sort: '', interest: new Set() };
}

export function samePresetAxes(a: FilterBag, b: FilterBag): boolean {
  return sameBag(axesBag(a), axesBag(b));
}

export function bagFromFilter(bag: FilterBag): FinderPresetBag {
  const dyn: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(bag.dyn)) {
    if (values?.size) dyn[key] = [...values];
  }
  return {
    periods: [...bag.periods],
    rent: [...bag.rent],
    dep: [...bag.dep],
    mile: [...bag.mile],
    fuel: [...bag.fuel],
    ptype: [...bag.ptype],
    credit: [...bag.credit],
    perks: [...bag.perks],
    promo: [...bag.promo],
    dyn,
    vehicle: normalizeVehicleFilter(bag.vehicle),
    models: [...bag.models],
  };
}

export function filterFromBag(bag: FinderPresetBag, meta?: Pick<FilterBag, 'sort' | 'interest'>): FilterBag {
  const dyn: Record<string, Set<string>> = {};
  for (const [key, values] of Object.entries(bag.dyn || {})) {
    if (values?.length) dyn[key] = new Set(values);
  }
  return {
    periods: new Set(bag.periods || []),
    rent: new Set(bag.rent || []),
    dep: new Set(bag.dep || []),
    mile: new Set(bag.mile || []),
    fuel: new Set(bag.fuel || []),
    ptype: new Set(bag.ptype || []),
    credit: new Set(bag.credit || []),
    perks: new Set(bag.perks || []),
    promo: new Set(bag.promo || []),
    dyn,
    vehicle: normalizeVehicleFilter(bag.vehicle),
    models: new Set(bag.models || []),
    sort: meta?.sort ?? '',
    interest: meta?.interest ? new Set(meta.interest) : new Set(),
  };
}

export function presetAxesCount(bag: FilterBag): number {
  return activeCount({
    q: '',
    periods: bag.periods,
    rent: bag.rent,
    dep: bag.dep,
    mile: bag.mile,
    fuel: bag.fuel,
    ptype: bag.ptype,
    credit: bag.credit,
    perks: bag.perks,
    promo: bag.promo,
    dyn: bag.dyn,
    vehicle: bag.vehicle,
  }) + bag.models.size;
}

export function labelFromBag(bag: FilterBag): string {
  const hints = activeFilterHints({
    q: '',
    periods: bag.periods,
    rent: bag.rent,
    dep: bag.dep,
    mile: bag.mile,
    fuel: bag.fuel,
    ptype: bag.ptype,
    credit: bag.credit,
    perks: bag.perks,
    promo: bag.promo,
    dyn: bag.dyn,
    vehicle: bag.vehicle,
  });
  const parts = [...bag.models, ...hints];
  const raw = parts.join(' · ') || '조건';
  if (raw.length <= LABEL_MAX) return raw;
  return `${raw.slice(0, LABEL_MAX - 1)}…`;
}

export function listPresets(): FinderFilterPreset[] {
  return read();
}

export function savePreset(bag: FilterBag): FinderFilterPreset | null {
  if (presetAxesCount(bag) <= 0) return null;
  const payload = bagFromFilter(bag);
  const asFilter = filterFromBag(payload);
  const cur = read();
  if (cur.some((p) => samePresetAxes(filterFromBag(p.bag), asFilter))) return null;
  const next: FinderFilterPreset = {
    id: `fp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    label: labelFromBag(bag),
    bag: payload,
    at: Date.now(),
  };
  write([next, ...cur].slice(0, MAX));
  return next;
}

export function removePreset(id: string): void {
  write(read().filter((p) => p.id !== id));
}

/** 축만 비움 — 정렬·최근/관심 유지. */
export function clearAxesKeepMeta(bag: FilterBag): FilterBag {
  return {
    ...emptyBag(),
    sort: bag.sort,
    interest: new Set(bag.interest),
  };
}

export function subscribePresets(cb: () => void): () => void {
  listeners.add(cb);
  if (typeof window === 'undefined') return () => { listeners.delete(cb); };
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) cb();
  };
  window.addEventListener(EVT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener(EVT, cb);
    window.removeEventListener('storage', onStorage);
  };
}
