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

export type FreepassCatalogPolicyField =
  | 'policy_name'
  | 'policy_type'
  | 'insurance_included'
  | 'injury_compensation_limit'
  | 'injury_deductible'
  | 'property_compensation_limit'
  | 'property_deductible'
  | 'self_body_accident'
  | 'self_body_deductible'
  | 'personal_injury_compensation_limit'
  | 'personal_injury_deductible'
  | 'uninsured_damage'
  | 'uninsured_compensation_limit'
  | 'uninsured_deductible'
  | 'own_damage_compensation'
  | 'own_damage_repair_ratio'
  | 'own_damage_compensation_rate'
  | 'own_damage_min_deductible'
  | 'own_damage_max_deductible'
  | 'annual_roadside_assistance'
  | 'roadside_assistance'
  | 'annual_mileage'
  | 'max_annual_mileage'
  | 'mileage_upcharge_per_10000km'
  | 'deposit_installment'
  | 'deposit_card_payment'
  | 'rental_card_payment'
  | 'payment_method'
  | 'payment_timing'
  | 'penalty_condition'
  | 'rental_region'
  | 'delivery_fee'
  | 'screening_criteria'
  | 'basic_driver_age'
  | 'driver_age_lowering'
  | 'age_lowering_cost'
  | 'driver_age_upper_limit'
  | 'license_period'
  | 'personal_driver_scope'
  | 'business_driver_scope'
  | 'additional_driver_allowance_count'
  | 'additional_driver_cost'
  | 'maintenance_service'
  | 'deposit_return_days'
  | 'buyout_notice_days'
  | 'credit_grade';
export type FreepassCatalogPolicy = Partial<Record<FreepassCatalogPolicyField, unknown>>;

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

/** Issue counts are per product, not per bad rate or image. Existing codes stay stable. */
export const FREEPASS_CATALOG_ISSUES = [
  'missing-product-id',
  'missing-vehicle-identity',
  'missing-price',
  'invalid-price',
  'invalid-product',
  'invalid-term',
  'invalid-deposit',
  'invalid-mileage',
  'invalid-year',
  'invalid-image-url',
] as const;
export type FreepassCatalogContractIssue = (typeof FREEPASS_CATALOG_ISSUES)[number];

type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function parsedYear(value: unknown): number {
  if (value == null || value === '') return 0;
  const match = /(\d{2,4})/.exec(String(value));
  if (!match) return -1;
  const raw = Number(match[1]);
  const year = raw >= 100 ? raw : raw < 50 ? 2000 + raw : 1900 + raw;
  return year >= 1900 && year <= new Date().getFullYear() + 2 ? year : -1;
}

export function catalogProductId(product: unknown): string {
  return isRecord(product) ? text(product.product_code) || text(product._key) : '';
}

export function catalogVehicleIdentity(product: unknown): string {
  return isRecord(product) ? text(product.car_number) || text(product.vin) : '';
}

/** Keep mileage variants such as 24_3만 intact; validate only their month axis. */
function validTerm(key: string): boolean {
  const match = /^(\d{1,2})(?:_.+)?$/u.exec(key);
  if (!match) return false;
  const months = Number(match[1]);
  return Number.isInteger(months) && months >= 1 && months <= 60;
}

/** Syntax only: this does not fetch a URL or authorize its host for a photo proxy. */
function validImageUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  const url = value.trim();
  if (/[\u0000-\u0020\u007f\\]/u.test(url)) return false;
  if (url.startsWith('/')) return !url.startsWith('//');
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    return !!parsed.hostname && !parsed.username && !parsed.password;
  } catch { return false; }
}

/**
 * Observe untrusted public payloads without coercing, mutating or removing products.
 * This is a diagnostic, not a complete schema guard or a source-cutover approval.
 * Optional year/trim/photographs are not made prerequisites for finding a vehicle.
 */
