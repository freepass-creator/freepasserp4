/**
 * 상품마스터 차량번호 ↔ 차종마스터(트림행키) 커버리지 종결 감사. 읽기 전용.
 *
 * - 기본 입력: 스냅샷 JSON(`values` 또는 `table`). 라이브는 선택적 Sheets GET만.
 * - Sheet write / Firebase / registry / ERP / v3·v4 / rules / engine / getStore 호출 없음.
 * - lib/server import 금지(server-only 가드).
 * - 헤더 50열 exact 검증은 fail-closed. 행 단위 판정은 관대해 고유 차량번호마다
 *   AUTO_UNIQUE | MANUAL_UNIQUE | EVIDENCE_BLOCKED 중 정확히 하나.
 *
 * 실행:
 *   npx tsx scripts/audit-product-vehicle-trim-coverage.mts
 *   npx tsx scripts/audit-product-vehicle-trim-coverage.mts --snapshot=tmp/product-master-values.json
 *   npx tsx scripts/audit-product-vehicle-trim-coverage.mts --live
 *   npx tsx scripts/audit-product-vehicle-trim-coverage.mts --out=tmp/new-coverage-report.json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PRODUCT_MASTER_COLUMNS, DEFAULT_PRODUCT_MASTER_SHEET_ID, PRODUCT_MASTER_TAB } from '../lib/domain/product-master-sheet';
import {
  explicitVehicleDisplacementCc,
  hasBoundedVehiclePhrase,
  mostSpecificBoundedVehiclePhrases,
  normFuel,
  recognizedDevelopmentCodes,
  vehicleBodyForm,
  vehicleRangeClass,
} from '../lib/domain/vehicle-master-format';
import { modelIdentityAliases, normDrive } from '../lib/domain/vehicle-master-match';
import { explicitSupplierTrimSignal, vehicleTrimSignalMatches } from '../lib/domain/vehicle-trim-evidence';
import type { VehicleTrimMasterArtifact, VehicleTrimMasterRecord } from '../lib/domain/vehicle-trim-master';
import { splitSupplierPreservedEvidence } from '../lib/domain/supplier-preserved-evidence';

const S = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const compact = (value: unknown) => S(value).replace(/[\s·._()[\]/-]+/g, '').toLowerCase();
const plateOf = (value: unknown) => S(value).replace(/\s/g, '');
export const SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const arg = (name: string, fallback = '') =>
  (process.argv.find((value) => value.startsWith(`--${name}=`)) || '').slice(name.length + 3) || fallback;

export type CoverageDecision = 'AUTO_UNIQUE' | 'MANUAL_UNIQUE' | 'EVIDENCE_BLOCKED';
export type CoverageSecondary =
  | 'NO_CANDIDATE'
  | 'MULTI_CANDIDATE'
  | 'BLOCKED_KEY_REFERENCE'
  | 'CODE_CONFLICT';
export type CoverageBacklog =
  | '원자 부족'
  | '공식 별칭 부족'
  | '마스터 계보 누락'
  | '기간 경계 부족'
  | '트림만 불명'
  | '입력 자체 충돌'
  | '';

export type ProductVehicleSignals = {
  car_number: string;
  provider_code: string;
  provider_name: string;
  supplier_vehicle_name: string;
  verification: string;
  review_reason: string;
  current_code: string;
  applied_value: string;
  maker: string;
  model_text: string;
  trim: string;
  fuel: string;
  engine_cc: number | null;
  drivetrain: string;
  seats: number | null;
  first_registration: string;
  registration_ym: string;
  raw_preserved: string;
  raw_preserved_full?: string;
  row_numbers: number[];
  input_conflict: boolean;
  input_conflict_axes: string[];
};

export type CoverageCandidateView = {
  trim_row_key: string;
  usage_tier: VehicleTrimMasterRecord['usage_tier'];
  maker: string;
  model: string;
  sub_model: string;
  powertrain: string;
  trim: string;
  fuel: string;
  engine_cc: number | null;
  drivetrain: string;
  seats: number | null;
  production_start: string;
  production_end: string;
  diff_axes: string[];
};

export type CoverageVehicleResult = {
  car_number: string;
  decision: CoverageDecision;
  secondary: CoverageSecondary | '';
  backlog: CoverageBacklog;
  provider_code: string;
  provider_name: string;
  maker: string;
  model_text: string;
  verification: string;
  current_code: string;
  current_tier: string;
  candidate_keys: string[];
  candidates: CoverageCandidateView[];
  contradiction_axes: string[];
  needed_next: string;
  row_numbers: string;
};

export type CoverageReport = {
  source: {
    mode: 'snapshot' | 'live' | 'fixture';
    path?: string;
    sheet_id?: string;
    tab?: string;
    header_columns: number;
    source_rows: number;
    unique_plates: number;
  };
  master: { trim_rows: number; data_as_of: string };
  totals: {
    unique_plates: number;
    AUTO_UNIQUE: number;
    MANUAL_UNIQUE: number;
    EVIDENCE_BLOCKED: number;
    NO_CANDIDATE: number;
    MULTI_CANDIDATE: number;
    BLOCKED_KEY_REFERENCE: number;
    CODE_CONFLICT: number;
  };
  groups: {
    by_provider: Record<string, number>;
    by_maker: Record<string, number>;
    by_model: Record<string, number>;
    by_backlog: Record<string, number>;
  };
  invariants: {
    primary_sum_matches_unique: boolean;
    secondary_subset_of_evidence: boolean;
  };
  vehicles: CoverageVehicleResult[];
};

const CC_TOLERANCE = 50;

const MAKER_CANON: Record<string, string> = {
  현대: '현대', hyundai: '현대',
  기아: '기아', kia: '기아',
  제네시스: '제네시스', genesis: '제네시스',
  르노: '르노코리아', 르노코리아: '르노코리아', 르노삼성: '르노코리아', '르노(삼성)': '르노코리아', 삼성: '르노코리아',
  kg모빌리티: 'KG모빌리티', 쌍용: 'KG모빌리티', kgm: 'KG모빌리티', 케이지모빌리티: 'KG모빌리티',
  쉐보레: '쉐보레', chevrolet: '쉐보레', gm: '쉐보레', gm대우: '쉐보레', 한국지엠: '쉐보레',
  벤츠: '벤츠', 메르세데스: '벤츠', 메르세데스벤츠: '벤츠', '메르세데스-벤츠': '벤츠', mercedes: '벤츠',
  bmw: 'BMW', 비엠더블유: 'BMW',
  아우디: '아우디', audi: '아우디',
  테슬라: '테슬라', tesla: '테슬라',
  볼보: '볼보', volvo: '볼보',
  도요타: '도요타', 토요타: '도요타', toyota: '도요타',
  렉서스: '렉서스', lexus: '렉서스',
  포드: '포드', ford: '포드',
  지프: '지프', jeep: '지프',
  포르쉐: '포르쉐', porsche: '포르쉐',
  미니: '미니', mini: '미니',
  폭스바겐: '폭스바겐', volkswagen: '폭스바겐', vw: '폭스바겐',
  푸조: '푸조', peugeot: '푸조',
  혼다: '혼다', honda: '혼다',
  캐딜락: '캐딜락', cadillac: '캐딜락',
  폴스타: '폴스타', polestar: '폴스타',
  byd: 'BYD',
  지커: '지커',
};

export function canonMaker(value: unknown): string {
  const raw = S(value);
  if (!raw) return '';
  const key = compact(raw);
  if (MAKER_CANON[key]) return MAKER_CANON[key];
  for (const [alias, canon] of Object.entries(MAKER_CANON)) {
    if (key.includes(alias) || alias.includes(key)) return canon;
  }
  return raw;
}

function meaningful(value: unknown): string {
  const text = S(value);
  return !text || /^(?:미입력|미분류|미제공|미정|없음|해당없음|n\/?a|0|-|—|–|null|undefined)$/i.test(text)
    ? ''
    : text;
}

function rawField(raw: unknown, labels: string[]): string {
  const text = S(raw);
  for (const part of text.split('|').map(S)) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const key = compact(part.slice(0, colon));
    if (labels.some((label) => key === compact(label))) return meaningful(part.slice(colon + 1));
  }
  return '';
}

function numericAtom(value: unknown): number | null {
  const raw = meaningful(value).replace(/,/g, '');
  if (!raw) return null;
  const liter = raw.match(/^(\d+(?:\.\d+)?)\s*L$/i);
  if (liter) {
    const liters = Number(liter[1]);
    return Number.isFinite(liters) ? Math.round(liters * 1000) : null;
  }
  const number = Number(raw.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(number) || number <= 0) return null;
  if (number > 0 && number < 20) return Math.round(number * 1000);
  return Math.round(number);
}

function seatsAtom(value: unknown): number | null {
  const text = S(value);
  if (!text) return null;
  // 차명 속 CN7·G80 같은 코드를 인승으로 오인하지 않는다. 「7인승」또는 인승 칸 숫자만.
  const labeled = text.match(/(\d+)\s*인승/);
  if (labeled) return Number(labeled[1]);
  if (/^\d{1,2}$/.test(text)) {
    const plain = Number(text);
    return plain > 0 ? plain : null;
  }
  return null;
}

/** YYYY-MM. 공란·파싱불가는 빈 문자열(기간 모순으로 쓰지 않음). */
export function registrationYearMonth(value: unknown): string {
  const text = meaningful(value);
  if (!text) return '';
  const iso = text.match(/(20\d{2}|19\d{2})\s*[.\-/년]\s*(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}`;
  const short = text.match(/(?:^|\D)(\d{2})\s*[.\-/년]\s*(\d{1,2})(?:\D|$)/);
  if (short) return `20${short[1]}-${short[2].padStart(2, '0')}`;
  const yOnly = text.match(/^(20\d{2}|19\d{2})$/);
  // A bare model year has no registration month; treating it as January can
  // incorrectly exclude a model launched later in the same year.
  if (yOnly) return '';
  const my = text.match(/(\d{2})\s*(?:MY|년)/i);
  if (my) return `20${my[1]}-01`;
  return '';
}

function ymOrder(value: string): number | null {
  const match = value.match(/^(20\d{2}|19\d{2})-(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number(match[2]);
}

function periodAllows(record: VehicleTrimMasterRecord, registrationYm: string): boolean {
  if (!registrationYm) return true;
  const reg = ymOrder(registrationYm);
  if (reg == null) return true;
  const start = ymOrder(record.production_start);
  if (start != null && reg < start) return false;
  const endRaw = S(record.production_end);
  if (!endRaw || endRaw === '현재') return true;
  const end = ymOrder(endRaw);
  if (end != null && reg > end) return false;
  return true;
}

function registrationDoesNotPrecedeProduction(
  record: VehicleTrimMasterRecord,
  registrationYm: string,
): boolean {
  if (!registrationYm) return true;
  const reg = ymOrder(registrationYm);
  const start = ymOrder(record.production_start);
  if (reg == null || start == null) return true;
  return reg >= start;
}

function fuelFamily(value: unknown): string {
  const fuel = normFuel(value);
  if (!fuel) return '';
  if (fuel === '전기' || fuel === 'ev') return '전기';
  if (fuel === '수소') return '수소';
  if (fuel === '하이브리드' || fuel === 'hev' || /mhev|phev|하이브리드/.test(compact(value))) return '하이브리드';
  if (fuel === 'lpg') return 'lpg';
  if (fuel === '디젤') return '디젤';
  if (fuel === '가솔린') return '가솔린';
  return fuel;
}

function fuelsContradict(productFuel: string, masterFuel: string): boolean {
  const left = fuelFamily(productFuel);
  const right = fuelFamily(masterFuel);
  if (!left || !right) return false;
  if (left === right) return false;
  if (left === '하이브리드' && (right === '가솔린' || right === '디젤' || right === 'lpg')) {
    // 공급사가 HEV만 밝히고 마스터가 가솔린 하이브리드면 연료칸이 가솔린일 수 있다.
    return !/하이브리드|hev|mhev|phev|전기/.test(compact(masterFuel));
  }
  if (right === '하이브리드' && (left === '가솔린' || left === '디젤' || left === 'lpg')) {
    return !/하이브리드|hev|mhev|phev|전기/.test(compact(productFuel));
  }
  return true;
}

function drivesContradict(productDrive: string, masterDrive: string): boolean {
  const left = normDrive(productDrive);
  const right = normDrive(masterDrive);
  return Boolean(left && right && left !== right);
}

function seatsContradict(productSeats: number | null, masterSeats: number | null): boolean {
  return productSeats != null && masterSeats != null && productSeats !== masterSeats;
}

function ccContradict(productCc: number | null, masterCc: number | null, productFuel: string, masterFuel: string): boolean {
  if (productCc == null || masterCc == null) return false;
  if (fuelFamily(productFuel) === '전기' || fuelFamily(masterFuel) === '전기') return false;
  if (fuelFamily(productFuel) === '수소' || fuelFamily(masterFuel) === '수소') return false;
  return Math.abs(productCc - masterCc) > CC_TOLERANCE;
}

function makersContradict(productMaker: string, masterMaker: string): boolean {
  const left = canonMaker(productMaker);
  const right = canonMaker(masterMaker);
  return Boolean(left && right && compact(left) !== compact(right));
}

/**
 * 압축 문자열 포함은 허용하되 숫자 모델 경계는 지킨다.
 * 예: K5↔K50, 아이오닉↔아이오닉6을 같은 모델 근거로 보지 않는다.
 * EV6 GT처럼 숫자 뒤 영문 파생명이 붙는 정상 표기는 허용한다.
 */
function containsModelIdentity(blobValue: unknown, identityValue: unknown): boolean {
  const blob = compact(blobValue);
  const identity = compact(identityValue);
  if (!blob || identity.length < 2) return false;
  const source = S(blobValue).normalize('NFKC');
  const boundedAlias = modelIdentityAliases(identityValue).some((alias) => {
    if (!hasBoundedVehiclePhrase(source, alias)) return false;
    const exact = new RegExp(String(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').exec(source);
    if (!exact || /\d$/.test(compact(alias))) return true;
    const tail = source.slice((exact.index || 0) + exact[0].length);
    // A non-numeric model followed only by a model number is not the same model
    // (Ioniq vs Ioniq 6). Decimal displacement and generation labels are safe.
    return !/^\s*\d/.test(tail)
      || /^\s*(?:[1-6]\.\d|\d{1,2}\s*(?:\uC138\uB300|my\b))/i.test(tail);
  });
  if (boundedAlias) return true;
  let from = 0;
  while (from <= blob.length - identity.length) {
    const index = blob.indexOf(identity, from);
    if (index < 0) return false;
    const before = index > 0 ? blob[index - 1] : '';
    const tail = blob.slice(index + identity.length);
    const after = tail[0] || '';
    const numericPrefixCollision = /^\d/.test(identity) && /\d/.test(before);
    const describedGeneration = /^\d{1,2}세대/.test(tail);
    const separatedSeatsAfterNumericModel = /\d$/.test(identity) && /^\d{1,2}인승/.test(tail);
    const numericSuffixCollision = /\d/.test(after)
      && !describedGeneration
      && !separatedSeatsAfterNumericModel;
    if (!numericPrefixCollision && !numericSuffixCollision) return true;
    from = index + 1;
  }
  return false;
}

function containsDevelopmentCode(blobValue: unknown, developmentCode: unknown): boolean {
  const code = S(developmentCode);
  return code.length >= 2 && hasBoundedVehiclePhrase(S(blobValue), code);
}

function modelMatches(signals: ProductVehicleSignals, record: VehicleTrimMasterRecord): boolean {
  const blob = [signals.model_text, signals.supplier_vehicle_name, signals.raw_preserved].filter(Boolean).join(' ');
  if (!blob) return true;
  if (containsModelIdentity(blob, record.model)) return true;
  if (containsModelIdentity(blob, record.sub_model)) return true;
  if (containsDevelopmentCode(blob, record.development_code)) return true;
  // 모델 신호가 거의 없으면(제조사만) 모델 축으로 탈락시키지 않는다 — 이후 다른 축·유일성이 가른다.
  if (!compact(signals.model_text) && !compact(signals.supplier_vehicle_name)) return true;
  return false;
}

function hasPositiveAutoEvidence(
  signals: ProductVehicleSignals,
  record: VehicleTrimMasterRecord,
): boolean {
  const blob = [
    signals.model_text,
    signals.supplier_vehicle_name,
    signals.raw_preserved,
  ].filter(Boolean).join(' ');
  if (!blob) return false;

  const modelMatched = [record.sub_model, record.model]
    .some((value) => containsModelIdentity(blob, value))
    || containsDevelopmentCode(blob, record.development_code);
  if (!modelMatched) return false;

  const periodMatched = Boolean(
    signals.registration_ym
    && (ymOrder(record.production_start) != null
      || ymOrder(record.production_end) != null
      || record.production_end === '현재')
    && periodAllows(record, signals.registration_ym),
  );
  const fuelMatched = Boolean(
    fuelFamily(signals.fuel)
    && fuelFamily(record.fuel)
    && !fuelsContradict(signals.fuel, record.fuel),
  );
  const ccMatched = signals.engine_cc != null
    && record.engine_cc != null
    && !ccContradict(signals.engine_cc, record.engine_cc, signals.fuel, record.fuel);
  const driveMatched = Boolean(
    normDrive(signals.drivetrain)
    && normDrive(record.drivetrain)
    && !drivesContradict(signals.drivetrain, record.drivetrain),
  );
  const trimMatched = Boolean(signals.trim && trimMatches(signals, record));

  // 제조사·인승만으로는 같은 차종/트림을 가를 수 없다. 모델 양성 근거에 더해
  // 기간·연료·배기량·구동·트림 중 하나의 기술/계보 축이 실제로 맞아야 한다.
  return periodMatched || fuelMatched || ccMatched || driveMatched || trimMatched;
}

function trimTokens(value: unknown): string[] {
  const normalized = S(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(\d+)\s*door\b/g, '$1도어')
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2');
  return normalized.split(/[^a-z0-9가-힣]+/).filter(Boolean);
}

function hasTrimEvidence(evidence: string, expected: string): boolean {
  const wanted = compact(expected);
  if (!wanted) return true;
  if (compact(evidence).includes(wanted)) return true;
  const expectedTokens = trimTokens(expected);
  if (expectedTokens.length < 2 || expectedTokens.some((token) => token.length < 2)) return false;
  const evidenceTokens = new Set(trimTokens(evidence));
  return expectedTokens.every((token) => evidenceTokens.has(token));
}

function trimMatches(
  signals: ProductVehicleSignals,
  record: VehicleTrimMasterRecord,
  allowSupplierContext = false,
): boolean {
  const wanted = compact(signals.trim);
  if (!wanted) return true;
  if (vehicleTrimSignalMatches(signals.trim, record.trim, record.trim_aliases)) return true;
  const expected = [record.trim, ...record.trim_aliases].filter(Boolean);
  if (expected.some((value) => compact(value) === wanted || hasTrimEvidence(signals.trim, value))) return true;
  if (!allowSupplierContext) return false;
  const context = [
    signals.trim,
    signals.model_text,
    signals.supplier_vehicle_name,
    signals.raw_preserved,
  ].filter(Boolean).join(' ');
  return expected.some((value) => hasTrimEvidence(context, value));
}

function trimLabels(record: VehicleTrimMasterRecord): string[] {
  // trim_aliases에는 구형 데이터의 모델·구동·인승 별칭도 섞여 있으므로 원문에서
  // 동적으로 트림을 찾을 때는 정본 세부트림만 사용한다.
  return [record.trim]
    .map(S)
    .filter((value) => value && !/세부등급\s*없음/.test(value));
}

/** 공급사 표시 차명에 직접 적힌 마스터 트림 완전명만 후보 축으로 사용한다. */
function filterByExplicitTrimEvidence(
  signals: ProductVehicleSignals,
  records: VehicleTrimMasterRecord[],
): VehicleTrimMasterRecord[] {
  if (signals.trim || !records.length) return records;
  const evidence = [signals.supplier_vehicle_name, signals.model_text, signals.raw_preserved]
    .filter(Boolean)
    .join(' ');
  const supplierSignal = explicitSupplierTrimSignal(evidence);
  if (supplierSignal) {
    const matched = records.filter((record) => vehicleTrimSignalMatches(
      supplierSignal,
      record.trim,
      record.trim_aliases,
    ));
    if (matched.length) return matched;
  }
  const labels = mostSpecificBoundedVehiclePhrases(evidence, records.flatMap(trimLabels));
  if (!labels.length) return records;
  const normalized = new Set(labels.map(compact));
  const matched = records.filter((record) => trimLabels(record).some((label) => normalized.has(compact(label))));
  return matched.length ? matched : records;
}

function contradictionAxes(
  signals: ProductVehicleSignals,
  record: VehicleTrimMasterRecord,
  allowExistingCodeContext = false,
): string[] {
  const axes: string[] = [];
  const makerLooksLikeModel = Boolean(
    signals.maker
    && (compact(signals.maker) === compact(record.model)
      || compact(record.sub_model).includes(compact(signals.maker))),
  );
  if (!makerLooksLikeModel && makersContradict(signals.maker, record.maker)) axes.push('manufacturer');
  if (!modelMatches(signals, record)) axes.push('generation');
  const periodMatches = allowExistingCodeContext
    ? registrationDoesNotPrecedeProduction(record, signals.registration_ym)
    : periodAllows(record, signals.registration_ym);
  if (!periodMatches) axes.push('period');
  if (fuelsContradict(signals.fuel, record.fuel)) axes.push('fuel');
  if (ccContradict(signals.engine_cc, record.engine_cc, signals.fuel, record.fuel)) axes.push('engine_cc');
  if (drivesContradict(signals.drivetrain, record.drivetrain)) axes.push('drivetrain');
  if (seatsContradict(signals.seats, record.seats)) axes.push('seats');
  if (!trimMatches(signals, record, allowExistingCodeContext)) axes.push('trim');
  return axes;
}

function candidateView(record: VehicleTrimMasterRecord, axes: string[]): CoverageCandidateView {
  return {
    trim_row_key: record.trim_row_key,
    usage_tier: record.usage_tier,
    maker: record.maker,
    model: record.model,
    sub_model: record.sub_model,
    powertrain: record.powertrain,
    trim: record.trim,
    fuel: record.fuel,
    engine_cc: record.engine_cc,
    drivetrain: record.drivetrain,
    seats: record.seats,
    production_start: record.production_start,
    production_end: record.production_end,
    diff_axes: axes,
  };
}

export function assertProductMasterHeader(header: unknown[]): asserts header is string[] {
  const cells = (header || []).map(S);
  const duplicates = cells.filter((name, index) => name && cells.indexOf(name) !== index);
  if (duplicates.length) {
    throw new Error(`상품마스터 헤더 중복(${[...new Set(duplicates)].join(', ')})`);
  }
  const missing = PRODUCT_MASTER_COLUMNS.filter((name) => !cells.includes(name));
  if (missing.length) throw new Error(`상품마스터 필수 열 없음(${missing.join(', ')})`);
  const unexpected = cells.filter((name) => name && !(PRODUCT_MASTER_COLUMNS as readonly string[]).includes(name));
  if (unexpected.length) throw new Error(`상품마스터 알 수 없는 열(${unexpected.join(', ')})`);
  if (cells.length !== PRODUCT_MASTER_COLUMNS.length
    || PRODUCT_MASTER_COLUMNS.some((name, index) => cells[index] !== name)) {
    throw new Error('상품마스터 열 순서가 규격과 다릅니다(A:AZ 50열)');
  }
}

function detectInputConflicts(partial: Omit<ProductVehicleSignals, 'input_conflict' | 'input_conflict_axes'>): string[] {
  const axes: string[] = [];
  const fuelFromRaw = fuelFamily(partial.fuel);
  const fuelFromName = fuelFamily(
    /전기|ev\b|하이브리드|hev|lpg|디젤|경유|가솔린|휘발유|수소/i.exec(partial.supplier_vehicle_name)?.[0] || '',
  );
  if (fuelFromRaw && fuelFromName && fuelsContradict(fuelFromRaw, fuelFromName)) axes.push('fuel');
  const seatsFromName = seatsAtom(partial.supplier_vehicle_name);
  if (partial.seats != null && seatsFromName != null && partial.seats !== seatsFromName) axes.push('seats');
  const driveFromName = normDrive(partial.supplier_vehicle_name);
  if (partial.drivetrain && driveFromName && drivesContradict(partial.drivetrain, driveFromName)) axes.push('drivetrain');
  return axes;
}

export function extractSignalsFromRow(
  cells: unknown[],
  headerIndex: Record<string, number>,
  rowNumber: number,
): ProductVehicleSignals | null {
  const at = (name: string) => headerIndex[name] == null ? '' : cells[headerIndex[name]];
  const carNumber = plateOf(at('차량번호'));
  if (!carNumber) return null;
  const rawEvidence = splitSupplierPreservedEvidence(at('공급사 원문보존'));
  const raw = rawEvidence.supplierDirect;
  const supplierName = meaningful(at('공급사 입력 차명'));
  const maker = meaningful(rawField(raw, ['제조사', '공급사 제조사'])) || '';
  const trim = meaningful(rawField(raw, ['세부트림', '트림'])) || '';
  const fuel = meaningful(rawField(raw, ['연료', '유종']))
    || meaningful(/하이브리드|\bHEV\b|LPG|LPI|디젤|경유|\bEV\b|전기|가솔린|휘발유/i.exec(supplierName)?.[0])
    || '';
  const engineCc = explicitVehicleDisplacementCc(supplierName)
    || numericAtom(rawField(raw, ['배기량', '배기', 'cc']));
  const drivetrain = meaningful(rawField(raw, ['구동', '구동방식', '드라이브트레인']))
    || normDrive(supplierName)
    || '';
  const seats = seatsAtom(rawField(raw, ['인승', '승차정원'])) ?? seatsAtom(supplierName);
  const firstRegistration = meaningful(rawField(raw, ['최초등록', '최초등록일']))
    || meaningful(rawField(raw, ['연식', '년식']));
  const base = {
    car_number: carNumber,
    provider_code: plateOf(at('공급사코드')),
    provider_name: meaningful(at('공급사명')),
    supplier_vehicle_name: supplierName,
    verification: S(at('검증상태')),
    review_reason: meaningful(at('검수사유')),
    current_code: meaningful(at('차종코드')),
    applied_value: meaningful(at('차종마스터 적용값')),
    maker,
    model_text: supplierName,
    trim,
    fuel,
    engine_cc: engineCc,
    drivetrain,
    seats,
    first_registration: firstRegistration,
    registration_ym: registrationYearMonth(firstRegistration),
    raw_preserved: raw,
    raw_preserved_full: rawEvidence.full,
    row_numbers: [rowNumber],
  };
  const inputConflictAxes = detectInputConflicts(base);
  return { ...base, input_conflict: inputConflictAxes.length > 0, input_conflict_axes: inputConflictAxes };
}

function mergeSignals(into: ProductVehicleSignals, next: ProductVehicleSignals): ProductVehicleSignals {
  const merged: ProductVehicleSignals = {
    ...into,
    row_numbers: [...into.row_numbers, ...next.row_numbers],
  };
  const fill = <K extends keyof ProductVehicleSignals>(key: K) => {
    if ((merged[key] === '' || merged[key] == null) && next[key] !== '' && next[key] != null) {
      (merged as Record<string, unknown>)[key as string] = next[key];
    }
  };
  for (const key of [
    'provider_code', 'provider_name', 'supplier_vehicle_name', 'verification', 'review_reason',
    'current_code', 'applied_value', 'maker', 'model_text', 'trim', 'fuel', 'drivetrain',
    'first_registration', 'registration_ym', 'raw_preserved', 'raw_preserved_full',
  ] as const) fill(key);
  if (merged.engine_cc == null && next.engine_cc != null) merged.engine_cc = next.engine_cc;
  if (merged.seats == null && next.seats != null) merged.seats = next.seats;
  if (next.current_code) merged.current_code = next.current_code;
  merged.input_conflict_axes = [...new Set([...into.input_conflict_axes, ...next.input_conflict_axes])];
  merged.input_conflict = merged.input_conflict_axes.length > 0;
  return merged;
}

function countBy(values: string[]): Record<string, number> {
  const map = new Map<string, number>();
  for (const value of values) map.set(value || '(공란)', (map.get(value || '(공란)') || 0) + 1);
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')));
}

function classifyBacklog(
  signals: ProductVehicleSignals,
  surviving: VehicleTrimMasterRecord[],
  eliminatedByPeriodOnly: boolean,
  trimOnlyAmbiguous: boolean,
): CoverageBacklog {
  if (signals.input_conflict) return '입력 자체 충돌';
  if (!signals.maker && !compact(signals.model_text)) return '원자 부족';
  if (trimOnlyAmbiguous) return '트림만 불명';
  if (eliminatedByPeriodOnly) return '기간 경계 부족';
  if (signals.trim && surviving.length === 0) return '공식 별칭 부족';
  return '마스터 계보 누락';
}

function neededNext(result: Omit<CoverageVehicleResult, 'needed_next'>): string {
  if (result.decision === 'AUTO_UNIQUE') return '자동 반영 가능(별도 승인 후)';
  if (result.decision === 'MANUAL_UNIQUE') return '운영자 1건 검수·승인 전 자동반영 금지';
  if (result.secondary === 'CODE_CONFLICT') return '기존 코드 의미 충돌 — 자동 교체 금지, 원자·근거 재확인';
  if (result.secondary === 'BLOCKED_KEY_REFERENCE') return 'blocked 키 배정 해제 금지 — 대체 비차단 키·근거 필요';
  if (result.secondary === 'MULTI_CANDIDATE') return '원자 보강 또는 MANUAL 검수(별칭 확장으로 억지 단일화 금지)';
  if (result.backlog === '마스터 계보 누락') return '공식 계보·신규키는 Claude/사람 게이트 후 별도';
  if (result.backlog === '원자 부족') return '공급사 원문 제조사·모델·등록·연료 원자 보강';
  if (result.backlog === '공식 별칭 부족') return '공식 트림 별칭 보강(추정 별칭 생성 금지)';
  if (result.backlog === '기간 경계 부족') return '생산시작/종료 공식 경계 보강(추정 금지)';
  if (result.backlog === '트림만 불명') return '트림 원자만 추가 확인';
  if (result.backlog === '입력 자체 충돌') return '상품 입력 신호 충돌 해소';
  return '근거 부족 — 추정 보정 금지';
}

export function classifyProductVehicleCoverage(
  signals: ProductVehicleSignals,
  trimRecords: VehicleTrimMasterRecord[],
): CoverageVehicleResult {
  const trimByKey = new Map(trimRecords.map((record) => [record.trim_row_key, record]));
  const base = {
    car_number: signals.car_number,
    provider_code: signals.provider_code,
    provider_name: signals.provider_name,
    maker: signals.maker,
    model_text: signals.model_text,
    verification: signals.verification,
    current_code: signals.current_code,
    current_tier: '',
    candidate_keys: [] as string[],
    candidates: [] as CoverageCandidateView[],
    contradiction_axes: [] as string[],
    row_numbers: signals.row_numbers.join('|'),
    backlog: '' as CoverageBacklog,
    secondary: '' as CoverageSecondary | '',
  };

  if (signals.input_conflict) {
    const blocked: CoverageVehicleResult = {
      ...base,
      decision: 'EVIDENCE_BLOCKED',
      secondary: 'NO_CANDIDATE',
      backlog: '입력 자체 충돌',
      contradiction_axes: signals.input_conflict_axes,
      needed_next: '',
    };
    blocked.needed_next = neededNext(blocked);
    return blocked;
  }

  if (signals.current_code) {
    const current = trimByKey.get(signals.current_code);
    base.current_tier = current?.usage_tier || '';
    if (!current) {
      const missing: CoverageVehicleResult = {
        ...base,
        decision: 'EVIDENCE_BLOCKED',
        secondary: 'CODE_CONFLICT',
        backlog: '마스터 계보 누락',
        contradiction_axes: ['missing_key'],
        needed_next: '',
      };
      missing.needed_next = neededNext(missing);
      return missing;
    }
    if (current.usage_tier === 'blocked') {
      const blockedRef: CoverageVehicleResult = {
        ...base,
        decision: 'EVIDENCE_BLOCKED',
        secondary: 'BLOCKED_KEY_REFERENCE',
        backlog: '',
        candidates: [candidateView(current, ['blocked'])],
        candidate_keys: [current.trim_row_key],
        needed_next: '',
      };
      blockedRef.needed_next = neededNext(blockedRef);
      return blockedRef;
    }
    const axes = contradictionAxes(signals, current, true).filter((axis) => (
      axis !== 'manufacturer' || !modelMatches(signals, current)
    ));
    if (axes.length) {
      const conflict: CoverageVehicleResult = {
        ...base,
        decision: 'EVIDENCE_BLOCKED',
        secondary: 'CODE_CONFLICT',
        backlog: '',
        contradiction_axes: axes,
        candidates: [candidateView(current, axes)],
        candidate_keys: [current.trim_row_key],
        needed_next: '',
      };
      conflict.needed_next = neededNext(conflict);
      return conflict;
    }
    const ok: CoverageVehicleResult = {
      ...base,
      decision: current.usage_tier === 'automatic' ? 'AUTO_UNIQUE' : 'MANUAL_UNIQUE',
      secondary: '',
      backlog: '',
      candidates: [candidateView(current, [])],
      candidate_keys: [current.trim_row_key],
      needed_next: '',
    };
    ok.needed_next = neededNext(ok);
    return ok;
  }

  const maker = canonMaker(signals.maker);
  const pool = trimRecords.filter((record) => {
    if (maker && makersContradict(maker, record.maker)) return false;
    return true;
  });

  const afterModel = pool.filter((record) => modelMatches(signals, record));
  const afterPeriod = afterModel.filter((record) => periodAllows(record, signals.registration_ym));
  const eliminatedByPeriodOnly = afterModel.length > 0 && afterPeriod.length === 0;

  let hardFiltered = afterPeriod.filter((record) => {
    const axes = contradictionAxes(signals, record).filter((axis) => axis !== 'generation' && axis !== 'period' && axis !== 'trim');
    return axes.length === 0;
  });
  const evidence = [signals.supplier_vehicle_name, signals.model_text, signals.raw_preserved]
    .filter(Boolean)
    .join(' ');
  const generationCodes = recognizedDevelopmentCodes(
    hardFiltered
      .map((record) => S(record.development_code).toUpperCase())
      .filter((code) => code.length >= 2 && hasBoundedVehiclePhrase(evidence, code)),
    hardFiltered.map((record) => record.development_code),
  );
  if (generationCodes.length) {
    hardFiltered = hardFiltered.filter((record) => generationCodes.includes(S(record.development_code).toUpperCase()));
  }
  const rangeClass = vehicleRangeClass(evidence);
  if (rangeClass && hardFiltered.some((record) => vehicleRangeClass(`${record.sub_model} ${record.powertrain}`) === rangeClass)) {
    hardFiltered = hardFiltered.filter((record) => vehicleRangeClass(`${record.sub_model} ${record.powertrain}`) === rangeClass);
  }
  const bodyForm = vehicleBodyForm(evidence);
  if (bodyForm && hardFiltered.some((record) => vehicleBodyForm(`${record.sub_model} ${record.powertrain} ${record.trim}`) === bodyForm)) {
    hardFiltered = hardFiltered.filter((record) => vehicleBodyForm(`${record.sub_model} ${record.powertrain} ${record.trim}`) === bodyForm);
  } else if (!bodyForm && hardFiltered.some((record) => vehicleBodyForm(record.sub_model) === 'coupe')
    && hardFiltered.some((record) => vehicleBodyForm(record.sub_model) !== 'coupe')) {
    const detailed = Boolean(signals.seats || signals.trim || explicitSupplierTrimSignal(evidence))
      && Boolean(signals.fuel || signals.engine_cc || signals.drivetrain);
    if (detailed) hardFiltered = hardFiltered.filter((record) => vehicleBodyForm(record.sub_model) !== 'coupe');
  }
  const trimFiltered = hardFiltered.filter((record) => trimMatches(signals, record));
  const withTrim = filterByExplicitTrimEvidence(signals, trimFiltered);
  const assignable = withTrim.filter((record) => record.usage_tier !== 'blocked');
  const views = assignable
    .map((record) => candidateView(record, contradictionAxes(signals, record)))
    .sort((a, b) => a.trim_row_key.localeCompare(b.trim_row_key));

  const trimOnlyAmbiguous = Boolean(
    signals.trim
    && hardFiltered.filter((record) => record.usage_tier !== 'blocked').length > 1
    && assignable.length !== 1,
  ) || (
    !signals.trim
    && assignable.length > 1
    && new Set(assignable.map((record) => [
      record.maker, record.model, record.sub_model, record.powertrain, record.fuel,
      record.engine_cc, record.drivetrain, record.seats,
    ].join('|'))).size === 1
  );

  if (assignable.length === 0) {
    const empty: CoverageVehicleResult = {
      ...base,
      decision: 'EVIDENCE_BLOCKED',
      secondary: 'NO_CANDIDATE',
      backlog: classifyBacklog(signals, assignable, eliminatedByPeriodOnly, trimOnlyAmbiguous),
      candidates: views.slice(0, 5),
      candidate_keys: [],
      needed_next: '',
    };
    empty.needed_next = neededNext(empty);
    return empty;
  }
  if (assignable.length > 1) {
    const multi: CoverageVehicleResult = {
      ...base,
      decision: 'EVIDENCE_BLOCKED',
      secondary: 'MULTI_CANDIDATE',
      backlog: classifyBacklog(signals, assignable, false, trimOnlyAmbiguous),
      candidates: views.slice(0, 5),
      candidate_keys: views.slice(0, 5).map((row) => row.trim_row_key),
      needed_next: '',
    };
    multi.needed_next = neededNext(multi);
    return multi;
  }

  const only = assignable[0]!;
  // blocked는 이미 제외. manual은 절대 AUTO가 될 수 없다.
  // 후보가 우연히 1개만 남았다는 사실은 자동 식별 근거가 아니다.
  // 모델/세대와 추가 식별축이 실제로 일치할 때만 automatic을 허용한다.
  const autoEligible = only.usage_tier === 'automatic'
    && hasPositiveAutoEvidence(signals, only);
  const unique: CoverageVehicleResult = {
    ...base,
    decision: autoEligible ? 'AUTO_UNIQUE' : 'MANUAL_UNIQUE',
    secondary: '',
    backlog: only.usage_tier === 'automatic' && !autoEligible ? '원자 부족' : '',
    candidates: [candidateView(only, [])],
    candidate_keys: [only.trim_row_key],
    current_tier: only.usage_tier,
    needed_next: '',
  };
  unique.needed_next = neededNext(unique);
  return unique;
}

export function auditProductVehicleTrimCoverage(input: {
  table: unknown[][];
  trimRecords: VehicleTrimMasterRecord[];
  source: CoverageReport['source'];
  masterMeta?: { trim_rows?: number; data_as_of?: string };
}): CoverageReport {
  assertProductMasterHeader(input.table[0] || []);
  const header = (input.table[0] || []).map(S);
  const headerIndex = Object.fromEntries(header.map((name, index) => [name, index]));
  const byPlate = new Map<string, ProductVehicleSignals>();
  for (let offset = 1; offset < input.table.length; offset += 1) {
    const row = input.table[offset] || [];
    if (row.every((cell) => !S(cell))) continue;
    const signals = extractSignalsFromRow(row, headerIndex, offset + 1);
    if (!signals) continue;
    const prev = byPlate.get(signals.car_number);
    byPlate.set(signals.car_number, prev ? mergeSignals(prev, signals) : signals);
  }

  const vehicles = [...byPlate.values()]
    .map((signals) => classifyProductVehicleCoverage(signals, input.trimRecords))
    .sort((a, b) => a.car_number.localeCompare(b.car_number, 'ko'));

  const totals = {
    unique_plates: vehicles.length,
    AUTO_UNIQUE: vehicles.filter((row) => row.decision === 'AUTO_UNIQUE').length,
    MANUAL_UNIQUE: vehicles.filter((row) => row.decision === 'MANUAL_UNIQUE').length,
    EVIDENCE_BLOCKED: vehicles.filter((row) => row.decision === 'EVIDENCE_BLOCKED').length,
    NO_CANDIDATE: vehicles.filter((row) => row.secondary === 'NO_CANDIDATE').length,
    MULTI_CANDIDATE: vehicles.filter((row) => row.secondary === 'MULTI_CANDIDATE').length,
    BLOCKED_KEY_REFERENCE: vehicles.filter((row) => row.secondary === 'BLOCKED_KEY_REFERENCE').length,
    CODE_CONFLICT: vehicles.filter((row) => row.secondary === 'CODE_CONFLICT').length,
  };
  const secondarySum = totals.NO_CANDIDATE + totals.MULTI_CANDIDATE
    + totals.BLOCKED_KEY_REFERENCE + totals.CODE_CONFLICT;
  const report: CoverageReport = {
    source: {
      ...input.source,
      header_columns: PRODUCT_MASTER_COLUMNS.length,
      source_rows: Math.max(0, input.table.length - 1),
      unique_plates: totals.unique_plates,
    },
    master: {
      trim_rows: input.masterMeta?.trim_rows ?? input.trimRecords.length,
      data_as_of: input.masterMeta?.data_as_of || '',
    },
    totals,
    groups: {
      by_provider: countBy(vehicles.map((row) => row.provider_code || row.provider_name)),
      by_maker: countBy(vehicles.map((row) => row.maker)),
      by_model: countBy(vehicles.map((row) => row.model_text)),
      by_backlog: countBy(vehicles.map((row) => row.backlog).filter(Boolean)),
    },
    invariants: {
      primary_sum_matches_unique:
        totals.AUTO_UNIQUE + totals.MANUAL_UNIQUE + totals.EVIDENCE_BLOCKED === totals.unique_plates,
      secondary_subset_of_evidence: secondarySum === totals.EVIDENCE_BLOCKED,
    },
    vehicles,
  };
  return report;
}

export function coverageReportToCsv(report: CoverageReport): string {
  const columns = [
    'car_number', 'decision', 'secondary', 'backlog', 'provider_code', 'provider_name',
    'maker', 'model_text', 'verification', 'current_code', 'current_tier',
    'candidate_keys', 'contradiction_axes', 'needed_next', 'row_numbers',
  ] as const;
  const escape = (value: unknown) => {
    const text = String(value ?? '');
    return /["\n,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.join(',')];
  for (const row of report.vehicles) {
    lines.push(columns.map((key) => {
      if (key === 'candidate_keys') return escape(row.candidate_keys.join('|'));
      if (key === 'contradiction_axes') return escape(row.contradiction_axes.join('|'));
      return escape(row[key]);
    }).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function loadSnapshotTable(path: string): unknown[][] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (Array.isArray(raw)) return raw as unknown[][];
  if (raw && typeof raw === 'object') {
    const obj = raw as {
      values?: unknown[][];
      table?: unknown[][];
      full_before_values?: unknown[][];
      rows?: unknown[][];
      product_master?: { values?: unknown[][] };
    };
    if (Array.isArray(obj.values)) return obj.values;
    if (Array.isArray(obj.table)) return obj.table;
    if (Array.isArray(obj.full_before_values)) return obj.full_before_values;
    if (Array.isArray(obj.product_master?.values)) return obj.product_master.values;
    if (Array.isArray(obj.rows)) {
      const rows = obj.rows;
      if (rows[0] && (rows[0] as unknown[]).length === PRODUCT_MASTER_COLUMNS.length
        && S((rows[0] as unknown[])[0]) !== '차량번호') {
        return [[...PRODUCT_MASTER_COLUMNS], ...rows];
      }
      return rows;
    }
  }
  throw new Error(`스냅샷 형식 오류 — values/table/rows 배열 필요: ${path}`);
}

export function buildSheetsReadonlyJwtClaims(input: {
  issuer: string;
  subject: string;
  audience: string;
  now: number;
}): Record<string, string | number> {
  const issuer = S(input.issuer);
  const subject = S(input.subject);
  const audience = S(input.audience);
  if (!issuer) throw new Error('Google 서비스계정 issuer 없음');
  if (!subject) {
    throw new Error('GOOGLE_WORKSPACE_SUBJECT 없음 — 라이브 감사는 위임 주체 없이 실행하지 않습니다');
  }
  if (!audience) throw new Error('Google OAuth audience 없음');
  return {
    iss: issuer,
    sub: subject,
    scope: SHEETS_READONLY_SCOPE,
    aud: audience,
    iat: input.now,
    exp: input.now + 3600,
  };
}

async function loadLiveTable(sheetId: string): Promise<unknown[][]> {
  const saPath = S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json';
  if (!existsSync(saPath) && !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error('라이브 Sheets GET 자격증명 없음(GOOGLE_APPLICATION_CREDENTIALS/FIREBASE_SERVICE_ACCOUNT_JSON)');
  }
  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON || readFileSync(saPath, 'utf8'),
  ) as { client_email: string; private_key: string; token_uri?: string };
  const { sign } = await import('node:crypto');
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = serviceAccount.token_uri || 'https://oauth2.googleapis.com/token';
  const delegatedSubject = S(process.env.GOOGLE_WORKSPACE_SUBJECT);
  const claims = buildSheetsReadonlyJwtClaims({
    issuer: serviceAccount.client_email,
    subject: delegatedSubject,
    audience: tokenUri,
    now,
  });
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}`;
  const signature = sign('RSA-SHA256', Buffer.from(unsigned), serviceAccount.private_key).toString('base64url');
  const tokenResponse = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const tokenBody = await tokenResponse.json() as { access_token?: string; error_description?: string };
  if (!tokenResponse.ok || !tokenBody.access_token) {
    throw new Error(tokenBody.error_description || `OAuth ${tokenResponse.status}`);
  }
  const range = encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A:AZ`);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`,
    { headers: { Authorization: `Bearer ${tokenBody.access_token}` }, signal: AbortSignal.timeout(45_000) },
  );
  const body = await response.json() as { values?: unknown[][]; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `Sheets HTTP ${response.status}`);
  return body.values || [];
}

