/** ERP5 차종마스터: Google Sheet 채택명과 Encar 참조본을 분리해 보존하는 공개 스키마. */
import { createHash } from 'node:crypto';
import { normalizeF03CanonicalRow } from './f03-canonical-projection';

export type VehicleSheetRow = {
  rowNumber: number;
  origin: string;
  maker: string;
  model: string;
  subModel: string;
  trim: string;
  productionStart: string;
  productionEnd: string;
  modelKey: string;
  subModelKey: string;
  trimKey: string;
  atomKey: string;
  reviews: Record<string, string>;
};

export type EncarReferenceRow = {
  id?: unknown;
  manufacturer?: unknown;
  manufacturer_code?: unknown;
  car_type?: unknown;
  model?: unknown;
  model_code?: unknown;
  sub_model?: unknown;
  gen_code?: unknown;
  period?: unknown;
  source?: unknown;
  fuel?: unknown;
  displacement_l?: unknown;
  turbo?: unknown;
  drivetrain?: unknown;
  seat?: unknown;
  battery_kwh?: unknown;
  range_km?: unknown;
  trim?: unknown;
  msrp_manwon?: unknown;
  fleet?: unknown;
  special?: unknown;
};

export type VehicleMasterEntry = {
  id: string;
  origin: string;
  maker: string;
  model: string;
  subModel: string;
  trim: string;
  production: { start: string; end: string };
  keys: { model: string; subModel: string; trim: string; atom: string };
  facts: { variants: Record<string, unknown>[] };
  evidence: {
    googleSheet: {
      rowNumber: number;
      trimDefaulted: boolean;
      canonicalProjectionApplied: boolean;
      sourceNames: { origin: string; maker: string; model: string; subModel: string; trim: string };
      reviews: Record<string, string>;
    };
    encar: {
      status: 'exact' | 'same-submodel' | 'not-found';
      referenceIds: string[];
      positiveReviews: string[];
      negativeReviews: string[];
    };
  };
  verification: 'exact-reference' | 'reviewed-encar' | 'conflict' | 'needs-review';
};

/** 절체 전에 실제 원장에 존재해야 한다고 확정한 대표 원자. 누락을 막되 이름을 추정 생성하지 않는다. */
export function requiredVehicleMasterBlockers(entries: VehicleMasterEntry[]): string[] {
  const hasG80Rg3Base = entries.some((entry) => entry.maker === '제네시스'
    && entry.model === 'G80' && entry.subModel === 'G80 RG3' && entry.trim === '기본형');
  return hasG80Rg3Base ? [] : ['REQUIRED_SENTINEL_MISSING:제네시스:G80:G80 RG3:기본형'];
}

const S = (value: unknown) => String(value ?? '').trim();

const makerForMatch = (value: unknown): string => {
  const folded = S(value).toLowerCase().replace(/[\s._-]/g, '');
  const aliases: Record<string, string> = {
    기아자동차: '기아',
    현대자동차: '현대',
    제네시스: '제네시스',
    kgm: 'kg모빌리티',
    쌍용: 'kg모빌리티',
    르노: '르노코리아',
    르노삼성: '르노코리아',
    한국gm: '쉐보레',
    gm대우: '쉐보레',
    '쉐보레(gm대우)': '쉐보레',
    도요타: '토요타',
    토요타: '토요타',
  };
  return aliases[folded] || folded;
};

const textForMatch = (value: unknown): string => S(value).toLowerCase()
  .replace(/[()（）]/g, '')
  .replace(/[\s._/·-]/g, '');

const trimForMatch = (value: unknown): string => {
  const raw = S(value);
  return textForMatch(!raw || raw === '기본' ? '기본형' : raw);
};

function encarSubModelForMatch(row: EncarReferenceRow): string {
  let subModel = S(row.sub_model).replace(/[()（）]/g, ' ');
  const maker = makerForMatch(row.manufacturer);
  const genCode = S(row.gen_code);
  if (maker === '기아' && genCode && /\d+\s*세대/.test(subModel)) {
    subModel = subModel.replace(/\d+\s*세대/g, genCode);
  }
  return textForMatch(subModel);
}

const fullKey = (parts: { maker: unknown; model: unknown; subModel: unknown; trim: unknown }) => [
  makerForMatch(parts.maker),
  textForMatch(parts.model),
  textForMatch(parts.subModel),
  trimForMatch(parts.trim),
].join('|');

