/**
 * FreePassERP.com public catalog contract.
 *
 * Source storage field names may evolve, but customer-facing code consumes products only
 * after they pass through the public catalog adapter. Keep version changes explicit.
 */
export const FREEPASS_CATALOG_CONTRACT_VERSION = '1.0' as const;

export type FreepassCatalogRate = {
  rent: number;
  deposit: number;
};

export type FreepassCatalogPolicy = Record<string, unknown>;

/**
 * Public product shape only. Do not add internal cost, settlement, source, auth, partner-code,
 * or pipeline fields here. New customer-visible fields must be added deliberately together
 * with the public adapter.
 */
export type FreepassCatalogProduct = {
  _key: string;
  product_code: string;
  car_number?: unknown;
  vin?: unknown;
  maker?: unknown;
  model?: unknown;
  sub_model?: unknown;
  trim_name?: unknown;
  trim_extra?: unknown;
  variant?: unknown;
  vehicle_class?: unknown;
  year?: unknown;
  first_registration_date?: unknown;
  fuel_type?: unknown;
  engine_type?: unknown;
  ext_color?: unknown;
  int_color?: unknown;
  drive_type?: unknown;
  seats?: unknown;
  transmission?: unknown;
  usage?: unknown;
  battery_capacity?: unknown;
  options?: unknown;
  product_type?: unknown;
  vehicle_status?: unknown;
  accident_history?: unknown;
  cert_car_name?: unknown;
  location?: unknown;
  note?: unknown;
  insurance_included?: unknown;
  annual_mileage?: unknown;
  deposit_note?: unknown;
  provider_name?: unknown;
  mileage?: unknown;
  engine_cc?: unknown;
  price: Record<string, FreepassCatalogRate>;
  image_urls?: string[];
  image_url?: string;
  photo_link?: string;
  _policy?: FreepassCatalogPolicy;
};

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
