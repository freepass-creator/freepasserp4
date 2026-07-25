/**
 * 엑셀 헤더 필터 — 사이드바 FState와 분리. colFilter만 사용.
 * 대여·주행 팝은 밴드 체크리스트, 매칭은 해당 칸(개월/주행)만.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import {
  RENT_BANDS, MILE_BANDS, PTYPES, FUELS, CREDITS, DYN,
  type Band,
} from '@/lib/domain/product-filters';
import { fuelDisplay, makerDisplay } from '@/lib/domain/vehicle-master-match';
import { canonProductType, creditDisplay, priceList } from '@/lib/domain/product';

export type PopEntry = { key: string; label: string; count: number };

function countBands(
  rows: EntityRecord[],
  bands: Band[],
  hit: (p: EntityRecord, b: Band) => boolean,
): PopEntry[] {
  return bands.map((b) => ({
    key: b.k,
    label: b.label,
    count: rows.filter((p) => hit(p, b)).length,
  })).filter((e) => e.count > 0);
}

function countStrings(vals: string[]): PopEntry[] {
  const m = new Map<string, number>();
  for (const v of vals) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()]
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'ko'));
}

/**
 * 팝 체크리스트.
 * null = 셀 값 집계(호출측 exColVals). 대여·주행=밴드, 상품·연료·심사·색·연식·제조사=고정/집계.
 */
export function excelPopEntries(field: string, rows: EntityRecord[]): PopEntry[] | null {
  if (field.startsWith('price:')) {
    const month = Number(field.slice(6));
    if (!Number.isFinite(month)) return [];
    return countBands(rows, RENT_BANDS, (p, b) => {
      const e = priceList(p).find((x) => x.m === month);
      return !!e && e.rent > b.lo && e.rent <= b.hi;
    });
  }
  if (field === 'mileage') {
    return countBands(rows, MILE_BANDS, (p, b) => {
      const km = Number(p.mileage) || 0;
      return km > b.lo && km <= b.hi;
    });
  }
  if (field === 'product_type') {
    return PTYPES.map((t) => ({
      key: t, label: t,
      count: rows.filter((p) => canonProductType(p.product_type) === t).length,
    })).filter((e) => e.count > 0);
  }
  if (field === 'fuel_type') {
    return FUELS.map((t) => ({
      key: t, label: t,
      count: rows.filter((p) => (fuelDisplay(p.fuel_type) || String(p.fuel_type || '')) === t).length,
    })).filter((e) => e.count > 0);
  }
  if (field === 'credit') {
    return CREDITS.map((t) => ({
      key: t, label: t,
      count: rows.filter((p) => creditDisplay(p) === t).length,
    })).filter((e) => e.count > 0);
  }
  const dyn = DYN.find((d) => d.key === field);
  if (dyn) {
    return countStrings(rows.map((p) => dyn.get(p)).filter(Boolean));
  }
  if (field === 'maker') {
    return countStrings(rows.map((p) => makerDisplay(p.maker) || String(p.maker || '')).filter(Boolean));
  }
  return null;
}

/**
 * 엑셀 colFilter 매칭.
 * true/false = 처리함. null = 일반 셀 매칭(exColMatch)으로.
 */
export function excelColFilterMatch(
  p: EntityRecord,
  key: string,
  set: Set<string>,
): boolean | null {
  if (!set.size) return true;
  if (key.startsWith('price:')) {
    const month = Number(key.slice(6));
    const e = priceList(p).find((x) => x.m === month);
    if (!e) return false;
    return RENT_BANDS.some((b) => set.has(b.k) && e.rent > b.lo && e.rent <= b.hi);
  }
  if (key === 'mileage') {
    const km = Number(p.mileage) || 0;
    return MILE_BANDS.some((b) => set.has(b.k) && km > b.lo && km <= b.hi);
  }
  if (key === 'product_type') return set.has(canonProductType(p.product_type));
  if (key === 'fuel_type') return set.has(fuelDisplay(p.fuel_type) || String(p.fuel_type || ''));
  if (key === 'credit') return set.has(creditDisplay(p));
  if (key === 'maker') {
    return set.has(makerDisplay(p.maker) || String(p.maker || ''));
  }
  const dyn = DYN.find((d) => d.key === key);
  if (dyn) return set.has(dyn.get(p));
  return null;
}
