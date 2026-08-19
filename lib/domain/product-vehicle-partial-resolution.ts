export type ProductVehiclePartialCandidate = {
  subModel: string;
  trim: string;
  fuel: string;
  engineCc: number | null;
  drive: string;
  seats: number | null;
  trimRowKey?: string;
  usageTier?: 'automatic' | 'manual' | 'blocked' | '';
};

export type ProductVehiclePartialSource = {
  maker: string;
  model: string;
  subModel: string;
  trim: string;
  fuel: string;
  engineCc: number | null;
  drive: string;
  seats: number | null;
};

export type ProductVehiclePartialResolution = {
  basis: 'blocked_master_exact' | 'blocked_master_candidates' | 'master_consensus' | 'review_consensus' | 'source_only';
  candidateCount: number;
  confirmed: ProductVehiclePartialSource;
  candidateValues: Record<'sub_model' | 'trim' | 'fuel' | 'engine_cc' | 'drive' | 'seats', string[]>;
  conflictAxes: ProductVehiclePartialAxis[];
  notApplicableAxes: ProductVehiclePartialAxis[];
  unresolvedAxes: string[];
  statusLabel: string;
  display: string;
  trimRowKey: string;
  usageTier: string;
};

export type ProductVehiclePartialResolutionOptions = {
  blockedCandidates?: ProductVehiclePartialCandidate[];
  candidateBasis?: 'master_consensus' | 'review_consensus';
  conflictAxes?: ProductVehiclePartialAxis[];
};

export type ProductVehiclePartialAxis = 'sub_model' | 'trim' | 'fuel' | 'engine_cc' | 'drive' | 'seats';

const S = (value: unknown) => String(value ?? '').trim();

export const canonicalProductVehicleDrive = (value: unknown) => {
  const text = S(value).toUpperCase();
  if (/4MATIC|XDRIVE|QUATTRO|HTRAC|AWD|콰트로|사륜/.test(text)) return 'AWD';
  if (/\b4WD\b/.test(text)) return '4WD';
  if (/\bFWD\b|전륜/.test(text)) return 'FWD';
  if (/\bRWD\b|후륜/.test(text)) return 'RWD';
  if (/\b2WD\b/.test(text)) return '2WD';
  return '';
};