function assertWritableOutPath(outPath: string): void {
  const resolved = resolve(outPath);
  if (existsSync(resolved)) {
    throw new Error(`--out 경로가 이미 존재합니다(덮어쓰기 금지): ${resolved}`);
  }
}

function printReport(report: CoverageReport): void {
  const summary = {
    source: report.source,
    master: report.master,
    totals: report.totals,
    groups: report.groups,
    invariants: report.invariants,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log('---CSV---');
  console.log(coverageReportToCsv(report).trimEnd());
}

async function main(): Promise<void> {
  const trimPath = resolve(arg('trim', 'public/data/vehicle-trim-master.json'));
  const defaultSnapshot = resolve('tmp/product-master-values.json');
  const snapshotArg = arg('snapshot');
  const live = process.argv.includes('--live');
  const out = arg('out');
  const sheetId = arg('sheet', DEFAULT_PRODUCT_MASTER_SHEET_ID);

  if (!existsSync(trimPath)) throw new Error(`차종마스터 없음: ${trimPath}`);
  const artifact = JSON.parse(readFileSync(trimPath, 'utf8')) as VehicleTrimMasterArtifact;
  if (!Array.isArray(artifact.records) || !artifact.records.length) {
    throw new Error('차종마스터 records 비어 있음');
  }

  let table: unknown[][];
  let source: CoverageReport['source'];
  if (live) {
    table = await loadLiveTable(sheetId);
    source = { mode: 'live', sheet_id: sheetId, tab: PRODUCT_MASTER_TAB, header_columns: 0, source_rows: 0, unique_plates: 0 };
  } else if (snapshotArg) {
    const path = resolve(snapshotArg);
    if (!existsSync(path)) throw new Error(`스냅샷 없음: ${path}`);
    table = loadSnapshotTable(path);
    source = { mode: 'snapshot', path, header_columns: 0, source_rows: 0, unique_plates: 0 };
  } else if (existsSync(defaultSnapshot)) {
    table = loadSnapshotTable(defaultSnapshot);
    source = { mode: 'snapshot', path: defaultSnapshot, header_columns: 0, source_rows: 0, unique_plates: 0 };
  } else {
    // 자격증명이 있으면 읽기 전용 GET 시도. 없으면 우회하지 않고 실패.
    try {
      table = await loadLiveTable(sheetId);
      source = { mode: 'live', sheet_id: sheetId, tab: PRODUCT_MASTER_TAB, header_columns: 0, source_rows: 0, unique_plates: 0 };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `상품마스터 입력 없음 — 기본 스냅샷(${defaultSnapshot}) 없고 라이브 GET도 불가: ${reason}`,
      );
    }
  }

  const report = auditProductVehicleTrimCoverage({
    table,
    trimRecords: artifact.records,
    source,
    masterMeta: { trim_rows: artifact.row_count, data_as_of: artifact.data_as_of },
  });
  printReport(report);
  if (out) {
    assertWritableOutPath(out);
    writeFileSync(resolve(out), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.error(`wrote ${resolve(out)}`);
  }
  if (!report.invariants.primary_sum_matches_unique
    || !report.invariants.secondary_subset_of_evidence) {
    process.exitCode = 1;
  }
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
