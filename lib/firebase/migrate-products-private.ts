import { get, ref, update } from 'firebase/database';
import type { EntityRecord } from '@/lib/intake/entities';
import { getRtdb } from './client';
import { mergeProductPrivate, splitProductPrivate } from './rtdb-products';

type ProductMap = Record<string, Record<string, unknown>>;
type UpdateMap = Record<string, unknown>;

const FORBIDDEN_KEY = /[.#$/[\]]/;
const PRIVATE_FIELDS = ['vehicle_price', 'vin'] as const;
const PRIVATE_PRICE_FIELDS = ['fee', 'commission', 'fee_memo'] as const;
const hasOwn = (record: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(record, key);

function mergePrice(base: unknown, overlay: unknown): unknown {
  if (!base || typeof base !== 'object' || Array.isArray(base)) return overlay;
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) return overlay ?? base;
  const output: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [period, overlayTerms] of Object.entries(overlay as Record<string, unknown>)) {
    const baseTerms = output[period];
    output[period] = baseTerms && typeof baseTerms === 'object' && !Array.isArray(baseTerms)
      && overlayTerms && typeof overlayTerms === 'object' && !Array.isArray(overlayTerms)
      ? { ...(baseTerms as Record<string, unknown>), ...(overlayTerms as Record<string, unknown>) }
      : overlayTerms;
  }
  return output;
}

export type ProductPrivateMigrationPlan = {
  scannedProducts: number;
  productsWithPrivate: number;
  privateWrites: number;
  publicDeletes: number;
  skippedUnsafe: number;
  updates: UpdateMap;
};

export type ProductPrivateMigrationResult = Omit<ProductPrivateMigrationPlan, 'updates'> & {
  dryRun: boolean;
  plannedPaths: number;
  plannedBatches: number;
  appliedPaths: number;
};

export type ProductPrivateMigrationBackup = {
  version: 1;
  exportedAt: string;
  nodes: {
    products: ProductMap;
    v4Products: ProductMap;
    productsPrivate: ProductMap;
  };
};

type ProductPrivateMigrationOptions = {
  beforeApply?: (backup: ProductPrivateMigrationBackup) => void | Promise<void>;
  onProgress?: (completedBatches: number, totalBatches: number) => void | Promise<void>;
};

function addPublicDeletes(updates: UpdateMap, path: string, record: Record<string, unknown>): number {
  let count = 0;
  for (const field of PRIVATE_FIELDS) {
    if (!hasOwn(record, field)) continue;
    updates[`${path}/${field}`] = null;
    count++;
  }
  if (!record.price || typeof record.price !== 'object' || Array.isArray(record.price)) return count;
  for (const [period, rawTerms] of Object.entries(record.price as Record<string, unknown>)) {
    if (!rawTerms || typeof rawTerms !== 'object' || Array.isArray(rawTerms)) continue;
    for (const field of PRIVATE_PRICE_FIELDS) {
      if (!hasOwn(rawTerms as Record<string, unknown>, field)) continue;
      updates[`${path}/price/${period}/${field}`] = null;
      count++;
    }
  }
  return count;
}

export function buildProductPrivateMigrationPlan(
  v3: ProductMap,
  v4: ProductMap,
  existingPrivate: ProductMap,
): ProductPrivateMigrationPlan {
  const merged = new Map<string, EntityRecord>();
  const publicSources = new Map<string, { path: string; record: Record<string, unknown> }[]>();
  let skippedUnsafe = 0;

  const collect = (records: ProductMap, prefix: string, overlay: boolean) => {
    for (const [childKey, record] of Object.entries(records)) {
      if (!record || typeof record !== 'object') {
        skippedUnsafe++;
        continue;
      }
      const key = String(record.product_code || childKey).trim();
      if (!key || FORBIDDEN_KEY.test(key) || FORBIDDEN_KEY.test(childKey)) {
        skippedUnsafe++;
        continue;
      }
      const previous = merged.get(key);
      merged.set(
        key,
        overlay
          ? {
              ...(previous || {}),
              ...record,
              price: mergePrice(previous?.price, record.price),
              _key: key,
              product_code: key,
            }
          : { ...record, _key: key, product_code: key },
      );
      const sources = publicSources.get(key) || [];
      sources.push({ path: `${prefix}/${childKey}`, record });
      publicSources.set(key, sources);
    }
  };
  collect(v3, 'products', false);
  collect(v4, 'v4/products', true);

  const updates: UpdateMap = {};
  let productsWithPrivate = 0;
  let privateWrites = 0;
  let publicDeletes = 0;

  for (const [key, publicProduct] of merged) {
    const existing = existingPrivate[key] as EntityRecord | undefined;
    const preferred = mergeProductPrivate(publicProduct, existing);
    const { privateRecord } = splitProductPrivate(preferred);
    if (!privateRecord) continue;
    productsWithPrivate++;
    updates[`v4/products_private/${key}`] = {
      ...privateRecord,
      _key: key,
      product_code: key,
      provider_company_code: preferred.provider_company_code || privateRecord.provider_company_code || '',
      migratedAt: new Date().toISOString(),
    };
    privateWrites++;
    for (const source of publicSources.get(key) || []) {
      publicDeletes += addPublicDeletes(updates, source.path, source.record);
    }
  }

  return {
    scannedProducts: merged.size,
    productsWithPrivate,
    privateWrites,
    publicDeletes,
    skippedUnsafe,
    updates,
  };
}

export async function migrateProductsPrivate(
  dryRun = true,
  options: ProductPrivateMigrationOptions = {},
): Promise<ProductPrivateMigrationResult> {
  const db = getRtdb();
  if (!db) throw new Error('Firebase DB가 설정되지 않았습니다.');
  const [v3Snapshot, v4Snapshot, privateSnapshot] = await Promise.all([
    get(ref(db, 'products')),
    get(ref(db, 'v4/products')),
    get(ref(db, 'v4/products_private')),
  ]);
  const source = {
    products: (v3Snapshot.val() as ProductMap | null) || {},
    v4Products: (v4Snapshot.val() as ProductMap | null) || {},
    productsPrivate: (privateSnapshot.val() as ProductMap | null) || {},
  };
  const plan = buildProductPrivateMigrationPlan(
    source.products,
    source.v4Products,
    source.productsPrivate,
  );
  const entries = Object.entries(plan.updates);
  const batchSize = 400;
  const plannedBatches = Math.ceil(entries.length / batchSize);
  if (!dryRun && entries.length) {
    if (plan.skippedUnsafe) {
      throw new Error(`안전하지 않은 상품 ${plan.skippedUnsafe}건이 있어 실제 이동을 중단했습니다.`);
    }
    if (!options.beforeApply) {
      throw new Error('실제 이동 전 백업 처리가 필요합니다.');
    }
    await options.beforeApply({
      version: 1,
      exportedAt: new Date().toISOString(),
      nodes: source,
    });
    for (let index = 0; index < entries.length; index += batchSize) {
      await update(ref(db), Object.fromEntries(entries.slice(index, index + batchSize)));
      await options.onProgress?.(Math.floor(index / batchSize) + 1, plannedBatches);
    }
  }
  return {
    scannedProducts: plan.scannedProducts,
    productsWithPrivate: plan.productsWithPrivate,
    privateWrites: plan.privateWrites,
    publicDeletes: plan.publicDeletes,
    skippedUnsafe: plan.skippedUnsafe,
    dryRun,
    plannedPaths: entries.length,
    plannedBatches,
    appliedPaths: dryRun ? 0 : entries.length,
  };
}
