/**
 * Add high-value, still-operational used-car coverage without reassigning any
 * previously registered trim key. Existing ambiguous/excluded rows stay intact;
 * corrected splits always receive new variant numbers.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildVehicleTrimMasterArtifact, type VehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import { trimKeyRecordsFromValues, type TrimKeyRegistry } from '../lib/domain/vehicle-trim-key-contract';

const SPREADSHEET_ID = '1T_RrErmGoj_yG9S1u7n--2NDolTOw8wA8ROQjPWuAlg';
const SHEET_NAME = '차종마스터';
const START_ROW = 3263;
const DATA_AS_OF = '2026-08-15';

const HEADERS = [
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
  aliases?: string[];
  generation: string;
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
  evidenceUrl: string;
  evidenceNote: string;
};

const rows: Cell[][] = [];
const pad = (value: number) => String(value).padStart(2, '0');
function addVariant(variant: Variant) {
  variant.trims.forEach((trim, index) => {
    const trimSeq = index + 1;
    rows.push([
      '검증중', '1차확인', '중고차', variant.origin, variant.maker, variant.model, variant.subModel,
      variant.powertrain, trim, `${variant.masterId}::v${pad(variant.powertrainSeq)}::t${pad(trimSeq)}`,
      variant.masterId, variant.powertrainSeq, trimSeq, variant.generation, variant.developmentCode,
      variant.productionStart, variant.productionEnd, variant.modelYearStart, variant.modelYearEnd, variant.fuel,
      variant.engineCc ?? '', variant.displacementL ?? '', variant.turbo, variant.drivetrain, variant.seats,
      variant.batteryKwh ?? '', variant.aliases?.[index] || '', variant.evidenceUrl, variant.evidenceNote, DATA_AS_OF,
    ]);
  });
}

// Keep the old ambiguous v01 rows excluded. v02/v03 are permanent capacity-specific identities.
const sm3Evidence = 'https://cdn.renault.co.kr/ko/service/svc_auto07.jsp';
addVariant({
  origin: '국산', maker: '르노코리아', model: 'SM3', subModel: 'SM3 Z.E. L38',
  masterId: 'mf-005.md-001.sm-l38__sm3-z-e-l38', powertrainSeq: 2,
  powertrain: '전기 22kWh 2WD', trims: ['SE', 'SE Plus', 'RE'], aliases: ['', '', ''],
  generation: '1세대', developmentCode: 'L38', productionStart: '2013-11', productionEnd: '2017-10',
  modelYearStart: '2014', modelYearEnd: '2017', fuel: '전기', turbo: '아니오', drivetrain: '2WD', seats: 5,
  batteryKwh: 22, evidenceUrl: sm3Evidence,
  evidenceNote: '르노코리아 공식 보증자료의 18MY 이전 구동배터리 22kWh를 별도 코드로 분리. 기존 용량 미구분 v01 키는 제외 상태로 보존.',
});
addVariant({
  origin: '국산', maker: '르노코리아', model: 'SM3', subModel: 'SM3 Z.E. L38',
  masterId: 'mf-005.md-001.sm-l38__sm3-z-e-l38', powertrainSeq: 3,
  powertrain: '전기 35.9kWh 2WD', trims: ['SE', 'SE Plus', 'RE'], aliases: ['Long Range', 'Long Range', 'Long Range'],
  generation: '1세대', developmentCode: 'L38', productionStart: '2017-11', productionEnd: '2020-12',
  modelYearStart: '2018', modelYearEnd: '2020', fuel: '전기', turbo: '아니오', drivetrain: '2WD', seats: 5,
  batteryKwh: 35.9, evidenceUrl: sm3Evidence,
  evidenceNote: '르노코리아 공식 보증자료에 18MY 이후 Long Range Battery 35.9kWh가 명시됨. 용량별 차량코드 식별을 위해 신규 영구키 부여.',
});

// Existing F22 v01/v02 rows cover the older ambiguous source. New keys carry corrected periods/specifications.
const f22Evidence = 'https://www.press.bmwgroup.com/global/article/detail/T0165234EN/specifications-bmw-2-series-coupe-03/2014';
addVariant({
  origin: '수입', maker: 'BMW', model: '2시리즈', subModel: '2시리즈 F22', masterId: 'mf-012.md-018.sm-f22',
  powertrainSeq: 3, powertrain: '가솔린 3.0T 2WD', trims: ['M235i 쿠페'], aliases: ['M235i Coupe'],
  generation: '1세대', developmentCode: 'F22', productionStart: '2014-03', productionEnd: '2016-06',
  modelYearStart: '2014', modelYearEnd: '2016', fuel: '가솔린', engineCc: 2979, displacementL: 3.0,
  turbo: '예', drivetrain: '2WD', seats: 4, evidenceUrl: f22Evidence,
  evidenceNote: 'BMW Group 공식 F22 기술자료 기준 M235i 2,979cc·터보·4인승. 기존 v01 의미를 바꾸지 않고 운영용 신규키로 분리.',
});
addVariant({
  origin: '수입', maker: 'BMW', model: '2시리즈', subModel: '2시리즈 F22', masterId: 'mf-012.md-018.sm-f22',
  powertrainSeq: 4, powertrain: '디젤 2.0T 2WD', trims: ['220d M 스포츠 쿠페'], aliases: ['220d M Sport Coupe'],
  generation: '1세대', developmentCode: 'F22', productionStart: '2014-03', productionEnd: '2021-06',
  modelYearStart: '2014', modelYearEnd: '2021', fuel: '디젤', engineCc: 1995, displacementL: 2.0,
  turbo: '예', drivetrain: '2WD', seats: 4, evidenceUrl: f22Evidence,
  evidenceNote: 'BMW Group 공식 F22 기술자료 기준 220d 1,995cc·터보·4인승. 기존 v02 의미를 바꾸지 않고 운영용 신규키로 분리.',
});

const w176Evidence = 'https://mercedes-benz-publicarchive.com/marsClassic/en/instance/ko/176-series-A-Class-Saloons-2012---2015.xhtml?oid=4262';
addVariant({
  origin: '수입', maker: '벤츠', model: 'A-클래스', subModel: 'A-클래스 W176', masterId: 'mf-013.md-029.sm-w176',
  powertrainSeq: 1, powertrain: '가솔린 2.0T 4MATIC', trims: ['A 250 4MATIC', 'Mercedes-AMG A 45 4MATIC'],
  aliases: ['A250 4MATIC', 'A45 AMG 4MATIC'], generation: '3세대', developmentCode: 'W176',
  productionStart: '2013-03', productionEnd: '2018-04', modelYearStart: '2013', modelYearEnd: '2018',
  fuel: '가솔린', engineCc: 1991, displacementL: 2.0, turbo: '예', drivetrain: '4MATIC', seats: 5,
  evidenceUrl: w176Evidence,
  evidenceNote: 'Mercedes-Benz 공식 Public Archive W176 계보 기준 A250/A45 2.0 터보·4MATIC·5도어. 국내 중고 재고 매칭용 1차확인.',
});
addVariant({
  origin: '수입', maker: '벤츠', model: 'A-클래스', subModel: 'A-클래스 W176', masterId: 'mf-013.md-029.sm-w176',
  powertrainSeq: 2, powertrain: '디젤 1.5T 2WD', trims: ['A 180 d Style'], aliases: ['A180d Style'],
  generation: '3세대', developmentCode: 'W176', productionStart: '2015-09', productionEnd: '2018-04',
  modelYearStart: '2016', modelYearEnd: '2018', fuel: '디젤', engineCc: 1461, displacementL: 1.5,
  turbo: '예', drivetrain: '2WD', seats: 5, evidenceUrl: w176Evidence,
  evidenceNote: 'Mercedes-Benz 공식 W176 계보의 1.5 디젤 사양을 국내 표기 A180 d Style로 정규화.',
});
addVariant({
  origin: '수입', maker: '벤츠', model: 'A-클래스', subModel: 'A-클래스 W176', masterId: 'mf-013.md-029.sm-w176',
  powertrainSeq: 4, powertrain: '가솔린 1.6T 2WD', trims: ['A 200'], aliases: ['A200'],
  generation: '3세대', developmentCode: 'W176', productionStart: '2015-09', productionEnd: '2018-04',
  modelYearStart: '2016', modelYearEnd: '2018', fuel: '가솔린', engineCc: 1595, displacementL: 1.6,
  turbo: '예', drivetrain: '2WD', seats: 5, evidenceUrl: w176Evidence,
  evidenceNote: 'Mercedes-Benz 공식 W176 계보의 M270 1.6 터보·전륜구동 사양을 국내 표기 A200으로 정규화.',
});
addVariant({
  origin: '수입', maker: '벤츠', model: 'A-클래스', subModel: 'A-클래스 W176', masterId: 'mf-013.md-029.sm-w176',
  powertrainSeq: 5, powertrain: '디젤 2.1T 2WD', trims: ['A 200 d'], aliases: ['A200d'],
  generation: '3세대', developmentCode: 'W176', productionStart: '2015-09', productionEnd: '2018-04',
  modelYearStart: '2016', modelYearEnd: '2018', fuel: '디젤', engineCc: 2143, displacementL: 2.1,
  turbo: '예', drivetrain: '2WD', seats: 5, evidenceUrl: w176Evidence,
  evidenceNote: 'Mercedes-Benz 공식 W176 계보의 OM651 2,143cc 디젤·전륜구동 사양을 국내 표시배기량 2.1로 정규화.',
});

const xt6Evidence = 'https://www.cadillac.co.kr/content/dam/cadillac/as/kr/ko/index/vehicle-brochures/2023/02-pdf/07102023/2023%20XT6.pdf';
addVariant({
  origin: '수입', maker: '캐딜락', model: 'XT6', subModel: 'XT6', masterId: 'mf-043.md-020.sm-xt6',
  powertrainSeq: 1, powertrain: '가솔린 3.6 AWD 6인승', trims: ['SPORT'], aliases: ['스포츠'],
  generation: '1세대', developmentCode: 'C1UL', productionStart: '2020-03', productionEnd: '2024-12',
  modelYearStart: '2020', modelYearEnd: '2024', fuel: '가솔린', engineCc: 3649, displacementL: 3.6,
  turbo: '아니오', drivetrain: 'AWD', seats: 6, evidenceUrl: xt6Evidence,
  evidenceNote: '캐딜락코리아 2023 XT6 공식 카탈로그 기준 3,649cc 자연흡기·AWD·SPORT·6인승.',
});
addVariant({
  origin: '수입', maker: '캐딜락', model: 'XT6', subModel: 'XT6', masterId: 'mf-043.md-020.sm-xt6',
  powertrainSeq: 2, powertrain: '가솔린 3.6 AWD 7인승', trims: ['SPORT'], aliases: ['스포츠'],
  generation: '1세대', developmentCode: 'C1UL', productionStart: '2020-03', productionEnd: '2024-12',
  modelYearStart: '2020', modelYearEnd: '2024', fuel: '가솔린', engineCc: 3649, displacementL: 3.6,
  turbo: '아니오', drivetrain: 'AWD', seats: 7, evidenceUrl: xt6Evidence,
  evidenceNote: '캐딜락코리아 2023 XT6 공식 카탈로그 기준 3,649cc 자연흡기·AWD·SPORT·7인승.',
});

const hgEvidence = 'https://www.hyundai.com/kr/ko/brand/heritage/model/grandeur-history/2011-grandeur-hg';
const hgHevEvidence = 'https://www.hyundai.com/kr/ko/brand/heritage/model/grandeur-history/2013-grandeur-hg-hev';
for (const spec of [
  { seq: 1, power: '가솔린 2.4 2WD', fuel: '가솔린', cc: 2359, l: 2.4, turbo: '아니오' as const, start: '2011-01', end: '2016-11', ys: '2011', ye: '2016', trims: ['HG240 모던', 'HG240 럭셔리', 'HG240 모던 컬렉션'], url: hgEvidence },
  { seq: 2, power: '가솔린 3.0 2WD', fuel: '가솔린', cc: 2999, l: 3.0, turbo: '아니오' as const, start: '2011-01', end: '2016-11', ys: '2011', ye: '2016', trims: ['HG300 로얄', 'HG300 프리미엄', 'HG300 노블', 'HG300 프라임', 'HG300 익스클루시브', 'HG300 익스클루시브 스페셜'], url: hgEvidence },
  { seq: 3, power: '디젤 2.2T 2WD', fuel: '디젤', cc: 2199, l: 2.2, turbo: '예' as const, start: '2014-06', end: '2016-11', ys: '2015', ye: '2016', trims: ['HG220 모던', 'HG220 프리미엄', 'HG220 프리미엄 컬렉션'], url: hgEvidence },
  { seq: 4, power: 'LPG 3.0 2WD', fuel: 'LPG', cc: 2999, l: 3.0, turbo: '아니오' as const, start: '2011-01', end: '2016-11', ys: '2011', ye: '2016', trims: ['HG300 모던', 'HG300 프리미엄', 'HG300 프라임', 'HG300 이그제큐티브', 'HG300 익스클루시브'], url: hgEvidence },
  { seq: 5, power: '가솔린 3.3 2WD', fuel: '가솔린', cc: 3342, l: 3.3, turbo: '아니오' as const, start: '2011-01', end: '2016-11', ys: '2011', ye: '2016', trims: ['HG330 셀러브리티'], url: hgEvidence },
  { seq: 6, power: '하이브리드 2.4 2WD', fuel: '하이브리드', cc: 2359, l: 2.4, turbo: '아니오' as const, start: '2013-12', end: '2017-03', ys: '2014', ye: '2017', trims: ['프리미엄', '프리미엄 컬렉션'], url: hgHevEvidence },
]) {
  addVariant({
    origin: '국산', maker: '현대', model: '그랜저', subModel: '그랜저 HG', masterId: 'mf-001.md-004.sm-hg',
    powertrainSeq: spec.seq, powertrain: spec.power, trims: spec.trims, generation: '5세대', developmentCode: 'HG',
    productionStart: spec.start, productionEnd: spec.end, modelYearStart: spec.ys, modelYearEnd: spec.ye,
    fuel: spec.fuel, engineCc: spec.cc, displacementL: spec.l, turbo: spec.turbo, drivetrain: '2WD', seats: 5,
    evidenceUrl: spec.url,
    evidenceNote: `현대자동차 공식 헤리티지와 기존 원본 트림목록 기준 ${spec.power}·${spec.trims.join('/')} 1차확인. 그랜저 HG는 인증중고차 거래량 상위 모델로 운영 우선 보강.`,
  });
}

if (rows.length !== 35) throw new Error(`운영 중고차 보강행은 35행이어야 합니다: ${rows.length}`);
if (rows.some((row) => row.length !== HEADERS.length)) throw new Error('신규 행의 열 수가 A:AD 30열과 다릅니다.');
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
  const currentRecords = buildVehicleTrimMasterArtifact([HEADERS, ...rows], SPREADSHEET_ID, SHEET_NAME).records;
  const currentByCode = new Map(currentRecords.map((record) => [record.trim_row_key, record]));
  artifact.records = artifact.records.map((record) => currentByCode.get(record.trim_row_key) || record)
    .sort((a, b) => a.trim_row_key.localeCompare(b.trim_row_key));
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
  const currentKeys = trimKeyRecordsFromValues([HEADERS, ...rows]).map((record, index) => ({
    ...record,
    capturedSheetRow: START_ROW + index,
  }));
  const currentKeyByCode = new Map(currentKeys.map((record) => [record.code, record]));
  registry.records = registry.records.map((record) => currentKeyByCode.get(record.code) || record)
    .sort((a, b) => a.code.localeCompare(b.code));
  registry.capturedAt = DATA_AS_OF;
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  console.log(`PASS 운영 중고차 ${rows.length}행 ERP 산출물·영구키 레지스트리 동기화`);
}

const output = { startRow: START_ROW, endRow: START_ROW + rows.length - 1, rows };
if (process.argv.includes('--sync-local')) syncLocal();
else if (process.argv.includes('--summary')) console.log(JSON.stringify({ count: rows.length, startRow: START_ROW, endRow: output.endRow }));
else console.log(JSON.stringify(output));
