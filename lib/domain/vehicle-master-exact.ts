import type { EntityRecord } from '@/lib/intake/entities';
import type { ExactMasterPath, MasterEntry, MasterVariant } from '@/lib/domain/vehicle-master-types';

type ExactPathHelpers = {
  variantLabel: (variant: Pick<MasterVariant, 'label'> | null | undefined) => string;
  realTrims: (list: string[] | null | undefined) => string[];
  canonicalTrim: (value: unknown, pool?: string[] | null) => string;
};

/** 추정 없이 마스터 JSON에 실재하는 경로만 반환하는 순수 엔진. */
export function resolveExactMasterPathEngine(
  entries: MasterEntry[],
  product: Partial<Pick<EntityRecord, 'maker' | 'model' | 'sub_model' | 'catalog_id' | 'variant' | 'trim_name'>> | EntityRecord,
  helpers: ExactPathHelpers,
): ExactMasterPath | null {
  if (!entries.length) return null;
  const catalogId = String(product.catalog_id ?? '').trim();
  const maker = String(product.maker ?? '').trim();
  const model = String(product.model ?? '').trim();
  const subModel = String(product.sub_model ?? '').trim();
  const equals = (a: unknown, b: string) => String(a ?? '').replace(/\s+/g, ' ').trim() === b;

  let entry: MasterEntry | undefined;
  if (maker && model && subModel) {
    entry = entries.find((candidate) => (
      equals(candidate.maker, maker)
      && equals(candidate.model, model)
      && equals(candidate.sub_model, subModel)
    ));
  }
  if (!entry && catalogId) {
    let candidates = entries.filter((candidate) => String(candidate.gen_code ?? '').trim() === catalogId);
    if (maker) candidates = candidates.filter((candidate) => equals(candidate.maker, maker));
    if (model) candidates = candidates.filter((candidate) => equals(candidate.model, model));
    if (subModel) entry = candidates.find((candidate) => equals(candidate.sub_model, subModel));
    if (!entry && candidates.length === 1) entry = candidates[0];
  }
  if (!entry) return null;
  if (maker && !equals(entry.maker, maker)) return null;
  if (model && !equals(entry.model, model)) return null;
  if (subModel && !equals(entry.sub_model, subModel)) return null;

  const wantedVariant = String(product.variant ?? '').trim();
  const variantIndex = wantedVariant
    ? (entry.variants || []).findIndex((variant) => helpers.variantLabel(variant) === wantedVariant)
    : -1;
  const trimPool = helpers.realTrims(
    variantIndex >= 0
      ? entry.variants[variantIndex]?.trims
      : (entry.trims || entry.variants?.flatMap((variant) => variant.trims || []) || []),
  );
  const trim = helpers.canonicalTrim(product.trim_name, trimPool);
  return {
    entry,
    variantIndex,
    trim: trim && trimPool.includes(trim) ? trim : '',
  };
}
