/** Close high-value inventory gaps and normalize the original IONIQ 6 submodel label. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildVehicleTrimMasterArtifact, type VehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import { trimKeyRecordsFromValues, type TrimKeyRegistry } from '../lib/domain/vehicle-trim-key-contract';

const SPREADSHEET_ID = '1T_RrErmGoj_yG9S1u7n--2NDolTOw8wA8ROQjPWuAlg';
const SHEET_NAME = '차종마스터';
const START_ROW = 3233;
const DATA_AS_OF = '2026-08-15';
const IONIQ6_ROWS = [4346, 4347, 4348, 4349, 4350, 4351, 4352, 4353] as const;

const HEADERS = [
  // 라이브 승격 apply 전: 파워트레인 열 포함(A:AD). 제거 후 헤더는 VEHICLE_MASTER_HEADERS_WITHOUT_POWERTRAIN.
  '관리상태', '검증상태', '신차/중고차', '원산지', '제조사', '모델', '세부모델', '파워트레인', '세부트림',
  '트림행키', '마스터ID', '파워트레인순번', '트림순번', '세대명', '개발코드', '생산시작', '생산종료',
  '연식시작', '연식종료', '연료', '정확배기량(cc)', '표시배기량(L)', '터보', '구동방식', '인승',
  '배터리(kWh)', '트림별칭', '근거URL', '근거메모', '데이터기준일',
] as const;

type Cell = string | number;
type Variant = {
  maker: string;
  model: string;
  subModel: string;
  masterId: string;
  powertrainSeq: number;
  powertrain: string;
  trims: string[];
  generation: string;
  developmentCode: string;
  productionStart: string;
  productionEnd?: string;
  modelYearStart: string;
  modelYearEnd?: string;
  fuel: string;
  engineCc?: number;
  displacementL?: number;
  turbo: '예' | '아니오';
  drivetrain: string;
  seats: number;
  batteryKwh?: number;
  marketStatus: '신차' | '중고차';
  origin?: '국산' | '수입';
  evidenceUrl: string;
  evidenceNote: string;
};

const rows: Cell[][] = [];
const pad = (value: number) => String(value).padStart(2, '0');
function addVariant(variant: Variant) {
  variant.trims.forEach((trim, index) => {
    const trimSeq = index + 1;
    rows.push([
      '검증중', '1차확인', variant.marketStatus, variant.origin || '국산', variant.maker, variant.model,
      variant.subModel, variant.powertrain, trim,
      `${variant.masterId}::v${pad(variant.powertrainSeq)}::t${pad(trimSeq)}`,
      variant.masterId, variant.powertrainSeq, trimSeq, variant.generation, variant.developmentCode,
      variant.productionStart, variant.productionEnd || '현재', variant.modelYearStart, variant.modelYearEnd || '현재',
      variant.fuel, variant.engineCc ?? '', variant.displacementL ?? '', variant.turbo, variant.drivetrain,
      variant.seats, variant.batteryKwh ?? '', '', variant.evidenceUrl, variant.evidenceNote, DATA_AS_OF,
    ]);
  });
}

// Pre-facelift EV6: official November 2023 Korean price sheet, retained for real inventory matching.
const ev6Url = 'https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/en_price/en_price_ev6.pdf';
addVariant({
  maker: '기아', model: 'EV6', subModel: 'EV6 CV1', masterId: 'mf-002.md-066.sm-cv1__ev6-cv1',
  powertrainSeq: 1, powertrain: '전기 77.4kWh 4WD', trims: ['라이트', '에어', '어스', 'GT-Line', 'GT'],
  generation: '1세대', developmentCode: 'CV1', productionStart: '2021-08', productionEnd: '2024-05',
  modelYearStart: '2021', modelYearEnd: '2024', fuel: '전기', turbo: '아니오', drivetrain: '4WD', seats: 5,
  batteryKwh: 77.4, marketStatus: '중고차', evidenceUrl: ev6Url,
  evidenceNote: '기아 2023-11 공식 EV6 가격표 기준 77.4kWh·4WD·라이트/에어/어스/GT-Line/GT 1차확인',
});
addVariant({
  maker: '기아', model: 'EV6', subModel: 'EV6 CV1', masterId: 'mf-002.md-066.sm-cv1__ev6-cv1',
  powertrainSeq: 2, powertrain: '전기 77.4kWh 2WD', trims: ['라이트', '에어', '어스', 'GT-Line'],
  generation: '1세대', developmentCode: 'CV1', productionStart: '2021-08', productionEnd: '2024-05',
  modelYearStart: '2021', modelYearEnd: '2024', fuel: '전기', turbo: '아니오', drivetrain: '2WD', seats: 5,
  batteryKwh: 77.4, marketStatus: '중고차', evidenceUrl: ev6Url,
  evidenceNote: '기아 2023-11 공식 EV6 가격표 기준 77.4kWh·2WD·라이트/에어/어스/GT-Line 1차확인',
});

// Renault Arkana: the renamed XM3 is a separate visible model from April 2024 onward.
const arkanaUrl = 'https://cdn.renault.co.kr/upload/asset/price/price_Arkana_202602.pdf';
addVariant({
  maker: '르노코리아', model: '아르카나', subModel: '아르카나', masterId: 'mf-005.md-018.sm-아르카나',
  powertrainSeq: 1, powertrain: '가솔린 1.6 2WD', trims: ['테크노', '아이코닉', '아이코닉 컬러패키지'],
  generation: '1세대', developmentCode: 'LJL', productionStart: '2024-04', modelYearStart: '2024', fuel: '가솔린',
  engineCc: 1598, displacementL: 1.6, turbo: '아니오', drivetrain: '2WD', seats: 5, marketStatus: '신차',
  evidenceUrl: arkanaUrl, evidenceNote: '르노코리아 2026-02 공식 아르카나 가격표 기준 1.6 GTe 트림 1차확인',
});
addVariant({
  maker: '르노코리아', model: '아르카나', subModel: '아르카나', masterId: 'mf-005.md-018.sm-아르카나',
  powertrainSeq: 2, powertrain: '하이브리드 1.6 2WD', trims: ['테크노', '아이코닉', '에스프리 알핀'],
  generation: '1세대', developmentCode: 'LJL', productionStart: '2024-04', modelYearStart: '2024', fuel: '하이브리드',
  engineCc: 1598, displacementL: 1.6, turbo: '아니오', drivetrain: '2WD', seats: 5, marketStatus: '신차',
  evidenceUrl: arkanaUrl, evidenceNote: '르노코리아 2026-02 공식 아르카나 가격표·출시자료 기준 E-Tech 하이브리드 트림 1차확인',
});
addVariant({
  maker: '르노코리아', model: '아르카나', subModel: '아르카나', masterId: 'mf-005.md-018.sm-아르카나',
  powertrainSeq: 3, powertrain: '가솔린 1.3T 2WD', trims: ['테크노', '아이코닉'], generation: '1세대',
  developmentCode: 'LJL', productionStart: '2024-04', productionEnd: '2025-03', modelYearStart: '2024', modelYearEnd: '2025',
  fuel: '가솔린', engineCc: 1332, displacementL: 1.3, turbo: '예', drivetrain: '2WD', seats: 5,
  marketStatus: '중고차', evidenceUrl: arkanaUrl,
  evidenceNote: '르노코리아 아르카나 공식 가격자료 계보 기준 TCe 260 1.3T 단종형 트림 1차확인',
});

// Kia PV5: body and battery combinations are separate master identities.
const pv5PassengerUrl = 'https://www.kia.com/kr/vehicles/pv5-passenger/specification';
addVariant({
  maker: '기아', model: 'PV5', subModel: 'PV5 패신저', masterId: 'mf-002.md-073.sm-pv5__passenger',
  powertrainSeq: 1, powertrain: '전기 71.2kWh 2WD 5인승', trims: ['베이직 2-3-0', '베이직 2-2-3', '베이직 1-2-2'],
  generation: '1세대', developmentCode: 'SW', productionStart: '2025-07', modelYearStart: '2025', fuel: '전기',
  turbo: '아니오', drivetrain: '2WD', seats: 5, batteryKwh: 71.2, marketStatus: '신차',
  evidenceUrl: pv5PassengerUrl, evidenceNote: '기아 2027 PV5 패신저 공식 가격·제원 기준 71.2kWh·5인승 시트 구성 1차확인',
});

const pv5CargoUrl = 'https://www.kia.com/kr/vehicles/pv5-cargo/specification';
for (const spec of [
  { seq: 1, battery: 51.5, label: '스탠다드' },
  { seq: 2, battery: 71.2, label: '롱레인지' },
]) {
  addVariant({
    maker: '기아', model: 'PV5', subModel: 'PV5 카고', masterId: 'mf-002.md-073.sm-pv5__cargo',
    powertrainSeq: spec.seq, powertrain: `전기 ${spec.battery}kWh 2WD 2인승`,
    trims: [`베이직 ${spec.label} 3도어`, `베이직 ${spec.label} 4도어`], generation: '1세대', developmentCode: 'SW',
    productionStart: '2025-07', modelYearStart: '2025', fuel: '전기', turbo: '아니오', drivetrain: '2WD', seats: 2,
    batteryKwh: spec.battery, marketStatus: '신차', evidenceUrl: pv5CargoUrl,
    evidenceNote: `기아 PV5 카고 공식 제원 기준 ${spec.battery}kWh·3/4도어·2인승 1차확인`,
  });
}

const pv5OpenUrl = 'https://www.kia.com/kr/vehicles/pv5-openbed/specification';
for (const spec of [{ seq: 1, battery: 51.5, label: '스탠다드' }, { seq: 2, battery: 71.2, label: '롱레인지' }]) {
  addVariant({
    maker: '기아', model: 'PV5', subModel: 'PV5 오픈베드', masterId: 'mf-002.md-073.sm-pv5__openbed',
    powertrainSeq: spec.seq, powertrain: `전기 ${spec.battery}kWh 2WD 2인승`, trims: [`베이직 ${spec.label}`],
    generation: '1세대', developmentCode: 'SW', productionStart: '2026-07', modelYearStart: '2027', fuel: '전기',
    turbo: '아니오', drivetrain: '2WD', seats: 2, batteryKwh: spec.battery, marketStatus: '신차',
    evidenceUrl: pv5OpenUrl, evidenceNote: `기아 PV5 오픈베드 공식 제원 기준 ${spec.battery}kWh·2인승 1차확인`,
  });
}
addVariant({
  maker: '기아', model: 'PV5', subModel: 'PV5 WAV', masterId: 'mf-002.md-073.sm-pv5__wav',
  powertrainSeq: 1, powertrain: '전기 71.2kWh 2WD', trims: ['베이직'], generation: '1세대', developmentCode: 'SW',
  productionStart: '2026-01', modelYearStart: '2026', fuel: '전기', turbo: '아니오', drivetrain: '2WD', seats: 5,
  batteryKwh: 71.2, marketStatus: '신차', evidenceUrl: 'https://www.kia.com/kr/vehicles/pv5-wav/specification',
  evidenceNote: '기아 PV5 WAV 공식 제원 기준 71.2kWh·교통약자형 1차확인',
});

const polestarUrl = 'https://www.polestar.com/kr/polestar-2/specifications';
for (const spec of [
  { seq: 1, battery: 69, drive: '2WD', trim: 'Standard range Single motor' },
  { seq: 2, battery: 78, drive: '2WD', trim: 'Long range Single motor' },
  { seq: 3, battery: 78, drive: 'AWD', trim: 'Long range Dual motor' },
]) {
  addVariant({
    maker: '폴스타', model: '폴스타 2', subModel: '폴스타 2', masterId: 'mf-089.md-001.sm-폴스타-2',
    powertrainSeq: spec.seq, powertrain: `전기 ${spec.battery}kWh ${spec.drive}`, trims: [spec.trim],
    generation: '1세대', developmentCode: 'P2', productionStart: '2024-10', modelYearStart: '2025', fuel: '전기',
    turbo: '아니오', drivetrain: spec.drive, seats: 5, batteryKwh: spec.battery, marketStatus: '신차', origin: '수입',
    evidenceUrl: polestarUrl, evidenceNote: `폴스타 코리아 공식 Polestar 2 제원 기준 ${spec.trim} 1차확인`,
  });
}

const boltRepairRow: Cell[] = [
  '검증중', '1차확인', '중고차', '국산', '쉐보레', '볼트 EUV', '볼트 EUV', '전기 66.0kWh 2WD', '프리미어',
  'mf-003.md-056.sm-볼트-euv::v01::t02', 'mf-003.md-056.sm-볼트-euv', 1, 2, '1세대', 'BOLT EUV',
  '2021-06', '2023-12', '2022', '2023', '전기', '', '', '아니오', '2WD', 5, 66, '',
  'https://pp.chevrolet.co.kr/httpobject/file/pricelist/bolteuv.pdf',
  '기존 영구 코드 보존: 쉐보레 코리아 공식 볼트 EUV 가격표 기준 66kWh·프리미어 사양 복구', DATA_AS_OF,
];

if (rows.length !== 30) throw new Error(`운영 보강행은 30행이어야 합니다: ${rows.length}`);
if (rows.some((row) => row.length !== HEADERS.length)) throw new Error('행 열 수가 A:AD 30열과 다릅니다.');
const codes = rows.map((row) => String(row[9]));
if (new Set(codes).size !== codes.length) throw new Error('신규 트림행키가 중복됩니다.');

function syncLocal() {
  const artifactPath = fileURLToPath(new URL('../public/data/vehicle-trim-master.json', import.meta.url));
  const registryPath = fileURLToPath(new URL('../data/vehicle-trim-key-registry.json', import.meta.url));
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as VehicleTrimMasterArtifact;
  const presentCodes = new Set(artifact.records.map((record) => record.trim_row_key));
  const present = codes.filter((code) => presentCodes.has(code));
  if (present.length && present.length !== codes.length) throw new Error(`일부 신규 코드만 ERP 산출물에 존재: ${present.length}/${codes.length}`);
  if (!present.length) {
    const added = buildVehicleTrimMasterArtifact([HEADERS, ...rows], SPREADSHEET_ID, SHEET_NAME);
    artifact.records = [...artifact.records, ...added.records].sort((a, b) => a.trim_row_key.localeCompare(b.trim_row_key));
  }
  for (const record of artifact.records) {
    if (record.master_id === 'mf-001.md-063.sm-아이오닉6') record.sub_model = '아이오닉6';
  }
  const repairedBolt = buildVehicleTrimMasterArtifact([HEADERS, boltRepairRow], SPREADSHEET_ID, SHEET_NAME).records[0];
  const boltIndex = artifact.records.findIndex((record) => record.trim_row_key === repairedBolt.trim_row_key);
  if (boltIndex < 0) throw new Error(`기존 볼트 EUV 영구 코드를 찾지 못했습니다: ${repairedBolt.trim_row_key}`);
  artifact.records[boltIndex] = repairedBolt;
  artifact.data_as_of = DATA_AS_OF;
  artifact.row_count = artifact.records.length;
  artifact.manual_assignable_count = artifact.records.filter((record) => record.usage_tier === 'manual').length;
  artifact.automatic_assignable_count = artifact.records.filter((record) => record.usage_tier === 'automatic').length;
  artifact.blocked_count = artifact.row_count - artifact.manual_assignable_count - artifact.automatic_assignable_count;
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as TrimKeyRegistry;
  const registeredCodes = new Set(registry.records.map((record) => record.code));
  const registered = codes.filter((code) => registeredCodes.has(code));
  if (registered.length && registered.length !== codes.length) throw new Error(`일부 신규 코드만 영구 레지스트리에 존재: ${registered.length}/${codes.length}`);
  if (!registered.length) {
    const added = trimKeyRecordsFromValues([HEADERS, ...rows]).map((record, index) => ({
      ...record,
      capturedSheetRow: START_ROW + index,
    }));
    registry.records = [...registry.records, ...added].sort((a, b) => a.code.localeCompare(b.code));
  }
  for (const record of registry.records) {
    if (record.masterId === 'mf-001.md-063.sm-아이오닉6') record.semantic[3] = '아이오닉6';
  }
  const repairedBoltKey = trimKeyRecordsFromValues([HEADERS, boltRepairRow])[0];
  const boltRegistryIndex = registry.records.findIndex((record) => record.code === repairedBoltKey.code);
  if (boltRegistryIndex < 0) throw new Error(`볼트 EUV 영구 레지스트리 코드를 찾지 못했습니다: ${repairedBoltKey.code}`);
  registry.records[boltRegistryIndex] = { ...repairedBoltKey, capturedSheetRow: 3009 };
  registry.capturedAt = DATA_AS_OF;
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  console.log(`PASS 운영 보강 ${rows.length}행 + 아이오닉6 ${IONIQ6_ROWS.length}행 정규화 동기화`);
}

const output = {
  startRow: START_ROW,
  endRow: START_ROW + rows.length - 1,
  rows,
  clearRow: 3263,
  boltRepairSheetRow: 3009,
  boltRepairRow,
  ioniq6Rows: IONIQ6_ROWS,
  ioniq6SubModel: '아이오닉6',
};
if (process.argv.includes('--sync-local')) syncLocal();
else if (process.argv.includes('--summary')) console.log(JSON.stringify({ count: rows.length, startRow: START_ROW, endRow: output.endRow, clearRow: output.clearRow, boltRepairSheetRow: output.boltRepairSheetRow, ioniq6Renames: IONIQ6_ROWS.length }));
else console.log(JSON.stringify(output));
