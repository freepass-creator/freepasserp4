export type VehiclePhase = 'initial' | 'facelift' | 'full_change';
export type PhaseNamePosition = 'prefix' | 'suffix' | 'none';
export type VehicleSalesType = 'retail' | 'rental' | 'taxi' | 'accessible' | 'commercial';

export type VehicleNameAtoms = {
  makerId: string;
  modelId: string;
  makerName: string;
  modelName: string;
  generationId: string;
  generationName: string;
  developmentCode: string;
  phase: VehiclePhase;
  phaseName: string;
  phaseNamePosition: PhaseNamePosition;
};

export type VehicleVariantAtoms = VehicleNameAtoms & {
  canonicalId: string;
  powertrainId: string;
  powertrainName: string;
  fuel: string;
  engineCc: number | null;
  batteryKwh: number | null;
  drivetrain: string;
  seats: number;
  bodyConfiguration?: string;
  salesType: VehicleSalesType;
  salesTypeName: string;
  trimId: string;
  trimName: string;
  productionFrom: string;
  productionTo: string;
  modelYearFrom: string;
  modelYearTo: string;
};

export type VehicleSourceAlias = {
  aliasText: string;
  source: 'manufacturer' | 'carnoon_new' | 'carnoon_used' | 'encar' | 'supplier';
  canonicalId: string;
  validFrom: string;
  validTo: string;
  confidence: 'official' | 'reviewed' | 'observed';
  evidenceRef: string;
};

export type VehicleDisplayPolicy = {
  /** 제조사 공식 동일 라인업에서 실제 구동을 선택할 수 있을 때만 켠다. */
  includeDrivetrain?: boolean;
  /** 제조사 공식 동일 라인업에서 실제 승차정원을 선택할 수 있을 때만 켠다. */
  includeSeats?: boolean;
  /** 승용/밴 등 공식 라인업에서 선택되는 차체구성이 식별에 필요할 때만 켠다. */
  includeBodyConfiguration?: boolean;
};

export type CanonicalSubModelLabelIssue =
  | 'PARENTHESES'
  | 'MODEL_YEAR'
  | 'RELEASE_OR_PHASE'
  | 'SALES_USE'
  | 'TRIM_SUFFIX'
  | 'POWERTRAIN'
  | 'BODY_OR_SEAT_SPEC';

const clean = (value: string) => value.trim().replace(/\s+/g, ' ');
const compact = (value: string) => clean(value).toLowerCase().replace(/[\s()[\]{}._/-]/g, '');

/** 개발코드는 허용하고, 다른 원자가 세부모델명에 섹인 경우만 반환한다. */
export function canonicalSubModelLabelIssues(subModel: string, trimName = ''): CanonicalSubModelLabelIssue[] {
  const sub = clean(subModel);
  const issues: CanonicalSubModelLabelIssue[] = [];
  if (/[()（）]/.test(sub)) issues.push('PARENTHESES');
  if (/(?:19|20)\d{2}|\b\d{2}\s*MY\b|\d{4}\s*[~-]\s*\d{2,4}/i.test(sub)) issues.push('MODEL_YEAR');
  if (/출시|연식변경|페이스리프트|부분변경|풀체인지/i.test(sub)) issues.push('RELEASE_OR_PHASE');
  if (/렌터카|렌트카|택시|장애인용|영업용/i.test(sub)) issues.push('SALES_USE');
  if (/(?:^|\s)(?:가솔린|휘발유|디젤|경유|LPG|LPe|LPi|하이브리드|HEV|PHEV|EV|전기)(?:\s|$)|\d+(?:\.\d+)?\s*(?:kWh|cc)\b/i.test(sub)) {
    issues.push('POWERTRAIN');
  }
  if (/(?:^|\s)(?:승용|밴|카고|캠핑카|\d+\s*인승|2WD|4WD|AWD|FWD|RWD)(?:\s|$)/i.test(sub)) {
    issues.push('BODY_OR_SEAT_SPEC');
  }
  const trim = compact(trimName);
  if (trim && trim.length >= 2 && compact(sub).endsWith(trim)) issues.push('TRIM_SUFFIX');
  return [...new Set(issues)];
}

/** 제조사 고유 작명 순서를 보존하면서 괄호·연식·판매사양을 섞지 않는다. */
export function composeCanonicalSubModel(atoms: VehicleNameAtoms): string {
  const model = clean(atoms.modelName);
  const code = clean(atoms.developmentCode);
  const phaseName = clean(atoms.phaseName);
  const core = clean(`${model} ${code}`);
  if (!phaseName || atoms.phaseNamePosition === 'none') return core;
  return atoms.phaseNamePosition === 'prefix'
    ? clean(`${phaseName} ${core}`)
    : clean(`${core} ${phaseName}`);
}

export function composeVehicleDisplay(variant: VehicleVariantAtoms, policy: VehicleDisplayPolicy = {}): string {
  return clean([
    composeCanonicalSubModel(variant),
    variant.powertrainName,
    policy.includeDrivetrain ? variant.drivetrain : '',
    policy.includeSeats ? `${variant.seats}인승` : '',
    policy.includeBodyConfiguration ? variant.bodyConfiguration || '' : '',
    variant.salesType === 'retail' ? '' : variant.salesTypeName,
    variant.trimName,
  ].filter(Boolean).join(' '));
}

export function validateCanonicalVariant(variant: VehicleVariantAtoms): string[] {
  const issues: string[] = [];
  const subModel = composeCanonicalSubModel(variant);
  if (/[()（）]/.test(subModel)) issues.push('세부모델 괄호 금지');
  if (/(?:19|20)\d{2}|\b\d{2}\s*MY\b/i.test(subModel)) issues.push('세부모델 연식 금지');
  if (/렌터카|렌트카|택시|장애인용|영업용/i.test(subModel)) issues.push('세부모델 판매유형 금지');
  if (variant.phaseNamePosition !== 'none' && !clean(variant.phaseName)) issues.push('부분변경명 누락');
  if (variant.phaseNamePosition === 'none' && clean(variant.phaseName)) issues.push('부분변경명 위치 누락');
  if (variant.fuel === '전기' && !(Number(variant.batteryKwh) > 0)) issues.push('전기차 배터리 누락');
  if (variant.fuel !== '전기' && !(Number(variant.engineCc) > 0)) issues.push('내연기관 배기량 누락');
  if (!variant.canonicalId || !variant.modelId || !variant.generationId || !variant.powertrainId || !variant.trimId) {
    issues.push('불변 ID 누락');
  }
  return issues;
}
