/** Build current mainstream vehicle rows that were entirely missing from the trim master. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildVehicleTrimMasterArtifact, type VehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import { trimKeyRecordsFromValues, type TrimKeyRegistry } from '../lib/domain/vehicle-trim-key-contract';

const SPREADSHEET_ID = '1T_RrErmGoj_yG9S1u7n--2NDolTOw8wA8ROQjPWuAlg';
const SHEET_NAME = '차종마스터';
const DATA_AS_OF = '2026-08-15';

export const HEADERS = [
  '관리상태', '검증상태', '신차/중고차', '원산지', '제조사', '모델', '세부모델', '파워트레인', '세부트림',
  '트림행키', '마스터ID', '파워트레인순번', '트림순번', '세대명', '개발코드', '생산시작', '생산종료',
  '연식시작', '연식종료', '연료', '정확배기량(cc)', '표시배기량(L)', '터보', '구동방식', '인승',
  '배터리(kWh)', '트림별칭', '근거URL', '근거메모', '데이터기준일',
] as const;

type Cell = string | number;
type SegmentName = '국산신차' | '벤츠현행' | '폭스바겐현행' | '볼보XC60' | '도요타현행';
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
  evidenceUrl: string;
  evidenceNote: string;
};

const segmentStarts: Record<SegmentName, number> = {
  국산신차: 3202,
  벤츠현행: 4164,
  폭스바겐현행: 4802,
  볼보XC60: 5199,
  도요타현행: 5602,
};
const segmentRows = new Map<SegmentName, Cell[][]>();
const pad = (value: number) => String(value).padStart(2, '0');

function addVariant(segment: SegmentName, variant: Variant) {
  const target = segmentRows.get(segment) || [];
  variant.trims.forEach((trim, index) => {
    const trimSeq = index + 1;
    const code = `${variant.masterId}::v${pad(variant.powertrainSeq)}::t${pad(trimSeq)}`;
    target.push([
      '검증중', '1차확인', '신차', variant.origin, variant.maker, variant.model, variant.subModel,
      variant.powertrain, trim, code, variant.masterId, variant.powertrainSeq, trimSeq, variant.generation || '',
      variant.developmentCode, variant.productionStart, variant.productionEnd || '현재', variant.modelYearStart,
      variant.modelYearEnd || '현재', variant.fuel, variant.engineCc ?? '', variant.displacementL ?? '', variant.turbo,
      variant.drivetrain, variant.seats, variant.batteryKwh ?? '', '', variant.evidenceUrl, variant.evidenceNote, DATA_AS_OF,
    ]);
  });
  segmentRows.set(segment, target);
}

// Hyundai IONIQ 9: the 2027 Korean price sheet is a six-seat 110.3 kWh model; HTRAC is a selectable drivetrain.
const ioniq9Url = 'https://www.hyundai.com/contents/repn-car/catalog/ioniq9-2027-price.pdf';
for (const drive of ['AWD', '2WD']) {
  addVariant('국산신차', {
    origin: '국산', maker: '현대', model: '아이오닉9', subModel: '아이오닉9 ME',
    masterId: 'mf-001.md-066.sm-아이오닉9', powertrainSeq: drive === 'AWD' ? 1 : 2,
    powertrain: `전기 110.3kWh ${drive} 6인승`, trims: ['익스클루시브', '프레스티지'], generation: '1세대',
    developmentCode: 'ME', productionStart: '2025-02', modelYearStart: '2025', fuel: '전기', turbo: '아니오',
    drivetrain: drive, seats: 6, batteryKwh: 110.3, evidenceUrl: ioniq9Url,
    evidenceNote: `현대 2027 아이오닉9 공식 가격표 기준 110.3kWh·${drive}·6인승·트림 1차확인`,
  });
}

// Kia EV4: Standard/Long Range and the Long Range dual-motor option are separate ERP identities.
const ev4Url = 'https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_ev4.pdf';
for (const spec of [
  { seq: 1, battery: 58.3, drive: '2WD' },
  { seq: 2, battery: 81.4, drive: '2WD' },
  { seq: 3, battery: 81.4, drive: '4WD' },
]) {
  addVariant('국산신차', {
    origin: '국산', maker: '기아', model: 'EV4', subModel: 'EV4 CT', masterId: 'mf-002.md-072.sm-ev4',
    powertrainSeq: spec.seq, powertrain: `전기 ${spec.battery.toFixed(1)}kWh ${spec.drive}`,
    trims: ['에어', '어스', 'GT-Line'], generation: '1세대', developmentCode: 'CT', productionStart: '2025-03',
    modelYearStart: '2025', fuel: '전기', turbo: '아니오', drivetrain: spec.drive, seats: 5,
    batteryKwh: spec.battery, evidenceUrl: ev4Url,
    evidenceNote: `기아 2026-08 공식 EV4 가격표 기준 ${spec.battery}kWh·${spec.drive}·트림 1차확인`,
  });
}

// Kia EV5: official Korean sheet lists 60.3/81.4 kWh and Long Range dual-motor 4WD.
const ev5Url = 'https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_ev5.pdf';
for (const spec of [
  { seq: 1, battery: 81.4, drive: '4WD' },
  { seq: 2, battery: 60.3, drive: '2WD' },
  { seq: 3, battery: 81.4, drive: '2WD' },
]) {
  addVariant('국산신차', {
    origin: '국산', maker: '기아', model: 'EV5', subModel: 'EV5 OV', masterId: 'mf-002.md-074.sm-ev5',
    powertrainSeq: spec.seq, powertrain: `전기 ${spec.battery.toFixed(1)}kWh ${spec.drive}`,
    trims: ['에어', '어스', 'GT-Line'], generation: '1세대', developmentCode: 'OV', productionStart: '2026-05',
    modelYearStart: '2026', fuel: '전기', turbo: '아니오', drivetrain: spec.drive, seats: 5,
    batteryKwh: spec.battery, evidenceUrl: ev5Url,
    evidenceNote: `기아 2026-08 공식 EV5 가격표 기준 ${spec.battery}kWh·${spec.drive}·트림 1차확인`,
  });
}

// Kia Tasman: 2WD/4WD are distinct, and X-Pro is 4WD-only.
const tasmanUrl = 'https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_tasman.pdf';
for (const spec of [
  { seq: 1, drive: '4WD', trims: ['다이내믹', '어드벤처', '베스트 셀렉션', '익스트림', 'X-Pro'] },
  { seq: 2, drive: '2WD', trims: ['다이내믹', '어드벤처', '베스트 셀렉션', '익스트림'] },
]) {
  addVariant('국산신차', {
    origin: '국산', maker: '기아', model: '타스만', subModel: '타스만 TK', masterId: 'mf-002.md-071.sm-타스만',
    powertrainSeq: spec.seq, powertrain: `가솔린 2.5T ${spec.drive}`, trims: spec.trims, generation: '1세대',
    developmentCode: 'TK', productionStart: '2025-03', modelYearStart: '2025', fuel: '가솔린', engineCc: 2497,
    displacementL: 2.5, turbo: '예', drivetrain: spec.drive, seats: 5, evidenceUrl: tasmanUrl,
    evidenceNote: `기아 2026-08 공식 타스만 가격표 기준 G2.5 T-GDI·${spec.drive}·트림 1차확인`,
  });
}

const mbCompactUrl = 'https://www.mercedes-benz.co.kr/passengercars/brand/news-events/news-story/2023/news-20231228.html';
addVariant('벤츠현행', {
  origin: '수입', maker: '벤츠', model: 'GLA-클래스', subModel: 'GLA-클래스 H247',
  masterId: 'mf-013.md-032.sm-gla-클래스-h247', powertrainSeq: 1, powertrain: '가솔린 2.0T 4MATIC',
  trims: ['GLA250 4MATIC'], generation: '2세대', developmentCode: 'H247', productionStart: '2023-12',
  modelYearStart: '2024', fuel: '가솔린', engineCc: 1991, displacementL: 2.0, turbo: '예', drivetrain: '4MATIC',
  seats: 5, evidenceUrl: mbCompactUrl, evidenceNote: '메르세데스-벤츠 코리아 공식 컴팩트카 출시자료 기준 GLA250 4MATIC 1차확인',
});
addVariant('벤츠현행', {
  origin: '수입', maker: '벤츠', model: 'GLB-클래스', subModel: 'GLB-클래스 X247',
  masterId: 'mf-013.md-039.sm-glb-클래스-x247', powertrainSeq: 1, powertrain: '가솔린 2.0T 4MATIC',
  trims: ['GLB250 4MATIC', 'AMG GLB35 4MATIC'], generation: '1세대', developmentCode: 'X247', productionStart: '2023-12',
  modelYearStart: '2024', fuel: '가솔린', engineCc: 1991, displacementL: 2.0, turbo: '예', drivetrain: '4MATIC',
  seats: 5, evidenceUrl: mbCompactUrl, evidenceNote: '메르세데스-벤츠 코리아 공식 컴팩트카 출시자료 기준 GLB 가솔린 4MATIC 트림 1차확인',
});
addVariant('벤츠현행', {
  origin: '수입', maker: '벤츠', model: 'GLB-클래스', subModel: 'GLB-클래스 X247',
  masterId: 'mf-013.md-039.sm-glb-클래스-x247', powertrainSeq: 3, powertrain: '디젤 2.0T 2WD',
  trims: ['GLB200d'], generation: '1세대', developmentCode: 'X247', productionStart: '2023-12', modelYearStart: '2024',
  fuel: '디젤', engineCc: 1950, displacementL: 2.0, turbo: '예', drivetrain: '2WD', seats: 5,
  evidenceUrl: mbCompactUrl, evidenceNote: '메르세데스-벤츠 코리아 공식 컴팩트카 출시자료 기준 GLB200d 1차확인',
});

const glsUrl = 'https://www.mercedes-benz.co.kr/passengercars/brand/news-events/news-story/2023/news-20231120.html';
addVariant('벤츠현행', {
  origin: '수입', maker: '벤츠', model: 'GLS-클래스', subModel: 'GLS-클래스 X167',
  masterId: 'mf-013.md-037.sm-gls-클래스-x167', powertrainSeq: 3, powertrain: '디젤 3.0T 4MATIC',
  trims: ['GLS450d 4MATIC'], generation: '3세대', developmentCode: 'X167', productionStart: '2023-11', modelYearStart: '2024',
  fuel: '디젤', engineCc: 2989, displacementL: 3.0, turbo: '예', drivetrain: '4MATIC', seats: 7,
  evidenceUrl: glsUrl, evidenceNote: '메르세데스-벤츠 코리아 공식 GLS 부분변경 출시자료 기준 GLS450d 4MATIC 1차확인',
});
addVariant('벤츠현행', {
  origin: '수입', maker: '벤츠', model: 'GLS-클래스', subModel: 'GLS-클래스 X167',
  masterId: 'mf-013.md-037.sm-gls-클래스-x167', powertrainSeq: 2, powertrain: '가솔린 4.0T 4MATIC',
  trims: ['GLS580 4MATIC'], generation: '3세대', developmentCode: 'X167', productionStart: '2023-11', modelYearStart: '2024',
  fuel: '가솔린', engineCc: 3982, displacementL: 4.0, turbo: '예', drivetrain: '4MATIC', seats: 7,
  evidenceUrl: glsUrl, evidenceNote: '메르세데스-벤츠 코리아 공식 GLS 부분변경 출시자료 기준 GLS580 4MATIC 1차확인',
});

const gClassUrl = 'https://www.mercedes-benz.co.kr/passengercars/models/suv/g-class/overview.html';
for (const spec of [
  { seq: 1, power: '디젤 3.0T 4MATIC', trim: 'G450d', fuel: '디젤', cc: 2989, l: 3.0, battery: undefined },
  { seq: 2, power: '가솔린 4.0T 4MATIC', trim: 'AMG G63', fuel: '가솔린', cc: 3982, l: 4.0, battery: undefined },
  { seq: 3, power: '전기 122.0kWh 4WD', trim: 'G580 with EQ Technology', fuel: '전기', cc: undefined, l: undefined, battery: 122 },
]) {
  addVariant('벤츠현행', {
    origin: '수입', maker: '벤츠', model: 'G-클래스', subModel: 'G-클래스 W465',
    masterId: 'mf-013.md-013.sm-g-클래스-w465', powertrainSeq: spec.seq, powertrain: spec.power, trims: [spec.trim],
    generation: '현행', developmentCode: 'W465', productionStart: '2024-10', modelYearStart: '2025', fuel: spec.fuel,
    engineCc: spec.cc, displacementL: spec.l, turbo: spec.fuel === '전기' ? '아니오' : '예', drivetrain: '4MATIC',
    seats: 5, batteryKwh: spec.battery, evidenceUrl: gClassUrl,
    evidenceNote: `메르세데스-벤츠 코리아 공식 G-클래스 라인업 기준 ${spec.trim} 1차확인`,
  });
}

addVariant('벤츠현행', {
  origin: '수입', maker: '벤츠', model: 'CLA-클래스', subModel: 'CLA-클래스 C118',
  masterId: 'mf-013.md-031.sm-cla-클래스-c118', powertrainSeq: 1, powertrain: '가솔린 2.0T 4MATIC',
  trims: ['CLA250 4MATIC'], generation: '2세대', developmentCode: 'C118', productionStart: '2023-12', modelYearStart: '2024',
  fuel: '가솔린', engineCc: 1991, displacementL: 2.0, turbo: '예', drivetrain: '4MATIC', seats: 5,
  evidenceUrl: mbCompactUrl, evidenceNote: '메르세데스-벤츠 코리아 공식 컴팩트카 출시자료 기준 CLA250 4MATIC 1차확인',
});

const vwAtlasUrl = 'https://www.volkswagen.co.kr/idhub/content/dam/onehub_pkw/importers/kr/models/atlas/leaflet/Atlas_Price%20List_260209.pdf';
for (const spec of [{ seq: 1, seats: 7 }, { seq: 2, seats: 6 }]) {
  addVariant('폭스바겐현행', {
    origin: '수입', maker: '폭스바겐', model: '아틀라스', subModel: '아틀라스', masterId: 'mf-014.md-019.sm-아틀라스',
    powertrainSeq: spec.seq, powertrain: `가솔린 2.0T 4MOTION ${spec.seats}인승`, trims: ['2.0 TSI'],
    generation: '1세대', developmentCode: 'CA1', productionStart: '2025-05', modelYearStart: '2025', fuel: '가솔린',
    engineCc: 1984, displacementL: 2.0, turbo: '예', drivetrain: '4WD', seats: spec.seats, evidenceUrl: vwAtlasUrl,
    evidenceNote: `폭스바겐코리아 2026 아틀라스 공식 가격표 기준 2.0 TSI·4MOTION·${spec.seats}인승 1차확인`,
  });
}

const touaregUrl = 'https://www.volkswagen.co.kr/idhub/content/dam/onehub_pkw/importers/kr/models/2026-touareg/The%20Touareg_Price%20List_251229_web.pdf';
addVariant('폭스바겐현행', {
  origin: '수입', maker: '폭스바겐', model: '투아렉', subModel: '투아렉 3세대', masterId: 'mf-014.md-005.sm-투아렉-3세대',
  powertrainSeq: 1, powertrain: '디젤 3.0T 4WD', trims: ['Prestige', 'R-Line'], generation: '3세대',
  developmentCode: 'CR', productionStart: '2023-03', modelYearStart: '2023', fuel: '디젤', engineCc: 2967,
  displacementL: 3.0, turbo: '예', drivetrain: '4WD', seats: 5, evidenceUrl: touaregUrl,
  evidenceNote: '폭스바겐코리아 2026 투아렉 공식 가격표 기준 3.0 TDI·4WD·Prestige/R-Line 1차확인',
});

const golfUrl = 'https://www.volkswagen.co.kr/ko/models.html';
addVariant('폭스바겐현행', {
  origin: '수입', maker: '폭스바겐', model: '골프', subModel: '골프 8세대', masterId: 'mf-014.md-007.sm-골프-8세대',
  powertrainSeq: 1, powertrain: '디젤 2.0T 2WD', trims: ['Premium', 'Prestige'], generation: '8세대',
  developmentCode: 'CD1', productionStart: '2025-03', modelYearStart: '2025', fuel: '디젤', engineCc: 1968,
  displacementL: 2.0, turbo: '예', drivetrain: '2WD', seats: 5, evidenceUrl: golfUrl,
  evidenceNote: '폭스바겐코리아 2026 현행 라인업·신형 골프 공식자료 기준 2.0 TDI Premium/Prestige 1차확인',
});
addVariant('폭스바겐현행', {
  origin: '수입', maker: '폭스바겐', model: '골프', subModel: '골프 8세대', masterId: 'mf-014.md-007.sm-골프-8세대',
  powertrainSeq: 2, powertrain: '가솔린 2.0T 2WD', trims: ['GTI'], generation: '8세대', developmentCode: 'CD1',
  productionStart: '2025-06', modelYearStart: '2025', fuel: '가솔린', engineCc: 1984, displacementL: 2.0,
  turbo: '예', drivetrain: '2WD', seats: 5, evidenceUrl: golfUrl,
  evidenceNote: '폭스바겐코리아 2026 현행 라인업·신형 골프 GTI 공식자료 기준 1차확인',
});

const vwEvUrl = 'https://www.volkswagen.co.kr/ko/models.html';
for (const spec of [
  { model: 'ID.4', sub: 'ID.4', id: 'mf-014.md-023.sm-id-4', battery: 82.836, start: '2025-02' },
  { model: 'ID.5', sub: 'ID.5', id: 'mf-014.md-025.sm-id-5', battery: 82.836, start: '2026-06' },
]) {
  addVariant('폭스바겐현행', {
    origin: '수입', maker: '폭스바겐', model: spec.model, subModel: spec.sub, masterId: spec.id, powertrainSeq: 1,
    powertrain: `전기 ${spec.battery}kWh 2WD`, trims: ['Pro Lite', 'Pro'], generation: '1세대', developmentCode: 'MEB',
    productionStart: spec.start, modelYearStart: spec.start.slice(0, 4), fuel: '전기', turbo: '아니오', drivetrain: '2WD',
    seats: 5, batteryKwh: spec.battery, evidenceUrl: vwEvUrl,
    evidenceNote: `폭스바겐코리아 2026 현행 라인업 기준 ${spec.model} Pro Lite/Pro·후륜구동 1차확인`,
  });
}

const xc60Url = 'https://www.volvocars.com/kr/cars/xc60/';
addVariant('볼보XC60', {
  origin: '수입', maker: '볼보', model: 'XC60', subModel: 'XC60 2세대', masterId: 'mf-017.md-016.sm-xc60-2세대',
  powertrainSeq: 1, powertrain: '가솔린 2.0T AWD', trims: ['B5 AWD Plus', 'B5 AWD Ultra'], generation: '2세대',
  developmentCode: 'SPA', productionStart: '2025-08', modelYearStart: '2026', fuel: '가솔린', engineCc: 1969,
  displacementL: 2.0, turbo: '예', drivetrain: 'AWD', seats: 5, evidenceUrl: xc60Url,
  evidenceNote: '볼보자동차코리아 공식 XC60 현행 라인업 기준 B5 AWD Plus/Ultra 1차확인',
});
addVariant('볼보XC60', {
  origin: '수입', maker: '볼보', model: 'XC60', subModel: 'XC60 2세대', masterId: 'mf-017.md-016.sm-xc60-2세대',
  powertrainSeq: 2, powertrain: '플러그인 하이브리드 2.0T AWD', trims: ['T8 AWD Ultra'], generation: '2세대',
  developmentCode: 'SPA', productionStart: '2025-08', modelYearStart: '2026', fuel: '플러그인 하이브리드',
  engineCc: 1969, displacementL: 2.0, turbo: '예', drivetrain: 'AWD', seats: 5, evidenceUrl: xc60Url,
  evidenceNote: '볼보자동차코리아 공식 XC60 현행 라인업 기준 T8 AWD Ultra 1차확인',
});

const toyotaBuildUrl = 'https://toyota.co.kr/build-my-car/';
addVariant('도요타현행', {
  origin: '수입', maker: '도요타', model: '캠리', subModel: '캠리 XV80', masterId: 'mf-031.md-001.sm-xv80',
  powertrainSeq: 1, powertrain: '하이브리드 2.5 2WD', trims: ['XLE', 'XSE'], generation: '9세대',
  developmentCode: 'XV80', productionStart: '2024-11', modelYearStart: '2025', fuel: '하이브리드', engineCc: 2487,
  displacementL: 2.5, turbo: '아니오', drivetrain: '2WD', seats: 5, evidenceUrl: toyotaBuildUrl,
  evidenceNote: '한국토요타 2026 현행 모델·내 차 만들기 기준 캠리 HEV XLE/XSE 1차확인',
});

for (const spec of [
  { seq: 1, power: '하이브리드 2.5 2WD', trims: ['HEV XLE'], fuel: '하이브리드', drive: '2WD' },
  { seq: 2, power: '하이브리드 2.5 AWD', trims: ['HEV LIMITED'], fuel: '하이브리드', drive: 'AWD' },
  { seq: 3, power: '플러그인 하이브리드 2.5 AWD', trims: ['PHEV XSE', 'PHEV GR SPORT'], fuel: '플러그인 하이브리드', drive: 'AWD' },
]) {
  addVariant('도요타현행', {
    origin: '수입', maker: '도요타', model: 'RAV4', subModel: 'RAV4 XA60', masterId: 'mf-031.md-008.sm-xa60',
    powertrainSeq: spec.seq, powertrain: spec.power, trims: spec.trims, generation: '6세대', developmentCode: 'XA60',
    productionStart: '2026-05', modelYearStart: '2026', fuel: spec.fuel, engineCc: 2487, displacementL: 2.5,
    turbo: '아니오', drivetrain: spec.drive, seats: 5, evidenceUrl: toyotaBuildUrl,
    evidenceNote: `한국토요타 2026 ALL-NEW RAV4 사전계약 공식 라인업 기준 ${spec.trims.join('/')} 1차확인`,
  });
}

const priusHevUrl = 'https://www.toyota.co.kr/download/model/PRIUS-HEV_spec.pdf';
for (const spec of [
  { seq: 1, drive: '2WD', trim: 'HEV XLE' },
  { seq: 2, drive: 'AWD', trim: 'HEV AWD XLE' },
]) {
  addVariant('도요타현행', {
    origin: '수입', maker: '도요타', model: '프리우스', subModel: '프리우스 XW60', masterId: 'mf-031.md-022.sm-xw60',
    powertrainSeq: spec.seq, powertrain: `하이브리드 2.0 ${spec.drive}`, trims: [spec.trim], generation: '5세대',
    developmentCode: 'XW60', productionStart: '2023-12', modelYearStart: '2024', fuel: '하이브리드', engineCc: 1987,
    displacementL: 2.0, turbo: '아니오', drivetrain: spec.drive, seats: 5, evidenceUrl: priusHevUrl,
    evidenceNote: `한국토요타 2026-06 프리우스 공식 제원표 기준 ${spec.trim} 1차확인`,
  });
}
addVariant('도요타현행', {
  origin: '수입', maker: '도요타', model: '프리우스', subModel: '프리우스 XW60', masterId: 'mf-031.md-022.sm-xw60',
  powertrainSeq: 3, powertrain: '플러그인 하이브리드 2.0 2WD', trims: ['PHEV XSE'], generation: '5세대',
  developmentCode: 'XW60', productionStart: '2023-12', modelYearStart: '2024', fuel: '플러그인 하이브리드',
  engineCc: 1987, displacementL: 2.0, turbo: '아니오', drivetrain: '2WD', seats: 5, batteryKwh: 13.6,
  evidenceUrl: 'https://www.toyota.co.kr/download/model/PRIUS-PHEV_spec.pdf',
  evidenceNote: '한국토요타 2026-06 프리우스 PHEV 공식 제원표 기준 13.6kWh·XSE 1차확인',
});

const crownUrl = 'https://www.toyota.co.kr/download/model/CROWN_spec.pdf';
for (const spec of [
  { seq: 1, power: '하이브리드 2.5 AWD', trim: 'CROWN HEV', cc: 2487, l: 2.5, turbo: '아니오' as const },
  { seq: 2, power: '하이브리드 2.4T AWD', trim: 'CROWN Dual Boost HEV', cc: 2393, l: 2.4, turbo: '예' as const },
]) {
  addVariant('도요타현행', {
    origin: '수입', maker: '도요타', model: '크라운', subModel: '크라운 크로스오버',
    masterId: 'mf-031.md-020.sm-크라운-크로스오버', powertrainSeq: spec.seq, powertrain: spec.power,
    trims: [spec.trim], generation: '16세대', developmentCode: 'S235', productionStart: '2023-06', modelYearStart: '2023',
    fuel: '하이브리드', engineCc: spec.cc, displacementL: spec.l, turbo: spec.turbo, drivetrain: 'AWD', seats: 5,
    evidenceUrl: crownUrl, evidenceNote: `한국토요타 2026-05 크라운 공식 제원표 기준 ${spec.trim} 1차확인`,
  });
}

addVariant('도요타현행', {
  origin: '수입', maker: '도요타', model: '하이랜더', subModel: '하이랜더 XU70', masterId: 'mf-031.md-035.sm-xu70',
  powertrainSeq: 1, powertrain: '하이브리드 2.5 AWD', trims: ['Platinum'], generation: '4세대', developmentCode: 'XU70',
  productionStart: '2023-07', modelYearStart: '2023', fuel: '하이브리드', engineCc: 2487, displacementL: 2.5,
  turbo: '아니오', drivetrain: 'AWD', seats: 7, evidenceUrl: 'https://www.toyota.co.kr/models/highlander/',
  evidenceNote: '한국토요타 2026 현행 하이랜더 공식 모델 페이지 기준 HEV AWD Platinum 1차확인',
});

const siennaUrl = 'https://www.toyota.co.kr/download/model/SIENNA_spec.pdf';
for (const spec of [{ seq: 1, drive: '2WD' }, { seq: 2, drive: 'AWD' }]) {
  addVariant('도요타현행', {
    origin: '수입', maker: '도요타', model: '시에나', subModel: '시에나 XL40', masterId: 'mf-031.md-029.sm-xl40',
    powertrainSeq: spec.seq, powertrain: `하이브리드 2.5 ${spec.drive}`, trims: [`HEV ${spec.drive}`], generation: '4세대',
    developmentCode: 'XL40', productionStart: '2021-04', modelYearStart: '2021', fuel: '하이브리드', engineCc: 2487,
    displacementL: 2.5, turbo: '아니오', drivetrain: spec.drive, seats: 7, evidenceUrl: siennaUrl,
    evidenceNote: `한국토요타 현행 시에나 공식 제원표 기준 HEV ${spec.drive}·7인승 1차확인`,
  });
}

addVariant('도요타현행', {
  origin: '수입', maker: '도요타', model: '알파드', subModel: '알파드 AH40', masterId: 'mf-031.md-050.sm-ah40',
  powertrainSeq: 1, powertrain: '하이브리드 2.5 AWD', trims: ['HEV Premium', 'HEV Executive Lounge'],
  generation: '4세대', developmentCode: 'AH40', productionStart: '2023-09', modelYearStart: '2023', fuel: '하이브리드',
  engineCc: 2487, displacementL: 2.5, turbo: '아니오', drivetrain: 'AWD', seats: 7,
  evidenceUrl: 'https://www.toyota.co.kr/download/model/ALPHARD_spec.pdf',
  evidenceNote: '한국토요타 2026 알파드 공식 제원표 기준 HEV Premium/Executive Lounge 1차확인',
});

const expectedCounts: Record<SegmentName, number> = { 국산신차: 31, 벤츠현행: 10, 폭스바겐현행: 11, 볼보XC60: 3, 도요타현행: 16 };
for (const [name, expected] of Object.entries(expectedCounts) as [SegmentName, number][]) {
  const actual = segmentRows.get(name)?.length || 0;
  if (actual !== expected) throw new Error(`${name} 행 수 오류: ${actual}/${expected}`);
}

const placements = [...segmentRows.entries()].flatMap(([segment, rows]) => rows.map((row, index) => ({
  segment,
  sheetRow: segmentStarts[segment] + index,
  row,
})));
if (placements.length !== 71) throw new Error(`신규 보강행은 71행이어야 합니다: ${placements.length}`);
if (placements.some(({ row }) => row.length !== HEADERS.length)) throw new Error('행 열 수가 A:AD 30열과 다릅니다.');
const codes = placements.map(({ row }) => String(row[9]));
if (new Set(codes).size !== codes.length) throw new Error('신규 트림행키가 중복됩니다.');

function syncLocal() {
  const artifactPath = fileURLToPath(new URL('../public/data/vehicle-trim-master.json', import.meta.url));
  const registryPath = fileURLToPath(new URL('../data/vehicle-trim-key-registry.json', import.meta.url));
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as VehicleTrimMasterArtifact;
  const presentCodes = new Set(artifact.records.map((record) => record.trim_row_key));
  const present = codes.filter((code) => presentCodes.has(code));
  if (present.length && present.length !== codes.length) throw new Error(`일부 신규 코드만 ERP 산출물에 존재: ${present.length}/${codes.length}`);
  if (!present.length) {
    const added = buildVehicleTrimMasterArtifact([HEADERS, ...placements.map(({ row }) => row)], SPREADSHEET_ID, SHEET_NAME);
    artifact.records = [...artifact.records, ...added.records].sort((a, b) => a.trim_row_key.localeCompare(b.trim_row_key));
    artifact.data_as_of = DATA_AS_OF;
    artifact.row_count = artifact.records.length;
    artifact.manual_assignable_count = artifact.records.filter((record) => record.usage_tier === 'manual').length;
    artifact.automatic_assignable_count = artifact.records.filter((record) => record.usage_tier === 'automatic').length;
    artifact.blocked_count = artifact.row_count - artifact.manual_assignable_count - artifact.automatic_assignable_count;
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  }

  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as TrimKeyRegistry;
  const registeredCodes = new Set(registry.records.map((record) => record.code));
  const registered = codes.filter((code) => registeredCodes.has(code));
  if (registered.length && registered.length !== codes.length) throw new Error(`일부 신규 코드만 영구 레지스트리에 존재: ${registered.length}/${codes.length}`);
  if (!registered.length) {
    const sheetRowByCode = new Map(placements.map(({ sheetRow, row }) => [String(row[9]), sheetRow]));
    const added = trimKeyRecordsFromValues([HEADERS, ...placements.map(({ row }) => row)]).map((record) => ({
      ...record,
      capturedSheetRow: sheetRowByCode.get(record.code) || 0,
    }));
    registry.capturedAt = DATA_AS_OF;
    registry.records = [...registry.records, ...added].sort((a, b) => a.code.localeCompare(b.code));
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  }
  console.log(`PASS ERP 산출물·영구 행키 레지스트리 ${placements.length}행 동기화`);
}

const segments = [...segmentRows.entries()].map(([segment, rows]) => ({
  segment,
  startRow: segmentStarts[segment],
  endRow: segmentStarts[segment] + rows.length - 1,
  rows,
}));
const outputArg = process.argv.find((value) => value.startsWith('--output='))?.slice('--output='.length);
const segmentArg = process.argv.find((value) => value.startsWith('--segment='))?.slice('--segment='.length) as SegmentName | undefined;
if (process.argv.includes('--sync-local')) syncLocal();
else if (segmentArg) {
  const segment = segments.find((item) => item.segment === segmentArg);
  if (!segment) throw new Error(`알 수 없는 세그먼트: ${segmentArg}`);
  console.log(JSON.stringify(segment));
}
else if (outputArg) {
  writeFileSync(outputArg, JSON.stringify({ segments }), 'utf8');
  console.log(`PASS 신규 현행차 JSON ${placements.length}행 생성: ${outputArg}`);
} else if (process.argv.includes('--summary')) {
  console.log(JSON.stringify({ count: placements.length, segments: segments.map(({ segment, startRow, endRow, rows }) => ({ segment, startRow, endRow, count: rows.length })) }));
} else console.log(JSON.stringify({ segments }));