const subModelKey = (parts: { maker: unknown; model: unknown; subModel: unknown }) => [
  makerForMatch(parts.maker),
  textForMatch(parts.model),
  textForMatch(parts.subModel),
].join('|');

export function erp5VehicleMasterEntryId(
  row: Pick<VehicleSheetRow, 'origin' | 'maker' | 'model' | 'subModel' | 'trim'>,
): string {
  return erp5VehicleHierarchyKeys(row).atomKey;
}

/** Google 원장의 4단계 키 계약. 표시명이 같아도 계층 경로가 다르면 다른 키가 된다. */
export function erp5VehicleHierarchyKeys(
  row: Pick<VehicleSheetRow, 'origin' | 'maker' | 'model' | 'subModel' | 'trim'>,
): Pick<VehicleSheetRow, 'modelKey' | 'subModelKey' | 'trimKey' | 'atomKey'> {
  const names = normalizeF03CanonicalRow({
    maker: row.maker,
    model: row.model,
    subModel: row.subModel,
    trim: row.trim || '기본형',
  });
  const modelPath = [row.origin, names.maker, names.model].join('|');
  const subModelPath = [modelPath, names.subModel].join('|');
  const trimPath = [subModelPath, names.trim].join('|');
  const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);
  return {
    modelKey: `vmm_${hash(modelPath)}`,
    subModelKey: `vms_${hash(subModelPath)}`,
    trimKey: `vmt_${hash(trimPath)}`,
    atomKey: `vm_${hash(trimPath)}`,
  };
}

function headerIndex(headers: string[], ...candidates: string[]): number {
  const normalized = headers.map((header) => header.replace(/\s+/g, ''));
  for (const candidate of candidates) {
    const index = normalized.indexOf(candidate.replace(/\s+/g, ''));
    if (index >= 0) return index;
  }
  return -1;
}

export function parseVehicleMasterSheet(grid: unknown[][]): VehicleSheetRow[] {
  const rows = (grid || []).map((row) => (row || []).map(S));
  const headerAt = rows.slice(0, 8).findIndex((row) =>
    headerIndex(row, '제조사') >= 0 && headerIndex(row, '세부모델') >= 0 && headerIndex(row, '세부트림') >= 0);
  if (headerAt < 0) throw new Error('차종마스터 머리글을 찾지 못했습니다.');

  const headers = rows[headerAt];
  const index = {
    origin: headerIndex(headers, '원산지'),
    maker: headerIndex(headers, '제조사'),
    model: headerIndex(headers, '모델', '1차모델'),
    subModel: headerIndex(headers, '세부모델'),
    trim: headerIndex(headers, '세부트림'),
    productionStart: headerIndex(headers, '생산시작'),
    productionEnd: headerIndex(headers, '생산종료'),
    modelKey: headerIndex(headers, '모델행키'),
    subModelKey: headerIndex(headers, '세부모델행키'),
    trimKey: headerIndex(headers, '세부트림행키', '트림행키'),
    atomKey: headerIndex(headers, '원자ID'),
  };
  if (index.origin < 0 || index.maker < 0 || index.model < 0 || index.subModel < 0 || index.trim < 0) {
    throw new Error(`차종마스터 필수 머리글이 없습니다: ${headers.join(' | ')}`);
  }
  const reviewIndexes = headers
    .map((header, column) => ({ header, column }))
    .filter(({ header }) => /검토|대조|판정/.test(header));

  const parsed = rows.slice(headerAt + 1).map((row, offset): VehicleSheetRow => {
    const reviews: Record<string, string> = {};
    for (const review of reviewIndexes) {
      const value = S(row[review.column]);
      if (value) reviews[review.header] = value;
    }
    return {
      rowNumber: headerAt + offset + 2,
      origin: S(row[index.origin]),
      maker: S(row[index.maker]),
      model: S(row[index.model]),
      subModel: S(row[index.subModel]),
      trim: S(row[index.trim]),
      productionStart: index.productionStart >= 0 ? S(row[index.productionStart]) : '',
      productionEnd: index.productionEnd >= 0 ? S(row[index.productionEnd]) : '',
      modelKey: index.modelKey >= 0 ? S(row[index.modelKey]) : '',
      subModelKey: index.subModelKey >= 0 ? S(row[index.subModelKey]) : '',
      trimKey: index.trimKey >= 0 ? S(row[index.trimKey]) : '',
      atomKey: index.atomKey >= 0 ? S(row[index.atomKey]) : '',
      reviews,
    };
  }).filter((row) => row.maker || row.model || row.subModel || row.trim);

  if (parsed.length < 50) throw new Error(`차종마스터 행이 너무 적습니다: ${parsed.length}`);
  return parsed;
}

