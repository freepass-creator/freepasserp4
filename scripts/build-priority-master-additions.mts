/** Build the priority vehicle rows missing from the Google Sheet trim master. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildVehicleTrimMasterArtifact, type VehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import {
  trimKeyRecordsFromValues,
  type TrimKeyRegistry,
} from '../lib/domain/vehicle-trim-key-contract';

const SPREADSHEET_ID = '1T_RrErmGoj_yG9S1u7n--2NDolTOw8wA8ROQjPWuAlg';
const SHEET_NAME = '차종마스터';
const START_ROW = 4288;
const DATA_AS_OF = '2026-08-15';

export const PRIORITY_MASTER_HEADERS = [
  '관리상태', '검증상태', '신차/중고차', '원산지', '제조사', '모델', '세부모델', '파워트레인', '세부트림',
  '트림행키', '마스터ID', '파워트레인순번', '트림순번', '세대명', '개발코드', '생산시작', '생산종료',
  '연식시작', '연식종료', '연료', '정확배기량(cc)', '표시배기량(L)', '터보', '구동방식', '인승',
  '배터리(kWh)', '트림별칭', '근거URL', '근거메모', '데이터기준일',
] as const;

type Cell = string | number;
type Variant = {
  origin: '국산' | '수입';
  maker: string;
  model: string;
  subModel: string;
  masterId: string;
  powertrainSeq: number;
  powertrain: string;
  trims: string[];
  generation?: string;
  developmentCode: string;
  productionStart: string;
  productionEnd: string;
  modelYearStart: string;
  modelYearEnd: string;
  fuel: string;
  engineCc?: number;
  displacementL?: number;
  turbo: '예' | '아니오';
  drivetrain: string;
  seats: number;
  batteryKwh?: number;
  marketStatus: '신차' | '중고차';
  evidenceUrl: string;
  evidenceNote: string;
};

const rows: Cell[][] = [];
const pad = (value: number) => String(value).padStart(2, '0');

function addVariant(variant: Variant) {
  variant.trims.forEach((trim, index) => {
    const trimSeq = index + 1;
    const code = `${variant.masterId}::v${pad(variant.powertrainSeq)}::t${pad(trimSeq)}`;
    rows.push([
      '검증중', '1차확인', variant.marketStatus, variant.origin, variant.maker, variant.model, variant.subModel,
      variant.powertrain, trim, code, variant.masterId, variant.powertrainSeq, trimSeq, variant.generation || '',
      variant.developmentCode, variant.productionStart, variant.productionEnd, variant.modelYearStart, variant.modelYearEnd,
      variant.fuel, variant.engineCc ?? '', variant.displacementL ?? '', variant.turbo, variant.drivetrain, variant.seats,
      variant.batteryKwh ?? '', '', variant.evidenceUrl, variant.evidenceNote, DATA_AS_OF,
    ]);
  });
}

// Hyundai Santa Fe MX5 — current core trims, split by engine, drivetrain, and seating.
const santaFeGasUrl = 'https://www.hyundai.com/contents/repn-car/catalog/santafe-2026-price.pdf';
const santaFeHevUrl = 'https://www.hyundai.com/contents/repn-car/catalog/santafe-hev-2026-price.pdf';
const santaFeTrims = ['익스클루시브', '프레스티지', 'H-Pick', '캘리그래피'];
let santaFeSeq = 0;
for (const spec of [
  { fuel: '가솔린', power: '가솔린 2.5T', cc: 2497, l: 2.5, url: santaFeGasUrl },
  { fuel: '하이브리드', power: '하이브리드 1.6T', cc: 1598, l: 1.6, url: santaFeHevUrl },
]) {
  for (const drive of ['2WD', '4WD']) {
    for (const seats of [5, 6, 7]) {
      addVariant({
        origin: '국산', maker: '현대', model: '싼타페', subModel: '디 올 뉴 싼타페 MX5',
        masterId: 'mf-001.md-017.sm-mx5', powertrainSeq: ++santaFeSeq,
        powertrain: `${spec.power} ${drive} ${seats}인승`, trims: santaFeTrims,
        generation: '5세대', developmentCode: 'MX5', productionStart: '2023-08', productionEnd: '현재',
        modelYearStart: '2023', modelYearEnd: '현재', fuel: spec.fuel, engineCc: spec.cc, displacementL: spec.l,
        turbo: '예', drivetrain: drive, seats, marketStatus: '신차', evidenceUrl: spec.url,
        evidenceNote: `현대 2026 싼타페 공식 가격표 기준 ${spec.power}·${drive}·${seats}인승·핵심 트림 1차 확인`,
      });
    }
  }
}

// Hyundai IONIQ 6 — split by generation, battery, and drivetrain.
const ioniqCurrentUrl = 'https://www.hyundai.com/contents/repn-car/catalog/ioniq6-pe_price.pdf';
const ioniqOldUrl = 'https://www.hyundai.com/contents/repn-car/catalog/ioniq6-catalog.pdf';
const addIoniq = (config: {
  subModel: string; masterId: string; seq: number; powertrain: string; trims: string[]; start: string; end: string;
  yearStart: string; yearEnd: string; battery: number; drive: string; market: '신차' | '중고차'; url: string;
}) => addVariant({
  origin: '국산', maker: '현대', model: '아이오닉6', subModel: config.subModel, masterId: config.masterId,
  powertrainSeq: config.seq, powertrain: config.powertrain, trims: config.trims, generation: '1세대', developmentCode: 'CE',
  productionStart: config.start, productionEnd: config.end, modelYearStart: config.yearStart, modelYearEnd: config.yearEnd,
  fuel: '전기', turbo: '아니오', drivetrain: config.drive, seats: 5, batteryKwh: config.battery,
  marketStatus: config.market, evidenceUrl: config.url,
  evidenceNote: `현대 공식 가격표·카탈로그 기준 ${config.battery}kWh·${config.drive}·트림 1차 확인`,
});
addIoniq({ subModel: '더 뉴 아이오닉6 CE', masterId: 'mf-001.md-063.sm-더-뉴-아이오닉6', seq: 1,
  powertrain: '전기 63.0kWh 2WD', trims: ['E-Value+', '익스클루시브', '프레스티지'], start: '2025-05', end: '현재',
  yearStart: '2025', yearEnd: '현재', battery: 63, drive: '2WD', market: '신차', url: ioniqCurrentUrl });
addIoniq({ subModel: '더 뉴 아이오닉6 CE', masterId: 'mf-001.md-063.sm-더-뉴-아이오닉6', seq: 2,
  powertrain: '전기 84.0kWh 2WD', trims: ['E-Lite', '익스클루시브', 'N Line', '프레스티지'], start: '2025-05', end: '현재',
  yearStart: '2025', yearEnd: '현재', battery: 84, drive: '2WD', market: '신차', url: ioniqCurrentUrl });
addIoniq({ subModel: '더 뉴 아이오닉6 CE', masterId: 'mf-001.md-063.sm-더-뉴-아이오닉6', seq: 3,
  powertrain: '전기 84.0kWh AWD', trims: ['익스클루시브', 'N Line', '프레스티지'], start: '2025-05', end: '현재',
  yearStart: '2025', yearEnd: '현재', battery: 84, drive: 'AWD', market: '신차', url: ioniqCurrentUrl });
addIoniq({ subModel: '아이오닉6', masterId: 'mf-001.md-063.sm-아이오닉6', seq: 1,
  powertrain: '전기 53.0kWh 2WD', trims: ['E-Lite'], start: '2022-09', end: '2025-04',
  yearStart: '2022', yearEnd: '2025', battery: 53, drive: '2WD', market: '중고차', url: ioniqOldUrl });
addIoniq({ subModel: '아이오닉6', masterId: 'mf-001.md-063.sm-아이오닉6', seq: 2,
  powertrain: '전기 77.4kWh 2WD', trims: ['E-Lite', '익스클루시브', '익스클루시브 플러스', '프레스티지'], start: '2022-09', end: '2025-04',
  yearStart: '2022', yearEnd: '2025', battery: 77.4, drive: '2WD', market: '중고차', url: ioniqOldUrl });
addIoniq({ subModel: '아이오닉6', masterId: 'mf-001.md-063.sm-아이오닉6', seq: 3,
  powertrain: '전기 77.4kWh AWD', trims: ['익스클루시브', '익스클루시브 플러스', '프레스티지'], start: '2022-09', end: '2025-04',
  yearStart: '2022', yearEnd: '2025', battery: 77.4, drive: 'AWD', market: '중고차', url: ioniqOldUrl });

// Renault Korea Grand Koleos — official May 2026 price/spec sheet.
const koleosUrl = 'https://cdn.renault.co.kr/upload/asset/price/price_koleos_202605.pdf';
for (const variant of [
  { seq: 1, power: '하이브리드 1.5T 2WD', trims: ['테크노', '아이코닉', '에스프리 알핀', '에스카파드'], fuel: '하이브리드', cc: 1499, l: 1.5, drive: '2WD' },
  { seq: 2, power: '가솔린 2.0T 4WD', trims: ['아이코닉', '에스프리 알핀'], fuel: '가솔린', cc: 1969, l: 2.0, drive: '4WD' },
  { seq: 3, power: '가솔린 2.0T 2WD', trims: ['테크노', '아이코닉', '에스프리 알핀'], fuel: '가솔린', cc: 1969, l: 2.0, drive: '2WD' },
]) {
  addVariant({
    origin: '국산', maker: '르노코리아', model: '그랑 콜레오스', subModel: '그랑 콜레오스',
    masterId: 'mf-005.md-019.sm-그랑-콜레오스', powertrainSeq: variant.seq, powertrain: variant.power,
    trims: variant.trims, generation: '1세대', developmentCode: 'Aurora 1', productionStart: '2024-09', productionEnd: '현재',
    modelYearStart: '2024', modelYearEnd: '현재', fuel: variant.fuel, engineCc: variant.cc, displacementL: variant.l,
    turbo: '예', drivetrain: variant.drive, seats: 5, marketStatus: '신차', evidenceUrl: koleosUrl,
    evidenceNote: `르노코리아 2026-05 공식 가격표·제원 기준 ${variant.power}·트림 1차 확인`,
  });
}

// Mercedes-Benz S-Class W223 — current Korean lineup.
const sClassCurrentUrl = 'https://www.mercedes-benz.co.kr/passengercars/brand/news-events/news-story/2025/news-20250826.html';
const w223Base = {
  origin: '수입' as const, maker: '벤츠', model: 'S-클래스', subModel: 'S-클래스 W223',
  masterId: 'mf-013.md-005.sm-w223', generation: '7세대', developmentCode: 'W223', productionStart: '2021-04',
  productionEnd: '현재', modelYearStart: '2021', modelYearEnd: '현재', marketStatus: '신차' as const,
  evidenceUrl: sClassCurrentUrl,
};
for (const variant of [
  { seq: 7, power: '디젤 2.9 4MATIC', trims: ['S350d 4MATIC'], fuel: '디젤', cc: 2925, l: 2.9, seats: 5 },
  { seq: 3, power: '가솔린 3.0 4MATIC', trims: ['S450 4MATIC', 'S500 4MATIC'], fuel: '가솔린', cc: 2999, l: 3.0, seats: 5 },
  { seq: 4, power: '가솔린 4.0 4MATIC', trims: ['S580 4MATIC', '마이바흐 S580 4MATIC'], fuel: '가솔린', cc: 3982, l: 4.0, seats: 5 },
  { seq: 5, power: '가솔린 6.0 4MATIC', trims: ['마이바흐 S680 4MATIC'], fuel: '가솔린', cc: 5980, l: 6.0, seats: 4 },
]) {
  addVariant({ ...w223Base, powertrainSeq: variant.seq, powertrain: variant.power, trims: variant.trims,
    fuel: variant.fuel, engineCc: variant.cc, displacementL: variant.l, turbo: '예', drivetrain: '4MATIC', seats: variant.seats,
    evidenceNote: `메르세데스-벤츠 코리아 S-Class 공식 라인업·기술자료 기준 ${variant.power}·트림 1차 확인` });
}

// Mercedes-Benz S-Class W222 — retained as a used-car generation for current inventory matching.
const w222Url = 'https://www.mercedes-benz.co.kr/passengercars/brand/news-events/news-story/2022/news-20221221.html';
const w222Variants = [
  { seq: 1, power: '가솔린 3.0 4MATIC', trims: ['S400 쿠페'], fuel: '가솔린', cc: 2996, l: 3.0, drive: '4MATIC', seats: 4 },
  { seq: 2, power: '가솔린 6.0 2WD', trims: ['S65 AMG', '마이바흐 S600', '마이바흐 S650'], fuel: '가솔린', cc: 5980, l: 6.0, drive: '2WD', seats: 5 },
  { seq: 3, power: '디젤 3.0 4MATIC', trims: ['S350 BlueTEC', 'S350L BlueTEC'], fuel: '디젤', cc: 2987, l: 3.0, drive: '4MATIC', seats: 5 },
  { seq: 4, power: '가솔린 4.7 4MATIC', trims: ['S500L'], fuel: '가솔린', cc: 4663, l: 4.7, drive: '4MATIC', seats: 4 },
  { seq: 5, power: '가솔린 4.7 2WD', trims: ['S500L', '마이바흐 S500'], fuel: '가솔린', cc: 4663, l: 4.7, drive: '2WD', seats: 5 },
  { seq: 6, power: '가솔린 4.0 4MATIC', trims: ['S560L', 'S63 AMG 4MATIC+', '마이바흐 S560'], fuel: '가솔린', cc: 3982, l: 4.0, drive: '4MATIC', seats: 5 },
  { seq: 8, power: '가솔린 3.0 4MATIC', trims: ['S400L', 'S450L'], fuel: '가솔린', cc: 2996, l: 3.0, drive: '4MATIC', seats: 5 },
  { seq: 10, power: '플러그인 하이브리드 3.0 2WD', trims: ['S560e L'], fuel: '플러그인 하이브리드', cc: 2996, l: 3.0, drive: '2WD', seats: 5 },
  { seq: 11, power: '디젤 2.9 4MATIC', trims: ['S350d AMG Line', 'S400Ld'], fuel: '디젤', cc: 2925, l: 2.9, drive: '4MATIC', seats: 5 },
  { seq: 12, power: '가솔린 3.0 2WD', trims: ['S350L', 'S400L', 'S450L'], fuel: '가솔린', cc: 2996, l: 3.0, drive: '2WD', seats: 5 },
  { seq: 13, power: '가솔린 5.5 4MATIC', trims: ['S63 AMG'], fuel: '가솔린', cc: 5461, l: 5.5, drive: '4MATIC', seats: 5 },
  { seq: 14, power: '디젤 3.0 2WD', trims: ['S350 BlueTEC', 'S350L BlueTEC'], fuel: '디젤', cc: 2987, l: 3.0, drive: '2WD', seats: 5 },
  { seq: 15, power: '가솔린 4.7 4MATIC', trims: ['마이바흐 S500'], fuel: '가솔린', cc: 4663, l: 4.7, drive: '4MATIC', seats: 5 },
  { seq: 16, power: '디젤 2.9 2WD', trims: ['S350d'], fuel: '디젤', cc: 2925, l: 2.9, drive: '2WD', seats: 5 },
  { seq: 17, power: '가솔린 6.0 2WD 6인승', trims: ['마이바흐 S650 풀만'], fuel: '가솔린', cc: 5980, l: 6.0, drive: '2WD', seats: 6 },
  { seq: 18, power: '가솔린 5.5 4MATIC 4인승', trims: ['S63 AMG 쿠페'], fuel: '가솔린', cc: 5461, l: 5.5, drive: '4MATIC', seats: 4 },
] as const;
for (const variant of w222Variants) {
  addVariant({
    origin: '수입', maker: '벤츠', model: 'S-클래스', subModel: 'S-클래스 W222',
    masterId: 'mf-013.md-005.sm-w222', powertrainSeq: variant.seq, powertrain: variant.power, trims: [...variant.trims],
    generation: '6세대', developmentCode: 'W222', productionStart: '2013-09', productionEnd: '2021-03',
    modelYearStart: '2013', modelYearEnd: '2021', fuel: variant.fuel, engineCc: variant.cc, displacementL: variant.l,
    turbo: '예', drivetrain: variant.drive, seats: variant.seats, marketStatus: '중고차', evidenceUrl: w222Url,
    evidenceNote: `메르세데스-벤츠 코리아 W222 공식 역사자료·원천 트림 대조 기준 ${variant.power}·트림 1차 확인`,
  });
}

if (rows.length !== 108) throw new Error(`우선 보강행은 108행이어야 합니다: ${rows.length}`);
if (rows.some((row) => row.length !== PRIORITY_MASTER_HEADERS.length)) throw new Error('열 수가 A:AD 30열과 다릅니다.');
const codes = rows.map((row) => String(row[9]));
if (new Set(codes).size !== codes.length) throw new Error('신규 트림행키가 중복됩니다.');

function syncLocal() {
  const artifactPath = fileURLToPath(new URL('../public/data/vehicle-trim-master.json', import.meta.url));
  const registryPath = fileURLToPath(new URL('../data/vehicle-trim-key-registry.json', import.meta.url));
  const existingArtifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as VehicleTrimMasterArtifact;
  const existingCodes = new Set(existingArtifact.records.map((record) => record.trim_row_key));
  const present = codes.filter((code) => existingCodes.has(code));
  if (present.length && present.length !== codes.length) throw new Error(`일부 신규 코드만 로컬 산출물에 존재합니다: ${present.length}/108`);
  if (!present.length) {
    const addedArtifact = buildVehicleTrimMasterArtifact([PRIORITY_MASTER_HEADERS, ...rows], SPREADSHEET_ID, SHEET_NAME);
    const records = [...existingArtifact.records, ...addedArtifact.records].sort((a, b) => a.trim_row_key.localeCompare(b.trim_row_key));
    const manual = records.filter((record) => record.usage_tier === 'manual').length;
    const automatic = records.filter((record) => record.usage_tier === 'automatic').length;
    const artifact: VehicleTrimMasterArtifact = {
      ...existingArtifact,
      data_as_of: records.map((record) => record.data_as_of).filter(Boolean).sort().at(-1) || '',
      row_count: records.length,
      manual_assignable_count: manual,
      automatic_assignable_count: automatic,
      blocked_count: records.length - manual - automatic,
      records,
    };
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  }

  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as TrimKeyRegistry;
  const registryCodes = new Set(registry.records.map((record) => record.code));
  const registered = codes.filter((code) => registryCodes.has(code));
  if (registered.length && registered.length !== codes.length) throw new Error(`일부 신규 코드만 영구 레지스트리에 존재합니다: ${registered.length}/108`);
  if (!registered.length) {
    const added = trimKeyRecordsFromValues([PRIORITY_MASTER_HEADERS, ...rows]).map((record, index) => ({
      ...record,
      capturedSheetRow: START_ROW + index,
    }));
    registry.capturedAt = DATA_AS_OF;
    registry.records = [...registry.records, ...added].sort((a, b) => a.code.localeCompare(b.code));
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  }
  console.log(`PASS — 로컬 트림마스터·영구 행키 레지스트리 ${rows.length}행 동기화`);
}

function fnv1a64(value: string) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function printRegistryHash() {
  const registryPath = fileURLToPath(new URL('../data/vehicle-trim-key-registry.json', import.meta.url));
  const artifactPath = fileURLToPath(new URL('../public/data/vehicle-trim-master.json', import.meta.url));
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as TrimKeyRegistry;
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as VehicleTrimMasterArtifact;
  const canonical = [...registry.records]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(({ code, masterId, powertrainSeq, trimSeq, semantic }) => [code, masterId, powertrainSeq, trimSeq, semantic]);
  console.log(JSON.stringify({
    registryCount: registry.records.length,
    registryHash: fnv1a64(JSON.stringify(canonical)),
    artifactCount: artifact.row_count,
    manual: artifact.manual_assignable_count,
    automatic: artifact.automatic_assignable_count,
    blocked: artifact.blocked_count,
  }));
}

function syncKnownDuplicateExclusion() {
  const artifactPath = fileURLToPath(new URL('../public/data/vehicle-trim-master.json', import.meta.url));
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as VehicleTrimMasterArtifact;
  const code = 'mf-007.md-002.sm-rg3__g80-rg3::v02::t02';
  const record = artifact.records.find((item) => item.trim_row_key === code);
  if (!record) throw new Error(`중복 제외 대상 코드를 찾지 못했습니다: ${code}`);
  record.management_status = '제외';
  record.usage_tier = 'blocked';
  record.evidence_note = '중복 제외: 동일 차량사양이 행 4071과 완전히 중복되어 신규 코드 후보에서 제외. 원천이 구분되면 기존 코드 의미는 보존하고 별도 행으로 추가.';
  record.data_as_of = DATA_AS_OF;
  artifact.data_as_of = DATA_AS_OF;
  artifact.manual_assignable_count = artifact.records.filter((item) => item.usage_tier === 'manual').length;
  artifact.automatic_assignable_count = artifact.records.filter((item) => item.usage_tier === 'automatic').length;
  artifact.blocked_count = artifact.records.length - artifact.manual_assignable_count - artifact.automatic_assignable_count;
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(`PASS — G80 완전중복 후보 제외 반영: ${code}`);
}

const outputArg = process.argv.find((value) => value.startsWith('--output='))?.slice('--output='.length);
if (process.argv.includes('--sync-local')) syncLocal();
else if (process.argv.includes('--sync-known-duplicate-exclusion')) syncKnownDuplicateExclusion();
else if (process.argv.includes('--registry-hash')) printRegistryHash();
else if (outputArg) {
  writeFileSync(outputArg, JSON.stringify({ startRow: START_ROW, rows }), 'utf8');
  console.log(`PASS — 우선 보강행 JSON ${rows.length}행 생성: ${outputArg}`);
}
else if (process.argv.includes('--summary')) {
  const byModel = Object.entries(rows.reduce<Record<string, number>>((counts, row) => {
    counts[String(row[5])] = (counts[String(row[5])] || 0) + 1;
    return counts;
  }, {}));
  console.log(JSON.stringify({ startRow: START_ROW, endRow: START_ROW + rows.length - 1, count: rows.length, byModel }));
} else {
  console.log(JSON.stringify({ startRow: START_ROW, rows }));
}
