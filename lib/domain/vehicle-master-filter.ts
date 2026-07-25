import type { EntityRecord } from '@/lib/intake/entities';
import { makerDisplay } from '@/lib/domain/vehicle-master-format';
import type { MasterEntry, VehicleFilter } from '@/lib/domain/vehicle-master-types';

export const EMPTY_VEHICLE_FILTER: VehicleFilter = {
  maker: '',
  model: '',
  sub_model: '',
  variant: '',
  trim_name: '',
};

export function vehicleFilterCount(filter: VehicleFilter): number {
  return [
    filter.maker,
    filter.model,
    filter.sub_model,
    filter.variant,
    filter.trim_name,
  ].filter(Boolean).length;
}

export function matchVehicleFilter(product: EntityRecord, filter: VehicleFilter): boolean {
  if (filter.maker) {
    const productMaker = makerDisplay(product.maker) || String(product.maker || '');
    const filterMaker = makerDisplay(filter.maker) || filter.maker;
    if (productMaker !== filterMaker && String(product.maker || '') !== filter.maker) {
      const isRenault = (value: string) => /르노/.test(value);
      if (!(isRenault(productMaker) && isRenault(filterMaker))) return false;
    }
  }
  if (filter.model && String(product.model || '') !== filter.model) return false;
  if (filter.sub_model && String(product.sub_model || '') !== filter.sub_model) return false;
  if (filter.variant && String(product.variant || '') !== filter.variant) return false;
  if (filter.trim_name && String(product.trim_name || '') !== filter.trim_name) return false;
  return true;
}

/** 마스터 제조사 그룹 — 국산을 먼저 반환한다. */
export function masterMakerGroups(entries: MasterEntry[]): { origin: string; makers: string[] }[] {
  const domesticByMaker = new Map<string, boolean>();
  for (const entry of entries) {
    domesticByMaker.set(
      entry.maker,
      (domesticByMaker.get(entry.maker) || false) || entry.origin === '국산',
    );
  }
  const domestic: string[] = [];
  const imported: string[] = [];
  for (const [maker, isDomestic] of domesticByMaker) {
    (isDomestic ? domestic : imported).push(maker);
  }
  domestic.sort((a, b) => a.localeCompare(b, 'ko'));
  imported.sort((a, b) => a.localeCompare(b, 'ko'));
  return [
    { origin: '국산', makers: domestic },
    { origin: '수입', makers: imported },
  ];
}

export function masterModels(entries: MasterEntry[], maker: string): string[] {
  if (!maker) return [];
  return [...new Set(
    entries.filter((entry) => entry.maker === maker).map((entry) => entry.model),
  )].sort((a, b) => a.localeCompare(b, 'ko'));
}

export function masterSubs(entries: MasterEntry[], maker: string, model: string): MasterEntry[] {
  if (!maker || !model) return [];
  return entries.filter((entry) => entry.maker === maker && entry.model === model);
}
