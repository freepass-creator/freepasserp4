import 'server-only';

import { readErp5StockFreshness, readWhitelabelCatalogFromErp5 } from './whitelabel-erp5-catalog';

type Rec = Record<string, any>;

export type FreepassCatalogReadOptions = {
  includePartners?: boolean;
  includeUsers?: boolean;
};

export type FreepassCatalogRead = {
  products: Record<string, Rec>;
  policies: Record<string, Rec>;
  partners: Record<string, Rec>;
  users: Record<string, Rec>;
};

/**
 * FreePassERP.com public catalog consumer boundary.
 *
 * UI/server surfaces must depend on this boundary rather than a concrete storage generation
 * such as ERP4/ERP5/Firestore. The current active implementation delegates to the verified
 * ERP5 reader while FreePass Data remains in shadow verification. A future source cutover
 * belongs here, not in customer-facing screens.
 */
export async function readFreepassCatalog(
  options: FreepassCatalogReadOptions = {},
): Promise<FreepassCatalogRead> {
  return readWhitelabelCatalogFromErp5(options);
}

/**
 * Public catalog freshness boundary.
 * Keep the customer-facing stock timestamp on the same source generation as the catalog itself.
 * The current implementation delegates to ERP5; a FreePass Data cutover must change this boundary,
 * not the shop status route or UI.
 */
export async function readFreepassCatalogFreshness(): Promise<number> {
  return readErp5StockFreshness();
}