const uniq = (values: unknown[]) => [...new Set(values.map(S).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
const one = (rawValues: unknown[], values: string[]) => rawValues.length > 0
  && rawValues.every((value) => Boolean(S(value)))
  && values.length === 1 ? values[0] : '';
const numberOrNull = (value: string) => value ? Number(value) : null;

export function buildProductVehiclePartialResolution(
  source: ProductVehiclePartialSource,
  candidates: ProductVehiclePartialCandidate[],
  options: ProductVehiclePartialResolutionOptions = {},
): ProductVehiclePartialResolution {
  const blockedCandidates = options.blockedCandidates || [];
  const selected = blockedCandidates.length ? blockedCandidates : candidates;
  const conflictAxes = [...new Set(options.conflictAxes || [])];
  const conflictSet = new Set<ProductVehiclePartialAxis>(conflictAxes);
  const rawValues = {
    sub_model: selected.map((candidate) => candidate.subModel),
    trim: selected.map((candidate) => candidate.trim),
    fuel: selected.map((candidate) => candidate.fuel),
    engine_cc: selected.map((candidate) => candidate.engineCc),
    drive: selected.map((candidate) => candidate.drive),
    seats: selected.map((candidate) => candidate.seats),
  };
  const candidateValues = {
    sub_model: uniq(rawValues.sub_model),
    trim: uniq(rawValues.trim),
    fuel: uniq(rawValues.fuel),
    engine_cc: uniq(rawValues.engine_cc),
    drive: uniq(rawValues.drive),
    seats: uniq(rawValues.seats),
  };
  const confirmed: ProductVehiclePartialSource = {
    maker: S(source.maker),
    model: S(source.model),
    subModel: conflictSet.has('sub_model') ? '' : one(rawValues.sub_model, candidateValues.sub_model),
    trim: conflictSet.has('trim') ? '' : one(rawValues.trim, candidateValues.trim),
    fuel: conflictSet.has('fuel') ? '' : one(rawValues.fuel, candidateValues.fuel),
    engineCc: conflictSet.has('engine_cc') ? null : numberOrNull(one(rawValues.engine_cc, candidateValues.engine_cc)),
    drive: conflictSet.has('drive') ? '' : one(rawValues.drive, candidateValues.drive),
    seats: conflictSet.has('seats') ? null : numberOrNull(one(rawValues.seats, candidateValues.seats)),
  };
  const notApplicableAxes: ProductVehiclePartialAxis[] = (
    !conflictSet.has('fuel') && (confirmed.fuel === '전기' || source.fuel === '전기')
  ) ? ['engine_cc'] : [];
  const notApplicableSet = new Set<ProductVehiclePartialAxis>(notApplicableAxes);
  const unresolvedAxes = ([
    ['sub_model', '세부모델', candidateValues.sub_model, confirmed.subModel],
    ['fuel', '연료', candidateValues.fuel, confirmed.fuel],
    ['engine_cc', '배기량', candidateValues.engine_cc, confirmed.engineCc],
    ['drive', '구동', candidateValues.drive, confirmed.drive],
    ['seats', '인승', candidateValues.seats, confirmed.seats],
    ['trim', '세부트림', candidateValues.trim, confirmed.trim],
  ] as Array<[ProductVehiclePartialAxis, string, string[], unknown]>).flatMap(([axis, label, values, resolved]) => (
    notApplicableSet.has(axis) ? []
      : conflictSet.has(axis) || values.length > 1 || (selected.length > 0 && !resolved) ? [label] : []
  ));

  const basis = blockedCandidates.length === 1 ? 'blocked_master_exact'
    : blockedCandidates.length > 1 ? 'blocked_master_candidates'
      : selected.length ? (options.candidateBasis || 'review_consensus')
      : 'source_only';
  const axisHasUnknown = (axis: keyof typeof rawValues) => rawValues[axis].some((value) => !S(value));
  const withUnknown = (axis: keyof typeof rawValues, values: string[]) => [
    ...values,
    ...(axisHasUnknown(axis) ? ['미상'] : []),
  ].join('/');
  const conflictText = (axis: keyof typeof rawValues, sourceValue: string, values: string[]) => [
    sourceValue ? `입력:${sourceValue}` : '입력:미상',
    values.length || axisHasUnknown(axis) ? `정본후보:${withUnknown(axis, values) || '미상'}` : '정본후보:없음',
  ].join('; ');
  const subModel = conflictSet.has('sub_model')
    ? `세부모델 충돌(${conflictText('sub_model', source.subModel, candidateValues.sub_model)})`
    : confirmed.subModel
    || (candidateValues.sub_model.length ? `세부모델 미확정(${withUnknown('sub_model', candidateValues.sub_model)})`
      : source.subModel ? `${source.subModel}(입력)` : '세부모델 미확정');
  const parts = [confirmed.maker, confirmed.model, subModel].filter(Boolean);
  if (conflictSet.has('fuel')) parts.push(`연료 충돌(${conflictText('fuel', source.fuel, candidateValues.fuel)})`);
  else if (confirmed.fuel) parts.push(confirmed.fuel);
  else if (candidateValues.fuel.length) parts.push(`연료 미확정(${withUnknown('fuel', candidateValues.fuel)})`);
  else if (source.fuel) parts.push(`${source.fuel}(입력)`);
  if (conflictSet.has('engine_cc')) parts.push(`배기량 충돌(${conflictText('engine_cc', source.engineCc ? `${source.engineCc}cc` : '', candidateValues.engine_cc.map((value) => `${value}cc`))})`);
  else if (confirmed.engineCc) parts.push(`${confirmed.engineCc.toLocaleString('ko-KR')}cc`);
  else if (candidateValues.engine_cc.length) parts.push(`배기량 미확정(${withUnknown('engine_cc', candidateValues.engine_cc).replace(/(\d+)(?=\/|$)/g, '$1cc')})`);
  else if (source.engineCc && source.fuel !== '전기') parts.push(`${source.engineCc.toLocaleString('ko-KR')}cc(입력)`);
  if (conflictSet.has('drive')) parts.push(`구동 충돌(${conflictText('drive', source.drive, candidateValues.drive)})`);
  else if (confirmed.drive) parts.push(confirmed.drive);
  else if (candidateValues.drive.length) parts.push(`구동 미확정(${withUnknown('drive', candidateValues.drive)})`);
  else if (source.drive) parts.push(`${source.drive}(입력)`);
  if (conflictSet.has('seats')) parts.push(`인승 충돌(${conflictText('seats', source.seats ? `${source.seats}인승` : '', candidateValues.seats.map((value) => `${value}인승`))})`);
  else if (confirmed.seats) parts.push(`${confirmed.seats}인승`);
  else if (candidateValues.seats.length) parts.push(`인승 미확정(${withUnknown('seats', candidateValues.seats).replace(/(\d+)(?=\/|$)/g, '$1인승')})`);
  else if (source.seats) parts.push(`${source.seats}인승(입력)`);
  else parts.push('인승 미확정');
  if (conflictSet.has('trim')) parts.push(`세부트림 충돌(${conflictText('trim', source.trim, candidateValues.trim)})`);
  else if (confirmed.trim) parts.push(confirmed.trim);
  else if (source.trim) parts.push(`세부트림 미확정(입력:${source.trim})`);
  else if (candidateValues.trim.length) parts.push(`세부트림 미확정(${candidateValues.trim.length}종)`);
  else parts.push('세부트림 미확정');

  const conflictLabels = conflictAxes.map((axis) => ({
    sub_model: '세부모델', trim: '세부트림', fuel: '연료', engine_cc: '배기량', drive: '구동', seats: '인승',
  } as const)[axis]);
  const statusLabel = conflictAxes.length ? `부분 특정 · ${conflictLabels.join('·')} 정본충돌`
    : basis === 'blocked_master_exact' ? '정본 단일 후보 · 운영 차단'
    : basis === 'blocked_master_candidates' ? `정본 후보 ${selected.length}개 · 모두 운영 차단`
    : basis === 'source_only' ? '입력축만 확인 · 정본 계보 미연결'
      : unresolvedAxes.length ? `부분 특정 · ${unresolvedAxes.join('·')} 미확정`
        : '계층 단일 특정';
  return {
    basis,
    candidateCount: selected.length,
    confirmed,
    candidateValues,
    conflictAxes,
    notApplicableAxes,
    unresolvedAxes,
    statusLabel,
    display: parts.join(' > '),
    trimRowKey: basis === 'blocked_master_exact' ? S(blockedCandidates[0]?.trimRowKey) : '',
    usageTier: basis === 'blocked_master_exact' ? S(blockedCandidates[0]?.usageTier) : '',
  };
}
