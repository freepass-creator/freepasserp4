/**
 * @deprecated FreePassERP.com runtime must not depend on RTDB semantics.
 * Keep this compatibility shim temporarily for legacy imports while active consumers
 * move to `product-visibility`. Do not add new imports from this module.
 */
export {
  splitProductPrivate,
  mergeProductPrivate,
  isExcludedProduct,
  canSeeProductCost,
  stripProductCost,
  dedupeProductsByVehicle,
} from './product-visibility';
