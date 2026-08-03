'use client';

import { useDeferredValue, useMemo } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import type { InterestSnap } from '@/lib/product-interest';
import {
  depositForSort, installmentOk, isOfferableProduct, minAge, noDeposit, rentForSort,
} from '@/lib/domain/product';
import {
  activeCount, aggregateDyn, EMPTY_VEHICLE_FILTER, excelMonths, matchProduct,
  presentFilterOptions, type FState, type VehicleFilter,
} from '@/lib/domain/product-filters';
import { excelColumnMatches, excelColumnSortValue, isNumericExcelColumn, type ColSort } from './excel-columns';
import { numOr, type FilterBag, type InterestKey } from './filter-state';

type Params = {
  rows: EntityRecord[] | null;
  query: string;
  periods: Set<number>;
  rent: Set<string>;
  deposit: Set<string>;
  mileage: Set<string>;
  fuel: Set<string>;
  productType: Set<string>;
  credit: Set<string>;
  perks: Set<string>;
  promo: Set<string>;
  dynamic: Record<string, Set<string>>;
  vehicle: VehicleFilter;
  models: Set<string>;
  sort: string;
  interest: Set<InterestKey>;
  recent: InterestSnap[];
  favorites: InterestSnap[];
  hiddenCodes: Set<string>;
  passedCodes: Set<string>;
  filterDraft: FilterBag | null;
  effectiveView: string;
  columnFilter: Record<string, Set<string>>;
  columnSort: ColSort;
};

export function useFinderResults(params: Params) {
  const {
    rows, query, periods, rent, deposit, mileage, fuel, productType, credit,
    perks, promo, dynamic, vehicle, models, sort, interest, recent, favorites,
    hiddenCodes, passedCodes, filterDraft, effectiveView, columnFilter, columnSort,
  } = params;
  const state: FState = {
    q: query, periods, rent, dep: deposit, mile: mileage, fuel,
    ptype: productType, credit, perks, promo, dyn: dynamic, vehicle,
  };
  const deferredState = useDeferredValue(state);
  const deferredModels = useDeferredValue(models);

  const aggregate = useMemo(() => aggregateDyn(rows || []), [rows]);
  const months = useMemo(() => effectiveView === 'excel' ? excelMonths(rows || []) : [], [rows, effectiveView]);
  const present = useMemo(() => presentFilterOptions(rows || []), [rows]);
  const cascadeProducts = useMemo(() => {
    const base: FState = { ...deferredState, vehicle: { ...EMPTY_VEHICLE_FILTER } };
    return (rows || []).filter((product) => matchProduct(product, base));
  }, [rows, deferredState]);
  const popularModels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of rows || []) {
      if (!isOfferableProduct(product)) continue;
      const model = String(product.model || '').trim();
      if (model) counts.set(model, (counts.get(model) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([model]) => ({ key: model, label: model }));
  }, [rows]);

  const list = useMemo(() => {
    let result = (rows || []).filter((product) => {
      const code = String(product.product_code || product._key || '');
      if (code && hiddenCodes.has(code)) return false;
      if (deferredModels.size && !deferredModels.has(String(product.model || '').trim())) return false;
      return matchProduct(product, deferredState);
    });
    if (interest.size > 0) {
      const codes = new Set<string>();
      if (interest.has('recent')) for (const snapshot of recent) codes.add(snapshot.code);
      if (interest.has('fav')) for (const snapshot of favorites) codes.add(snapshot.code);
      result = result.filter((product) => codes.has(String(product.product_code || product._key || '')));
    }
    if (sort) {
      result.sort((a, b) => {
        const mile = (product: EntityRecord) => numOr(product.mileage, sort === 'mile_asc' ? Infinity : -1);
        const year = (product: EntityRecord) => numOr(product.year, 0);
        switch (sort) {
          case 'desc': return rentForSort(b) - rentForSort(a);
          case 'dep_asc': return depositForSort(a) - depositForSort(b);
          case 'dep_desc': return depositForSort(b) - depositForSort(a);
          case 'mile_asc': return mile(a) - mile(b);
          case 'mile_desc': return mile(b) - mile(a);
          case 'new': return year(b) - year(a);
          case 'old': return year(a) - year(b);
          case 'asc': return rentForSort(a) - rentForSort(b);
          default: return 0;
        }
      });
    } else {
      const scores = new Map<EntityRecord, number>();
      for (const product of result) {
        const age = minAge(product);
        scores.set(product, (noDeposit(product) ? 4 : 0) + (installmentOk(product) ? 2 : 0) + (age > 0 && age <= 21 ? 1 : 0));
      }
      result.sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0));
    }
    if (!passedCodes.size) return result;
    const front: EntityRecord[] = [];
    const back: EntityRecord[] = [];
    for (const product of result) {
      const code = String(product.product_code || product._key || '');
      if (code && passedCodes.has(code)) back.push(product);
      else front.push(product);
    }
    return [...front, ...back];
  }, [rows, deferredState, deferredModels, sort, hiddenCodes, passedCodes, interest, recent, favorites]);

  const draftPreviewCount = useMemo(() => {
    if (!filterDraft || !rows) return list.length;
    const draftState: FState = {
      q: query, periods: filterDraft.periods, rent: filterDraft.rent,
      dep: filterDraft.dep, mile: filterDraft.mile, fuel: filterDraft.fuel,
      ptype: filterDraft.ptype, credit: filterDraft.credit, perks: filterDraft.perks,
      promo: filterDraft.promo, dyn: filterDraft.dyn, vehicle: filterDraft.vehicle,
    };
    let interestCodes: Set<string> | null = null;
    if (filterDraft.interest.size > 0) {
      interestCodes = new Set();
      if (filterDraft.interest.has('recent')) for (const snapshot of recent) interestCodes.add(snapshot.code);
      if (filterDraft.interest.has('fav')) for (const snapshot of favorites) interestCodes.add(snapshot.code);
    }
    let count = 0;
    for (const product of rows) {
      const code = String(product.product_code || product._key || '');
      if (code && hiddenCodes.has(code)) continue;
      if (filterDraft.models.size && !filterDraft.models.has(String(product.model || '').trim())) continue;
      if (interestCodes && (!code || !interestCodes.has(code))) continue;
      if (matchProduct(product, draftState)) count += 1;
    }
    return count;
  }, [filterDraft, rows, query, hiddenCodes, recent, favorites, list.length]);

  const totalVisible = useMemo(() => {
    const visible = (rows || []).filter(isOfferableProduct);
    if (!hiddenCodes.size) return visible.length;
    return visible.filter((product) => !hiddenCodes.has(String(product.product_code || product._key || ''))).length;
  }, [rows, hiddenCodes]);

  const excelRows = useMemo(() => {
    if (effectiveView !== 'excel') return [] as EntityRecord[];
    let result = list.filter((product) =>
      Object.entries(columnFilter).every(([key, selected]) => excelColumnMatches(product, key, selected)),
    );
    if (columnSort && isNumericExcelColumn(columnSort.field)) {
      const { field, dir } = columnSort;
      result = [...result].sort((a, b) => {
        const comparison = (excelColumnSortValue(a, field) as number) - (excelColumnSortValue(b, field) as number);
        return dir === 'asc' ? comparison : -comparison;
      });
    }
    return result;
  }, [effectiveView, list, columnFilter, columnSort]);

  return {
    state,
    aggregate,
    months,
    present,
    cascadeProducts,
    popularModels,
    list,
    draftPreviewCount,
    totalVisible,
    narrowed: !!(query || activeCount(state) > 0 || models.size > 0 || interest.size > 0 || sort),
    excelRows,
  };
}
