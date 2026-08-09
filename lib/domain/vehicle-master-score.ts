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
    || deps.extractGen(product.cert_car_name, codes)
    /**
     * 추가표기도 읽는다 — 트림을 규격화하면서 원문이 이리로 옮겨지기 때문이다.
     * 아래 `ordinalGen` 은 이미 여기를 읽는데 **세대코드만 안 읽고 있었다**:
     * 원문 「아반떼 CN7 26MY … 인스퍼레이션」이 통째로 `trim_extra` 에 있는데도
     * 2006년 「아반떼 J2」로 붙었다(실측 2026-08-09).
     */
    || deps.extractGen(product.trim_extra, codes);
  /**
   * 「E클래스(6세대)」처럼 **원문에 박힌 세대 순번**은 세대를 곧바로 확정하는 신호다.
   * 트림을 규격화하면서 원문이 `trim_extra` 로 옮겨지는데 여기서 그걸 안 읽어
   * 「(6세대)」를 잃고 최고령 W124 로 떨어졌다(실측 2026-08-08 · E-클래스 4대).
   * 원문도 같이 읽는다 — 이름에는 안 쓰지만 판정에는 쓴다.
   */
  const ordinal = deps.ordinalGen(product.sub_model)
    || deps.ordinalGen(product.trim_name)
    || deps.ordinalGen(product.trim_extra)
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
    /**
     * 트림 칸에 들어온 «원문 문장»도 세대를 가르는 근거다.
     * 규격 트림만 `trim_name` 에 남기고 원문을 `trim_extra` 로 옮기면서 이 신호가 끊겼고,
     * 그 순간 E-클래스가 W213 에서 1984년 W124 로 떨어졌다(실측 2026-08-08 · 5대).
     * 이름에는 안 쓰지만 판정에는 읽는다 — 가중치는 trim_name 보다 낮게 둔다(원문은 잡음이 섞인다).
     */
    if (product.trim_extra) score += deps.similarity(String(product.trim_extra), entry.sub_model) * 0.8;
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
      if (year >= yearStart && year <= yearEnd) {
        /**
         * 세대 구간은 **경계에서 겹친다** — 22년식은 IG(2019~2022)와 GN7(2022~2026)에 둘 다 든다.
         * 둘 다 +3 이면 동점이 되고, 동점 규칙(오래된 쪽)이 구형을 골라
         * 「22년식 그랜저」가 GN7 이 아니라 더 뉴 그랜저 IG 가 됐다(실측 2026-08-08).
         * 구간에 «든» 것들끼리만 새 세대에 아주 작은 가점을 준다 — 다른 판정은 건드리지 않는다.
         */
        score += 3 + Math.min(0.9, yearStart / 10000);
      }
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

    // 레이·모닝: 승용과 밴은 세부모델이 다름(인승 옵션 아님).
    // 신호에 «밴»·2인승 이하면 밴 서브, 그 외(빈 신호 포함)는 승용 서브를 고른다.
    {
      const seats = Number(product.seats) || 0;
      const wantVan = /밴/.test(signalBlob) || (seats > 0 && seats <= 2);
      const entryIsVan = /\s밴$/.test(String(entry.sub_model || '')) || /밴/.test(String(entry.title || ''));
      if (wantVan && entryIsVan) score += 3.2;
      else if (wantVan && !entryIsVan) score -= 2.4;
      else if (!wantVan && entryIsVan) score -= 2.8;
      else if (!wantVan && !entryIsVan && (entry.model === '레이' || entry.model === '모닝')) score += 0.35;
    }

    return { entry, score };
  }).sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    // 동점이면 예전대로 «오래된 쪽». 여기서 최신을 밀면 연식이 말해 주는 것까지 뒤집힌다
    // (실측: W213→W214 · G80 DH→RG3 로 244대가 흔들리고 신뢰도가 11건 내려갔다).
    // 경계 연도 문제는 아래 점수에서 «연식 구간 안에 든 것 중 새 세대»에 가점해 푼다.
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
