import 'server-only';

type Rec = Record<string, unknown>;

type FreepassDataVehicle = {
  plateNumber?: unknown;
};

type FreepassDataProduct = {
  productId?: unknown;
  vehicle?: FreepassDataVehicle;
};

type FreepassDataResponse = {
  data?: FreepassDataProduct[];
  meta?: {
    schemaVersion?: unknown;
    releaseId?: unknown;
    revision?: unknown;
    inputDigest?: unknown;
    dataDigest?: unknown;
    generatedAt?: unknown;
    activatedAt?: unknown;
  };
};

export type FreepassDataShadowObservation = {
  state: 'DISABLED' | 'SKIPPED' | 'OBSERVED' | 'ERROR';
  activeCount: number;
  /** @deprecated telemetry compatibility alias; use activeCount in new consumers. */
  legacyCount: number;
  canonicalCount: number | null;
  comparablePlateCount: number;
  matchedPlateCount: number;
  missingInCanonical: number;
  extraInCanonical: number;
  releaseId: string;
  revision: string;
  dataDigest: string;
  generatedAt: string;
  activatedAt: string;
  error?: string;
};

const S = (value: unknown) => String(value ?? '').trim();
const plate = (value: unknown) => S(value).replace(/\s+/g, '');
const enabled = () => S(process.env.FREEPASS_DATA_ERP_COM_SHADOW_READ_ENABLED).toLowerCase() === 'true';
const baseUrl = () => S(process.env.FREEPASS_DATA_BASE_URL).replace(/\/+$/, '');
const timeoutMs = () => {
  const value = Number(process.env.FREEPASS_DATA_SHADOW_TIMEOUT_MS || 1200);
  return Number.isFinite(value) && value >= 100 && value <= 5000 ? Math.trunc(value) : 1200;
};

function activePlates(products: Rec[]) {
  return new Set(products.map((product) => plate(product.car_number || product.plateNumber)).filter(Boolean));
}

function canonicalPlates(products: FreepassDataProduct[]) {
  return new Set(products.map((product) => plate(product.vehicle?.plateNumber)).filter(Boolean));
}

function empty(state: FreepassDataShadowObservation['state'], activeCount: number, error?: string): FreepassDataShadowObservation {
  return {
    state,
    activeCount,
    legacyCount: activeCount,
    canonicalCount: null,
    comparablePlateCount: 0,
    matchedPlateCount: 0,
    missingInCanonical: 0,
    extraInCanonical: 0,
    releaseId: '',
    revision: '',
    dataDigest: '',
    generatedAt: '',
    activatedAt: '',
    ...(error ? { error } : {}),
  };
}

/**
 * FreePass Data Catalog V1 shadow observer.
 *
 * This never supplies customer-visible data and never falls back from one authority to another.
 * ERP5 remains the active public reader until explicit PARITY_VERIFIED evidence exists.
 */
export async function observeFreepassDataShadow(activeProducts: Rec[]): Promise<FreepassDataShadowObservation> {
  if (!enabled()) return empty('DISABLED', activeProducts.length);

  const base = baseUrl();
  if (!base) {
    const result = empty('SKIPPED', activeProducts.length, 'FREEPASS_DATA_BASE_URL 미설정');
    console.warn('[freepass-data-shadow]', JSON.stringify(result));
    return result;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(`${base}/v1/views/erp-public/products`, {
      method: 'GET',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const body = await response.json() as FreepassDataResponse;
    const canonical = Array.isArray(body.data) ? body.data : [];
    const activePlateSet = activePlates(activeProducts);
    const canonicalPlateSet = canonicalPlates(canonical);

    let matchedPlateCount = 0;
    for (const key of activePlateSet) if (canonicalPlateSet.has(key)) matchedPlateCount += 1;

    const comparablePlateCount = Math.max(activePlateSet.size, canonicalPlateSet.size);
    const missingInCanonical = [...activePlateSet].filter((key) => !canonicalPlateSet.has(key)).length;
    const extraInCanonical = [...canonicalPlateSet].filter((key) => !activePlateSet.has(key)).length;

    const result: FreepassDataShadowObservation = {
      state: 'OBSERVED',
      activeCount: activeProducts.length,
      legacyCount: activeProducts.length,
      canonicalCount: canonical.length,
      comparablePlateCount,
      matchedPlateCount,
      missingInCanonical,
      extraInCanonical,
      releaseId: S(body.meta?.releaseId),
      revision: S(body.meta?.revision),
      dataDigest: S(body.meta?.dataDigest),
      generatedAt: S(body.meta?.generatedAt),
      activatedAt: S(body.meta?.activatedAt),
    };
    console.info('[freepass-data-shadow]', JSON.stringify(result));
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = empty('ERROR', activeProducts.length, message);
    console.warn('[freepass-data-shadow]', JSON.stringify(result));
    return result;
  } finally {
    clearTimeout(timer);
  }
}
