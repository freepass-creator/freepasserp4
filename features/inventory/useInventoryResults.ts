'use client';

import { useMemo } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import {
  VEHICLE_DISPLAY_STATUSES,
  canonProductType,
  normalizeVehicleDisplayStatus,
  vehicleName,
} from '@/lib/domain/product';
import { matchProductQuery } from '@/lib/domain/search';

export type InventorySort = 'status' | 'name' | 'plate' | 'code';

type Params = {
  rows: EntityRecord[] | null;
  query: string;
  liveQuery: string;
  /** 빈 Set = 전체. 값이 있으면 OR 매칭. */
  statuses: Set<string>;
  productTypes: Set<string>;
  draftStatuses: Set<string>;
  draftProductTypes: Set<string>;
  sort: InventorySort | '';
};

function matchesFilters(
  product: EntityRecord,
  statuses: Set<string>,
  productTypes: Set<string>,
): boolean {
  const statusOk = statuses.size === 0
    || statuses.has(normalizeVehicleDisplayStatus(product.vehicle_status));
  const typeOk = productTypes.size === 0
    || productTypes.has(canonProductType(product.product_type));
  return statusOk && typeOk;
}

export function useInventoryResults({
  rows, query, liveQuery, statuses, productTypes, draftStatuses, draftProductTypes, sort,
}: Params) {
  const filtered = useMemo(() => (rows || [])
    .filter((product) => matchProductQuery(product, query))
    .filter((product) => matchesFilters(product, statuses, productTypes))
    .slice()
    .sort((a, b) => {
      if (!sort) return 0;
      if (sort === 'name') return vehicleName(a).localeCompare(vehicleName(b), 'ko');
      if (sort === 'plate') return String(a.car_number || '').localeCompare(String(b.car_number || ''), 'ko');
      if (sort === 'code') return String(a.product_code || '').localeCompare(String(b.product_code || ''), 'ko');
      const aIndex = VEHICLE_DISPLAY_STATUSES.indexOf(normalizeVehicleDisplayStatus(a.vehicle_status));
      const bIndex = VEHICLE_DISPLAY_STATUSES.indexOf(normalizeVehicleDisplayStatus(b.vehicle_status));
      return (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex)
        || vehicleName(a).localeCompare(vehicleName(b), 'ko');
    }), [rows, query, statuses, productTypes, sort]);

  const draftPreviewCount = useMemo(() => (rows || [])
    .filter((product) => matchProductQuery(product, liveQuery))
    .filter((product) => matchesFilters(product, draftStatuses, draftProductTypes))
    .length, [rows, liveQuery, draftStatuses, draftProductTypes]);

  return { filtered, draftPreviewCount };
}
