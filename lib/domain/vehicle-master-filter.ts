import type { EntityRecord } from '@/lib/intake/entities';
import { makerDisplay } from '@/lib/domain/vehicle-master-format';
import type { MasterEntry, VehicleFilter } from '@/lib/domain/vehicle-master-types';

export const EMPTY_VEHICLE_FILTER: VehicleFilter = {
  maker: [],
  model: [],
  sub_model: [],
  variant: [],
  trim_name: [],
};

const VEHICLE_KEYS = ['maker', 'model', 'sub_model', 'variant', 'trim_name'] as const;

/** 레거시 단수 문자열 → 복수 배열. 세션·즐겨찾기 호환. */
export function normalizeVehicleFilter(raw: unknown): VehicleFilter {
  const out: VehicleFilter = { ...EMPTY_VEHICLE_FILTER, maker: [], model: [], sub_model: [], variant: [], trim_name: [] };
  if (!raw || typeof raw !== 'object') return out;
  const row = raw as Record<string, unknown>;
  for (const key of VEHICLE_KEYS) {
    const value = row[key];
    if (Array.isArray(value)) out[key] = value.map(String).map((s) => s.trim()).filter(Boolean);
    else if (typeof value === 'string' && value.trim()) out[key] = [value.trim()];
    else out[key] = [];
  }
  return out;
}

export function vehicleFilterCount(filter: VehicleFilter): number {
  const v = normalizeVehicleFilter(filter);
  return v.maker.length + v.model.length + v.sub_model.length + v.variant.length + v.trim_name.length;
}

function makerInSelected(product: EntityRecord, selected: string[]): boolean {
  if (!selected.length) return true;
  const productMaker = makerDisplay(product.maker) || String(product.maker || '');
  const raw = String(product.maker || '');
  return selected.some((entry) => {
    const filterMaker = makerDisplay(entry) || entry;
    if (productMaker === filterMaker || raw === entry) return true;
    return /르노/.test(productMaker) && /르노/.test(filterMaker);
  });
}

function fieldInSelected(productValue: unknown, selected: string[]): boolean {
  if (!selected.length) return true;
  const value = String(productValue || '').trim();
  return selected.includes(value);
}

export function matchVehicleFilter(product: EntityRecord, filter: VehicleFilter): boolean {
  const v = normalizeVehicleFilter(filter);
  if (!makerInSelected(product, v.maker)) return false;
  if (!fieldInSelected(product.model, v.model)) return false;
  if (!fieldInSelected(product.sub_model, v.sub_model)) return false;
  if (!fieldInSelected(product.variant, v.variant)) return false;
  if (!fieldInSelected(product.trim_name, v.trim_name)) return false;
  return true;
}

/** 상위 축만 적용한 매물 모수(하위 칩 집계용). */
export function productsForVehicleStep(
  products: EntityRecord[],
  filter: VehicleFilter,
  upto: 'maker' | 'model' | 'sub_model' | 'variant' | 'trim_name',
): EntityRecord[] {
  const v = normalizeVehicleFilter(filter);
  return products.filter((product) => {
    if (upto === 'maker') return true;
    if (!makerInSelected(product, v.maker)) return false;
    if (upto === 'model') return true;
    if (!fieldInSelected(product.model, v.model)) return false;
    if (upto === 'sub_model') return true;
    if (!fieldInSelected(product.sub_model, v.sub_model)) return false;
    if (upto === 'variant') return true;
    if (!fieldInSelected(product.variant, v.variant)) return false;
    return true;
  });
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
