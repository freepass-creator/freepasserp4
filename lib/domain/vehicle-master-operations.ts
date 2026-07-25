import type { EntityRecord } from '@/lib/intake/entities';
import { yearDisplay } from '@/lib/domain/vehicle-master-format';
import type { MasterEntry, MasterFitRow, SnapResult } from '@/lib/domain/vehicle-master-types';

const norm = (value: unknown) => String(value ?? '').toLowerCase().replace(/\s+/g, '');

export function isMasterPath(product: EntityRecord, pathSet: Set<string>): boolean {
  const key = `${norm(product.maker)}|${norm(product.model)}|${norm(product.sub_model)}`;
  return !!(norm(product.maker) && norm(product.model) && norm(product.sub_model) && pathSet.has(key));
}

export function masterPathSet(entries: MasterEntry[]): Set<string> {
  return new Set(entries.map((entry) => `${norm(entry.maker)}|${norm(entry.model)}|${norm(entry.sub_model)}`));
}

export function reconcileToMasterEngine(
  products: EntityRecord[],
  entries: MasterEntry[],
  options: { mode?: 'auto' | 'all' } | undefined,
  snap: (product: EntityRecord, entries: MasterEntry[]) => SnapResult | null,
  apply: (product: EntityRecord, result: SnapResult, options?: { source?: string }) => EntityRecord,
) {
  const auto = (options?.mode ?? 'auto') === 'auto';
  const patches: { key: string; patch: EntityRecord; confidence: SnapResult['confidence'] }[] = [];
  let high = 0, medium = 0, low = 0, unmatched = 0;
  for (const product of products) {
    const key = String(product._key ?? product.product_code ?? '');
    if (!key) continue;
    const result = snap(product, entries);
    if (!result) { unmatched++; continue; }
    if (result.confidence === 'high') high++;
    else if (result.confidence === 'medium') medium++;
    else { low++; if (auto) continue; }
    const applied = apply(product, result, { source: 'reconcile' });
    const patch: EntityRecord = {
      maker: applied.maker, model: applied.model, sub_model: applied.sub_model, catalog_id: applied.catalog_id,
      gen_year_start: applied.gen_year_start, gen_year_end: applied.gen_year_end,
      variant: applied.variant, trim_name: applied.trim_name,
      fuel_type: applied.fuel_type, engine_cc: applied.engine_cc, seats: applied.seats, drive_type: applied.drive_type,
      year: applied.year, vehicle_class: applied.vehicle_class, _snap_confidence: result.confidence,
      _raw_vehicle: applied._raw_vehicle, _snapped: true,
      _snap_at: applied._snap_at, _snap_history: applied._snap_history,
    };
    patches.push({ key, patch, confidence: result.confidence });
  }
  return { patches, matched: patches.length, high, medium, low, unmatched };
}

export function auditMasterFitEngine(
  products: EntityRecord[],
  entries: MasterEntry[],
  snap: (product: EntityRecord, entries: MasterEntry[]) => SnapResult | null,
) {
  const paths = masterPathSet(entries);
  let ok = 0, high = 0, medium = 0, low = 0, none = 0, no_signal = 0;
  const samples = { low: [] as MasterFitRow[], none: [] as MasterFitRow[], no_signal: [] as MasterFitRow[] };
  const push = (bucket: 'low' | 'none' | 'no_signal', row: MasterFitRow) => {
    if (samples[bucket].length < 12) samples[bucket].push(row);
  };
  for (const product of products) {
    const key = String(product._key ?? product.product_code ?? '');
    const car = String(product.car_number || '').trim() || '(차번없음)';
    const before = [product.maker, product.model, product.sub_model].map((value) => String(value || '').trim()).filter(Boolean).join(' ') || '(차종공란)';
    const year = yearDisplay(product.year) || undefined;
    if (isMasterPath(product, paths)) { ok++; continue; }
    const maker = norm(product.maker), model = norm(product.model), sub = norm(product.sub_model);
    if ((!maker && !model && !sub) || (!model && !sub)) {
      no_signal++;
      push('no_signal', { key, car, bucket: 'no_signal', before, year });
      continue;
    }
    const result = snap(product, entries);
    if (!result) {
      none++;
      push('none', { key, car, bucket: 'none', before, year });
      continue;
    }
    const after = [result.maker, result.model, result.sub_model].join(' ');
    if (result.confidence === 'high') high++;
    else if (result.confidence === 'medium') medium++;
    else {
      low++;
      push('low', { key, car, bucket: 'low', before, after, year, confidence: result.confidence });
    }
  }
  const total = products.length;
  return {
    total, ok, high, medium, low, none, no_signal, offSpec: total - ok,
    autoConvert: high + medium,
    needReview: low + none + no_signal,
    samples,
  };
}
