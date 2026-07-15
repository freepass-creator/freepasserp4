/**
 * 매물 검색 필터 엔진 — freepasserp3 product-filters.js(19종) 참고, 각 그룹 OR·그룹간 AND.
 * 정적 밴드(대여료·보증금·주행) + 정적 enum(연료·상품구분·심사) + 동적 집계(제조사·차종·연식·연령하향·약정주행·공급사).
 */
import type { EntityRecord } from '@/lib/intake/entities';
import { priceList, creditDisplay } from '@/lib/domain/product';

export type Band = { k: string; label: string; lo: number; hi: number };
export const RENT_BANDS: Band[] = [
  { k: 'r50', label: '50만↓', lo: 0, hi: 500000 }, { k: 'r60', label: '50~60만', lo: 500000, hi: 600000 },
  { k: 'r70', label: '60~70만', lo: 600000, hi: 700000 }, { k: 'r80', label: '70~80만', lo: 700000, hi: 800000 },
  { k: 'r90', label: '80~90만', lo: 800000, hi: 900000 }, { k: 'r100', label: '90~100만', lo: 900000, hi: 1000000 },
  { k: 'r150', label: '100~150만', lo: 1000000, hi: 1500000 }, { k: 'r200', label: '150만↑', lo: 1500000, hi: Infinity },
];
export const DEP_BANDS: Band[] = [
  { k: 'd0', label: '무보증', lo: -1, hi: 1 }, { k: 'd1', label: '100만↓', lo: 1, hi: 1000000 },
  { k: 'd2', label: '100~200만', lo: 1000000, hi: 2000000 }, { k: 'd3', label: '200~300만', lo: 2000000, hi: 3000000 }, { k: 'd4', label: '300만↑', lo: 3000000, hi: Infinity },
];
export const MILE_BANDS: Band[] = [
  { k: 'm1', label: '1만km↓', lo: -1, hi: 10000 }, { k: 'm3', label: '1~3만', lo: 10000, hi: 30000 },
  { k: 'm5', label: '3~5만', lo: 30000, hi: 50000 }, { k: 'm10', label: '5~10만', lo: 50000, hi: 100000 }, { k: 'm99', label: '10만↑', lo: 100000, hi: Infinity },
];
export const FUELS = ['가솔린', '디젤', '하이브리드', '전기'];
export const PTYPES = ['신차', '재렌트', '재구독'];
export const CREDITS = ['소득무관', '소득확인'];

const polGet = (p: EntityRecord, k: string): string => String((p._policy as Record<string, unknown> | undefined)?.[k] ?? '');
export const DYN: { key: string; label: string; get: (p: EntityRecord) => string }[] = [
  { key: 'maker', label: '제조사', get: (p) => String(p.maker || '') },
  { key: 'vehicle_class', label: '차종', get: (p) => String(p.vehicle_class || '') },
  { key: 'year', label: '연식', get: (p) => String(p.year || '') },
  { key: 'age_lowering', label: '연령하향', get: (p) => polGet(p, 'driver_age_lowering') },
  { key: 'annual_mileage', label: '약정주행', get: (p) => polGet(p, 'annual_mileage') },
  { key: 'provider', label: '공급사', get: (p) => String(p.provider_company_code || '') },
];

/** 데이터에 실제 존재하는 운영 개월수(오름차순) — 기간 필터 칩·엑셀 컬럼용. */
export function operatingMonths(products: EntityRecord[]): number[] {
  const s = new Set<number>();
  for (const p of products) priceList(p).forEach((x) => s.add(x.m));
  return [...s].sort((a, b) => a - b);
}

export type FState = {
  q: string; period: number;
  rent: Set<string>; dep: Set<string>; mile: Set<string>;
  fuel: Set<string>; ptype: Set<string>; credit: Set<string>;
  dyn: Record<string, Set<string>>;
};

export function aggregateDyn(products: EntityRecord[]): Record<string, [string, number][]> {
  const out: Record<string, [string, number][]> = {};
  for (const d of DYN) {
    const m = new Map<string, number>();
    for (const p of products) { const v = d.get(p); if (v) m.set(v, (m.get(v) || 0) + 1); }
    out[d.key] = [...m.entries()].sort((a, b) => d.key === 'year' ? Number(b[0]) - Number(a[0]) : b[1] - a[1]);
  }
  return out;
}

export function matchProduct(p: EntityRecord, s: FState): boolean {
  const pl = priceList(p);
  const qq = s.q.trim().toLowerCase();
  if (qq && ![p.car_number, p.maker, p.model, p.sub_model, p.trim_name].some((v) => v && String(v).toLowerCase().includes(qq))) return false;
  if (s.rent.size && !RENT_BANDS.some((b) => s.rent.has(b.k) && pl.some((x) => x.rent > b.lo && x.rent <= b.hi))) return false;
  if (s.dep.size && !DEP_BANDS.some((b) => s.dep.has(b.k) && pl.some((x) => x.deposit > b.lo && x.deposit <= b.hi))) return false;
  if (s.period && !pl.some((x) => x.m === s.period)) return false; // 기간 필터 = 그 개월수 운영 상품
  if (s.mile.size) { const km = Number(p.mileage) || 0; if (!MILE_BANDS.some((b) => s.mile.has(b.k) && km > b.lo && km <= b.hi)) return false; }
  if (s.fuel.size && !s.fuel.has(String(p.fuel_type))) return false;
  if (s.ptype.size && !s.ptype.has(String(p.product_type))) return false;
  if (s.credit.size && !s.credit.has(creditDisplay(p))) return false;
  for (const d of DYN) { const set = s.dyn[d.key]; if (set && set.size && !set.has(d.get(p))) return false; }
  return true;
}

export function activeCount(s: FState): number {
  return s.rent.size + s.dep.size + s.mile.size + s.fuel.size + s.ptype.size + s.credit.size + DYN.reduce((n, d) => n + (s.dyn[d.key]?.size || 0), 0);
}
