'use client';

import { useMemo } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import { VEHICLE_STATES } from '@/lib/intake/entities';
import { canonProductType, vehicleName } from '@/lib/domain/product';
import { matchProductQuery } from '@/lib/domain/search';

export type InventorySort = 'status' | 'name' | 'plate' | 'code';

type Params = {
  rows: EntityRecord[] | null;
  query: string;
  liveQuery: string;
  status: string;
  productType: string;
  draftStatus: string;
  draftProductType: string;
  sort: InventorySort | '';
};

function matchesFilters(product: EntityRecord, status: string, productType: string): boolean {
  return (status === 'all' || String(product.vehicle_status || '') === status)
    && (productType === 'all' || canonProductType(product.product_type) === productType);
}

export function useInventoryResults({
  rows, query, liveQuery, status, productType, draftStatus, draftProductType, sort,
}: Params) {
  const filtered = useMemo(() => (rows || [])
    .filter((product) => matchProductQuery(product, query))
    .filter((product) => matchesFilters(product, status, productType))
    .slice()
    .sort((a, b) => {
      if (!sort) return 0;
      if (sort === 'name') return vehicleName(a).localeCompare(vehicleName(b), 'ko');
      if (sort === 'plate') return String(a.car_number || '').localeCompare(String(b.car_number || ''), 'ko');
      if (sort === 'code') return String(a.product_code || '').localeCompare(String(b.product_code || ''), 'ko');
      const aIndex = VEHICLE_STATES.indexOf(String(a.vehicle_status || '') as typeof VEHICLE_STATES[number]);
      const bIndex = VEHICLE_STATES.indexOf(String(b.vehicle_status || '') as typeof VEHICLE_STATES[number]);
      return (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex)
        || vehicleName(a).localeCompare(vehicleName(b), 'ko');
    }), [rows, query, status, productType, sort]);

  const draftPreviewCount = useMemo(() => (rows || [])
    .filter((product) => matchProductQuery(product, liveQuery))
    .filter((product) => matchesFilters(product, draftStatus, draftProductType))
    .length, [rows, liveQuery, draftStatus, draftProductType]);

  return { filtered, draftPreviewCount };
}
