import type { EntityRecord } from '@/lib/intake/entities';
import type { MasterEntry } from '@/lib/domain/vehicle-master-types';

export type MasterEntryScoreDeps = {
  norm: (value: unknown) => string;
  makerGroup: (maker: string) => string[];
  genCodes: (entries: MasterEntry[]) => Set<string>;
  normModel: (model: unknown, maker: unknown, sub: unknown) => string;
  modelFromSub: (sub: unknown, maker: unknown, codes: Set<string>) => string;
  similarity: (left: string, right: string) => number;
  extractGen: (sub: unknown, codes: Set<string>) => string | null;
  ordinalGen: (value: unknown) => number;
  genOrder: (entries: MasterEntry[]) => Map<string, string[]>;
  carYear: (product: EntityRecord) => number;
  normFuel: (value: unknown) => string;
};

export type MasterEntryScoreResult = {
  entry: MasterEntry;
  score: number;
  modelSimilarity: number;
  lockedModel: string | null;
  makerPool: MasterEntry[];
  year: number;
};

export function selectMasterEntry(
  product: EntityRecord,
  entries: MasterEntry[],
  signalBlob: string,
  deps: MasterEntryScoreDeps,
): MasterEntryScoreResult | null {
  const maker = deps.norm(product.maker);
  const model = deps.norm(product.model);
  const sub = deps.norm(product.sub_model);
  const year = deps.carYear(product);
  if (!maker && !model && !sub) return null;
  if (!model && !sub) return null;

  const makerGroup = maker ? deps.makerGroup(maker) : [];
  const sameMaker = (entryMaker: string) => makerGroup.some(
    (group) => entryMaker === group || entryMaker.includes(group) || group.includes(entryMaker),
  );
  let makerPool = maker ? entries.filter((entry) => sameMaker(deps.norm(entry.maker))) : entries;
  if (!makerPool.length) makerPool = entries;
  if (!makerPool.length) return null;

  const codes = deps.genCodes(entries);
  const productModel = deps.normModel(product.model, product.maker, product.sub_model);
  const subModel = deps.modelFromSub(product.sub_model, product.maker, codes);
  let lockedModel: string | null = null;
  let modelSimilarity = 0;
  for (const entryModel of new Set(makerPool.map((entry) => entry.model))) {
    const normalizedEntryModel = deps.norm(entryModel);
    let score = Math.max(
      deps.similarity(subModel, entryModel),
      deps.similarity(productModel, entryModel) * 0.9,
      sub ? deps.similarity(String(product.sub_model), entryModel) * 0.85 : 0,
    );
    if (normalizedEntryModel && sub.includes(normalizedEntryModel)) {
      score += 0.02 * normalizedEntryModel.length;
    }
    if (score > modelSimilarity) {
      modelSimilarity = score;
      lockedModel = entryModel;
    }
  }
  const lockedEntries = lockedModel && modelSimilarity > 0.4
    ? makerPool.filter((entry) => entry.model === lockedModel)
    : makerPool;

  // 세대코드(DN8·CN7·KA4·W214)는 «어느 칸에 적혔든» 세대를 확정하는 가장 강한 신호다.
  // 예전엔 sub_model·catalog_id·type_number 만 봤는데, 공급사가 **한 칸에 다 적으면**
  // 그 값은 model 이나 trim_name 으로 들어와 코드가 통째로 무시됐다 —
  // 「쏘나타 디 엣지 DN8 2.0 가솔린 인스퍼레이션」이 1990년대 「쏘나타 II Y3」로 붙었다(실측 2026-08-08).
  // 코드는 마스터 gen_code 집합에 있는 토큰만 인정하므로 아무 글자나 걸리지 않는다.
  const productGen = deps.extractGen(product.sub_model, codes)
    || deps.extractGen(product.catalog_id, codes)
    || deps.extractGen(product.type_number, codes)
    || deps.extractGen(product.model, codes)
    || deps.extractGen(product.trim_name, codes)
    || deps.extractGen(product.vehicle_name, codes)
    || deps.extractGen(product.cert_car_name, codes);
  const ordinal = deps.ordinalGen(product.sub_model)
    || deps.ordinalGen(product.trim_name)
    || deps.ordinalGen(product.cert_car_name);
  const order = lockedModel ? deps.genOrder(entries).get(lockedModel) || [] : [];
  const targetGen = ordinal >= 1 && ordinal <= order.length ? order[ordinal - 1] : null;
  const productFuel = deps.normFuel(product.fuel_type);
  const productIsEv = productFuel === '전기' || productFuel === '수소';
  const evHint = /전기|일렉트릭|일렉트리파이드|electrified|\bev\b/i.test(signalBlob.toLowerCase());
  const bodyPattern = /쿠페|카브리올레|컨버터블|coupe|cabriolet|convertible/i;
  const productIsCoupe = bodyPattern.test(signalBlob);
  const catalog = String(product.catalog_id || '').trim().toUpperCase();

  const scored = lockedEntries.map((entry) => {
    let score = 0;
    if (sub) {
      score += deps.similarity(String(product.sub_model), entry.sub_model) * 2.2
        + deps.similarity(String(product.sub_model), entry.title || '') * 0.5;
    }
    if (product.trim_name) score += deps.similarity(String(product.trim_name), entry.sub_model) * 1;
    if (product.cert_car_name) {
      score += deps.similarity(String(product.cert_car_name), entry.sub_model) * 0.8
        + deps.similarity(String(product.cert_car_name), entry.title || '') * 0.4;
    }
    if (product.vehicle_name) score += deps.similarity(String(product.vehicle_name), entry.sub_model) * 0.6;

    const genLock = (productGen && String(entry.gen_code).toUpperCase() === productGen)
      || (targetGen && entry.gen_code === targetGen)
      || (!!catalog && String(entry.gen_code).toUpperCase() === catalog);
    if (genLock) score += 5;

    const yearStart = Number(entry.year_start) || 0;
    const yearEnd = /\d{4}/.test(String(entry.year_end)) ? Number(entry.year_end) : 9999;
    if (year && yearStart && !genLock) {
      if (year >= yearStart && year <= yearEnd) score += 3;
      else if (year >= yearStart - 1 && year <= yearEnd + 1) score += 1.2;
      else score -= Math.min(3, (year < yearStart ? yearStart - year : year - yearEnd) * 0.6);
    } else if (year && yearStart && genLock && year >= yearStart && year <= yearEnd) {
      score += 1;
    }

    if (productFuel && entry.variants?.length) {
      const fuels = new Set(entry.variants.map((variant) => deps.normFuel(variant.fuel)));
      if (fuels.has(productFuel)) score += 0.8;
      else if (productFuel === '하이브리드' || productFuel === '전기') score -= 2;
    }
    if (
      !productIsEv
      && !evHint
      && entry.variants?.length
      && entry.variants.every((variant) => {
        const fuel = deps.normFuel(variant.fuel);
        return fuel === '전기' || fuel === '수소';
      })
    ) {
      score -= 6;
    }
    if (productIsCoupe !== bodyPattern.test(`${entry.sub_model || ''} ${entry.title || ''}`)) score -= 6;
    return { entry, score };
  }).sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return (Number(left.entry.year_start) || 0) - (Number(right.entry.year_start) || 0);
  });

  const best = scored[0];
  if (!best) return null;
  return {
    entry: best.entry,
    score: best.score,
    modelSimilarity,
    lockedModel,
    makerPool,
    year,
  };
}
