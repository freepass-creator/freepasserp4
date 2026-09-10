import type { EntityRecord } from '@/lib/intake/entities';
import type { AvailabilityStatus, NormalizationStatus } from '@/lib/server/source-snapshot';

const text = (value: unknown): string => String(value ?? '').trim();

export function normalizationStatusOf(product: EntityRecord): NormalizationStatus {
  if (Array.isArray(product.normalization_conflicts) && product.normalization_conflicts.length) return 'conflict';
  const model = text(product.model);
  if (!model) return 'unknown';
  const axes = ['maker', 'model', 'sub_model', 'trim_name'] as const;
  return axes.every((axis) => text(product[axis])) ? 'complete' : 'partial';
}

export function availabilityStatusOf(product: EntityRecord): AvailabilityStatus {
  const status = text(product.vehicle_status);
  if (status === '출고불가' || status === '계약중') return 'unavailable';
  if (status === '즉시출고' || status === '출고가능') return 'available';
  return 'discuss';
}

export function attachInventoryAtomState(product: EntityRecord): EntityRecord {
  return {
    ...product,
    inventory_registration: text(product.car_number) ? 'registered' : 'pending_identity',
    normalization_status: normalizationStatusOf(product),
    availability_status: availabilityStatusOf(product),
  };
}
