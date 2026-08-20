/**
 * 상품마스터 실제 차량 ↔ 차종마스터 운영 커버리지 전수 감사. 읽기 전용.
 *
 * - 기존 차종코드는 영구키 실재/usage_tier를 검증한다.
 * - 미매칭은 공급사 원문을 보존한 채 세대 매칭 엔진으로 후보만 산출한다.
 * - Sheet/registry/RTDB write 없음. 차량번호 포함 상세는 tmp 아래에만 쓴다.
 *
 * 실행: npx tsx scripts/audit-product-master-vehicle-coverage.mts
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { JWT } from 'google-auth-library';
import {
  DEFAULT_PRODUCT_MASTER_SHEET_ID,
  PRODUCT_MASTER_COLUMNS,
  PRODUCT_MASTER_TAB,
} from '../lib/domain/product-master-sheet';
import { normDrive, normFuel, parseYear, snapToMaster, unpackVehicleSignals, type MasterEntry } from '../lib/domain/vehicle-master-match';
import {
  explicitVehicleDisplacementCc,
  hasBoundedVehiclePhrase,
  recognizedDevelopmentCodes,
  vehicleBodyForm,
  vehicleRangeClass,
} from '../lib/domain/vehicle-master-format';
import {
  canonicalVehicleTrimSignal,
  explicitMasterTrimSignals,
  explicitSupplierTrimSignal,
  vehicleTrimSignalMatches,
} from '../lib/domain/vehicle-trim-evidence';
import {
  productCoverageReportPath,
  productCoverageRowFingerprint,
  productCoverageSheetFingerprint,
} from '../lib/domain/product-master-coverage-audit';
import type { VehicleTrimMasterArtifact, VehicleTrimMasterRecord } from '../lib/domain/vehicle-trim-master';
import { splitSupplierPreservedEvidence } from '../lib/domain/supplier-preserved-evidence';

type Rec = Record<string, unknown>;
const S = (value: unknown) => String(value ?? '').trim();
const compact = (value: unknown) => S(value).replace(/[\s·._()\[\]/-]+/g, '').toLowerCase();
const plate = (value: unknown) => S(value).replace(/\s/g, '');
const arg = (name: string, fallback = '') =>
  (process.argv.find((value) => value.startsWith(`--${name}=`)) || '').slice(name.length + 3) || fallback;
const outputPath = resolve(arg('out', 'tmp/product-master-vehicle-coverage.json'));
const allowCached = process.argv.includes('--allow-cached');

const generationRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec | MasterEntry[];
const generations = (Array.isArray(generationRaw) ? generationRaw : generationRaw.entries) as MasterEntry[];
const trimArtifactRaw = readFileSync('public/data/vehicle-trim-master.json', 'utf8');
const trimArtifact = JSON.parse(trimArtifactRaw) as VehicleTrimMasterArtifact;
const trimByKey = new Map(trimArtifact.records.map((row) => [row.trim_row_key, row]));
const aliasBook = JSON.parse(readFileSync('public/data/master-aliases.json', 'utf8')) as { rules?: Rec[] };

const saPath = S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json';
const serviceAccount = JSON.parse(readFileSync(saPath, 'utf8')) as { client_email: string; private_key: string };
const authClient = new JWT({
  email: serviceAccount.client_email,
  key: serviceAccount.private_key,
  // Workspace delegation currently whitelists the Sheets scope used by the
  // existing importer. This script still performs GET requests only.
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com',
});
const timeout = <T>(promise: Promise<T>, label: string, milliseconds = 30_000) => Promise.race([
  promise,
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} ${milliseconds}ms timeout`)), milliseconds)),
]);
const sheetId = arg('sheet', DEFAULT_PRODUCT_MASTER_SHEET_ID);
let values: unknown[][] = [];
let sourceMode = 'live_sheet';
const snapshotPath = arg('snapshot');
if (snapshotPath) {
  const snapshot = JSON.parse(readFileSync(resolve(snapshotPath), 'utf8')) as {
    values?: unknown[][];
    full_before_values?: unknown[][];
  } | unknown[][];
  values = Array.isArray(snapshot) ? snapshot : snapshot.values || snapshot.full_before_values || [];
  if (!values.length) throw new Error('Workspace 커넥터 스냅샷에 값이 없습니다.');
  sourceMode = 'workspace_connector_snapshot';
} else try {
  const token = (await timeout(authClient.getAccessToken(), 'Google OAuth')).token;
  const range = encodeURIComponent(`'${PRODUCT_MASTER_TAB}'!A:AZ`);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`상품마스터 읽기 실패 HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  values = ((await response.json()) as { values?: unknown[][] }).values || [];
} catch (error) {
  // 원문보존 전체 열이 없는 요약 보고서를 라이브 시트처럼 재분류하면 후보 수와
  // 명시축 충돌이 왜곡된다. 기본 감사는 반드시 fail-closed 하고, 진단 목적의
  // 캐시 재분류만 명시 플래그로 허용하며 원본 보고서를 절대 덮어쓰지 않는다.
  if (!allowCached) {
    throw new Error(`라이브 상품마스터 감사 실패 — 캐시로 대체하지 않습니다: ${S((error as Error).message)}`);
  }
  if (!existsSync(outputPath)) throw error;
  const cached = JSON.parse(readFileSync(outputPath, 'utf8')) as { rows?: AuditRow[] };
  if (!cached.rows?.length) throw error;
  const toSheetRow = (row: AuditRow) => PRODUCT_MASTER_COLUMNS.map((column) => ({
    '차량번호': row.car_number,
    '공급사 입력 차명': row.supplier_vehicle_name,
    '검증상태': row.verification,
    '검수사유': row.reason,
    '차종코드': row.current_code,
    '공급사코드': row.provider,
  }[column] || ''));
  values = [PRODUCT_MASTER_COLUMNS as unknown as string[], ...cached.rows.map(toSheetRow)];
  sourceMode = `cached_live_report:${S((error as Error).message)}`;
}
const headers = (values[0] || []).map(S);
if (headers.length !== PRODUCT_MASTER_COLUMNS.length
  || PRODUCT_MASTER_COLUMNS.some((name, column) => headers[column] !== name)) {
  throw new Error('상품마스터 A:AZ 헤더 불일치 — 감사 중단');
}
const index = (name: string) => headers.indexOf(name);
const at = (row: unknown[], name: string) => index(name) < 0 ? '' : S(row[index(name)]);

const rawPairs = (raw: string): Rec => Object.fromEntries(raw.split('|').map((part) => {
  const match = part.match(/^\s*([^:]+?)\s*:\s*(.*?)\s*$/);
  return match ? [compact(match[1]), S(match[2])] : ['', ''];
}).filter(([key]) => key));
const first = (source: Rec, patterns: RegExp[]) => {
  for (const [key, value] of Object.entries(source)) if (patterns.some((pattern) => pattern.test(key))) return S(value);
  return '';
};
const sourceClues = (source: Rec, visibleOption: string) => {
  const option = first(source, [/^(?:선택)?옵션(?:사항|내역)?$/, /^추가옵션$/]) || S(visibleOption);
  const vehiclePrice = first(source, [
    /^(?:차량|소비자|신차|출고)가격$/, /^(?:차량|신차)가액$/, /^소비자가$/,
  ]);
  return {
    original_tab: first(source, [/^원본탭$/]),
    sub_model: first(source, [/^(?:세부모델|세부차종)$/]),
    powertrain: first(source, [/^(?:파워트레인|동력계|엔진)$/]),
    trim: first(source, [/^(?:세부)?트림$/]),
    option,
    vehicle_price: numeric(vehiclePrice) || null,
    vehicle_price_raw: vehiclePrice,
    body_or_use: first(source, [/^(?:차종분류|차종구분|차체형태|바디타입|차형|용도|구분)$/]),
    transmission: first(source, [/^(?:변속기|미션)$/]),
    battery: first(source, [/^(?:배터리|배터리용량|배터리kwh)$/]),
    source_vehicle_code: first(source, [/^(?:차종코드|차량코드|모델코드)$/]),
  };
};
const numeric = (value: unknown) => Number((S(value).match(/\d[\d,]*/) || [''])[0].replace(/,/g, '')) || undefined;
const plausibleYear = (value: string) => {
  const parsed = Number(parseYear(value));
  const max = new Date().getFullYear() + 1;
  return Number.isInteger(parsed) && parsed >= 1990 && parsed <= max ? parsed : undefined;
};
const registrationMonth = (value: string) => {
  const match = S(value).match(/(?:^|\D)(\d{2,4})\D+(\d{1,2})(?:\D|$)/);
  if (!match) return '';
  const year = plausibleYear(match[1]);
  const month = Number(match[2]);
  return year && month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, '0')}` : '';
};

const SUPPLIER_IDENTITY_RULES: Array<{ pattern: RegExp; maker: string; model: string }> = [
  { pattern: /\bA6\s+C9\b/i, maker: '아우디', model: 'A6' },
  { pattern: /벤츠\s*E250\b/i, maker: '벤츠', model: 'E-클래스' },
  { pattern: /벤츠\s*C200\b/i, maker: '벤츠', model: 'C-클래스' },
  { pattern: /\bARKANA(?:-LJL)?\b/i, maker: '르노코리아', model: '아르카나' },
  { pattern: /더\s*뉴\s*(?:스포티지|슾티지)/i, maker: '기아', model: '스포티지' },
];
const inferredSupplierIdentity = (supplierName: string) => {
  const matches = SUPPLIER_IDENTITY_RULES.filter((rule) => rule.pattern.test(supplierName));
  return matches.length === 1 ? matches[0] : undefined;
};
if (inferredSupplierIdentity('7 26MY 2.0 프레스티지') || inferredSupplierIdentity('200 1세대 하이브리드 3.0 4MATIC')) {
  throw new Error('모호 공급명은 제조사/모델을 역추론하면 안 됩니다.');
}

const rowSignals = (row: unknown[]): Rec => {
  const supplierName = at(row, '공급사 입력 차명');
  const preservedEvidence = splitSupplierPreservedEvidence(at(row, '공급사 원문보존'));
  const preserved = preservedEvidence.supplierDirect;
  const pairs = rawPairs(preserved);
  const clues = sourceClues(pairs, at(row, '옵션'));
  const inferredIdentity = inferredSupplierIdentity(supplierName);
  const maker = first(pairs, [/^(?:공급사)?(?:제조사|메이커|브랜드)$/]) || inferredIdentity?.maker || '';
  const model = inferredIdentity?.model || first(pairs, [/^(?:공급사)?(?:차명|차량명|상품명|모델명|차종)$/]) || supplierName;
  const structuredTrim = first(pairs, [/^(?:세부)?트림$/]);
  const supplierTrim = explicitSupplierTrimSignal(supplierName);
  const trim = structuredTrim || supplierTrim;
  const blob = `${supplierName} ${preserved}`;
  const fuel = first(pairs, [/^(?:연료|유종)$/]) || (/하이브리드|\bHEV\b/i.test(blob) ? '하이브리드'
    : /LPG|LPI/i.test(blob) ? 'LPG' : /디젤|경유/i.test(blob) ? '디젤'
      : /\bEV\b|전기/i.test(blob) ? '전기' : /가솔린|휘발유|GSL/i.test(blob) ? '가솔린' : '');
  const cc = first(pairs, [/^(?:배기량|배기)$/]);
  const statedYear = first(pairs, [/^(?:연식|모델연도|my)$/]);
  const registration = first(pairs, [/^(?:최초등록|최초등록일)$/]);
  const statedParsed = plausibleYear(statedYear);
  const registrationParsed = plausibleYear(registration);
  const structuredCc = numeric(cc);
  const yearLooksCopiedFromCc = Boolean(statedParsed && structuredCc && Math.abs(statedParsed - structuredCc) <= 5);
  // 공급사 열 오염 사례(배기 2,000이 연식 2000으로 복제됨)는 최초등록과
  // 큰 폭으로 충돌한다. 이 경우 세대 선택에 오염값을 쓰지 않는다.
  const statedYearTrusted = statedParsed && !yearLooksCopiedFromCc
    && (!registrationParsed || Math.abs(statedParsed - registrationParsed) <= 2)
    ? statedParsed : undefined;
  const year = statedYearTrusted || registrationParsed;
  const seats = first(pairs, [/^(?:인승|승차정원)$/]) || S((blob.match(/(\d+)\s*인승/) || [])[1]);
  const drive = first(pairs, [/^(?:구동|구동방식|드라이브트레인)$/])
    || S((blob.match(/\b(2WD|4WD|AWD|RWD|FWD|4MATIC|XDRIVE|QUATTRO)\b|콰트로/i) || [])[0]).toUpperCase();
  // 열 밀림이 있더라도 공급사 표시 차명 자체의 파워트레인 표기는 차량번호와
  // 같은 행에 붙어 있는 직접 근거다. 원문보존의 다른 숫자는 집지 않는다.
  const embeddedCc = explicitVehicleDisplacementCc(supplierName) || undefined;
  const ccColumnPolluted = Boolean(structuredCc && embeddedCc && Math.abs(structuredCc - embeddedCc) > 50);
  const auditCc = ccColumnPolluted ? embeddedCc : structuredCc || embeddedCc;
  const yearColumnPolluted = Boolean(
    statedParsed
    && ((yearLooksCopiedFromCc)
      || (registrationParsed && Math.abs(statedParsed - registrationParsed) > 2)),
  );
  const conflicts = [
    structuredTrim && supplierTrim && compact(structuredTrim) !== compact(supplierTrim)
      ? `트림 충돌:${structuredTrim}/${supplierTrim}` : '',
  ].filter(Boolean);
  const warnings = [
    ccColumnPolluted ? `배기량 열 오염:${structuredCc}/${embeddedCc}→차명 ${embeddedCc} 사용` : '',
    yearColumnPolluted ? `연식 열 오염:${statedParsed}/${registrationParsed || '등록일 없음'}→최초등록 사용` : '',
  ].filter(Boolean);
  const generationCodes = [...new Set(generations.flatMap((entry) => {
    const code = S(entry.gen_code).toUpperCase();
    return code.length >= 2 && new RegExp(`(?:^|[^A-Z0-9])${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^A-Z0-9])`, 'i').test(blob)
      ? [code] : [];
  }))];
  return unpackVehicleSignals({
    maker,
    model: inferredIdentity ? model : [model, supplierName].filter(Boolean).join(' '),
    trim_name: trim,
    fuel_type: fuel,
    engine_cc: auditCc,
    year,
    seats: numeric(seats),
    drive_type: drive,
    _raw_vehicle: {
      maker, model, trim_name: trim, fuel_type: fuel, engine_cc: cc,
      year: year ? String(year) : '', seats, drive_type: drive,
    },
    _audit_conflicts: conflicts,
    _audit_warnings: warnings,
    _audit_fuel: fuel,
    _audit_cc: auditCc,
    _audit_drive: drive,
    _audit_seats: numeric(seats),
    _audit_trim: trim,
    _audit_year: year,
    _audit_stated_year: statedYearTrusted,
    _audit_generation_signal: generationCodes.length > 0,
    _audit_generation_codes: generationCodes,
    _audit_registration_month: registrationMonth(registration),
    _audit_supplier_evidence: supplierName,
    _audit_preserved_full: preservedEvidence.full,
    _audit_source_clues: clues,
  } as never, generations);
};

const candidateDifferences = (candidates: VehicleTrimMasterRecord[]): Record<string, string[]> => {
  const fields: Array<[string, (record: VehicleTrimMasterRecord) => unknown]> = [
    ['sub_model', (record) => record.sub_model],
    ['powertrain', (record) => record.powertrain],
    ['trim', (record) => record.trim],
    ['generation_name', (record) => record.generation_name],
    ['development_code', (record) => record.development_code],
    ['production_period', (record) => `${record.production_start}~${record.production_end}`],
    ['model_year_period', (record) => `${record.model_year_start}~${record.model_year_end}`],
    ['fuel', (record) => record.fuel],
    ['engine_cc', (record) => record.engine_cc],
    ['turbo', (record) => record.turbo == null ? '' : record.turbo ? '예' : '아니오'],
    ['drivetrain', (record) => record.drivetrain],
    ['seats', (record) => record.seats],
    ['battery_kwh', (record) => record.battery_kwh],
  ];
  return Object.fromEntries(fields.flatMap(([name, getter]) => {
    const values = [...new Set(candidates.map((record) => S(getter(record))).filter(Boolean))].sort();
    return values.length > 1 ? [[name, values]] : [];
  }));
};

const sourceCodeClue = (clues: Rec): Rec | null => {
  const code = S(clues.source_vehicle_code);
  const record = trimByKey.get(code);
  if (!code) return null;
  if (!record) return { code, found: false };
  return {
    code,
    found: true,
    usage_tier: record.usage_tier,
    maker: record.maker,
    model: record.model,
    sub_model: record.sub_model,
    powertrain: record.powertrain,
    trim: record.trim,
    fuel: record.fuel,
    drivetrain: record.drivetrain,
    seats: record.seats,
    battery_kwh: record.battery_kwh,
  };
};

// 현재 마스터의 trim_aliases에는 과거 호환 때문에 모델·파워트레인·구동·인승
// 별칭도 함께 들어 있다. 동적 트림 증거에는 세부트림 정본만 사용해 `AWD`나
// `G80`을 트림으로 오인하지 않는다. 영/한글 공식 동치어는 위 제한 사전으로만 읽는다.
const masterTrimLabels = (record: VehicleTrimMasterRecord) => [record.trim]
  .map(S)
  .filter((value) => value && !/세부등급\s*없음/.test(value));

/**
 * 제한 사전에 없던 트림도 마스터에 등록된 완전명/별칭이 공급사 차명에 직접 적힌
 * 경우만 읽는다. 후보가 둘 이상 잡히거나, 짧은 트림이 다른 후보의 긴 트림 접두어면
 * 아무것도 고르지 않는다. 후보 수가 우연히 1개라는 이유만으로는 호출하지 않는다.
 */
const explicitlyAttestedCandidates = (
  evidence: string,
  candidates: VehicleTrimMasterRecord[],
): { records: VehicleTrimMasterRecord[]; labels: string[] } | null => {
  const labels = explicitMasterTrimSignals(evidence, candidates.flatMap(masterTrimLabels));
  if (!labels.length) return null;
  const canonicalLabels = new Set(labels.map(canonicalVehicleTrimSignal));
  const records = candidates.filter((record) => masterTrimLabels(record)
    .some((label) => canonicalLabels.has(canonicalVehicleTrimSignal(label))));
  return records.length ? { records, labels } : null;
};

const reviewedTrimAliasCandidate = (
  evidence: string,
  maker: string,
  model: string,
  candidates: VehicleTrimMasterRecord[],
): { record: VehicleTrimMasterRecord; from: string; to: string } | null => {
  const rules = (aliasBook.rules || []).filter((rule) => S(rule.kind) === 'trim'
    && rule.reviewed === true
    && S(rule.maker) === maker
    && S(rule.model) === model
    && hasBoundedVehiclePhrase(evidence, S(rule.from)));
  if (rules.length !== 1) return null;
  const rule = rules[0];
  const matches = candidates.filter((record) => compact(record.sub_model) === compact(rule.sub_model)
    && vehicleTrimSignalMatches(S(rule.to), record.trim, record.trim_aliases));
  return matches.length === 1 ? { record: matches[0], from: S(rule.from), to: S(rule.to) } : null;
};

const directCurrentConflicts = (record: VehicleTrimMasterRecord, signals: Rec): string[] => {
  const conflicts: string[] = [];
  const fuel = S(signals._audit_fuel);
  const cc = numeric(signals._audit_cc);
  const drive = S(signals._audit_drive);
  const seats = numeric(signals._audit_seats);
  const month = S(signals._audit_registration_month);
  if (fuel && normFuel(record.fuel) !== normFuel(fuel)) conflicts.push(`연료:${record.fuel}/${fuel}`);
  if (cc && (record.engine_cc == null || Math.abs(record.engine_cc - cc) > 50)) {
    conflicts.push(`배기량:${record.engine_cc ?? '공란'}/${cc}`);
  }
  if (drive && normDrive(record.drivetrain) !== normDrive(drive)) conflicts.push(`구동:${record.drivetrain}/${drive}`);
  if (seats && record.seats !== seats) conflicts.push(`인승:${record.seats ?? '공란'}/${seats}`);
  if (month) {
    const start = S(record.production_start);
    const end = S(record.production_end);
    // 최초등록은 재고차·수입 인증 지연으로 생산종료 뒤일 수 있다. 생산 시작 전
    // 등록만 물리적으로 불가능한 충돌이며, 종료 뒤 등록은 검수 힌트일 뿐 차단축이 아니다.
    if (start && month < start) {
      conflicts.push(`생산기간:${start}~${end}/${month}`);
    }
  }
  return conflicts;
};

const candidatesFor = (signals: Rec) => {
  const snap = snapToMaster(signals as never, generations);
  if (!snap) return { snap: null, candidates: [] as VehicleTrimMasterRecord[] };
  // 부분변경·연식변경은 별도 master_id로 발급된다. 세대 점수기가 고른 한 master_id만
  // 보면 형제 계보가 사라져 거짓 단일후보가 되므로 maker/model 전체에서 좁힌다.
  let candidates = trimArtifact.records.filter((record) => record.maker === snap.maker
    && record.model === snap.model && record.usage_tier !== 'blocked');
  const refine = (predicate: (record: VehicleTrimMasterRecord) => boolean) => {
    candidates = candidates.filter(predicate);
  };
  // 후보가 다시 자기 자신의 축을 신호로 공급하는 순환판정을 막는다. 후보
  // 협소화에는 공급사 원문에서 직접 읽힌 audit 원자만 사용한다.
  const fuelSignal = S(signals._audit_fuel);
  const ccSignal = numeric(signals._audit_cc);
  const driveSignal = S(signals._audit_drive);
  const seatSignal = numeric(signals._audit_seats);
  let trimSignal = S(signals._audit_trim);
  const statedYearSignal = numeric(signals._audit_stated_year);
  const generationCodes = Array.isArray(signals._audit_generation_codes)
    ? signals._audit_generation_codes.map(S).filter(Boolean) : [];
  const monthSignal = S(signals._audit_registration_month);
  const supplierEvidence = S(signals._audit_supplier_evidence);
  if (fuelSignal) refine((record) => normFuel(record.fuel) === normFuel(fuelSignal));
  if (ccSignal) refine((record) => record.engine_cc != null && Math.abs(record.engine_cc - ccSignal) <= 50);
  if (driveSignal) refine((record) => normDrive(record.drivetrain) === normDrive(driveSignal));
  if (seatSignal) refine((record) => record.seats === seatSignal);
  if (monthSignal) refine((record) => {
    const start = S(record.production_start);
    const end = S(record.production_end);
    // 신규 자동배정은 보수적으로 생산월 범위 안에서만 허용한다. 종료 뒤 등록된
    // 재고차 가능성은 사람이 확인할 수 있지만 다른 부분변경 계보와 섞일 수 있다.
    return (!start || start <= monthSignal) && (!end || end === '현재' || monthSignal <= end);
  });
  if (statedYearSignal) refine((record) => {
    const start = Number(S(record.model_year_start).slice(0, 4));
    const end = record.model_year_end === '현재' ? 9999 : Number(S(record.model_year_end).slice(0, 4));
    return (!start || start <= statedYearSignal) && (!end || statedYearSignal <= end);
  });
  if (generationCodes.length) {
    // 신호 추출기는 `G80`, `SM`, 숫자 조각처럼 개발코드가 아닌 토큰도 함께
    // 반환할 수 있다. 해당 maker/model 마스터에 실제 존재하는 개발코드와의
    // 교집합만 신뢰해, 모델명 토큰 때문에 모든 후보가 사라지는 거짓 음성을 막는다.
    const recognizedGenerationCodes = recognizedDevelopmentCodes(
      generationCodes,
      candidates.map((record) => record.development_code),
    );
    if (recognizedGenerationCodes.length) {
      refine((record) => recognizedGenerationCodes.includes(S(record.development_code).toUpperCase()));
    }
  }
  const rangeClass = vehicleRangeClass(supplierEvidence);
  if (rangeClass && candidates.some((record) => vehicleRangeClass(`${record.sub_model} ${record.powertrain}`) === rangeClass)) {
    refine((record) => vehicleRangeClass(`${record.sub_model} ${record.powertrain}`) === rangeClass);
  }
  const bodyForm = vehicleBodyForm(supplierEvidence);
  if (bodyForm && candidates.some((record) => vehicleBodyForm(`${record.sub_model} ${record.powertrain} ${record.trim}`) === bodyForm)) {
    refine((record) => vehicleBodyForm(`${record.sub_model} ${record.powertrain} ${record.trim}`) === bodyForm);
  } else if (!bodyForm && candidates.some((record) => vehicleBodyForm(record.sub_model) === 'coupe')
    && candidates.some((record) => vehicleBodyForm(record.sub_model) !== 'coupe')) {
    // 상세 차명에 기본 모델·파워트레인·트림/인승까지 적혔는데 `쿠페`가 없으면
    // 같은 모델의 쿠페 파생형을 기본형 후보로 남기지 않는다.
    const detailed = Boolean(seatSignal || trimSignal || explicitSupplierTrimSignal(supplierEvidence))
      && Boolean(fuelSignal || ccSignal || driveSignal);
    if (detailed) refine((record) => vehicleBodyForm(record.sub_model) !== 'coupe');
  }
  if (!trimSignal && !(Array.isArray(signals._audit_conflicts) && signals._audit_conflicts.length)) {
    const reviewedAlias = reviewedTrimAliasCandidate(supplierEvidence, snap.maker, snap.model, candidates);
    if (reviewedAlias) {
      trimSignal = reviewedAlias.to;
      signals._audit_trim_evidence = `${reviewedAlias.from} → ${reviewedAlias.to} (reviewed alias)`;
      refine((record) => record.trim_row_key === reviewedAlias.record.trim_row_key);
    } else {
      const attested = explicitlyAttestedCandidates(S(signals._audit_supplier_evidence), candidates);
      if (attested) {
      signals._audit_trim_evidence = attested.labels.join(' | ');
      const keys = new Set(attested.records.map((record) => record.trim_row_key));
      refine((record) => keys.has(record.trim_row_key));
      }
    }
  }
  // powertrain 표기는 세대 마스터와 행 마스터 사이에 `1.6T`/`1.6 터보`,
  // `AWD`/`4WD`처럼 형식 차이가 있다. 위의 연료·cc·구동·인승 원자 비교를
  // 통과한 뒤 문자열 전체가 같지 않다는 이유로 후보를 버리지 않는다.
  if (trimSignal) {
    refine((record) => vehicleTrimSignalMatches(trimSignal, record.trim, record.trim_aliases));
  }
  return { snap, candidates };
};

type AuditRow = {
  row: number; car_number: string; provider: string; verification: string; reason: string;
  current_code: string; current_tier: string; category: string; candidate_keys: string[];
  snap_confidence: string; supplier_vehicle_name: string;
  signal_conflicts: string[];
  signal_warnings: string[];
  current_axis_conflict: boolean;
  audit_axes: Record<string, unknown>;
  source_clues: Record<string, unknown>;
  source_code_clue: Record<string, unknown> | null;
  candidate_differences: Record<string, string[]>;
  candidate_profiles: Array<Record<string, unknown>>;
  source_fingerprint: string;
  snap_maker: string; snap_model: string; snap_sub_model: string;
};
const audited: AuditRow[] = [];
for (let offset = 1; offset < values.length; offset += 1) {
  const source = values[offset] || [];
  const carNumber = plate(at(source, '차량번호'));
  if (!carNumber) continue;
  const currentCode = at(source, '차종코드');
  const current = trimByKey.get(currentCode);
  let category = '';
  let candidates: VehicleTrimMasterRecord[] = [];
  let snapConfidence = '';
  const signals = rowSignals(source);
  const clues = (signals._audit_source_clues || {}) as Rec;
  const signalConflicts = Array.isArray(signals._audit_conflicts) ? signals._audit_conflicts.map(S) : [];
  const signalWarnings = Array.isArray(signals._audit_warnings) ? signals._audit_warnings.map(S) : [];
  let currentAxisConflict = false;
  const strictMatched = candidatesFor(signals);
  if (currentCode && !current) category = '존재하지 않는 키 참조';
  else if (current?.usage_tier === 'blocked') {
    const matched = candidatesFor(signals);
    candidates = matched.candidates;
    snapConfidence = matched.snap?.confidence || '';
    const automatic = candidates.filter((candidate) => candidate.usage_tier === 'automatic');
    if (automatic.length === 1 && snapConfidence === 'high') category = '차단키→단일자동후보';
    else if (automatic.length > 1) category = '차단키→다중자동후보';
    else if (candidates.length) category = '차단키→수동후보';
    else category = '차단키→안전 후보 없음';
  }
  else if (current?.usage_tier === 'automatic') {
    candidates = strictMatched.candidates;
    snapConfidence = strictMatched.snap?.confidence || '';
    const currentConflicts = directCurrentConflicts(current, signals);
    const currentSupportedByDirectEvidence = candidates.some((candidate) => candidate.trim_row_key === currentCode);
    currentAxisConflict = currentConflicts.length > 0;
    category = currentConflicts.length ? '확정 코드 명시축 불일치'
      : !currentSupportedByDirectEvidence ? '확정 코드 직접근거 재확인'
        : '확정 코드 정상';
    signalConflicts.push(...currentConflicts);
    if (!currentConflicts.length && !currentSupportedByDirectEvidence) {
      signalWarnings.push('현재 차종코드가 supplier-direct 후보집합에 없음');
    }
  }
  else if (current?.usage_tier === 'manual') category = '수동 코드 검수필요';
  else {
    const matched = candidatesFor(signals);
    candidates = matched.candidates;
    snapConfidence = matched.snap?.confidence || '';
    const automatic = candidates.filter((candidate) => candidate.usage_tier === 'automatic');
    const hasGenerationBoundary = !!signals._audit_generation_signal || !!signals._audit_registration_month || !!signals._audit_year;
    if (signalConflicts.length) category = '원천 입력 충돌';
    else if (automatic.length === 1 && snapConfidence === 'high' && hasGenerationBoundary) category = '단일 자동후보(승인대기)';
    else if (automatic.length > 1) category = '다중 자동후보';
    else if (candidates.length) category = '수동후보 있음';
    else category = '안전 후보 없음';
  }
  audited.push({
    row: offset + 1,
    car_number: carNumber,
    provider: at(source, '공급사코드') || at(source, '공급사명'),
    verification: at(source, '검증상태'),
    reason: at(source, '검수사유'),
    current_code: currentCode,
    current_tier: current?.usage_tier || '',
    category,
    candidate_keys: candidates.map((candidate) => candidate.trim_row_key),
    snap_confidence: snapConfidence,
    supplier_vehicle_name: at(source, '공급사 입력 차명'),
    signal_conflicts: signalConflicts,
    signal_warnings: signalWarnings,
    current_axis_conflict: currentAxisConflict,
    audit_axes: {
      fuel: signals._audit_fuel, engine_cc: signals._audit_cc, drive: signals._audit_drive,
      seats: signals._audit_seats, trim: signals._audit_trim, year: signals._audit_year,
      trim_evidence: signals._audit_trim_evidence,
      stated_year: signals._audit_stated_year,
      generation_codes: signals._audit_generation_codes,
      registration_month: signals._audit_registration_month,
      generation_signal: signals._audit_generation_signal,
    },
    source_clues: clues,
    source_code_clue: sourceCodeClue(clues),
    candidate_differences: candidateDifferences(candidates),
    candidate_profiles: candidates.map((candidate) => ({
      key: candidate.trim_row_key,
      sub_model: candidate.sub_model,
      powertrain: candidate.powertrain,
      trim: candidate.trim,
      fuel: candidate.fuel,
      engine_cc: candidate.engine_cc,
      drivetrain: candidate.drivetrain,
      seats: candidate.seats,
      battery_kwh: candidate.battery_kwh,
      production_start: candidate.production_start,
      production_end: candidate.production_end,
    })),
    source_fingerprint: productCoverageRowFingerprint(source, PRODUCT_MASTER_COLUMNS.length),
    snap_maker: S(strictMatched.snap?.maker),
    snap_model: S(strictMatched.snap?.model),
    snap_sub_model: S(strictMatched.snap?.sub_model),
  });
}

const counts = Object.fromEntries([...audited.reduce((map, row) => {
  map.set(row.category, (map.get(row.category) || 0) + 1);
  return map;
}, new Map<string, number>())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
const report = {
  report_type: 'product_master_vehicle_coverage_v2_supplier_direct_evidence',
  generated_at: new Date().toISOString(),
  source: {
    sheet_id: sheetId,
    tab: PRODUCT_MASTER_TAB,
    rows: audited.length,
    mode: sourceMode,
    evidence_scope: 'supplier_direct_prefix_only',
    sheet_fingerprint: productCoverageSheetFingerprint(values.slice(1), PRODUCT_MASTER_COLUMNS.length),
  },
  master: {
    trim_rows: trimArtifact.row_count,
    data_as_of: trimArtifact.data_as_of,
    artifact_sha256: createHash('sha256').update(trimArtifactRaw).digest('hex'),
  },
  counts,
  gates: {
    no_safe_candidate: audited.filter((row) => row.category === '안전 후보 없음').length,
    multiple_automatic_candidates: audited.filter((row) => row.category === '다중 자동후보').length,
    blocked_key_references: audited.filter((row) => row.current_tier === 'blocked').length,
    existing_axis_conflicts: audited.filter((row) => row.current_axis_conflict).length,
    nonexistent_key_references: audited.filter((row) => row.category === '존재하지 않는 키 참조').length,
  },
  patch_candidates: audited.filter((row) => (
    row.category === '단일 자동후보(승인대기)' || row.category === '차단키→단일자동후보'
  )).map((row) => ({
    row: row.row,
    car_number: row.car_number,
    expected_current_code: row.current_code,
    expected_verification: row.verification,
    expected_source_fingerprint: row.source_fingerprint,
    replacement_code: row.candidate_keys[0],
    decision: row.signal_conflicts.length ? 'CONFLICT' : 'SAFE_CANDIDATE',
    conflicts: row.signal_conflicts,
  })),
  rows: audited,
};
mkdirSync(dirname(outputPath), { recursive: true });
const reportPath = productCoverageReportPath(outputPath, sourceMode);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ...report, rows: undefined, detail_path: reportPath }, null, 2));
process.exit(
  report.gates.blocked_key_references
  || report.gates.nonexistent_key_references
  || report.gates.existing_axis_conflicts
    ? 1 : 0,
);
