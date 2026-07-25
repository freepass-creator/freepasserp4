import type { EntityRecord } from '@/lib/intake/entities';
import { vehicleIdentity } from '@/lib/domain/product';
import { getSession } from '@/lib/auth-session';

type RecordValue = Record<string, unknown>;
const KASHUNG_PROVIDERS = new Set(['PT-0024']);

export function isExcludedProduct(record: RecordValue): boolean {
  return KASHUNG_PROVIDERS.has(String(record.provider_company_code))
    || KASHUNG_PROVIDERS.has(String(record.partner_code));
}

export function canSeeProductCost(product?: EntityRecord): boolean {
  const session = getSession();
  if (session?.role === 'admin') return true;
  if (session?.role !== 'provider') return false;
  const company = String(session.company_code || session.code || '');
  return !!company && String(product?.provider_company_code || '') === company;
}

export function stripProductCost(product: EntityRecord): EntityRecord {
  if (product.vehicle_price == null) return product;
  const output = { ...product };
  delete output.vehicle_price;
  return output;
}

export function dedupeProductsByVehicle(rows: EntityRecord[]): EntityRecord[] {
  const timestamp = (product: EntityRecord) => Number(product.updatedAt ?? product.updated_at ?? product.created_at ?? 0);
  const richness = (product: EntityRecord) => {
    let score = 0;
    if (product.price && typeof product.price === 'object' && Object.keys(product.price).length) score += 5;
    if (product.policy_code) score += 2;
    if (product.maker || product.sub_model || product.model) score++;
    if (product.year) score++;
    if (product.photos || product.image_urls || product.images) score++;
    return score;
  };
  const unidentified: EntityRecord[] = [];
  const byIdentity = new Map<string, EntityRecord>();
  for (const product of rows) {
    const identity = vehicleIdentity(product);
    if (!identity) { unidentified.push(product); continue; }
    const previous = byIdentity.get(identity);
    if (!previous) { byIdentity.set(identity, product); continue; }
    const score = richness(product) - richness(previous)
      || Number(!!product.product_code) - Number(!!previous.product_code)
      || timestamp(product) - timestamp(previous);
    if (score > 0) byIdentity.set(identity, product);
  }
  return [...byIdentity.values(), ...unidentified];
}