function factsFromReferences(references: EncarReferenceRow[]): Record<string, unknown>[] {
  const variants = new Map<string, Record<string, unknown>>();
  for (const row of references) {
    const variant: Record<string, unknown> = {
      fuel: S(row.fuel) || null,
      displacementL: typeof row.displacement_l === 'number' ? row.displacement_l : null,
      turbo: typeof row.turbo === 'boolean' ? row.turbo : null,
      drivetrain: S(row.drivetrain) || null,
      seats: Number(row.seat) || null,
      batteryKwh: typeof row.battery_kwh === 'number' ? row.battery_kwh : null,
      rangeKm: typeof row.range_km === 'number' ? row.range_km : null,
      msrpManwon: typeof row.msrp_manwon === 'number' ? row.msrp_manwon : null,
      fleet: row.fleet === true,
      special: row.special === true,
    };
    const key = JSON.stringify(variant);
    variants.set(key, variant);
  }
  return [...variants.values()];
}

export function buildVehicleMaster(input: {
  sheetRows: VehicleSheetRow[];
  encarRows: EncarReferenceRow[];
}): { entries: VehicleMasterEntry[]; quarantined: VehicleMasterEntry[]; blockers: string[]; stats: Record<string, number> } {
  const exactIndex = new Map<string, EncarReferenceRow[]>();
  const subIndex = new Map<string, EncarReferenceRow[]>();
  for (const row of input.encarRows.filter((candidate) => !S(candidate.source) || /encar/i.test(S(candidate.source)))) {
    const normalized = {
      maker: row.manufacturer,
      model: row.model,
      subModel: encarSubModelForMatch(row),
      trim: row.trim,
    };
    const exact = fullKey(normalized);
    const sub = subModelKey(normalized);
    exactIndex.set(exact, [...(exactIndex.get(exact) || []), row]);
    subIndex.set(sub, [...(subIndex.get(sub) || []), row]);
  }

  const entries: VehicleMasterEntry[] = [];
  const quarantined: VehicleMasterEntry[] = [];
  const blockers: string[] = [];
  const seen = new Map<string, number>();
  const stats: Record<string, number> = {
    exact: 0,
    reviewed: 0,
    conflict: 0,
    needsReview: 0,
    trimDefaulted: 0,
    canonicalProjected: 0,
  };

  for (const row of input.sheetRows) {
    const sourceTrim = row.trim || '기본형';
    // Google Sheet 채택값을 근거로 남기고, 발행명에만 F03 표기 규칙을 투영한다.
    // Encar 대조는 원래 채택명으로 수행해 `모델=세부모델` 행도 기존 참조와 맞출 수 있게 한다.
    const canonical = normalizeF03CanonicalRow({
      maker: row.maker,
      model: row.model,
      subModel: row.subModel,
      trim: sourceTrim,
    });
    const canonicalProjectionApplied = canonical.maker !== row.maker
      || canonical.model !== row.model
      || canonical.subModel !== row.subModel
      || canonical.trim !== sourceTrim;
    const matchPathKey = fullKey({ maker: row.maker, model: row.model, subModel: row.subModel, trim: sourceTrim });
    const publishedPathKey = fullKey(canonical);
    const previous = seen.get(publishedPathKey);
    if (previous) throw new Error(`차종마스터 중복: ${previous}행과 ${row.rowNumber}행`);
    seen.set(publishedPathKey, row.rowNumber);

    const structural: string[] = [];
    if (!row.origin || !canonical.maker || !canonical.model || !canonical.subModel) structural.push('필수 계층값 누락');
    const expectedKeys = erp5VehicleHierarchyKeys({ origin: row.origin, ...canonical });
    if (!row.modelKey || !row.subModelKey || !row.trimKey || !row.atomKey) {
      structural.push('차종 계층키 누락');
    } else if (row.modelKey !== expectedKeys.modelKey || row.subModelKey !== expectedKeys.subModelKey
      || row.trimKey !== expectedKeys.trimKey || row.atomKey !== expectedKeys.atomKey) {
      structural.push('차종 계층키 불일치');
    }
    if (/\bFL\b|F\/L|페이스리프트/i.test(`${canonical.subModel} ${canonical.trim}`)) structural.push('FL 표기');
    if (canonical.maker === '기아' && /\d+\s*세대/.test(canonical.subModel)) structural.push('기아 세대명 미변환');
    if (structural.length) blockers.push(`${row.rowNumber}행 ${canonical.maker} ${canonical.subModel}: ${structural.join(', ')}`);

    const subKey = subModelKey({ maker: row.maker, model: row.model, subModel: row.subModel });
    const exactReferences = exactIndex.get(matchPathKey) || [];
    const subReferences = subIndex.get(subKey) || [];
    const positiveReviews = Object.entries(row.reviews)
      .filter(([column, value]) => /엔카대조/.test(column) && /^맞음/.test(value))
      .map(([column]) => column);
    const negativeReviews = Object.entries(row.reviews)
      .filter(([column, value]) => /엔카대조/.test(column) && /^틀림|^못정함/.test(value))
      .map(([column]) => column);
    const overallDecision = Object.entries(row.reviews)
      .find(([column]) => column.replace(/\s+/g, '') === '종합판정')?.[1] || '';
    const overallConfirmed = /^확정/.test(overallDecision);
    const overallNeedsReview = /^(?:검수|충돌|못정함)/.test(overallDecision);
    const conflict = !overallDecision && positiveReviews.length > 0 && negativeReviews.length > 0;

    let verification: VehicleMasterEntry['verification'];
    if (overallConfirmed) verification = exactReferences.length > 0 ? 'exact-reference' : 'reviewed-encar';
    else if (overallNeedsReview) verification = 'needs-review';
    else if (conflict) verification = 'conflict';
    else if (exactReferences.length > 0 && negativeReviews.length === 0) verification = 'exact-reference';
    else if (positiveReviews.length > 0) verification = 'reviewed-encar';
    else verification = 'needs-review';

    if (verification === 'exact-reference') stats.exact += 1;
    else if (verification === 'reviewed-encar') stats.reviewed += 1;
    else if (verification === 'conflict') stats.conflict += 1;
    else stats.needsReview += 1;
    if (!row.trim) stats.trimDefaulted += 1;
    if (canonicalProjectionApplied) stats.canonicalProjected += 1;
    // 세부모델만 같고 트림이 다른 참조값으로 제원을 추정하지 않는다.
    const factReferences = exactReferences;
    const evidenceReferences = exactReferences.length ? exactReferences : subReferences;
    const entry: VehicleMasterEntry = {
      id: erp5VehicleMasterEntryId({ origin: row.origin, ...canonical }),
      origin: row.origin,
      maker: canonical.maker,
      model: canonical.model,
      subModel: canonical.subModel,
      trim: canonical.trim,
      production: { start: row.productionStart, end: row.productionEnd },
      keys: { model: row.modelKey, subModel: row.subModelKey, trim: row.trimKey, atom: row.atomKey },
      facts: { variants: factsFromReferences(factReferences) },
      evidence: {
        googleSheet: {
          rowNumber: row.rowNumber,
          trimDefaulted: !row.trim,
          canonicalProjectionApplied,
          sourceNames: {
            origin: row.origin,
            maker: row.maker,
            model: row.model,
            subModel: row.subModel,
            trim: row.trim,
          },
          reviews: row.reviews,
        },
        encar: {
          status: exactReferences.length ? 'exact' : (subReferences.length ? 'same-submodel' : 'not-found'),
          referenceIds: [...new Set(evidenceReferences.map((reference) => S(reference.id)).filter(Boolean))].slice(0, 50),
          positiveReviews,
          negativeReviews,
        },
      },
      verification,
    };
    // 검수 대기 원자는 버리지 않고 격리 보존한다. 활성 entries에는 검증된 원자만 둔다.
    if (structural.length || verification === 'conflict' || verification === 'needs-review') quarantined.push(entry);
    else entries.push(entry);
  }

  stats.quarantined = quarantined.length;
  stats.active = entries.length;
  return { entries, quarantined, blockers, stats };
}
