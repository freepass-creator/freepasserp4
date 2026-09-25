import type { EntityRecord } from '@/lib/intake/entities';

/**
 * FreePassERP.com public catalog contract.
 *
 * Source storage field names may evolve, but customer-facing code consumes products only
 * after they pass through the public catalog adapter. Keep version changes explicit.
 */
export const FREEPASS_CATALOG_CONTRACT_VERSION = '1.0' as const;

export type FreepassCatalogProduct = EntityRecord;

export type FreepassCatalogContractIssue =
  | 'missing-product-id'
  | 'missing-vehicle-identity'
  | 'missing-price'
  | 'invalid-price';

const S = (value: unknown) => String(value ?? '').trim();

export function catalogProductId(product: FreepassCatalogProduct): string {
  return S(product.product_code || product._key);
}

export function catalogVehicleIdentity(product: FreepassCatalogProduct): string {
  return S(product.car_number || product.vin);
}

export function inspectFreepassCatalogProduct(
  product: FreepassCatalogProduct,
): FreepassCatalogContractIssue[] {
  const issues: FreepassCatalogContractIssue[] = [];
  if (!catalogProductId(product)) issues.push('missing-product-id');
  if (!catalogVehicleIdentity(product)) issues.push('missing-vehicle-identity');

  const price = product.price;
  if (!price || typeof price !== 'object' || Array.isArray(price)) {
    issues.push('missing-price');
    return issues;
  }

  const terms = Object.values(price as Record<string, unknown>);
  if (!terms.length) {
    issues.push('missing-price');
    return issues;
  }

  const hasValidRate = terms.some((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const rent = Number((value as Record<string, unknown>).rent);
    return Number.isFinite(rent) && rent > 0;
  });
  if (!hasValidRate) issues.push('invalid-price');
  return issues;
}

export function summarizeFreepassCatalogIssues(products: FreepassCatalogProduct[]) {
  const counts: Record<FreepassCatalogContractIssue, number> = {
    'missing-product-id': 0,
    'missing-vehicle-identity': 0,
    'missing-price': 0,
    'invalid-price': 0,
  };
  for (const product of products) {
    for (const issue of inspectFreepassCatalogProduct(product)) counts[issue] += 1;
  }
  return counts;
}
