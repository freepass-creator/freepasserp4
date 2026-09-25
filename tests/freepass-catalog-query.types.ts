/** Compile-only regression: filtering/sorting must preserve the input product type. */
import type { EntityRecord } from '@/lib/intake/entities';
import type { FreepassCatalogProduct } from '@/lib/domain/freepass-catalog-contract';
import type { runShopQuery, ShopResult } from '@/lib/shop/query';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

type PublicRows = ReturnType<typeof runShopQuery<FreepassCatalogProduct>>['list'];
type RawRows = ReturnType<typeof runShopQuery<EntityRecord>>['list'];
type WithMarker = FreepassCatalogProduct & { testMarker: 'preserved' };

type PublicInputStaysPublic = Assert<Equal<PublicRows, FreepassCatalogProduct[]>>;
type RawInputIsNotPromoted = Assert<Equal<RawRows, EntityRecord[]>>;
type DefaultResultIsPublic = Assert<Equal<ShopResult['list'], FreepassCatalogProduct[]>>;
type ExtraFieldsSurvive = Assert<Equal<
  ReturnType<typeof runShopQuery<WithMarker>>['list'], WithMarker[]
>>;
// @ts-expect-error A raw row without required identity/price fields is not a public row.
type RawRowsCannotBecomePublic = Assert<Equal<RawRows, FreepassCatalogProduct[]>>;