export function inspectFreepassCatalogProduct(product: unknown): FreepassCatalogContractIssue[] {
  if (!isRecord(product)) return ['invalid-product'];
  const issues = new Set<FreepassCatalogContractIssue>();
  if (!catalogProductId(product)) issues.add('missing-product-id');
  if (!catalogVehicleIdentity(product)) issues.add('missing-vehicle-identity');

  const price = product.price;
  if (price == null) {
    issues.add('missing-price');
  } else if (!isRecord(price)) {
    issues.add('invalid-price');
  } else {
    const rates = Object.entries(price);
    if (!rates.length) issues.add('missing-price');
    for (const [key, rate] of rates) {
      if (!validTerm(key)) issues.add('invalid-term');
      if (!isRecord(rate)) {
        issues.add('invalid-price');
        continue;
      }
      // Number(true), Number('670000') and Number(null) must not make a bad value valid.
      // Keep this aligned with the customer price reader: outside 10만원~2천만원 is not displayable rent.
      if (!finiteNumber(rate.rent) || rate.rent < 100_000 || rate.rent > 20_000_000) issues.add('invalid-price');
      if (!finiteNumber(rate.deposit) || rate.deposit < 0) issues.add('invalid-deposit');
    }
  }

  const year = product.year;
  if (year != null && year !== '' && parsedYear(year) < 0) issues.add('invalid-year');

  // Unknown mileage is not a claim of 0 km; inspect only an explicitly supplied value.
  const mileage = product.mileage;
  if (mileage != null && mileage !== '' && (!finiteNumber(mileage) || mileage < 0)) {
    issues.add('invalid-mileage');
  }

  if (product.image_url != null && product.image_url !== '' && !validImageUrl(product.image_url)) {
    issues.add('invalid-image-url');
  }
  if (product.image_urls != null) {
    if (!Array.isArray(product.image_urls) || product.image_urls.some((url) => !validImageUrl(url))) {
      issues.add('invalid-image-url');
    }
  }
  // photo_link may contain folder/source lists, not a resolved image URL; do not rewrite it.
  return [...issues];
}

export type FreepassCatalogIssueCounts = Record<FreepassCatalogContractIssue, number>;

export function emptyFreepassCatalogIssueCounts(): FreepassCatalogIssueCounts {
  return Object.fromEntries(FREEPASS_CATALOG_ISSUES.map((issue) => [issue, 0])) as FreepassCatalogIssueCounts;
}

export function addFreepassCatalogIssues(
  counts: FreepassCatalogIssueCounts,
  issues: readonly FreepassCatalogContractIssue[],
): void {
  for (const issue of new Set(issues)) counts[issue] += 1;
}

/**
 * Compare one source row with the public row emitted by the adapter.
 *
 * maskedByAdapter means the source contract had an anomaly that no longer exists after
 * adaptation. This is diagnostic evidence, not permission to keep coercing the source forever.
 * introducedByAdapter is more severe: the adapter/public boundary created an anomaly that
 * was not present in the supplied row.
 */
export function diffFreepassCatalogIssues(source: unknown, published: unknown): {
  inputIssues: FreepassCatalogContractIssue[];
  publishedIssues: FreepassCatalogContractIssue[];
  maskedByAdapter: FreepassCatalogContractIssue[];
  introducedByAdapter: FreepassCatalogContractIssue[];
} {
  const sourceIssues = inspectFreepassCatalogProduct(source);
  const publishedIssues = inspectFreepassCatalogProduct(published);
  const sourceSet = new Set(sourceIssues);
  const publishedSet = new Set(publishedIssues);
  return {
    inputIssues: sourceIssues,
    publishedIssues,
    maskedByAdapter: sourceIssues.filter((issue) => !publishedSet.has(issue)),
    introducedByAdapter: publishedIssues.filter((issue) => !sourceSet.has(issue)),
  };
}

export function summarizeFreepassCatalogIssues(products: readonly unknown[]): FreepassCatalogIssueCounts {
  const counts = emptyFreepassCatalogIssueCounts();
  for (const product of products) addFreepassCatalogIssues(counts, inspectFreepassCatalogProduct(product));
  return counts;
}
