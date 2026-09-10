import type { EntityRecord } from '@/lib/intake/entities';
import { vehicleIdentity } from '@/lib/domain/product';
import { getSession } from '@/lib/auth-session';

type RecordValue = Record<string, unknown>;
const KASHUNG_PROVIDERS = new Set(['PT-0024']);
const PRIVATE_PRICE_FIELDS = new Set(['fee', 'commission', 'fee_memo']);

const hasOwn = (record: RecordValue, key: string) => Object.prototype.hasOwnProperty.call(record, key);

function splitPrice(price: unknown): { publicPrice?: RecordValue; privatePrice?: RecordValue } {
  if (!price || typeof price !== 'object' || Array.isArray(price)) return {};
  const publicPrice: RecordValue = {};
  const privatePrice: RecordValue = {};
  for (const [period, rawTerms] of Object.entries(price as RecordValue)) {
    if (!rawTerms || typeof rawTerms !== 'object' || Array.isArray(rawTerms)) {
      publicPrice[period] = rawTerms;
      continue;
    }
    const publicTerms: RecordValue = {};
    const privateTerms: RecordValue = {};
    for (const [field, value] of Object.entries(rawTerms as RecordValue)) {
      if (PRIVATE_PRICE_FIELDS.has(field)) privateTerms[field] = value;
      else publicTerms[field] = value;
    }
    publicPrice[period] = publicTerms;
    if (Object.keys(privateTerms).length) privatePrice[period] = privateTerms;
  }
  return {
    publicPrice,
    privatePrice: Object.keys(privatePrice).length ? privatePrice : undefined,
  };
}

export function splitProductPrivate(product: EntityRecord): {
  publicRecord: EntityRecord;
  privateRecord: EntityRecord | null;
} {
  const source = product as RecordValue;
  const publicRecord = { ...product };
  const privateRecord: EntityRecord = {};
  if (hasOwn(source, 'vehicle_price')) {
    privateRecord.vehicle_price = product.vehicle_price;
    delete publicRecord.vehicle_price;
  }
  if (hasOwn(source, 'vin')) {
    privateRecord.vin = product.vin;
    delete publicRecord.vin;
  }
  // 레거시 상품에 섞인 정산계좌. canonical 소유자는 partner이지만, 소유권 확인 전에는
  // 값을 버리거나 자동 이관하지 않고 상품 private에 격리해 public 재저장·영업자 노출만 막는다.
  if (hasOwn(source, 'account_number')) {
    privateRecord.account_number = product.account_number;
    delete publicRecord.account_number;
  }
  if (hasOwn(source, 'price')) {
    const { publicPrice, privatePrice } = splitPrice(product.price);
    if (publicPrice) publicRecord.price = publicPrice;
    if (privatePrice) privateRecord.price = privatePrice;
  }
  if (!Object.keys(privateRecord).length) return { publicRecord, privateRecord: null };
  for (const field of ['_key', 'product_code', 'provider_company_code'] as const) {
    if (product[field] != null && product[field] !== '') privateRecord[field] = product[field];
  }
  return { publicRecord, privateRecord };
}

export function mergeProductPrivate(product: EntityRecord, privateRecord?: EntityRecord | null): EntityRecord {
  if (!privateRecord) return product;
  const output = { ...product };
  if (hasOwn(privateRecord as RecordValue, 'vehicle_price')) output.vehicle_price = privateRecord.vehicle_price;
  if (hasOwn(privateRecord as RecordValue, 'vin')) output.vin = privateRecord.vin;
  if (hasOwn(privateRecord as RecordValue, 'account_number')) output.account_number = privateRecord.account_number;
  if (privateRecord.price && typeof privateRecord.price === 'object' && !Array.isArray(privateRecord.price)) {
    const mergedPrice: RecordValue = { ...((output.price as RecordValue | undefined) || {}) };
    for (const [period, rawPrivateTerms] of Object.entries(privateRecord.price as RecordValue)) {
      const publicTerms = mergedPrice[period];
      mergedPrice[period] = {
        ...(publicTerms && typeof publicTerms === 'object' && !Array.isArray(publicTerms) ? publicTerms as RecordValue : {}),
        ...(rawPrivateTerms && typeof rawPrivateTerms === 'object' && !Array.isArray(rawPrivateTerms) ? rawPrivateTerms as RecordValue : {}),
      };
    }
    output.price = mergedPrice;
  }
  return output;
}

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
  return splitProductPrivate(product).publicRecord;
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
