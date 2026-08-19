/** Current Korean rental/subscription additions backed by OEM price sheets. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildVehicleTrimMasterArtifact, type VehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import { trimKeyRecordsFromValues, type TrimKeyRegistry } from '../lib/domain/vehicle-trim-key-contract';

const DATA_AS_OF = '2026-08-15';
const START_ROW = 7052;
const HEADERS = [
  '관리상태', '검증상태', '신차/중고차', '원산지', '제조사', '모델', '세부모델', '파워트레인', '세부트림',
  '트림행키', '마스터ID', '파워트레인순번', '트림순번', '세대명', '개발코드', '생산시작', '생산종료',
  '연식시작', '연식종료', '연료', '정확배기량(cc)', '표시배기량(L)', '터보', '구동방식', '인승',
  '배터리(kWh)', '트림별칭', '근거URL', '근거메모', '데이터기준일',
] as const;

const FILANTE_URL = 'https://cdn.renault.co.kr/upload/asset/price/price_filante_202607.pdf';
const FILANTE_MASTER_ID = 'mf-005.md-020.sm-filante__filante-hybrid-e-tech';
const FILANTE_NOTE = '르노코리아 필랑트 하이브리드 E-Tech 2026-07 공식 가격표 기준. 가솔린 1.5 터보 1,499cc, 멀티모드 오토, 100kW 구동 모터·60kW 보조 모터, 1.64kWh 배터리, 시스템 출력 250ps. 테크노/아이코닉/에스프리 알핀/에스프리 알핀 1955 실제 판매 트림을 분리함. 공식 가격표에서 구동방식 표기가 명시적이지 않아 2WD는 1차확인 수동 후보로 유지.';
const filanteRows = ['테크노', '아이코닉', '에스프리 알핀', '에스프리 알핀 1955'].map((trim, index) => [
  '검증중', '1차확인', '신차', '국산', '르노코리아', '필랑트', '필랑트 하이브리드 E-Tech',
  '하이브리드 1.5T 2WD 멀티모드 오토', trim,
  `${FILANTE_MASTER_ID}::v01::t${String(index + 1).padStart(2, '0')}`, FILANTE_MASTER_ID, 1, index + 1,
  '1세대', '', '2026-05', '현재', '2026', '현재', '하이브리드', 1499, 1.5, '예', '2WD', 5, 1.64,
  `르노 필랑트,Filante,필랑트 E-Tech,${trim}`, FILANTE_URL, FILANTE_NOTE, DATA_AS_OF,
]);

const IONIQ5_2027_URL = 'https://www.hyundai.com/contents/repn-car/catalog/ioniq-5-2027-price.pdf';
const IONIQ5_STANDARD_ID = 'mf-001.md-097.sm-ne__ioniq5-2027-standard-63k';
const IONIQ5_LONG_ID = 'mf-001.md-097.sm-ne__ioniq5-2027-long-range-84k';
const IONIQ5_BUSINESS_ID = 'mf-001.md-097.sm-ne__ioniq5-2027-business-84k';
const IONIQ5_2027_NOTE = '현대 2027 아이오닉 5 공식 가격표(현 모델 출시일 2026-06-09, 보조금 가격 2026-08-01 기준). Standard 63.0kWh 2WD E-Value Plus, Long Range 84.0kWh E-Lite/모던/프리미엄/N Line/인스퍼레이션과 HTRAC AWD 선택, 84.0kWh 영업용 및 HTRAC 선택을 배터리·구동별 영구 코드로 분리함. 공식 가격표·산업부 인증 제원 교차확인.';
const ioniq5StandardRows = [[
  '검증중', '교차확인', '신차', '국산', '현대', '아이오닉5', '2027 아이오닉 5 Standard',
  '전기 63.0kWh 2WD', 'E-Value Plus', `${IONIQ5_STANDARD_ID}::v01::t01`, IONIQ5_STANDARD_ID, 1, 1,
  '1세대 부분변경', 'NE', '2026-06', '현재', '2027', '현재', '전기', '', '', '아니오', '2WD', 5, 63,
  '아이오닉5 스탠다드,아이오닉 5 Standard,이-밸류 플러스,E-Value +', IONIQ5_2027_URL, IONIQ5_2027_NOTE, DATA_AS_OF,
]];
const IONIQ5_LONG_TRIMS = ['E-Lite', '모던', '프리미엄', 'N Line', '인스퍼레이션'] as const;
const ioniq5LongRows = (['2WD', 'AWD'] as const).flatMap((drive, driveIndex) =>
  IONIQ5_LONG_TRIMS.map((trim, trimIndex) => [
    '검증중', '교차확인', '신차', '국산', '현대', '아이오닉5', '2027 아이오닉 5 Long Range',
    `전기 84.0kWh ${drive}`, trim,
    `${IONIQ5_LONG_ID}::v${String(driveIndex + 1).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`,
    IONIQ5_LONG_ID, driveIndex + 1, trimIndex + 1, '1세대 부분변경', 'NE', '2026-06', '현재', '2027', '현재',
    '전기', '', '', '아니오', drive, 5, 84,
    `아이오닉5 롱레인지,아이오닉 5 Long Range,아이오닉5 ${trim},${drive === 'AWD' ? 'HTRAC' : '후륜구동'}`,
    IONIQ5_2027_URL, IONIQ5_2027_NOTE, DATA_AS_OF,
  ]),
);
const ioniq5BusinessRows = (['2WD', 'AWD'] as const).map((drive, driveIndex) => [
  '검증중', '교차확인', '신차', '국산', '현대', '아이오닉5', '2027 아이오닉 5 영업용',
  `전기 84.0kWh ${drive}`, '영업용', `${IONIQ5_BUSINESS_ID}::v${String(driveIndex + 1).padStart(2, '0')}::t01`,
  IONIQ5_BUSINESS_ID, driveIndex + 1, 1, '1세대 부분변경', 'NE', '2026-06', '현재', '2027', '현재',
  '전기', '', '', '아니오', drive, 5, 84,
  `아이오닉5 영업용,아이오닉 5 비즈니스,아이오닉5 택시,${drive === 'AWD' ? 'HTRAC' : '후륜구동'}`,
  IONIQ5_2027_URL, IONIQ5_2027_NOTE, DATA_AS_OF,
]);
const IONIQ5_2022_URL = 'https://www.hyundai.com/contents/repn-car/catalog/ioniq5-price.pdf';
const IONIQ5_58_ID = 'mf-001.md-098.sm-ne__ioniq5-2022-standard-58k';
const IONIQ5_77_ID = 'mf-001.md-098.sm-ne__ioniq5-2022-long-range-77k';
const IONIQ5_2022_BUSINESS_ID = 'mf-001.md-098.sm-ne__ioniq5-2022-business';
const IONIQ5_2022_NOTE = '현대 아이오닉 5 공식 가격표(현 모델 출시일 2022-07-15) 기준. Standard 58.0kWh 익스클루시브의 2WD/HTRAC와 E-Lite HTRAC, Long Range 77.4kWh 익스클루시브·프레스티지의 2WD/HTRAC, 영업용 58.0kWh 및 Long Range 77.4kWh/HTRAC를 배터리·구동별로 분리함. 더 뉴 아이오닉 5가 2024-03 출시되어 생산종료는 2024-02로 경계 설정. 기존 배터리 미구분 행은 제외 상태로 보존.';
const ioniq5_58Rows = [
  { drive: '2WD', trim: '익스클루시브', variant: 1, trimSeq: 1 },
  { drive: 'AWD', trim: '익스클루시브', variant: 2, trimSeq: 1 },
  { drive: 'AWD', trim: 'E-Lite HTRAC', variant: 2, trimSeq: 2 },
].map((config) => [
  '검증중', '교차확인', '중고차', '국산', '현대', '아이오닉5', '아이오닉 5 Standard 58.0kWh',
  `전기 58.0kWh ${config.drive}`, config.trim,
  `${IONIQ5_58_ID}::v${String(config.variant).padStart(2, '0')}::t${String(config.trimSeq).padStart(2, '0')}`,
  IONIQ5_58_ID, config.variant, config.trimSeq, '1세대', 'NE', '2022-07', '2024-02', '2023', '2024',
  '전기', '', '', '아니오', config.drive, 5, 58,
  `아이오닉5 스탠다드,아이오닉 5 58kWh,아이오닉5 ${config.trim},${config.drive === 'AWD' ? 'HTRAC' : '후륜구동'}`,
  IONIQ5_2022_URL, IONIQ5_2022_NOTE, DATA_AS_OF,
]);
const ioniq5_77Rows = (['2WD', 'AWD'] as const).flatMap((drive, driveIndex) =>
  ['익스클루시브', '프레스티지'].map((trim, trimIndex) => [
    '검증중', '교차확인', '중고차', '국산', '현대', '아이오닉5', '아이오닉 5 Long Range 77.4kWh',
    `전기 77.4kWh ${drive}`, trim,
    `${IONIQ5_77_ID}::v${String(driveIndex + 1).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`,
    IONIQ5_77_ID, driveIndex + 1, trimIndex + 1, '1세대', 'NE', '2022-07', '2024-02', '2023', '2024',
    '전기', '', '', '아니오', drive, 5, 77.4,
    `아이오닉5 롱레인지,아이오닉 5 77.4kWh,아이오닉5 ${trim},${drive === 'AWD' ? 'HTRAC' : '후륜구동'}`,
    IONIQ5_2022_URL, IONIQ5_2022_NOTE, DATA_AS_OF,
  ]),
);
const ioniq5_2022BusinessRows = [
  { battery: 58, drive: '2WD', variant: 1, trim: '영업용' },
  { battery: 77.4, drive: '2WD', variant: 2, trim: '영업용 롱레인지' },
  { battery: 77.4, drive: 'AWD', variant: 3, trim: '영업용 롱레인지 HTRAC' },
].map((config) => [
  '검증중', '교차확인', '중고차', '국산', '현대', '아이오닉5', '아이오닉 5 영업용 2022',
  `전기 ${config.battery.toFixed(1)}kWh ${config.drive}`, config.trim,
  `${IONIQ5_2022_BUSINESS_ID}::v${String(config.variant).padStart(2, '0')}::t01`, IONIQ5_2022_BUSINESS_ID,
  config.variant, 1, '1세대', 'NE', '2022-07', '2024-02', '2023', '2024', '전기', '', '', '아니오', config.drive, 5,
  config.battery, `아이오닉5 영업용,아이오닉5 택시,아이오닉 5 비즈니스,${config.trim}`,
  IONIQ5_2022_URL, IONIQ5_2022_NOTE, DATA_AS_OF,
]);
const IONIQ5_72_ID = 'mf-001.md-099.sm-ne__ioniq5-2021-long-range-72k';
const IONIQ5_72_2WD_URL = 'https://certified.hyundai.com/p/goods/goodsDetail.do?goodsNo=HNE250124011988&requestURI=%2Flink%2FgoodsDetail.do';
const IONIQ5_72_AWD_URL = 'https://certified.hyundai.com/p/goods/goodsDetail.do?goodsNo=HNE240328005000';
const IONIQ5_72_NOTE = '현대자동차 인증중고차 공식 실차 제원 기준. 2021-07 최초등록 2022년형 2WD 롱레인지 익스클루시브와 2022-02 최초등록 2022년형 AWD 롱레인지 프레스티지에서 72.6kWh 배터리·구동방식을 직접 확인함. 같은 제조사 공식 페이지의 실제 구매차량 정보에서 2WD 프레스티지와 AWD 익스클루시브 조합도 교차 확인함. 77.4kWh 현 모델 출시일 2022-07-15 이전 세대로 경계를 분리하고 기존 배터리 미구분 행은 제외 상태로 보존.';
const ioniq5_72Rows = (['2WD', 'AWD'] as const).flatMap((drive, driveIndex) =>
  ['익스클루시브', '프레스티지'].map((trim, trimIndex) => [
    '검증중', '교차확인', '중고차', '국산', '현대', '아이오닉5', '아이오닉 5 Long Range 72.6kWh',
    `전기 72.6kWh ${drive}`, trim,
    `${IONIQ5_72_ID}::v${String(driveIndex + 1).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`,
    IONIQ5_72_ID, driveIndex + 1, trimIndex + 1, '1세대', 'NE', '2021-04', '2022-06', '2022', '2022',
    '전기', '', '', '아니오', drive, 5, 72.6,
    `아이오닉5 초기형,아이오닉 5 72.6kWh,아이오닉5 롱레인지,아이오닉5 ${trim},${drive === 'AWD' ? 'HTRAC' : '후륜구동'}`,
    drive === 'AWD' ? IONIQ5_72_AWD_URL : IONIQ5_72_2WD_URL, IONIQ5_72_NOTE, DATA_AS_OF,
  ]),
);
const NIRO_DE_64_ID = 'mf-002.md-100.sm-de__niro-ev-64k';
const NIRO_DE_NOTICE_URL = 'https://www.kia.com/kr/customer-service/notice/notice-202407311';
const NIRO_DE_NOTE = '기아 공식 배터리 제조사 공지에서 니로 EV DE의 국내 생산기간을 2018-07~2021-12로 확인하고, 기아 헤리티지 아카이브에서 64.0kWh 배터리를 확인함. 기아 인증중고차 공식 매물에서 2021 니로 EV A/T 프레스티지와 2019·2020 니로 EV A/T 노블레스 실차 트림을 교차 확인함. 글로벌 보도자료에 언급된 39.2kWh는 국내 유통 실차 근거가 부족해 발급하지 않고 기존 배터리 미구분 행은 제외 상태로 보존.';
const niroDe64Rows = ['프레스티지', '노블레스'].map((trim, trimIndex) => [
  '검증중', '교차확인', '중고차', '국산', '기아', '니로', '니로 EV DE 64.0kWh', '전기 64.0kWh FWD', trim,
  `${NIRO_DE_64_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`, NIRO_DE_64_ID, 1, trimIndex + 1,
  '1세대', 'DE', '2018-07', '2021-12', '2019', '2022', '전기', '', '', '아니오', 'FWD', 5, 64,
  `니로 EV,니로 전기차,니로 EV 64kWh,니로 일렉트릭,${trim}`,
  trim === '프레스티지' ? 'https://cpo.kia.com/products/detail/?id=9789' : 'https://cpo.kia.com/products/detail/?id=737',
  `${NIRO_DE_NOTE} 생산기간 근거: ${NIRO_DE_NOTICE_URL}`, DATA_AS_OF,
]);
const SOUL_SK3_ID = 'mf-002.md-101.sm-sk3__soul-booster-ev';
const SOUL_SK3_CATALOG_URL = 'https://www.kia.com/content/dam/kwcms/kr/ko/files/ESK/catalog/catalog_soul-ev.pdf';
const SOUL_SK3_NOTE = '기아 2020-11 쏘울 EV 공식 카탈로그 기준. 노블레스(기본형 배터리)는 64kWh·150kW·386km, 프레스티지(도심형 배터리)는 39.2kWh·100kW·250km로 명시되어 배터리와 실제 트림을 한 쌍으로 분리함. 기아 공식 고전압배터리 안내의 SK3 EV 제작년월 2019-02~2020-11을 생산 경계로 적용함.';
const soulSk3Rows = [
  { variant: 1, battery: 64, trim: '노블레스', batteryLabel: '기본형 배터리' },
  { variant: 2, battery: 39.2, trim: '프레스티지', batteryLabel: '도심형 배터리' },
].map((config) => [
  '검증중', '교차확인', '중고차', '국산', '기아', '쏘울', '쏘울 부스터 EV SK3',
  `전기 ${config.battery.toFixed(config.battery % 1 ? 1 : 0)}kWh FWD`, config.trim,
  `${SOUL_SK3_ID}::v${String(config.variant).padStart(2, '0')}::t01`, SOUL_SK3_ID, config.variant, 1,
  '3세대', 'SK3', '2019-02', '2020-11', '2019', '2021', '전기', '', '', '아니오', 'FWD', 5, config.battery,
  `쏘울 EV,쏘울 부스터 전기차,쏘울 일렉트릭,${config.trim},${config.batteryLabel}`,
  SOUL_SK3_CATALOG_URL, SOUL_SK3_NOTE, DATA_AS_OF,
]);
const AVANTE_AD_LPI_ID = 'mf-001.md-102.sm-ad__avante-ad-lpi';
const AVANTE_AD_CPO_URL = 'https://certified.hyundai.com/p/search/vehicle?fuelList=001%2C002%2C004&mdlGrpList=96%2C110%2C112%2C1421&requestURI=%2Flink%2Fsearch%2Fvehicle%2Flease&saleCorpCd=5&srchType=srchFilter';
const AVANTE_AD_LPI_NOTE = '현대자동차 인증중고차 공식 차종 분류에서 아반떼 AD(15~18년) LPG 1.6의 실제 트림 스타일·스마트·법인전용을 확인함. 현대자동차 헤리티지의 2015-09 출시, 1,591cc·전륜구동 제원과 2018-09 더 뉴 아반떼 출시 경계를 교차 적용해 초기형 생산기간을 2015-09~2018-08로 설정함. 기존 트림 미상 LPG 1.6 행은 제외 상태로 보존.';
const avanteAdLpiRows = ['스타일', '스마트', '법인전용'].map((trim, trimIndex) => [
  '검증중', '교차확인', '중고차', '국산', '현대', '아반떼', '아반떼 AD', 'LPG 1.6 FWD', trim,
  `${AVANTE_AD_LPI_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`, AVANTE_AD_LPI_ID, 1, trimIndex + 1,
  '6세대', 'AD', '2015-09', '2018-08', '2016', '2018', 'LPG', 1591, 1.6, '아니오', 'FWD', 5, '',
  `아반떼 AD LPi,아반떼 LPG,아반떼 렌터카,아반떼 LPI 1.6,${trim}`,
  AVANTE_AD_CPO_URL, AVANTE_AD_LPI_NOTE, DATA_AS_OF,
]);
const CASPER_ELECTRIC_ID = 'mf-001.md-103.sm-ax1e__casper-electric';
const CASPER_ELECTRIC_PRICE_URL = 'https://casper.hyundai.com/wcontents/repn-car/catalog/AX05/AX_CASPER_Electric_price.pdf';
const CASPER_ELECTRIC_NOTE = '현대자동차 캐스퍼 공식 가격표 기준. 프리미엄은 42kWh 리튬 이온 배터리, 인스퍼레이션은 49kWh 배터리이며 크로스와 라운지는 인스퍼레이션 기본 품목을 승계하는 49kWh 트림으로 분리했다. 현대차 헤리티지의 캐스퍼 Electric 출시 시점 2024-08과 공식 전기차 배터리 정보의 항속형·크로스 49kWh를 교차 확인했다. 기존 AX1 전기 행은 내연기관 생산기간과 배터리 미구분 상태이므로 영구 코드를 재사용하지 않고 AX1e 신규 마스터로 발급했다.';
const casperElectricRows = [
  { variant: 1, trimSeq: 1, battery: 42, trim: '프리미엄' },
  { variant: 2, trimSeq: 1, battery: 49, trim: '인스퍼레이션' },
  { variant: 2, trimSeq: 2, battery: 49, trim: '크로스' },
  { variant: 2, trimSeq: 3, battery: 49, trim: '라운지' },
].map((config) => [
  '검증중', '교차확인', '신차', '국산', '현대', '캐스퍼', '캐스퍼 일렉트릭 AX1e',
  `전기 ${config.battery.toFixed(1)}kWh FWD`, config.trim,
  `${CASPER_ELECTRIC_ID}::v${String(config.variant).padStart(2, '0')}::t${String(config.trimSeq).padStart(2, '0')}`,
  CASPER_ELECTRIC_ID, config.variant, config.trimSeq, '1세대', 'AX1e', '2024-08', '현재', '2025', '현재',
  '전기', '', '', '아니오', 'FWD', 4, config.battery,
  `캐스퍼 EV,캐스퍼 전기차,캐스퍼 일렉트릭,${config.trim},${config.battery}kWh`,
  CASPER_ELECTRIC_PRICE_URL, CASPER_ELECTRIC_NOTE, DATA_AS_OF,
]);
const CASPER_ELECTRIC_PHASED_ID = 'mf-001.md-103.sm-ax1e-phased__casper-electric-phased';
const CASPER_ELECTRIC_PREMIUM_EVENT_URL = 'https://casper.hyundai.com/vehicles/event/EventDetail?eventNumber=E000000166';
const CASPER_ELECTRIC_CROSS_EVENT_URL = 'https://casper.hyundai.com/vehicles/event/EventDetail?eventNumber=E000000185';
const CASPER_ELECTRIC_LOUNGE_EVENT_URL = 'https://casper.hyundai.com/vehicles/event/EventDetail?eventNumber=E000000216';
const casperElectricPhasedRows = ([
  { variant: 1, trimSeq: 1, battery: 42, trim: '프리미엄', start: '2024-10', modelYear: '2025', eventUrl: CASPER_ELECTRIC_PREMIUM_EVENT_URL, launch: '2024-10-18' },
  { variant: 2, trimSeq: 1, battery: 49, trim: '크로스', start: '2025-02', modelYear: '2025', eventUrl: CASPER_ELECTRIC_CROSS_EVENT_URL, launch: '2025-02-11' },
  { variant: 2, trimSeq: 2, battery: 49, trim: '라운지', start: '2026-03', modelYear: '2026', eventUrl: CASPER_ELECTRIC_LOUNGE_EVENT_URL, launch: '2026-03-17' },
] as const).map((config) => [
  '검증중', '교차확인', '신차', '국산', '현대', '캐스퍼', '캐스퍼 일렉트릭 AX1e 트림별 출시계보',
  `전기 ${config.battery.toFixed(1)}kWh FWD`, config.trim,
  `${CASPER_ELECTRIC_PHASED_ID}::v${String(config.variant).padStart(2, '0')}::t${String(config.trimSeq).padStart(2, '0')}`,
  CASPER_ELECTRIC_PHASED_ID, config.variant, config.trimSeq, '1세대 트림확장', 'AX1e', config.start, '현재', config.modelYear, '현재',
  '전기', '', '', '아니오', 'FWD', 4, config.battery,
  `캐스퍼 EV,캐스퍼 전기차,캐스퍼 일렉트릭,${config.trim},${config.battery}kWh`, config.eventUrl,
  `현대자동차 캐스퍼 공식 ${config.trim} 출시 이벤트 시작일 ${config.launch}과 현행 공식 가격표의 배터리·트림 구성을 기준으로 발급했다. 최초 캐스퍼 Electric 출시월 2024-08로 소급하지 않는다. 현행 가격표: ${CASPER_ELECTRIC_PRICE_URL}`,
  DATA_AS_OF,
]);
const HYUNDAI_2027_CASPER_PRICE_URL = 'https://casper.hyundai.com/wcontents/repn-car/catalog/AX08/AX_CASPER_price.pdf';
const HYUNDAI_2027_CASPER_PAGE_URL = 'https://casper.hyundai.com/vehicles/highlight';
const HYUNDAI_2027_CASPER_ID = 'mf-001.md-062.sm-ax1-my2027__casper-2027';
const HYUNDAI_2027_CASPER_NOTE = `현대자동차 캐스퍼 공식 2027 CASPER 출시 페이지와 2026-07-15 가격표 기준. 승용 스마트·디 에센셜·인스퍼레이션과 VAN 스마트·스마트 초이스에 스마트스트림 가솔린 1.0 또는 캐스퍼 액티브 카파 1.0 터보를 선택할 수 있어 차체·엔진·트림별로 분리했다. 출시 페이지: ${HYUNDAI_2027_CASPER_PAGE_URL}`;
const hyundai2027CasperRows = ([
  ...(['스마트', '디 에센셜', '인스퍼레이션'] as const).map((trim, index) => ({ variant: 1, trimSeq: index + 1, body: '승용', seats: 4, powertrain: '가솔린 1.0', trim, turbo: '아니오' })),
  ...(['스마트', '디 에센셜', '인스퍼레이션'] as const).map((trim, index) => ({ variant: 2, trimSeq: index + 1, body: '승용', seats: 4, powertrain: '가솔린 1.0T', trim, turbo: '예' })),
  ...(['스마트', '스마트 초이스'] as const).map((trim, index) => ({ variant: 3, trimSeq: index + 1, body: 'VAN', seats: 2, powertrain: '가솔린 1.0 VAN', trim, turbo: '아니오' })),
  ...(['스마트', '스마트 초이스'] as const).map((trim, index) => ({ variant: 4, trimSeq: index + 1, body: 'VAN', seats: 2, powertrain: '가솔린 1.0T VAN', trim, turbo: '예' })),
]).map((config) => [
  '검증중', '교차확인', '신차', '국산', '현대', '캐스퍼', `2027 캐스퍼 AX1 ${config.body}`,
  config.powertrain, config.trim,
  `${HYUNDAI_2027_CASPER_ID}::v${String(config.variant).padStart(2, '0')}::t${String(config.trimSeq).padStart(2, '0')}`,
  HYUNDAI_2027_CASPER_ID, config.variant, config.trimSeq, '1세대 2027 연식변경', 'AX1', '2026-07', '현재', '2027', '현재',
  '가솔린', 998, 1, config.turbo, '2WD', config.seats, '',
  `현대 2027 캐스퍼,2027 CASPER,캐스퍼 AX1,${config.body},${config.powertrain},${config.trim}`,
  HYUNDAI_2027_CASPER_PRICE_URL, HYUNDAI_2027_CASPER_NOTE, DATA_AS_OF,
]);
const BOLT_EV_2022_ID = 'mf-003.md-058.sm-bolt-ev__bolt-ev-2022-66k';
const BOLT_EV_2022_PRICE_URL = 'https://pp.chevrolet.co.kr/httpobject/file/pricelist/bolt.pdf';
const BOLT_EV_2022_NOTE = '쉐보레 코리아 공식 볼트 EV 가격표와 공식 2022년형 제원·사전계약 보도자료 기준. 국내 판매 트림은 Premier, 66kWh 리튬이온 배터리, 150kW 싱글 모터, 전륜구동, 5인승으로 확인했다. 공식 보도자료의 2022년 2분기 고객 인도 재개 시점을 생산·유통 시작 경계로 적용했다. 기존 뉴 볼트 EV 행은 영구키가 차단 상태이므로 의미를 덮어쓰지 않고 신규 마스터를 발급했다.';
const boltEv2022Rows = [[
  '검증중', '교차확인', '중고차', '수입', '쉐보레', '볼트 EV', '2022 볼트 EV 부분변경',
  '전기 66.0kWh FWD', 'Premier', `${BOLT_EV_2022_ID}::v01::t01`, BOLT_EV_2022_ID, 1, 1,
  '1세대 부분변경', 'BEV2', '2022-04', '2023-12', '2022', '2023', '전기', '', '', '아니오', 'FWD', 5, 66,
  '볼트EV,볼트 EV 프리미어,뉴 볼트 EV,2022 볼트 EV,Bolt EV Premier',
  BOLT_EV_2022_PRICE_URL, BOLT_EV_2022_NOTE, DATA_AS_OF,
]];
const IONIQ_ELECTRIC_38_ID = 'mf-001.md-104.sm-ae-pe__ioniq-electric-38k';
const IONIQ_ELECTRIC_38_PRICE_URL = 'https://www.hyundai.com/content/dam/hyundai/kr/ko/data/vehicles/price/ioniq-electric-price.pdf';
const IONIQ_ELECTRIC_38_NOTE = '현대자동차 공식 아이오닉 일렉트릭 가격표 기준. N과 Q 두 국내 트림 모두 100kW 구동 모터와 38.3kWh 리튬 이온 폴리머 배터리를 사용한다. 현대자동차 지속가능성 보고서에서 2019-05 부분변경 출시와 기존 28kWh에서 38.3kWh로의 변경을 교차 확인했다. 구형 28kWh 모델은 배터리 제원은 확인되지만 국내 연식별 트림 원문이 부족하여 이번 발급에서 제외했다.';
const ioniqElectric38Rows = ['N', 'Q'].map((trim, trimIndex) => [
  '검증중', '교차확인', '중고차', '국산', '현대', '아이오닉', '더 뉴 아이오닉 일렉트릭 AE',
  '전기 38.3kWh FWD', trim,
  `${IONIQ_ELECTRIC_38_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`,
  IONIQ_ELECTRIC_38_ID, 1, trimIndex + 1, '1세대 부분변경', 'AE PE', '2019-05', '2021-12', '2020', '2021',
  '전기', '', '', '아니오', 'FWD', 5, 38.3,
  `아이오닉 EV,아이오닉 전기차,IONIQ Electric,더 뉴 아이오닉 일렉트릭,${trim}`,
  IONIQ_ELECTRIC_38_PRICE_URL, IONIQ_ELECTRIC_38_NOTE, DATA_AS_OF,
]);
const BMW_I3_120_ID = 'mf-012.md-044.sm-i01__bmw-i3-120ah';
const BMW_I3_120_URL = 'https://www.press.bmwgroup.com/korea/article/detail/T0295514KO/bmw-%EA%B7%B8%EB%A3%B9-%EC%BD%94%EB%A6%AC%EC%95%84-i3-120ah-%EA%B3%B5%EC%8B%9D-%EC%B6%9C%EC%8B%9C';
const BMW_I3_120_NOTE = 'BMW 그룹 코리아 공식 2019-05-02 국내 출시자료 기준. i3 120Ah는 37.9kWh 고전압 리튬이온 배터리와 170마력 eDrive 모터를 사용하며 국내 트림은 LUX와 SOL+ 두 가지다. BMW 공식 이전 자료에서 i3가 후륜구동·4인승임을 교차 확인했다. 기존 배터리 미구분 i3 영구키는 의미를 변경하지 않고 차단 상태로 보존하며, 공식 국내 120Ah 자료에 없는 SOL 조합은 발급하지 않았다.';
const bmwI3_120Rows = ['LUX', 'SOL+'].map((trim, trimIndex) => [
  '검증중', '교차확인', '중고차', '수입', 'BMW', 'i3', '뉴 BMW i3 120Ah I01',
  '전기 37.9kWh RWD', trim,
  `${BMW_I3_120_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`,
  BMW_I3_120_ID, 1, trimIndex + 1, '1세대 부분변경', 'I01', '2019-05', '2022-06', '2019', '2022',
  '전기', '', '', '아니오', 'RWD', 4, 37.9,
  `BMW i3 120Ah,i3 120 Ah,i3 37.9kWh,${trim === 'SOL+' ? '솔+,SOL Plus' : '룩스'}`,
  BMW_I3_120_URL, BMW_I3_120_NOTE, DATA_AS_OF,
]);
const BMW_I3_94_ID = 'mf-012.md-044.sm-i01__bmw-i3-94ah';
const BMW_I3_94_URL = 'https://www.press.bmwgroup.com/korea/pressDetail.html?id=T0278467KO&left_menu_item=node__809&outputChannelId=27';
const BMW_I3_94_NOTE = 'BMW 그룹 코리아 공식 2018-02-05 국내 사전계약·제원자료 기준. 뉴 i3 94Ah는 33kWh급 고전압 리튬이온 배터리의 순수 충전 용량이 27.2kWh이며, 170마력 eDrive 모터와 후륜구동을 사용한다. 국내 트림은 LUX와 SOL+ 두 가지다. 프리패스 배터리 필드는 120Ah 국내자료의 37.9kWh 표기와 동일하게 실사용 순수 충전 용량 기준으로 기록했다.';
const bmwI3_94Rows = ['LUX', 'SOL+'].map((trim, trimIndex) => [
  '검증중', '교차확인', '중고차', '수입', 'BMW', 'i3', '뉴 BMW i3 94Ah I01',
  '전기 27.2kWh RWD', trim,
  `${BMW_I3_94_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`,
  BMW_I3_94_ID, 1, trimIndex + 1, '1세대 부분변경', 'I01', '2018-03', '2019-04', '2018', '2019',
  '전기', '', '', '아니오', 'RWD', 4, 27.2,
  `BMW i3 94Ah,i3 94 Ah,i3 27.2kWh,i3 33kWh,${trim === 'SOL+' ? '솔+,SOL Plus' : '룩스'}`,
  BMW_I3_94_URL, BMW_I3_94_NOTE, DATA_AS_OF,
]);
const IONIQ_ELECTRIC_28_ID = 'mf-001.md-104.sm-ae__ioniq-electric-28k';
const IONIQ_ELECTRIC_28_PRICE_URL = 'https://www.hyundai.com/content/dam/hyundai/kr/ko/html/pdf/en-cn-price/cn-price/ioniq-electric-price-cn.pdf';
const IONIQ_ELECTRIC_28_NOTE = '현대자동차 공식 국내용 가격표의 외국어 병기본 기준. N 기본 품목에 88kW 구동 모터와 28kWh 리튬 이온 폴리머 배터리가 명시되고 Q는 N 기본 품목을 승계한다. 현대자동차 공식 전동화 연혁에서 아이오닉 전기차 2016-07 양산을 확인하고, 공식 지속가능성 보고서의 38.3kWh 부분변경 시점 2019-05 직전까지를 생산 경계로 적용했다.';
const ioniqElectric28Rows = ['N', 'Q'].map((trim, trimIndex) => [
  '검증중', '교차확인', '중고차', '국산', '현대', '아이오닉', '아이오닉 일렉트릭 AE',
  '전기 28.0kWh FWD', trim,
  `${IONIQ_ELECTRIC_28_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`,
  IONIQ_ELECTRIC_28_ID, 1, trimIndex + 1, '1세대', 'AE', '2016-07', '2019-04', '2017', '2019',
  '전기', '', '', '아니오', 'FWD', 5, 28,
  `아이오닉 EV,아이오닉 전기차,IONIQ Electric,아이오닉 일렉트릭 28kWh,${trim}`,
  IONIQ_ELECTRIC_28_PRICE_URL, IONIQ_ELECTRIC_28_NOTE, DATA_AS_OF,
]);
const IONIQ5_FACELIFT_STANDARD_ID = 'mf-001.md-061.sm-ne-pe__ioniq5-standard-63k';
const IONIQ5_FACELIFT_LONG_ID = 'mf-001.md-061.sm-ne-pe__ioniq5-long-range-84k';
const IONIQ5_FACELIFT_PRICE_URL = 'https://www.hyundai.com/content/dam/hyundai/kr/ko/data/vehicles/price/en/the-new-ioniq5-price-en.pdf';
const IONIQ5_FACELIFT_NOTE = '현대자동차 공식 국내 판매 가격표 기준. 더 뉴 아이오닉 5 스탠다드는 후륜 모터와 63.0kWh 리튬 이온 배터리를 사용하며 E-Value+와 익스클루시브 트림을 확인했다. 롱레인지는 84.0kWh 배터리를 사용하고 익스클루시브·프레스티지 트림에서 HTRAC(전륜 모터)을 선택할 수 있어 RWD와 AWD를 분리했다. 기존 배터리 용량 미구분 행은 의미를 변경하지 않고 차단 상태로 보존한다.';
const ioniq5FaceliftStandardRows = ['E-Value Plus', '익스클루시브'].map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '국산', '현대', '아이오닉5', '더 뉴 아이오닉 5 NE PE',
  '전기 63.0kWh RWD', trim,
  `${IONIQ5_FACELIFT_STANDARD_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`,
  IONIQ5_FACELIFT_STANDARD_ID, 1, trimIndex + 1, '1세대 부분변경', 'NE PE', '2024-03', '현재', '2024', '현재',
  '전기', '', '', '아니오', 'RWD', 5, 63,
  `아이오닉5 스탠다드,더 뉴 아이오닉5 63kWh,IONIQ 5 Standard,${trim === 'E-Value Plus' ? 'E-Value+,E Value Plus' : trim}`,
  IONIQ5_FACELIFT_PRICE_URL, IONIQ5_FACELIFT_NOTE, DATA_AS_OF,
]);
const ioniq5FaceliftLongRows = (['RWD', 'AWD'] as const).flatMap((drive, driveIndex) =>
  ['익스클루시브', '프레스티지'].map((trim, trimIndex) => [
    '검증중', '교차확인', '신차', '국산', '현대', '아이오닉5', '더 뉴 아이오닉 5 NE PE',
    `전기 84.0kWh ${drive}`, trim,
    `${IONIQ5_FACELIFT_LONG_ID}::v${String(driveIndex + 1).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`,
    IONIQ5_FACELIFT_LONG_ID, driveIndex + 1, trimIndex + 1, '1세대 부분변경', 'NE PE', '2024-03', '현재', '2024', '현재',
    '전기', '', '', '아니오', drive, 5, 84,
    `아이오닉5 롱레인지,더 뉴 아이오닉5 84kWh,IONIQ 5 Long Range,${trim},${drive === 'AWD' ? 'HTRAC,사륜구동' : '후륜구동'}`,
    IONIQ5_FACELIFT_PRICE_URL, IONIQ5_FACELIFT_NOTE, DATA_AS_OF,
  ]),
);
const VOLVO_EX90_ID = 'mf-017.md-027.sm-ex90__ex90-2026-106k';
const VOLVO_EX90_URL = 'https://www.volvocars.com/kr/news/culture/20260401-Volvo-EX90-Launches-in-Korea/';
const VOLVO_EX90_SPEC_URL = 'https://www.volvocars.com/kr/cars/ex90-electric/specifications/';
const VOLVO_EX90_NOTE = `볼보자동차코리아 공식 2026-04-01 국내 출시 자료와 공식 제원 기준. 국내 파워트레인은 106kWh NCM 배터리와 AWD 기반 Twin Motor 및 Twin Motor Performance이며, Ultra는 각각 7인승과 6인승 가격이 명시됐다. 공식 제원 페이지에서도 두 파워트레인의 106kWh·AWD·6~7인승을 교차 확인했다. Twin Motor Plus는 출시 가격은 확인되지만 가격 문구에 좌석 구성이 직접 연결되지 않아 영구 코드를 발급하지 않았다. 제원 교차 근거: ${VOLVO_EX90_SPEC_URL}`;
const volvoEx90Rows = (['Twin Motor', 'Twin Motor Performance'] as const).flatMap((motor, motorIndex) =>
  [7, 6].map((seats, seatIndex) => [
    '검증중', '교차확인', '신차', '수입', '볼보', 'EX90', '볼보 EX90 1세대',
    `전기 106.0kWh AWD ${motor}`, `Ultra ${seats}인승`,
    `${VOLVO_EX90_ID}::v${String(motorIndex + 1).padStart(2, '0')}::t${String(seatIndex + 1).padStart(2, '0')}`,
    VOLVO_EX90_ID, motorIndex + 1, seatIndex + 1, '1세대', 'EX90', '2026-04', '현재', '2026', '현재',
    '전기', '', '', '아니오', 'AWD', seats, 106,
    `볼보 EX90,EX90 ${motor},${motor === 'Twin Motor Performance' ? '트윈 모터 퍼포먼스' : '트윈 모터'},울트라 ${seats}인승,Ultra ${seats} Seater`,
    VOLVO_EX90_URL, VOLVO_EX90_NOTE, DATA_AS_OF,
  ]),
);
const BENZ_EQC_80_ID = 'mf-013.md-038.sm-n293__eqc-400-80k';
const BENZ_EQC_URL = 'https://media.mercedes-benz.com/article/6f121b22-e57e-47fb-8eb4-38fb20e69fad';
const BENZ_EQC_KOREA_URL = 'https://www.mercedes-benz.co.kr/passengercars/brand/news-events/news-story/2020/news-2020EQC.html';
const BENZ_EQC_NOTE = `메르세데스-벤츠 공식 EQC 개발 자료 기준 EQC 400 4MATIC은 사용 가능 용량 80kWh 배터리와 전륜·후륜 전기 구동장치를 사용하는 사륜구동 모델이다. 메르세데스-벤츠 코리아 국내 판매 자료와 당시 공식 발표에서 EQC 400 4MATIC, Edition 1886, Premium 세 트림을 확인했다. 기존 85kWh 원천 행은 국내 세부 제원과 불일치해 의미를 변경하지 않고 차단 상태로 보존한다. 국내 트림 교차 근거: ${BENZ_EQC_KOREA_URL}`;
const benzEqc80Rows = ['EQC 400 4MATIC', 'EQC 400 4MATIC Edition 1886', 'EQC 400 4MATIC Premium'].map((trim, trimIndex) => [
  '검증중', '교차확인', '중고차', '수입', '벤츠', 'EQC', '더 뉴 EQC N293',
  '전기 80.0kWh 4MATIC', trim,
  `${BENZ_EQC_80_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`,
  BENZ_EQC_80_ID, 1, trimIndex + 1, '1세대', 'N293', '2019-10', '2023-05', '2020', '2023',
  '전기', '', '', '아니오', '4MATIC', 5, 80,
  `벤츠 EQC,Mercedes-Benz EQC,EQC400,EQC 400 4매틱,${trim.replace('EQC 400 4MATIC ', '')}`,
  BENZ_EQC_URL, BENZ_EQC_NOTE, DATA_AS_OF,
]);
const PEUGEOT_5008_P67_ID = 'mf-021.md-025.sm-p67__5008-smart-hybrid-1-2';
const PEUGEOT_5008_P67_URL = 'https://www.epeugeot.co.kr/new-cars/5008hybrid.html';
const PEUGEOT_5008_P67_LAUNCH_URL = 'https://www.media.stellantis.com/kr-ko/peugeot/press/%ED%91%B8%EC%A1%B0-%EC%98%AC-%EB%89%B4-5008-%EC%8A%A4%EB%A7%88%ED%8A%B8-%ED%95%98%EC%9D%B4%EB%B8%8C%EB%A6%AC%EB%93%9C-%EA%B3%B5%EC%8B%9D-%EC%B6%9C%EC%8B%9C';
const PEUGEOT_5008_P67_NOTE = `푸조 코리아 공식 국내 모델 페이지 기준 올 뉴 5008 스마트 하이브리드는 1,199cc 직렬 3기통 가솔린 엔진과 전기모터, 전륜구동, e-DCS6 자동변속기, 7인승 구성이다. 스텔란티스 코리아 공식 2026-02-05 국내 출시 발표에서 Allure와 GT 두 트림 및 국내 판매 개시를 교차 확인했다. 기존 파워트레인·트림 공란 행은 의미를 변경하지 않고 차단 상태로 보존한다. 출시 교차 근거: ${PEUGEOT_5008_P67_LAUNCH_URL}`;
const peugeot5008P67Rows = ['Allure', 'GT'].map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '수입', '푸조', '5008', '올 뉴 5008 3세대 P67',
  '스마트 하이브리드 1.2 FWD', trim,
  `${PEUGEOT_5008_P67_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`,
  PEUGEOT_5008_P67_ID, 1, trimIndex + 1, '3세대', 'P67', '2026-02', '현재', '2026', '현재',
  '하이브리드', 1199, 1.2, '예', 'FWD', 7, '',
  `푸조 5008,올 뉴 5008,5008 스마트 하이브리드,ALL NEW 5008 SMART HYBRID,${trim}`,
  PEUGEOT_5008_P67_URL, PEUGEOT_5008_P67_NOTE, DATA_AS_OF,
]);
const FORD_RANGER_P703_ID = 'mf-024.md-023.sm-p703__next-gen-ranger-2-0-bi-turbo';
const FORD_RANGER_URL = 'https://www.ford.co.kr/trucks/ranger/';
const FORD_RANGER_BROCHURE_URL = 'https://www.premiermotors.co.kr/ford/pdf/23_next-gen-ranger_catalog_digital_kr_250122_Compress.pdf';
const FORD_RANGER_NOTE = `포드코리아 국내 판매 페이지와 포드 공식 딜러가 배포한 국내용 2023 NEXT-GEN RANGER 카탈로그 기준. 국내형 Wildtrak·Raptor는 1,996cc 2.0L Bi-Turbo 디젤, 10단 자동변속기, 4WD, 더블캡 5인승 조합이다. 2023-03 국내 출시 자료로 판매 개시를 교차 확인했다. 기존 4세대 행은 근거 메모가 실제 국내 정식 판매 사실과 충돌하므로 의미를 고치지 않고 차단 상태로 보존한다. 국내용 카탈로그: ${FORD_RANGER_BROCHURE_URL}`;
const fordRangerP703Rows = ['Wildtrak', 'Raptor'].map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '수입', '포드', '레인저', '넥스트 제너레이션 레인저 4세대 P703',
  '디젤 2.0 Bi-Turbo 4WD', trim,
  `${FORD_RANGER_P703_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`,
  FORD_RANGER_P703_ID, 1, trimIndex + 1, '4세대', 'P703', '2023-03', '현재', '2023', '현재',
  '디젤', 1996, 2.0, '예', '4WD', 5, '',
  `포드 레인저,Ford Ranger,넥스트 젠 레인저,Next-Gen Ranger,${trim},${trim === 'Wildtrak' ? '와일드트랙' : '랩터'}`,
  FORD_RANGER_URL, FORD_RANGER_NOTE, DATA_AS_OF,
]);
const FORD_BRONCO_27_ID = 'mf-024.md-016.sm-u725__bronco-outer-banks-27';
const FORD_BRONCO_23_ID = 'mf-024.md-016.sm-u725__bronco-outer-banks-23';
const FORD_BRONCO_22_URL = 'https://www.ford.co.kr/content/dam/Ford/website-assets/ap/kr/nameplate/bronco/brochure/22MY_Bronco.pdf';
const FORD_TIRE_2025_URL = 'https://www.ford.co.kr/content/dam/Ford/kr/shopping/Ford_Tire_Energy_Consumption_Efficiency_2025.pdf';
const FORD_BRONCO_27_NOTE = '포드코리아 22MY 브롱코 국내용 공식 카탈로그 기준. 국내 Outer Banks 4도어는 2,694cc 2.7L V6 EcoBoost 가솔린 터보, 자동 10단, Advanced 4×4, 5인승이다. 2022-03 국내 출시 시점과 결합하되 공식 판매 종료 월은 확인되지 않아 공란으로 유지한다. 기존 2.7 행은 국내 정식 판매 모델을 비주력·병행수입으로 잘못 설명하므로 의미를 고치지 않고 차단 상태로 보존한다.';
const FORD_BRONCO_23_NOTE = '포드코리아 2025 타이어 에너지 소비효율 공식 자료에서 국내 Bronco 2.3 Outer Banks 장착 모델을 확인했다. 2024-09 국내 투입 발표와 국내 등록 실차 제원을 교차해 2,261cc 2.3L I4 EcoBoost 가솔린 터보, 자동 10단, 4WD, 5인승으로 분리한다. 공식 판매 종료 월은 확인되지 않아 공란으로 유지하며 기존 2.3 행의 잘못된 2022 생산 시작과 제외 메모는 변경하지 않고 차단 상태로 보존한다.';
const fordBroncoRows = [
  ['검증중', '교차확인', '중고차', '수입', '포드', '브롱코', '브롱코 6세대 U725 2.7', '가솔린 2.7 EcoBoost 4WD', 'Outer Banks', `${FORD_BRONCO_27_ID}::v01::t01`, FORD_BRONCO_27_ID, 1, 1, '6세대', 'U725', '2022-03', '', '2022', '', '가솔린', 2694, 2.7, '예', '4WD', 5, '', '포드 브롱코,Ford Bronco,브롱코 2.7,아우터 뱅크스,Outerbanks,Outer Banks', FORD_BRONCO_22_URL, FORD_BRONCO_27_NOTE, DATA_AS_OF],
  ['검증중', '교차확인', '중고차', '수입', '포드', '브롱코', '브롱코 6세대 U725 2.3', '가솔린 2.3 EcoBoost 4WD', 'Outer Banks', `${FORD_BRONCO_23_ID}::v01::t01`, FORD_BRONCO_23_ID, 1, 1, '6세대', 'U725', '2024-09', '', '2024', '', '가솔린', 2261, 2.3, '예', '4WD', 5, '', '포드 브롱코,Ford Bronco,브롱코 2.3,아우터 뱅크스,Outerbanks,Outer Banks', FORD_TIRE_2025_URL, FORD_BRONCO_23_NOTE, DATA_AS_OF],
];
const MINI_ELECTRIC_F56_ID = 'mf-054.md-001.sm-f56__mini-electric-32-6';
const MINI_ELECTRIC_F56_URL = 'https://www.press.bmwgroup.com/korea/article/detail/T0371675KO/mini-%EC%BD%94%EB%A6%AC%EC%95%84-%EB%B8%8C%EB%9E%9C%EB%93%9C-%EC%B5%9C%EC%B4%88%EC%9D%98-%EC%88%9C%EC%88%98%EC%A0%84%EA%B8%B0-%EB%AA%A8%EB%8D%B8-mini-%EC%9D%BC%EB%A0%89%ED%8A%B8%EB%A6%AD%E2%80%99-%EA%B5%AD%EB%82%B4-%EA%B3%B5%EC%8B%9D-%EC%B6%9C%EC%8B%9C';
const MINI_ELECTRIC_F56_BROCHURE_URL = 'https://www.mini.co.kr/content/dam/MINI/marketKR/mini_co_kr/Models/electric/20220526_tech/MINI_Electric_Product_Brochure.pdf.asset.1653552860928.pdf';
const MINI_GEN_Z_E_URL = 'https://www.press.bmwgroup.com/korea/article/detail/T0384074KO/mini-%EC%BD%94%EB%A6%AC%EC%95%84-%EC%98%A8%EB%9D%BC%EC%9D%B8-%ED%95%9C%EC%A0%95-%ED%8C%90%EB%A7%A4-%EC%88%9C%EC%88%98%EC%A0%84%EA%B8%B0-%EB%AA%A8%EB%8D%B8-mini-gen-z-e-%EC%97%90%EB%94%94%EC%85%98%E2%80%99-%EC%B6%9C%EC%8B%9C?language=ko';
const MINI_ELECTRIC_F56_NOTE = `BMW 그룹 코리아 2022-02-28 공식 국내 출시자료와 MINI 코리아 공식 제품 브로슈어 기준. F56 3도어 MINI 일렉트릭은 32.6kWh 고전압 배터리 총 용량, 전륜 전기모터, 4인승 조합이며 국내 기본 트림은 Cooper SE Classic과 Cooper SE Electric이다. 배터리 필드는 공식 브로슈어가 명시한 총 용량 기준으로 기록했다. 4세대 J01 사전예약이 2024-04 시작됐으나 F56의 공식 판매 종료 월은 확인되지 않아 생산 종료는 공란으로 유지한다. 기존 '3세대' 비트림 행은 의미를 바꾸지 않고 차단 상태로 보존한다. 공식 브로슈어: ${MINI_ELECTRIC_F56_BROCHURE_URL}`;
const miniElectricF56Rows = [
  { trim: 'Cooper SE Classic', alias: '쿠퍼 SE 클래식', url: MINI_ELECTRIC_F56_URL, note: MINI_ELECTRIC_F56_NOTE },
  { trim: 'Cooper SE Electric', alias: '쿠퍼 SE 일렉트릭', url: MINI_ELECTRIC_F56_URL, note: MINI_ELECTRIC_F56_NOTE },
  { trim: 'Cooper SE GEN Z E Edition', alias: '쿠퍼 SE GEN Z E 에디션', url: MINI_GEN_Z_E_URL, note: `${MINI_ELECTRIC_F56_NOTE} BMW 그룹 코리아 2022-04-25 공식 자료에서 국내 150대 한정 GEN Z E 에디션을 추가 확인했다.` },
].map((config, trimIndex) => [
  '검증중', '교차확인', '중고차', '수입', '미니', '미니 일렉트릭', '미니 일렉트릭 3세대 F56',
  '전기 32.6kWh FWD', config.trim,
  `${MINI_ELECTRIC_F56_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`,
  MINI_ELECTRIC_F56_ID, 1, trimIndex + 1, '3세대', 'F56', '2022-03', '', '2022', '2024',
  '전기', '', '', '아니오', 'FWD', 4, 32.6,
  `MINI 일렉트릭,미니 일렉트릭,MINI Electric,MINI Cooper SE,쿠퍼 SE,${config.trim},${config.alias}`,
  config.url, config.note, DATA_AS_OF,
]);
const PEUGEOT_E208_LAUNCH_ID = 'mf-021.md-022.sm-p21__e208-50k-launch';
const PEUGEOT_E208_2022_ID = 'mf-021.md-022.sm-p21__e208-50k-2022';
const PEUGEOT_E208_LAUNCH_URL = 'https://base.epeugeot.co.kr/Board/Details/31';
const PEUGEOT_E208_2022_URL = 'https://base.epeugeot.co.kr/Board/Details/124?SrhPg=11&compagneParameter=true';
const PEUGEOT_E208_2024_URL = 'https://base.epeugeot.co.kr/Board/Details/191?SrhPg=1';
const PEUGEOT_E208_LAUNCH_NOTE = '푸조 코리아 공식 국내 출시자료 기준. 2020-07 국내 출시 e-208은 e-CMP 기반 50kWh 배터리와 100kW(136마력) 전기모터를 사용하는 5도어 전륜구동 해치백이며, 국내 트림은 Allure와 GT Line 두 가지다. 2022년식의 트림 체계 및 효율 개선 전후를 안전하게 구분하기 위해 초기형 영구 코드로 분리한다. 기존 배터리·구동·기간 미구분 행은 의미를 변경하지 않고 차단 상태로 보존한다.';
const PEUGEOT_E208_2022_NOTE = `스텔란티스 코리아 2022-08-18 공식 국내 출시자료 기준. 2022년식 e-208은 기존과 동일한 50kWh(120Ah) 배터리와 100kW 전기모터를 유지하면서 효율을 개선했고, 국내 트림명은 Allure와 GT로 운영됐다. 2024-07 공식 가격 조정 자료에서도 GT의 국내 판매를 재확인했다. 공식 판매 종료 월은 확인되지 않아 생산 종료는 공란으로 유지하며, 기존 배터리·구동·기간 미구분 행은 차단 상태로 보존한다. 2024 판매 교차 근거: ${PEUGEOT_E208_2024_URL}`;
const peugeotE208Rows = [
  { id: PEUGEOT_E208_LAUNCH_ID, start: '2020-07', end: '2022-08', myStart: '2020', myEnd: '2021', trim: 'Allure', alias: '알뤼르', url: PEUGEOT_E208_LAUNCH_URL, note: PEUGEOT_E208_LAUNCH_NOTE },
  { id: PEUGEOT_E208_LAUNCH_ID, start: '2020-07', end: '2022-08', myStart: '2020', myEnd: '2021', trim: 'GT Line', alias: 'GT 라인', url: PEUGEOT_E208_LAUNCH_URL, note: PEUGEOT_E208_LAUNCH_NOTE },
  { id: PEUGEOT_E208_2022_ID, start: '2022-09', end: '', myStart: '2022', myEnd: '2024', trim: 'Allure', alias: '알뤼르', url: PEUGEOT_E208_2022_URL, note: PEUGEOT_E208_2022_NOTE },
  { id: PEUGEOT_E208_2022_ID, start: '2022-09', end: '', myStart: '2022', myEnd: '2024', trim: 'GT', alias: '지티', url: PEUGEOT_E208_2022_URL, note: PEUGEOT_E208_2022_NOTE },
].map((config, index, all) => {
  const sameId = all.slice(0, index).filter((row) => row.id === config.id).length + 1;
  return [
    '검증중', '교차확인', '중고차', '수입', '푸조', '208', '푸조 e-208 2세대 P21',
    '전기 50.0kWh FWD', config.trim,
    `${config.id}::v01::t${String(sameId).padStart(2, '0')}`,
    config.id, 1, sameId, '2세대', 'P21', config.start, config.end, config.myStart, config.myEnd,
    '전기', '', '', '아니오', 'FWD', 5, 50,
    `푸조 e-208,Peugeot e-208,e208,208 전기차,${config.trim},${config.alias},50kWh`,
    config.url, config.note, DATA_AS_OF,
  ];
});
const PEUGEOT_E2008_LAUNCH_ID = 'mf-021.md-024.sm-p24__e2008-50k-launch';
const PEUGEOT_E2008_2022_ID = 'mf-021.md-024.sm-p24__e2008-50k-2022';
const PEUGEOT_E2008_LAUNCH_URL = 'https://base.epeugeot.co.kr/Board/Details/32';
const PEUGEOT_E2008_2022_URL = 'https://base.epeugeot.co.kr/Board/Details/124?SrhPg=11&compagneParameter=true';
const PEUGEOT_E2008_2024_URL = 'https://base.epeugeot.co.kr/Board/Details/191?SrhPg=1';
const PEUGEOT_E2008_LAUNCH_NOTE = '푸조 코리아 2020-07-28 공식 국내 출시자료 기준. 뉴 e-2008 SUV는 e-CMP 기반 50kWh 배터리와 100kW(136마력) 전기모터를 사용하는 전륜구동 5인승 SUV이며 국내 트림은 Allure와 GT Line 두 가지다. 2022년식의 효율 개선 및 트림 체계 변경 전후를 안전하게 구분하기 위해 초기형 영구 코드로 분리한다. 기존 포르투갈 가격표 근거의 EV GT·EV GT Line 행은 국내 세부 연식 및 트림명이 불일치해 차단 상태로 전환한다.';
const PEUGEOT_E2008_2022_NOTE = `스텔란티스 코리아 2022-08-18 공식 국내 출시자료와 2022-09 공식 캠페인 자료 기준. 2022년식 e-2008 SUV는 기존과 동일한 50kWh(120Ah) 배터리와 100kW 전기모터를 유지하면서 효율을 개선했고 국내 트림은 Allure와 GT다. 2024-07 공식 가격 조정 자료에서 23년식 Allure·GT의 국내 판매를 재확인했다. 공식 판매 종료 월은 확인되지 않아 생산 종료는 공란으로 유지한다. 2024 판매 교차 근거: ${PEUGEOT_E2008_2024_URL}`;
const peugeotE2008Rows = [
  { id: PEUGEOT_E2008_LAUNCH_ID, seq: 1, start: '2020-07', end: '2022-08', myStart: '2020', myEnd: '2021', trim: 'Allure', alias: '알뤼르', url: PEUGEOT_E2008_LAUNCH_URL, note: PEUGEOT_E2008_LAUNCH_NOTE },
  { id: PEUGEOT_E2008_LAUNCH_ID, seq: 2, start: '2020-07', end: '2022-08', myStart: '2020', myEnd: '2021', trim: 'GT Line', alias: 'GT 라인', url: PEUGEOT_E2008_LAUNCH_URL, note: PEUGEOT_E2008_LAUNCH_NOTE },
  { id: PEUGEOT_E2008_2022_ID, seq: 1, start: '2022-09', end: '', myStart: '2022', myEnd: '2023', trim: 'Allure', alias: '알뤼르', url: PEUGEOT_E2008_2022_URL, note: PEUGEOT_E2008_2022_NOTE },
  { id: PEUGEOT_E2008_2022_ID, seq: 2, start: '2022-09', end: '', myStart: '2022', myEnd: '2023', trim: 'GT', alias: '지티', url: PEUGEOT_E2008_2022_URL, note: PEUGEOT_E2008_2022_NOTE },
].map((config) => [
  '검증중', '교차확인', '중고차', '수입', '푸조', '2008', '푸조 e-2008 2세대 P24',
  '전기 50.0kWh FWD', config.trim,
  `${config.id}::v01::t${String(config.seq).padStart(2, '0')}`,
  config.id, 1, config.seq, '2세대', 'P24', config.start, config.end, config.myStart, config.myEnd,
  '전기', '', '', '아니오', 'FWD', 5, 50,
  `푸조 e-2008,Peugeot e-2008,e2008,e-2008 SUV,2008 전기차,EV ${config.trim},${config.trim},${config.alias},50kWh`,
  config.url, config.note, DATA_AS_OF,
]);
const DS3_ETENSE_2022_ID = 'mf-022.md-011.sm-ds3cb__ds3-crossback-e-tense-2022-50k';
const DS3_ETENSE_2022_URL = 'https://base.epeugeot.co.kr/Board/Details/124?SrhPg=11&compagneParameter=true';
const DS3_ETENSE_SPEC_URL = 'https://www.media.stellantis.com/em-en/ds/press/ds-3-crossback-e-tense-the-electric-revolution';
const DS3_ETENSE_2022_NOTE = `스텔란티스 코리아 2022-08-18 공식 국내 출시자료 기준. 2022년식 DS 3 크로스백 E-텐스는 e-CMP 기반 120Ah(공식 글로벌 제원 50kWh) 배터리와 100kW(136마력) 전기모터를 사용하며 국내 판매 트림은 Grand Chic 단일 구성이다. 국내 고객 인도는 2022-09 시작으로 기록했다. 공식 판매 종료 월은 확인되지 않아 공란으로 유지한다. 2020 초기 국내형 So Chic·Grand Chic은 국내 공식 원문을 추가 확보하기 전까지 영구 코드를 발급하지 않는다. DS 공식 제원: ${DS3_ETENSE_SPEC_URL}`;
const ds3Etense2022Rows = [[
  '검증중', '교차확인', '중고차', '수입', '시트로엥/DS', 'DS 3 크로스백', 'DS 3 크로스백 E-텐스 1세대',
  '전기 50.0kWh FWD', 'Grand Chic',
  `${DS3_ETENSE_2022_ID}::v01::t01`, DS3_ETENSE_2022_ID, 1, 1, '1세대', '',
  '2022-09', '', '2022', '2022', '전기', '', '', '아니오', 'FWD', 5, 50,
  'DS 3 크로스백 E-텐스,DS3 크로스백 E텐스,DS 3 CROSSBACK E-TENSE,DS3 E-TENSE,Grand Chic,그랜드 시크,50kWh',
  DS3_ETENSE_2022_URL, DS3_ETENSE_2022_NOTE, DATA_AS_OF,
]];
const POLESTAR4_ID = 'mf-089.md-002.sm-polestar4__polestar-4-korea';
const POLESTAR4_LAUNCH_URL = 'https://www.polestar.com/kr/news/polestar-4-launching';
const POLESTAR4_SPEC_URL = 'https://www.polestar.com/kr/configure/polestar-4-coupe/specifications';
const POLESTAR4_NOTE = `Polestar Korea 2024-08-13 공식 국내 출시 자료와 현행 국내 사양 페이지 기준. 국내 판매형은 100kWh 배터리를 공통 적용한 Long range Single motor RWD와 Long range Dual motor AWD이며 2024-11-29 고객 출고가 시작됐다. 환경부 2025 공식표에서도 두 동력계의 리스·렌탈 추가보조금 대상을 확인했다. 20·21·22인치 인증 변형과 Performance Pack은 휠·선택 패키지이므로 독립 차종 영구코드로 과분할하지 않고 별칭에 흡수한다. 상세 제원: ${POLESTAR4_SPEC_URL}`;
const polestar4Rows = [
  ['검증중', '교차확인', '신차', '수입', '폴스타', '폴스타 4', 'Polestar 4 국내형', '전기 100.0kWh RWD', 'Long range Single motor', `${POLESTAR4_ID}::v01::t01`, POLESTAR4_ID, 1, 1, '1세대', '', '2024-08', '현재', '2024', '현재', '전기', '', '', '아니오', 'RWD', 5, 100, '폴스타 4,Polestar 4,Polestar4,Long range Single motor,롱레인지 싱글모터,Rear motor,RWD,20인치', POLESTAR4_LAUNCH_URL, POLESTAR4_NOTE, DATA_AS_OF],
  ['검증중', '교차확인', '신차', '수입', '폴스타', '폴스타 4', 'Polestar 4 국내형', '전기 100.0kWh AWD', 'Long range Dual motor', `${POLESTAR4_ID}::v02::t01`, POLESTAR4_ID, 2, 1, '1세대', '', '2024-08', '현재', '2024', '현재', '전기', '', '', '아니오', 'AWD', 5, 100, '폴스타 4,Polestar 4,Polestar4,Long range Dual motor,롱레인지 듀얼모터,Dual motor,AWD,20인치,21인치,22인치,Performance Pack,퍼포먼스 팩', POLESTAR4_LAUNCH_URL, POLESTAR4_NOTE, DATA_AS_OF],
];
const RENAULT_SCENIC_ID = 'mf-005.md-021.sm-scenic-e-tech__scenic-e-tech-electric-korea';
const RENAULT_SCENIC_PRICE_URL = 'https://www.renault.co.kr/upload/asset/price/price_scenic_202508.pdf';
const renaultScenicRows = [[
  '검증중', '교차확인', '신차', '수입', '르노코리아', '세닉 E-Tech', 'Scenic E-Tech 100% electric 국내형', '전기 87.0kWh FWD', '테크노',
  `${RENAULT_SCENIC_ID}::v01::t01`, RENAULT_SCENIC_ID, 1, 1, '5세대', '', '2025-06', '현재', '2025', '현재', '전기', '', '', '아니오', 'FWD', 5, 87,
  '르노 세닉 E-Tech,르노코리아 세닉 E-Tech,Renault Scenic E-Tech electric,SCENIC E-TECH 100% electric,세닉 전기차,테크노,techno,87kWh,160kW',
  RENAULT_SCENIC_PRICE_URL,
  '르노코리아 공식 2025-06 및 2025-08 가격표 기준. Scenic E-Tech 100% electric 국내 판매형은 87kWh 리튬이온배터리·160kW 전륜 구동모터·5인승·테크노 단일 트림이다. 환경부 2025 공식표의 scenic 리스·렌탈 추가보조금 대상으로 국내 유통을 교차확인했다.', DATA_AS_OF,
]];
const VOLVO_EX30_KOREA_ID = 'mf-017.md-025.sm-ex30-korea__ex30-single-motor-extended-range';
const VOLVO_EX30_CC_KOREA_ID = 'mf-017.md-025.sm-ex30-cross-country-korea__ex30cc-twin-motor-performance';
const VOLVO_EX30_LAUNCH_URL = 'https://www.volvocars.com/kr/news/corporate/20250203-EX30-Price-reduction-launch/';
const VOLVO_EX30_CC_LAUNCH_URL = 'https://www.volvocars.com/kr/news/culture/20250904-Launch-of-the-EX30-Cross-Country/';
const VOLVO_EX30_NOTE = '볼보자동차코리아 공식 2025-02-03 국내 출시 자료 기준. 국내 EX30은 66kWh NCM 배터리와 200kW 후륜 모터를 결합한 Single Motor Extended Range 단일 파워트레인이며 Core와 Ultra 두 트림으로 출시됐다. 글로벌 69kWh 명목 표기나 국내 미판매 파워트레인은 국내 영구코드에 혼합하지 않는다.';
const VOLVO_EX30_CC_NOTE = '볼보자동차코리아 공식 2025-09-04 국내 출시 자료 기준. EX30 Cross Country는 66kWh NCM 배터리, 두 개의 모터, AWD를 결합한 Twin Motor Performance 단일 파워트레인이며 국내 판매 트림은 Ultra다. 기존 69kWh·2025-06·퍼포먼스 울트라 코드는 시점과 명칭이 혼합돼 차단하고 국내 공식 조합을 새 영구코드로 분리했다.';
const volvoEx30KoreaRows = ['Core', 'Ultra'].map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '수입', '볼보', 'EX30', 'EX30 국내형', '전기 66.0kWh RWD', trim,
  `${VOLVO_EX30_KOREA_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`, VOLVO_EX30_KOREA_ID, 1, trimIndex + 1,
  '1세대', '', '2025-02', '현재', '2025', '현재', '전기', '', '', '아니오', 'RWD', 5, 66,
  `볼보 EX30,Volvo EX30,EX30 Single Motor Extended Range,싱글 모터 익스텐디드 레인지,${trim},${trim === 'Core' ? '코어' : '울트라'},66kWh,200kW,RWD`,
  VOLVO_EX30_LAUNCH_URL, VOLVO_EX30_NOTE, DATA_AS_OF,
]);
const volvoEx30CrossCountryKoreaRows = [[
  '검증중', '교차확인', '신차', '수입', '볼보', 'EX30', 'EX30 Cross Country 국내형', '전기 66.0kWh AWD', 'Ultra',
  `${VOLVO_EX30_CC_KOREA_ID}::v01::t01`, VOLVO_EX30_CC_KOREA_ID, 1, 1, '1세대 크로스컨트리', '',
  '2025-09', '현재', '2025', '현재', '전기', '', '', '아니오', 'AWD', 5, 66,
  '볼보 EX30 Cross Country,Volvo EX30 Cross Country,EX30CC,EX30 크로스 컨트리,Twin Motor Performance,트윈 모터 퍼포먼스,Ultra,울트라,66kWh,AWD',
  VOLVO_EX30_CC_LAUNCH_URL, VOLVO_EX30_CC_NOTE, DATA_AS_OF,
]];
const VOLVO_XC40_2026_ID = 'mf-017.md-023.sm-xc40-2026-korea__xc40-b4-awd-mhev';
const VOLVO_XC40_2026_URL = 'https://www.volvocars.com/kr/news/culture/20251015-Launch-of-the-XC40/';
const VOLVO_XC40_2026_SPEC_URL = 'https://www.volvocars.com/files/cs/v3/assets/blt84e01a6904dbd2e8/blt36d4fb5cfb4b5a42/66d67b1e6402a22c1bd3a2db/xc40-specifications.pdf?branch=prod_alias';
const VOLVO_XC40_2026_NOTE = `볼보자동차코리아 공식 2025-10-15 국내 출시자료와 한국 공식 제원표 기준. 2026년식 XC40은 197마력 48V 마일드 하이브리드 B4 AWD 단일 파워트레인이며 Plus Bright, Ultra Bright, Ultra Dark 세 조합으로 판매된다. 한국 공식 제원표에서 배기량 1,969cc, 4륜구동, 5인승을 교차확인했다. 2018년부터 여러 연식 트림을 현재까지 합친 기존 영구코드는 자동매칭에서 차단하고 2026년식 국내 조합을 별도 발급한다. 제원 근거: ${VOLVO_XC40_2026_SPEC_URL}`;
const volvoXc40_2026Rows = [
  ['Plus Bright', '플러스 브라이트'],
  ['Ultra Bright', '울트라 브라이트'],
  ['Ultra Dark', '울트라 다크'],
].map(([trim, korean], trimIndex) => [
  '검증중', '교차확인', '신차', '수입', '볼보', 'XC40', '2026 XC40 B4 AWD', '가솔린 2.0T 48V MHEV AWD', trim,
  `${VOLVO_XC40_2026_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`, VOLVO_XC40_2026_ID, 1, trimIndex + 1,
  '1세대 2026년형', '', '2025-10', '현재', '2026', '현재', '가솔린', 1969, 2.0, '예', 'AWD', 5, '',
  `볼보 XC40,Volvo XC40,XC40 B4 AWD,B4 AWD 마일드 하이브리드,48V MHEV,${trim},${korean}`,
  VOLVO_XC40_2026_URL, VOLVO_XC40_2026_NOTE, DATA_AS_OF,
]);
const VOLVO_XC90_2026_ID = 'mf-017.md-010.sm-xc90-2026-korea__new-xc90-b6-t8-awd';
const VOLVO_XC90_2026_URL = 'https://www.volvocars.com/kr/news/culture/20250702-The-new-Volvo-XC90-S90/';
const VOLVO_XC90_2026_SPEC_URL = 'https://www.volvocars.com/images/cs/v3/assets/blt84e01a6904dbd2e8/bltc9af4af03db2571f/66d67b7027beb55d990ec437/xc90-specifications.pdf?branch=prod_alias';
const VOLVO_XC90_2026_NOTE = `볼보자동차코리아 공식 2025-07-02 국내 출시자료 기준. 신형 2026년식 XC90은 300마력 48V 가솔린 마일드 하이브리드 B6 AWD와 462마력 플러그인 하이브리드 T8 AWD 두 파워트레인, 7인승으로 출시됐다. 실제 가격 조합은 B6 Plus·B6 Ultra·T8 Ultra이며 Ultra의 Bright·Dark는 외관 테마 선택이므로 별도 영구 트림으로 과분할하지 않고 별칭에 흡수한다. 한국 공식 제원표에서 B6/T8의 1,969cc·AWD를 교차확인했다. 제원 근거: ${VOLVO_XC90_2026_SPEC_URL}`;
const volvoXc90_2026Rows = [
  { variant: 1, trimSeq: 1, powertrain: '가솔린 2.0T 48V MHEV AWD', trim: 'B6 Plus', aliases: 'B6 Plus Bright,B6 플러스,B6 플러스 브라이트', fuel: '가솔린' },
  { variant: 1, trimSeq: 2, powertrain: '가솔린 2.0T 48V MHEV AWD', trim: 'B6 Ultra', aliases: 'B6 Ultra Bright,B6 Ultra Dark,B6 울트라,B6 울트라 브라이트,B6 울트라 다크', fuel: '가솔린' },
  { variant: 2, trimSeq: 1, powertrain: '플러그인 하이브리드 2.0T AWD', trim: 'T8 Ultra', aliases: 'T8 Ultra Bright,T8 Ultra Dark,T8 울트라,T8 울트라 브라이트,T8 울트라 다크', fuel: '하이브리드' },
].map((config) => [
  '검증중', '교차확인', '신차', '수입', '볼보', 'XC90', '신형 XC90 2026', config.powertrain, config.trim,
  `${VOLVO_XC90_2026_ID}::v${String(config.variant).padStart(2, '0')}::t${String(config.trimSeq).padStart(2, '0')}`,
  VOLVO_XC90_2026_ID, config.variant, config.trimSeq, '2세대 부분변경', '', '2025-07', '현재', '2026', '현재',
  config.fuel, 1969, 2.0, '예', 'AWD', 7, '',
  `볼보 XC90,Volvo XC90,신형 XC90,New XC90,2026 XC90,${config.trim},${config.aliases},7인승`,
  VOLVO_XC90_2026_URL, VOLVO_XC90_2026_NOTE, DATA_AS_OF,
]);
const VOLVO_S90_2026_ID = 'mf-017.md-015.sm-s90-2026-korea__new-s90-b5-t8';
const VOLVO_S90_2026_URL = 'https://www.volvocars.com/kr/news/culture/20250702-The-new-Volvo-XC90-S90/';
const VOLVO_S90_2026_NOTE = '볼보자동차코리아 공식 2025-07-02 국내 출시자료 기준. 신형 2026년식 S90은 250마력 48V 가솔린 마일드 하이브리드 B5와 순수 전기모드 최대 65km의 플러그인 하이브리드 T8로 출시됐다. 가격이 직접 연결된 국내 판매 조합은 B5 Plus·B5 Ultra·T8 Ultra이며 5인승이다. B5 Ultra의 Bright·Dark는 동일 트림 내 외관 테마 선택이므로 독립 영구코드로 나누지 않고 별칭에 흡수한다. 기존 마스터에는 2023년 종료 T8 Inscription·Excellence만 있어 현행 국내형을 신규 발급한다.';
const volvoS90_2026Rows = [
  { variant: 1, trimSeq: 1, powertrain: '가솔린 2.0T 48V MHEV', trim: 'B5 Plus', aliases: 'B5 플러스', fuel: '가솔린' },
  { variant: 1, trimSeq: 2, powertrain: '가솔린 2.0T 48V MHEV', trim: 'B5 Ultra', aliases: 'B5 Ultra Bright,B5 Ultra Dark,B5 울트라,B5 울트라 브라이트,B5 울트라 다크', fuel: '가솔린' },
  { variant: 2, trimSeq: 1, powertrain: '플러그인 하이브리드 2.0T AWD', trim: 'T8 Ultra', aliases: 'T8 울트라', fuel: '하이브리드' },
].map((config) => [
  '검증중', '교차확인', '신차', '수입', '볼보', 'S90', '신형 S90 2026', config.powertrain, config.trim,
  `${VOLVO_S90_2026_ID}::v${String(config.variant).padStart(2, '0')}::t${String(config.trimSeq).padStart(2, '0')}`,
  VOLVO_S90_2026_ID, config.variant, config.trimSeq, '2세대 부분변경', '', '2025-07', '현재', '2026', '현재',
  config.fuel, 1969, 2.0, '예', config.variant === 2 ? 'AWD' : 'FWD', 5, '',
  `볼보 S90,Volvo S90,신형 S90,New S90,2026 S90,${config.trim},${config.aliases},5인승`,
  VOLVO_S90_2026_URL, VOLVO_S90_2026_NOTE, DATA_AS_OF,
]);
const VOLVO_V60CC_2026_ID = 'mf-017.md-017.sm-v60cc-2026-korea__v60-cross-country-b5-awd-ultra';
const VOLVO_V60CC_2026_URL = 'https://www.volvocars.com/kr/build/print?token=12566181414701609215';
const VOLVO_V60CC_2026_LAUNCH_URL = 'https://www.volvocars.com/kr/news/culture/20251111-V60CC-Forest-Lake-Edition-Sold-Out/';
const VOLVO_V60CC_2026_SPEC_URL = 'https://www.volvocars.com/images/v/-/media/market-assets/korea/applications/localpages/test/my24/v60cc/v60-cross-country-specifications.pdf';
const VOLVO_V60CC_2026_NOTE = `볼보자동차코리아 공식 2026년식 국내 구성 출력과 2025-11-11 국내 공식 자료 기준. 현행 V60 Cross Country는 250마력 B5 AWD 48V 마일드 하이브리드, Ultra, 5인승으로 직접 확인된다. Forest Lake Edition은 Ultra 기반 색상·액세서리 한정판이므로 별도 파워트레인/트림 코드로 과분할하지 않고 별칭에 흡수한다. 한국 공식 제원표에서 1,969cc·AWD를 교차확인했다. 기존 B5·Ultimate·Ultra·Pro를 2019-03부터 모두 현재로 연 B5 통합 코드는 실제 연식 경계를 과매칭하므로 차단한다. 국내 공식 출시시점을 직접 확인할 수 있는 2025-11보다 시작월을 앞당기지 않는다. 공식 한정판 근거: ${VOLVO_V60CC_2026_LAUNCH_URL}; 제원: ${VOLVO_V60CC_2026_SPEC_URL}`;
const volvoV60cc_2026Rows = [[
  '검증중', '교차확인', '신차', '수입', '볼보', 'V60', 'V60 Cross Country 2026', '가솔린 2.0T 48V MHEV AWD', 'B5 Ultra',
  `${VOLVO_V60CC_2026_ID}::v01::t01`, VOLVO_V60CC_2026_ID, 1, 1, '2세대 2026년형', '', '2025-11', '현재', '2026', '현재',
  '가솔린', 1969, 2.0, '예', 'AWD', 5, '',
  '볼보 V60 Cross Country,Volvo V60 Cross Country,V60CC,V60 크로스컨트리,B5 AWD Ultra,B5 울트라,Ultra Bright,울트라 브라이트,Forest Lake Edition,포레스트 레이크 에디션,5인승',
  VOLVO_V60CC_2026_URL, VOLVO_V60CC_2026_NOTE, DATA_AS_OF,
]];
const VOLVO_V90CC_MY23_KOREA_ID = 'mf-017.md-022.sm-v90cc-my23-korea__v90-cross-country-b5-awd';
const VOLVO_V90CC_MY23_OPTIONS_URL = 'https://www.volvocars.com/files/cs/v3/assets/blt84e01a6904dbd2e8/bltb90b41a46f3ed054/66d677a3d56cdaf52a974bb4/my23-v90-cross-country-options.pdf?branch=prod_alias';
const VOLVO_V90CC_SPEC_URL = 'https://www.volvocars.com/files/cs/v3/assets/blt84e01a6904dbd2e8/blt2ccb48011a514c95/66d67b046402a268d2d3a2bd/v90-cross-country-specifications.pdf?branch=prod_alias';
const VOLVO_V90CC_CURRENT_URL = 'https://www.volvocars.com/kr/build/print?token=11814590325135763523';
const VOLVO_V90CC_MY23_NOTE = `볼보자동차코리아 공식 2022-08-01 기준 MY2023 옵션표에서 V90 Cross Country의 B5 AWD Plus·B5 AWD Ultimate 국내 트림 체계를 직접 확인했다. 공식 제원표는 1,969cc 가솔린 B5 AWD, 250마력, 5인승을 확인하며 현재 국내 구성 출력에서도 B5 AWD Plus가 유지된다. 기존 B5 Ultimate·Ultra·Pro·Plus 코드는 모두 2017-03부터 현재까지 열려 있어 B5 도입 전 기간과 서로 다른 트림 명칭을 과매칭하므로 의미를 바꾸지 않고 차단한다. MY2023 국내 체계는 2022-08보다 앞당기지 않은 신규 영구코드로 분리한다. 현행 구성: ${VOLVO_V90CC_CURRENT_URL}; 제원: ${VOLVO_V90CC_SPEC_URL}`;
const volvoV90ccMy23Rows = [
  { trimSeq: 1, trim: 'B5 Plus', aliases: 'B5 AWD Plus,B5 플러스,B5 AWD 플러스' },
  { trimSeq: 2, trim: 'B5 Ultimate', aliases: 'B5 AWD Ultimate,B5 얼티메이트,B5 AWD 얼티메이트' },
].map((config) => [
  '검증중', '교차확인', '신차', '수입', '볼보', 'V90', 'V90 Cross Country MY2023', '가솔린 2.0T 48V MHEV AWD', config.trim,
  `${VOLVO_V90CC_MY23_KOREA_ID}::v01::t${String(config.trimSeq).padStart(2, '0')}`,
  VOLVO_V90CC_MY23_KOREA_ID, 1, config.trimSeq, '2세대 MY2023', '', '2022-08', '현재', '2023', '현재',
  '가솔린', 1969, 2.0, '예', 'AWD', 5, '',
  `볼보 V90 Cross Country,Volvo V90 Cross Country,V90CC,V90 크로스컨트리,${config.trim},${config.aliases},5인승`,
  VOLVO_V90CC_MY23_OPTIONS_URL, VOLVO_V90CC_MY23_NOTE, DATA_AS_OF,
]);
const VOLVO_XC60_MY23_KOREA_ID = 'mf-017.md-016.sm-xc60-my23-korea__xc60-b5-b6-t8-awd';
const VOLVO_XC60_MY23_OPTIONS_URL = 'https://www.volvocars.com/files/cs/v3/assets/blt84e01a6904dbd2e8/blt692c2d33105b9cd0/66d67a8227beb5e7e50ec3f1/my23-xc60-options.pdf?branch=prod_alias';
const VOLVO_XC60_MY23_SPEC_URL = 'https://www.volvocars.com/images/v/-/media/market-assets/korea/applications/localpages/test/spec-and-option-sub-image/xc60/my23-xc60-specifications_v2.pdf';
const VOLVO_XC60_2026_URL = 'https://www.volvocars.com/kr/news/culture/20250804-New-XC60-Officially-Launched/';
const VOLVO_XC60_MY23_NOTE = `볼보자동차코리아 공식 2022-08-01 기준 MY2023 옵션표에서 XC60 B5 AWD Plus Bright·B5 AWD Ultimate Bright·B6 AWD Ultimate Bright·T8 AWD Ultimate Bright 네 국내 판매 조합을 확인했다. 한국 공식 MY2023 제원표로 1,969cc·AWD를 교차확인했다. Bright는 당시 공식 트림 표기의 일부이므로 검색 별칭에 보존하되 파워트레인·핵심 트림과 별개 영구 축으로 과분할하지 않는다. 2025-08 신형 XC60이 B5 Plus·B5 Ultra·T8 Ultra 체계로 공식 출시됐으므로 이 역사 계보는 2025-07에서 닫고 현행 코드와 겹치지 않게 분리한다. 신형 경계 근거: ${VOLVO_XC60_2026_URL}; 제원: ${VOLVO_XC60_MY23_SPEC_URL}`;
const volvoXc60My23Rows = [
  { variant: 1, trimSeq: 1, powertrain: '가솔린 2.0T 48V MHEV AWD', trim: 'B5 Plus', aliases: 'B5 AWD Plus Bright,B5 플러스 브라이트', fuel: '가솔린' },
  { variant: 1, trimSeq: 2, powertrain: '가솔린 2.0T 48V MHEV AWD', trim: 'B5 Ultimate', aliases: 'B5 AWD Ultimate Bright,B5 얼티메이트 브라이트', fuel: '가솔린' },
  { variant: 2, trimSeq: 1, powertrain: '가솔린 2.0T 48V MHEV AWD', trim: 'B6 Ultimate', aliases: 'B6 AWD Ultimate Bright,B6 얼티메이트 브라이트', fuel: '가솔린' },
  { variant: 3, trimSeq: 1, powertrain: '플러그인 하이브리드 2.0T AWD', trim: 'T8 Ultimate', aliases: 'T8 AWD Ultimate Bright,T8 얼티메이트 브라이트,XC60 Recharge', fuel: '하이브리드' },
].map((config) => [
  '검증중', '교차확인', '중고차', '수입', '볼보', 'XC60', 'XC60 MY2023', config.powertrain, config.trim,
  `${VOLVO_XC60_MY23_KOREA_ID}::v${String(config.variant).padStart(2, '0')}::t${String(config.trimSeq).padStart(2, '0')}`,
  VOLVO_XC60_MY23_KOREA_ID, config.variant, config.trimSeq, '2세대 MY2023', '', '2022-08', '2025-07', '2023', '2025',
  config.fuel, 1969, 2.0, '예', 'AWD', 5, '',
  `볼보 XC60,Volvo XC60,XC60 MY2023,${config.trim},${config.aliases},5인승`,
  VOLVO_XC60_MY23_OPTIONS_URL, VOLVO_XC60_MY23_NOTE, DATA_AS_OF,
]);
const VOLVO_S60_B5_KOREA_ID = 'mf-017.md-009.sm-s60-b5-korea__s60-b5-fwd';
const VOLVO_S60_B5_INSCRIPTION_URL = 'https://www.volvocars.com/images/v/-/media/market-assets/korea/applications/dotcom/images/pdf/brochure_volvo-s60.pdf';
const VOLVO_S60_MY23_OPTIONS_URL = 'https://www.volvocars.com/files/cs/v3/assets/blt84e01a6904dbd2e8/blta8b95ae866b07c77/66d67a606402a29e43d3a28b/my23-s60-options.pdf?branch=prod_alias';
const VOLVO_S60_MY24_URL = 'https://www.volvocars.com/images/v/-/media/market-assets/korea/applications/localpages/test/brochure-download/brochure-file/my24/volvo-s60.pdf';
const VOLVO_S60_DARK_URL = 'https://www.volvocars.com/kr/news/corporate/230926-S60-Dark-Edition/';
const VOLVO_S60_B5_NOTE = `볼보자동차코리아 공식 2021-10 국내 브로슈어에서 S60 B5 Inscription, 1,969cc, 250마력, 5인승 구성을 확인했다. 공식 2022-08-01 기준 MY2023 옵션표와 MY2024 브로슈어에서는 B5 Ultimate Bright 단일 국내 판매 조합을 확인했다. 2023-10 한정 S60 Dark Edition은 Ultimate Dark 기반의 외관·스포츠 서스펜션 패키지이므로 별도 파워트레인 코드로 과분할하지 않고 MY2023 Ultimate 계보의 별칭에 보존한다. 기존 7개 코드는 T5·B5 및 R-Design·Inscription·Ultimate·Ultra를 모두 2019-04~2024-12로 합쳐 실제 연식과 명칭을 과매칭하므로 의미를 바꾸지 않고 차단한다. Dark Edition 근거: ${VOLVO_S60_DARK_URL}; MY2024 근거: ${VOLVO_S60_MY24_URL}`;
const volvoS60B5KoreaRows = [
  { trimSeq: 1, trim: 'B5 Inscription', aliases: 'B5 인스크립션,S60 Inscription', start: '2021-10', end: '2022-07', myStart: '2022', myEnd: '2022', url: VOLVO_S60_B5_INSCRIPTION_URL },
  { trimSeq: 2, trim: 'B5 Ultimate', aliases: 'B5 Ultimate Bright,B5 얼티메이트 브라이트,S60 Dark Edition,B5 Ultimate Dark,S60 다크 에디션', start: '2022-08', end: '2024-12', myStart: '2023', myEnd: '2025', url: VOLVO_S60_MY23_OPTIONS_URL },
].map((config) => [
  '검증중', '교차확인', '중고차', '수입', '볼보', 'S60', 'S60 3세대 B5 국내형', '가솔린 2.0T 48V MHEV FWD', config.trim,
  `${VOLVO_S60_B5_KOREA_ID}::v01::t${String(config.trimSeq).padStart(2, '0')}`,
  VOLVO_S60_B5_KOREA_ID, 1, config.trimSeq, '3세대', '', config.start, config.end, config.myStart, config.myEnd,
  '가솔린', 1969, 2.0, '예', '2WD', 5, '',
  `볼보 S60,Volvo S60,S60 B5,${config.trim},${config.aliases},전륜구동,FWD,5인승`,
  config.url, VOLVO_S60_B5_NOTE, DATA_AS_OF,
]);
const VOLVO_C40_MY24_KOREA_ID = 'mf-017.md-024.sm-c40-my24-korea__c40-recharge-twin-awd';
const VOLVO_C40_MY24_URL = 'https://www.volvocars.com/kr/news/corporate/230814-MY24-C40-Recharge-launch/';
const VOLVO_EC40_RENAME_URL = 'https://www.volvocars.com/kr/news/corporate/new-name-new-me-say-hello-to-the-ex40-and-ec40/';
const VOLVO_C40_MY24_NOTE = `볼보자동차코리아 공식 2023-08-14 국내 출시자료 기준. 2024년식 C40 Recharge는 Recharge Twin 단일 트림, 78kWh 배터리, 듀얼 전기모터, AWD, 408마력, 5인승으로 출시됐다. 기존 코드는 글로벌 데뷔 시점인 2021-10부터 국내형을 연 것으로 보여 국내 출시·출고 경계를 과매칭하므로 의미와 이력을 보존한 채 차단한다. 국내 공식 출시월보다 앞당기지 않은 MY2024 영구코드를 별도로 발급한다. Volvo의 공식 C40→EC40 명칭 변경은 확인되지만 한국 판매 개시일과 국내 인증 트림을 직접 입증할 자료가 부족하므로 EC40을 이 코드의 현행 연장이나 별도 국내 판매 코드로 추정하지 않는다. 명칭 변경 근거: ${VOLVO_EC40_RENAME_URL}`;
const volvoC40My24Rows = [[
  '검증중', '교차확인', '중고차', '수입', '볼보', 'C40', 'C40 Recharge MY2024', '전기 78kWh 듀얼모터 AWD', 'Recharge Twin',
  `${VOLVO_C40_MY24_KOREA_ID}::v01::t01`, VOLVO_C40_MY24_KOREA_ID, 1, 1, '1세대 MY2024', '', '2023-08', '2024-06', '2024', '2024',
  '전기', '', '', '아니오', 'AWD', 5, 78,
  '볼보 C40 Recharge,Volvo C40 Recharge,C40 리차지,C40 Recharge Twin,C40 Twin,트윈모터,듀얼모터,408마력,5인승',
  VOLVO_C40_MY24_URL, VOLVO_C40_MY24_NOTE, DATA_AS_OF,
]];
const VOLVO_XC40_RECHARGE_KOREA_ID = 'mf-017.md-023.sm-xc40-recharge-korea__xc40-recharge-twin-awd';
const VOLVO_XC40_RECHARGE_KOREA_URL = 'https://www.volvocars.com/kr/news/safety/230201-Enhanced-stability-with-C40-XC40-Recharge/';
const VOLVO_XC40_RECHARGE_SUPPORT_URL = 'https://www.volvocars.com/kr/support/car/xc40-recharge-pure-electric/2022/article/';
const VOLVO_XC40_RECHARGE_KOREA_NOTE = `볼보자동차코리아 공식 2023-02-01 자료에서 XC40 Recharge가 당시 국내 판매 중임을 직접 확인했다. 한국어 공식 2022년식 지원자료와 기존 국내 계보를 교차해 78kWh 듀얼모터 AWD·5인승 Recharge Twin으로 보수적으로 복원한다. 기존 Twin·Twin Ultimate 두 코드는 글로벌 시점 2021-10부터 동시에 국내 판매된 것처럼 열려 있으나 국내 출시월과 트림 분기 근거가 부족해 의미와 이력을 보존한 채 차단한다. 국내 판매가 직접 확인되는 2023-02보다 시작월을 앞당기지 않고, 기존 공식 계보 종료 2024-06까지의 단일 수동 코드로 제한한다. 한국어 지원 근거: ${VOLVO_XC40_RECHARGE_SUPPORT_URL}`;
const volvoXc40RechargeKoreaRows = [[
  '검증중', '교차확인', '중고차', '수입', '볼보', 'XC40', 'XC40 Recharge Pure Electric 국내형', '전기 78kWh 듀얼모터 AWD', 'Recharge Twin',
  `${VOLVO_XC40_RECHARGE_KOREA_ID}::v01::t01`, VOLVO_XC40_RECHARGE_KOREA_ID, 1, 1, '1세대 전기형', '', '2023-02', '2024-06', '2023', '2024',
  '전기', '', '', '아니오', 'AWD', 5, 78,
  '볼보 XC40 Recharge,Volvo XC40 Recharge,XC40 리차지,XC40 Recharge Pure Electric,Recharge Twin,트윈모터,듀얼모터,408마력,5인승',
  VOLVO_XC40_RECHARGE_KOREA_URL, VOLVO_XC40_RECHARGE_KOREA_NOTE, DATA_AS_OF,
]];
const RENAULT_QM6_2025_KOREA_ID = 'mf-005.md-011.sm-hzg-qm6-2025-korea__qm6-gde-lpe-2wd';
const RENAULT_QM6_2025_PRICE_URL = 'https://www.renault.co.kr/upload/asset/price/price_qm6_202502.pdf';
const RENAULT_QM6_2026_CART_URL = 'https://cdn.renault.co.kr/ko/login/my_cart.jsp';
const RENAULT_QM6_2025_NOTE = `르노코리아 공식 2025-02 가격표에서 QM6 승용 국내 판매 조합을 2.0 LPe LE·RE와 2.0 GDe RE로 확인했다. 공식 가격표 제원은 GDe 1,997cc·LPe 1,998cc, 2WD, 5인승이며 2026-07 공식 차량 비교 페이지에서도 GDe RE와 LPe RE의 판매 노출을 교차 확인했다. 기존 2019-06~현재 자동 코드 10개는 LE·RE·LE 시그니처·RE 시그니처·프리미에르를 모두 현행으로 열어 종료된 트림까지 자동 과매칭하므로 원래 키 의미와 이력을 보존한 채 차단한다. 시작월은 직접 확인되는 2025-02보다 앞당기지 않는다. 현행 교차 근거: ${RENAULT_QM6_2026_CART_URL}`;
const renaultQm6_2025Rows = [
  { variant: 1, trimSeq: 1, powertrain: 'LPG 2.0 2WD', trim: 'LPe LE', fuel: 'LPG', cc: 1998, aliases: 'QM6 LPe LE,QM6 LPG LE,2.0 LPe LE' },
  { variant: 1, trimSeq: 2, powertrain: 'LPG 2.0 2WD', trim: 'LPe RE', fuel: 'LPG', cc: 1998, aliases: 'QM6 LPe RE,QM6 LPG RE,2.0 LPe RE' },
  { variant: 2, trimSeq: 1, powertrain: '가솔린 2.0 2WD', trim: 'GDe RE', fuel: '가솔린', cc: 1997, aliases: 'QM6 GDe RE,QM6 가솔린 RE,2.0 GDe RE' },
].map((config) => [
  '검증중', '교차확인', '신차', '국산', '르노코리아', 'QM6', 'QM6 2025 국내형', config.powertrain, config.trim,
  `${RENAULT_QM6_2025_KOREA_ID}::v${String(config.variant).padStart(2, '0')}::t${String(config.trimSeq).padStart(2, '0')}`,
  RENAULT_QM6_2025_KOREA_ID, config.variant, config.trimSeq, '1세대 후기형', 'HZG', '2025-02', '현재', '2025', '현재',
  config.fuel, config.cc, 2.0, '아니오', '2WD', 5, '',
  `르노 QM6,르노코리아 QM6,Renault QM6,QM6 HZG,${config.aliases},5인승`,
  RENAULT_QM6_2025_PRICE_URL, RENAULT_QM6_2025_NOTE, DATA_AS_OF,
]);
const RENAULT_SM6_2025_KOREA_ID = 'mf-005.md-010.sm-lfd-sm6-2025-korea__sm6-tce-lpe';
const RENAULT_SM6_2025_PRICE_URL = 'https://www.renault.co.kr/upload/asset/price/price_sm6_202506.pdf';
const RENAULT_SM6_FEEL_URL = 'https://www.renault.co.kr/ko/inside/news_view.jsp?index=1436&searchStr=&searchType=&sort=&syr=all';
const RENAULT_SM6_2025_BROCHURE_URL = 'https://www.renault.co.kr/upload/asset/ebrochure/eBrochure_sm6_202501.pdf';
const RENAULT_SM6_2025_NOTE = `르노코리아 공식 2025-06 가격표에서 SM6 국내 판매 조합을 TCe 260 필 [必; Feel], TCe 300 INSPIRE, 2.0 LPe 필 [必; Feel]로 확인했다. 공식 2025-01 브로슈어 제원은 TCe 260 1,332cc, TCe 300 1,798cc, LPe 1,998cc와 5인승을 확인하며, 공식 필 출시자료는 필 트림이 기존 SE·LE를 통합 대체하고 TCe 260 및 LPe에서 운영됨을 설명한다. 기존 2020-07~현재 자동 코드 14개는 LE·SE·SE Plus·RE·프리미에르·필·인스파이어를 동시에 현행으로 열어 연식과 파워트레인별 트림을 과매칭하므로 키 의미와 이력을 보존한 채 차단한다. 생산 종료월은 추정하지 않고 2025-06 가격표와 2025-09 공식 구매혜택에 판매 대상이 겹치는 확인 구간만 복원한다. 제원 근거: ${RENAULT_SM6_2025_BROCHURE_URL}; 필 계보 근거: ${RENAULT_SM6_FEEL_URL}`;
const renaultSm6_2025Rows = [
  { variant: 1, trim: 'TCe 260 필 [必; Feel]', powertrain: '가솔린 1.3T 2WD', fuel: '가솔린', cc: 1332, aliases: 'SM6 TCe 260 필,SM6 TCe260 Feel,SM6 1.3 터보 필' },
  { variant: 2, trim: 'TCe 300 INSPIRE', powertrain: '가솔린 1.8T 2WD', fuel: '가솔린', cc: 1798, aliases: 'SM6 TCe 300 인스파이어,SM6 TCe300 Inspire,SM6 1.8 터보 인스파이어' },
  { variant: 3, trim: 'LPe 필 [必; Feel]', powertrain: 'LPG 2.0 2WD', fuel: 'LPG', cc: 1998, aliases: 'SM6 LPe 필,SM6 LPe Feel,SM6 LPG 필' },
].map((config) => [
  '검증중', '교차확인', '중고차', '국산', '르노코리아', 'SM6', 'SM6 2025 국내형', config.powertrain, config.trim,
  `${RENAULT_SM6_2025_KOREA_ID}::v${String(config.variant).padStart(2, '0')}::t01`,
  RENAULT_SM6_2025_KOREA_ID, config.variant, 1, '1세대 후기형', 'LFD', '2025-06', '2025-09', '2025', '2025',
  config.fuel, config.cc, config.cc === 1332 ? 1.3 : config.cc === 1798 ? 1.8 : 2.0, config.fuel === 'LPG' ? '아니오' : '예', '2WD', 5, '',
  `르노 SM6,르노코리아 SM6,Renault SM6,SM6 LFD,${config.aliases},5인승`,
  RENAULT_SM6_2025_PRICE_URL, RENAULT_SM6_2025_NOTE, DATA_AS_OF,
]);
const KGM_KORANDO_2025_KOREA_ID = 'mf-004.md-011.sm-c300-korando-2025-korea__korando-1.5t';
const KGM_KORANDO_2025_PRICE_URL = 'https://m.kg-mobility.com/showroom/korando/price/__icsFiles/afieldfile/2024/11/29/korando_price_1.pdf';
const KGM_KORANDO_2025_NOTE = `KG모빌리티 공식 2024-11 가격표 기준. 후기형 코란도 국내 판매 파워트레인은 1,497cc 가솔린 1.5 T-GDI와 AISIN 6단 자동변속기이며 C5·C5 Plus·C7·Black Edition 트림을 확인했다. C7에는 공식 가격표에 4WD 시스템 선택이 별도로 명시돼 2WD와 AWD를 분리한다. Black Edition은 C7 기본품목 기반의 외관 패키지이지만 해당 항목에 4WD 선택이 직접 연결되지 않아 2WD만 발급한다. 기존 C300 자동 코드 18개는 디젤 1.6과 과거 C3+·딜라이트·플러스·판타스틱·프라임·R+ 등을 모두 2019-02부터 현재까지 열어 실제 연식별 파워트레인·트림을 과매칭하므로 의미와 이력을 보존한 채 차단한다. 현행 종료월을 추정하지 않고 공식 온라인 스토어가 확인되는 2025-06까지의 후기형 이력으로 제한한다.`;
const kgmKorando_2025Rows = [
  { variant: 1, trimSeq: 1, drivetrain: '2WD', trim: 'C5', aliases: '코란도 C5,Korando C5' },
  { variant: 1, trimSeq: 2, drivetrain: '2WD', trim: 'C5 Plus', aliases: '코란도 C5 플러스,Korando C5 Plus' },
  { variant: 1, trimSeq: 3, drivetrain: '2WD', trim: 'C7', aliases: '코란도 C7,Korando C7' },
  { variant: 1, trimSeq: 4, drivetrain: '2WD', trim: 'Black Edition', aliases: '코란도 블랙 에디션,Korando Black Edition' },
  { variant: 2, trimSeq: 1, drivetrain: 'AWD', trim: 'C7', aliases: '코란도 C7 AWD,Korando C7 4WD,코란도 사륜' },
].map((config) => [
  '검증중', '교차확인', '중고차', '국산', 'KG모빌리티', '코란도', '코란도 C300 2025 국내형', `가솔린 1.5T ${config.drivetrain}`, config.trim,
  `${KGM_KORANDO_2025_KOREA_ID}::v${String(config.variant).padStart(2, '0')}::t${String(config.trimSeq).padStart(2, '0')}`,
  KGM_KORANDO_2025_KOREA_ID, config.variant, config.trimSeq, '4세대 후기형', 'C300', '2024-11', '2025-06', '2025', '2025',
  '가솔린', 1497, 1.5, '예', config.drivetrain, 5, '',
  `KGM 코란도,KG모빌리티 코란도,쌍용 코란도,Korando,코란도 C300,${config.aliases},5인승`,
  KGM_KORANDO_2025_PRICE_URL, KGM_KORANDO_2025_NOTE, DATA_AS_OF,
]);
const KGM_KORANDO_EV_2024_ID = 'mf-004.md-011.sm-e100-korando-ev-2024-korea__korando-ev-73k';
const KGM_KORANDO_EV_2024_PRICE_URL = 'https://m.kg-mobility.com/showroom/korandoev/price/__icsFiles/afieldfile/2024/09/27/korando_EV_price_1.pdf';
const KGM_KORANDO_EV_2024_SPEC_URL = 'https://m.kg-mobility.com/showroom/total_price/__icsFiles/afieldfile/2024/11/29/Total_price_2412_1.pdf';
const KGM_KORANDO_EV_2024_NOTE = `KG모빌리티 공식 2024-09 코란도 EV 가격표에서 E3·E5 두 국내 트림과 73.4kWh 리튬인산철 배터리, 152.2kW 모터를 확인했다. 공식 2024-12 종합가격표 제원에서 2WD·73.4kWh·152.2kW를 교차 확인했다. 기존 E100 E5 코드는 2022-02 코란도 이모션 초기 계보를 배터리와 명칭 구분 없이 현재까지 연장해 2024 코란도 EV E5와 자동 충돌하므로 키 의미와 이력을 보존한 채 차단한다. 신규 코드는 코란도 EV 공식 가격표가 시작되는 2024-06보다 앞당기지 않고, 공식 온라인 스토어 확인 시점인 2025-06까지의 국내 이력으로 제한한다. 제원 근거: ${KGM_KORANDO_EV_2024_SPEC_URL}`;
const kgmKorandoEv_2024Rows = ['E3', 'E5'].map((trim, index) => [
  '검증중', '교차확인', '중고차', '국산', 'KG모빌리티', '코란도 EV', '코란도 EV E100 국내형', '전기 73.4kWh 2WD', trim,
  `${KGM_KORANDO_EV_2024_ID}::v01::t${String(index + 1).padStart(2, '0')}`,
  KGM_KORANDO_EV_2024_ID, 1, index + 1, '4세대 전기형', 'E100', '2024-06', '2025-06', '2024', '2025',
  '전기', '', '', '아니오', '2WD', 5, 73.4,
  `KGM 코란도 EV,KG모빌리티 코란도 EV,쌍용 코란도 EV,Korando EV,코란도 이브이,코란도 E100,코란도 EV ${trim},Korando EV ${trim},73.4kWh,5인승`,
  KGM_KORANDO_EV_2024_PRICE_URL, KGM_KORANDO_EV_2024_NOTE, DATA_AS_OF,
]);
const HYUNDAI_VENUE_2025_ID = 'mf-001.md-059.sm-qx1-venue-2025-korea__venue-1.6-ivt';
const HYUNDAI_VENUE_2025_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/venue-2025-price.pdf';
const HYUNDAI_VENUE_2025_CATALOG_URL = 'https://www.hyundai.com/contents/repn-car/catalog/venue-catalog.pdf';
const HYUNDAI_VENUE_2025_NOTE = `현대자동차 공식 2025 베뉴 가격표(현 모델 출시일 2025-04-02)에서 국내 판매 트림이 Smart·Premium·FLUX이고 모두 스마트스트림 가솔린 1.6 엔진과 스마트스트림 IVT를 쓰는 것을 확인했다. 공식 현행 카탈로그에서 스마트스트림 G1.6, 1,598cc와 5인승 차체를 교차 확인했다. 기존 QX1 영구코드 5개는 2019-07부터 현재까지 Smart·Modern·Modern Plus·Premium·Flux를 같은 기간으로 기록했지만, 현대 공식 초기 가격표에는 Smart·Modern 계열만 있었고 2025 가격표에는 Modern·Modern Plus가 없다. 서로 다른 연식의 동명 또는 변경 트림이 자동으로 합쳐지지 않도록 원래 키 의미와 이력을 보존한 채 기존 5개를 차단하고 2025-04 공식 라인업을 별도 코드로 발급한다. 제원 근거: ${HYUNDAI_VENUE_2025_CATALOG_URL}`;
const hyundaiVenue_2025Rows = ['Smart', 'Premium', 'FLUX'].map((trim, index) => [
  '확정', '확정', '신차', '국산', '현대', '베뉴', '2025 베뉴 QX1', '가솔린 1.6 2WD IVT', trim,
  `${HYUNDAI_VENUE_2025_ID}::v01::t${String(index + 1).padStart(2, '0')}`,
  HYUNDAI_VENUE_2025_ID, 1, index + 1, '1세대 연식변경', 'QX1', '2025-04', '현재', '2025', '현재',
  '가솔린', 1598, 1.6, '아니오', '2WD', 5, '',
  `현대 베뉴,Hyundai Venue,베뉴 QX1,2025 베뉴,베뉴 1.6 IVT,베뉴 ${trim},Venue ${trim},${trim === 'FLUX' ? '플럭스' : trim === 'Premium' ? '프리미엄' : '스마트'}`,
  HYUNDAI_VENUE_2025_PRICE_URL, HYUNDAI_VENUE_2025_NOTE, DATA_AS_OF,
]);
const KIA_SELTOS_SP3_2026_ID = 'mf-002.md-064.sm-sp3-seltos-2026-korea__all-new-seltos';
const KIA_SELTOS_SP3_2026_PRICE_URL = 'https://www.kia.com/kr/vehicles/seltos/price';
const KIA_SELTOS_SP3_2026_SPEC_URL = 'https://www.kia.com/kr/vehicles/seltos/specification';
const KIA_SELTOS_SP3_2026_NOTE = `기아 공식 디 올 뉴 셀토스 국내 가격 페이지의 2026-07-01 기준 라인업에서 1.6 가솔린 터보와 1.6 하이브리드, 트렌디·프레스티지·시그니처·X-Line 네 트림을 확인했다. 가솔린 터보는 각 트림에서 전자식 4WD 선택이 가능하고, 공식 제원에서 1,598cc·8단 자동·2WD/4WD를 확인했다. 하이브리드는 공식 제원상 1,580cc·6단 DCT·2WD이다. 기존 SP3 코드는 2025-07부터 국내 판매된 것으로 1년 일찍 열려 있고 가솔린 4WD가 누락돼 있으며 비터보 가솔린·빈 트림도 섞여 있어, 키 의미와 이력을 보존한 채 전부 차단하고 공식 국내 가격 기준일보다 앞당기지 않은 신규 코드를 발급한다. 제원 근거: ${KIA_SELTOS_SP3_2026_SPEC_URL}`;
const KIA_SELTOS_SP3_TRIMS = ['트렌디', '프레스티지', '시그니처', 'X-Line'] as const;
const kiaSeltosSp3_2026Rows = [
  ...(['2WD', '4WD'] as const).flatMap((drive, driveIndex) => KIA_SELTOS_SP3_TRIMS.map((trim, trimIndex) => [
    '검증중', '교차확인', '신차', '국산', '기아', '셀토스', '디 올 뉴 셀토스 SP3',
    `가솔린 1.6T ${drive} 8AT`, trim,
    `${KIA_SELTOS_SP3_2026_ID}::v${String(driveIndex + 1).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`,
    KIA_SELTOS_SP3_2026_ID, driveIndex + 1, trimIndex + 1, '2세대 완전변경', 'SP3', '2026-07', '현재', '2026', '현재',
    '가솔린', 1598, 1.6, '예', drive, 5, '',
    ['기아 셀토스', 'Kia Seltos', '디 올 뉴 셀토스', 'The all-new Seltos', '셀토스 SP3', `셀토스 ${trim}`, `Seltos ${trim}`,
      ...(trim === 'X-Line' ? ['X라인', '엑스라인'] : []), ...(drive === '4WD' ? ['전자식 4WD', '사륜'] : ['전륜', '2륜'])].join(','),
    KIA_SELTOS_SP3_2026_PRICE_URL, KIA_SELTOS_SP3_2026_NOTE, DATA_AS_OF,
  ])),
  ...KIA_SELTOS_SP3_TRIMS.map((trim, trimIndex) => [
    '검증중', '교차확인', '신차', '국산', '기아', '셀토스', '디 올 뉴 셀토스 SP3',
    '하이브리드 1.6 2WD 6DCT', trim,
    `${KIA_SELTOS_SP3_2026_ID}::v03::t${String(trimIndex + 1).padStart(2, '0')}`,
    KIA_SELTOS_SP3_2026_ID, 3, trimIndex + 1, '2세대 완전변경', 'SP3', '2026-07', '현재', '2026', '현재',
    '하이브리드', 1580, 1.6, '아니오', '2WD', 5, '',
    ['기아 셀토스', 'Kia Seltos', '디 올 뉴 셀토스', 'The all-new Seltos', '셀토스 SP3', '셀토스 하이브리드', '셀토스 HEV',
      `셀토스 ${trim}`, `Seltos ${trim}`, ...(trim === 'X-Line' ? ['X라인', '엑스라인'] : [])].join(','),
    KIA_SELTOS_SP3_2026_PRICE_URL, KIA_SELTOS_SP3_2026_NOTE, DATA_AS_OF,
  ]),
];
const KIA_NIRO_PE_2026_ID = 'mf-002.md-061.sm-sg2-niro-pe-2026-korea__the-new-niro-hev';
const KIA_NIRO_PE_2026_PRICE_URL = 'https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_niro.pdf';
const KIA_NIRO_PE_2026_SPEC_URL = 'https://www.kia.com/kr/vehicles/niro/specification/';
const KIA_NIRO_PE_2026_PLAN_URL = 'https://worldwide.kia.com/files/investors/ir-activities/hz/vz/zlyunrrb/289493601qrxs.pdf?_sp=ea6d51ef-c043-4411-a419-19494a34b23f';
const KIA_NIRO_PE_2026_NOTE = `기아 공식 2026 상품계획에서 Niro HEV 부분변경(PE)을 2026년 일정으로 확인했고, 공식 2026-05 가격표에서 The new Niro의 트렌디·프레스티지·시그니처 세 트림을 확인했다. 현행 공식 제원은 스마트스트림 G1.6 하이브리드, 1,580cc, 6단 DCT, 2WD, 5인승이다. 기존 더 뉴 니로 SG2 코드는 이 부분변경을 2025-04부터 1년 이상 일찍 열어 자동 과매칭하므로 키 의미와 이력을 보존한 채 차단한다. 2022-01 국내 판매를 시작한 디 올 뉴 니로 HEV의 기존 네 코드는 부분변경 직전인 2026-04까지로 닫고, 신규 부분변경 코드는 공식 2026-05 가격표보다 앞당기지 않는다. 상품계획 근거: ${KIA_NIRO_PE_2026_PLAN_URL}; 제원 근거: ${KIA_NIRO_PE_2026_SPEC_URL}`;
const kiaNiroPe_2026Rows = ['트렌디', '프레스티지', '시그니처'].map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '국산', '기아', '니로', '더 뉴 니로 SG2 부분변경',
  '하이브리드 1.6 2WD 6DCT', trim,
  `${KIA_NIRO_PE_2026_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`,
  KIA_NIRO_PE_2026_ID, 1, trimIndex + 1, '2세대 부분변경', 'SG2', '2026-05', '현재', '2026', '현재',
  '하이브리드', 1580, 1.6, '아니오', '2WD', 5, '',
  ['기아 니로', 'Kia Niro', '더 뉴 니로', 'The new Niro', '니로 SG2', '니로 하이브리드', '니로 HEV', `니로 ${trim}`, `Niro ${trim}`].join(','),
  KIA_NIRO_PE_2026_PRICE_URL, KIA_NIRO_PE_2026_NOTE, DATA_AS_OF,
]);
const KIA_RAY_EV_2023_ID = 'mf-002.md-058.sm-tam-ray-ev-2023-korea__ray-ev-35k';
const KIA_RAY_EV_PRICE_URL = 'https://www.kia.com/kr/vehicles/ray-ev/price';
const KIA_RAY_EV_SPEC_URL = 'https://www.kia.com/kr/vehicles/ray-ev/specification';
const KIA_RAY_EV_2023_RENTAL_URL = 'https://rental.kia.com/rentfile/carseries/carseries_1696997562745.pdf';
const KIA_RAY_EV_HERITAGE_URL = 'https://heritage.kia.com/kr/vehicles/ray-ev';
const KIA_RAY_EV_2023_NOTE = `기아 헤리티지 공식 자료에서 레이 EV 2세대가 2023년에 출시됐음을 확인했고, 기아 공식 2023-09 렌트 카탈로그에서 35.2kWh 레이 EV의 국내 판매 이력을 확인했다. 현행 공식 가격 페이지는 4인승 승용·2인승 밴·1인승 밴을 각각 라이트·에어 트림으로 구분하며, 공식 제원과 배터리 가이드는 35.2kWh LFP 배터리와 전륜구동을 확인한다. 기존 영구코드는 35.2kWh 레이 EV를 2022-09부터 1년 일찍 열었고 승용 2개와 2인승 밴 에어만 있어 차체·인승 조합이 불완전하다. 원래 키 의미와 이력은 보존한 채 기존 3개를 차단하고, 공식 2023-09 자료보다 앞당기지 않은 6개 조합을 새로 발급한다. 출시 근거: ${KIA_RAY_EV_HERITAGE_URL}; 제원 근거: ${KIA_RAY_EV_SPEC_URL}`;
const KIA_RAY_EV_BODIES = [
  { variant: 1, subModel: '더 기아 레이 EV 4인승 승용', powertrain: '전기 35.2kWh FWD 4인승', seats: 4, bodyAlias: '승용' },
  { variant: 2, subModel: '더 기아 레이 EV 2인승 밴', powertrain: '전기 35.2kWh FWD 2인승 밴', seats: 2, bodyAlias: '2인승 밴' },
  { variant: 3, subModel: '더 기아 레이 EV 1인승 밴', powertrain: '전기 35.2kWh FWD 1인승 밴', seats: 1, bodyAlias: '1인승 밴' },
] as const;
const kiaRayEv_2023Rows = KIA_RAY_EV_BODIES.flatMap((body) => ['라이트', '에어'].map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '국산', '기아', '레이 EV', body.subModel, body.powertrain, trim,
  `${KIA_RAY_EV_2023_ID}::v${String(body.variant).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`,
  KIA_RAY_EV_2023_ID, body.variant, trimIndex + 1, '2세대 전기형', 'TAM', '2023-09', '현재', '2023', '현재',
  '전기', '', '', '아니오', 'FWD', body.seats, 35.2,
  ['기아 레이 EV', 'Kia Ray EV', '더 기아 레이 EV', 'The Kia Ray EV', '레이 전기차', '레이 35.2kWh', `레이 EV ${body.bodyAlias}`, `레이 EV ${trim}`, `Ray EV ${trim}`].join(','),
  KIA_RAY_EV_2023_RENTAL_URL, KIA_RAY_EV_2023_NOTE, DATA_AS_OF,
]));
const KIA_RAY_GAS_2027_ID = 'mf-002.md-058.sm-tam-ray-gas-2027-korea__the-2027-ray';
const KIA_RAY_GAS_PRICE_URL = 'https://www.kia.com/kr/vehicles/ray/price';
const KIA_RAY_GAS_SPEC_URL = 'https://www.kia.com/kr/vehicles/ray/specification';
const KIA_RAY_GAS_2027_NOTE = `기아 공식 The 2027 Ray 가격 페이지의 2026-08-01 기준 구성과 공식 제원 기준. 승용은 트렌디·프레스티지·시그니처·X-Line, 가솔린 밴은 1인승과 2인승 각각 트렌디·프레스티지·프레스티지 스페셜로 분리한다. 모든 조합은 카파 1.0 가솔린 998cc, 4단 자동변속기, 2WD이며 승용 5인승과 밴 1·2인승을 별도 영구코드로 발급한다. 기존 2022-09 시작 코드는 당시 명칭과 이력을 보존해 2026-07에서 닫고, 실제 당시 공식 가격표에 없던 시그니처 X라인 합본 코드는 차단한다. 제원 근거: ${KIA_RAY_GAS_SPEC_URL}`;
const KIA_RAY_GAS_2027_BODIES = [
  { variant: 1, subModel: 'The 2027 Ray 가솔린 승용', powertrain: '가솔린 1.0 2WD 4AT 5인승', seats: 5, trims: ['트렌디', '프레스티지', '시그니처', 'X-Line'], bodyAliases: ['레이 가솔린 승용', '레이 5인승'] },
  { variant: 2, subModel: 'The 2027 Ray 가솔린 1인승 밴', powertrain: '가솔린 1.0 2WD 4AT 1인승 밴', seats: 1, trims: ['트렌디', '프레스티지', '프레스티지 스페셜'], bodyAliases: ['레이 1인승 밴', '레이 밴 1인승'] },
  { variant: 3, subModel: 'The 2027 Ray 가솔린 2인승 밴', powertrain: '가솔린 1.0 2WD 4AT 2인승 밴', seats: 2, trims: ['트렌디', '프레스티지', '프레스티지 스페셜'], bodyAliases: ['레이 2인승 밴', '레이 밴 2인승'] },
] as const;
const kiaRayGas_2027Rows = KIA_RAY_GAS_2027_BODIES.flatMap((body) => body.trims.map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '국산', '기아', '레이', body.subModel, body.powertrain, trim,
  `${KIA_RAY_GAS_2027_ID}::v${String(body.variant).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`,
  KIA_RAY_GAS_2027_ID, body.variant, trimIndex + 1, '2세대 2차 부분변경 2027 연식', 'TAM', '2026-08', '현재', '2027', '현재',
  '가솔린', 998, 1.0, '아니오', '2WD', body.seats, '',
  ['기아 레이', 'Kia Ray', 'The 2027 Ray', '2027 레이', ...body.bodyAliases, `레이 ${trim}`, `Ray ${trim}`].join(','),
  KIA_RAY_GAS_PRICE_URL, KIA_RAY_GAS_2027_NOTE, DATA_AS_OF,
]));
const KIA_MORNING_2027_ID = 'mf-002.md-013.sm-ja-morning-2027-korea__the-2027-morning';
const KIA_MORNING_2027_LAUNCH_URL = 'https://worldwide.kia.com/ko/newsroom-korea/view/?id=1520';
const KIA_MORNING_PRICE_URL = 'https://www.kia.com/kr/vehicles/morning/price';
const KIA_MORNING_SPEC_URL = 'https://www.kia.com/kr/vehicles/morning/specification';
const KIA_MORNING_2027_NOTE = `기아 공식 2026-05-15 출시자료와 The 2027 Morning 현행 가격·제원 기준. 2027 연식은 2026-05-18 판매를 시작했고 승용 트렌디·프레스티지·시그니처·GT-Line, 2인승 밴 트렌디·프레스티지로 구성된다. 모든 조합은 스마트스트림 G1.0 998cc, 4단 자동변속기, 2WD이며 승용 5인승과 밴 2인승을 별도 영구코드로 발급한다. 기존 2023-07 시작 JA 부분변경 코드는 의미와 이력을 보존해 2026-04에서 닫는다. 현행 가격: ${KIA_MORNING_PRICE_URL}; 제원: ${KIA_MORNING_SPEC_URL}`;
const KIA_MORNING_2027_BODIES = [
  { variant: 1, subModel: 'The 2027 Morning 가솔린 승용', powertrain: '가솔린 1.0 2WD 4AT 5인승', seats: 5, trims: ['트렌디', '프레스티지', '시그니처', 'GT-Line'], aliases: ['모닝 가솔린 승용', '모닝 5인승'] },
  { variant: 2, subModel: 'The 2027 Morning 가솔린 2인승 밴', powertrain: '가솔린 1.0 2WD 4AT 2인승 밴', seats: 2, trims: ['트렌디', '프레스티지'], aliases: ['모닝 2인승 밴', '모닝 밴'] },
] as const;
const kiaMorning_2027Rows = KIA_MORNING_2027_BODIES.flatMap((body) => body.trims.map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '국산', '기아', '모닝', body.subModel, body.powertrain, trim,
  `${KIA_MORNING_2027_ID}::v${String(body.variant).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`,
  KIA_MORNING_2027_ID, body.variant, trimIndex + 1, '3세대 2차 부분변경 2027 연식', 'JA', '2026-05', '현재', '2027', '현재',
  '가솔린', 998, 1.0, '아니오', '2WD', body.seats, '',
  ['기아 모닝', 'Kia Morning', 'The 2027 Morning', '2027 모닝', ...body.aliases, `모닝 ${trim}`, `Morning ${trim}`].join(','),
  KIA_MORNING_2027_LAUNCH_URL, KIA_MORNING_2027_NOTE, DATA_AS_OF,
]));
const TESLA_NEW_MODEL_Y_ID = 'mf-087.md-004.sm-juniper__new-model-y-premium';
const TESLA_MODEL_Y_L_ID = 'mf-087.md-004.sm-model-y-l__model-y-l';
const TESLA_MODEL_Y_URL = 'https://www.tesla.com/ko_kr/modely';
const TESLA_RANGE_URL = 'https://www.tesla.com/ko_KR/support/range-calculator-ref';
const TESLA_MODEL_Y_L_LAUNCH_URL = 'https://shop.tesla.com/ko_kr/product/model-y-l-roof-rack';
const TESLA_NEW_MODEL_Y_NOTE = `Tesla 대한민국 현행 Model Y 공식 페이지와 한국 공인연비 페이지 기준. New Model Y Premium은 2025 대규모 리프레시 차체로 구형 Model Y와 분리하고 RWD 5인승과 Long Range AWD 5인승으로 나눈다. 환경부 2025 공식 보조금표에는 같은 리프레시 국내형이 New Model Y RWD·New Model Y Long Range로 기록되어 두 명칭을 역사 별칭으로 함께 유지한다. Premium 명칭 전환월은 공식 자료로 직접 확인되지 않아 근거 없이 별도 기간 코드를 만들지 않는다. Juniper는 공식 국내 모델명이 아니므로 검색 별칭으로만 유지한다. Tesla 공식 액세서리 호환 기준이 2025-02 이후 생산차로 명시되어 생산 시작을 2025-02로 기록했다. 배터리는 정격전압·Ah만 공개되고 총용량 kWh가 공식 미공개이므로 추산하지 않고 공란으로 유지한다. 국내 공인 제원: ${TESLA_RANGE_URL}; 2025 렌트·리스 차종 근거: https://ev.or.kr/nportal/file/downloadJfile.do?FILE_MASK=2025102109EE56E0EF86524AF898D1C357B2ED0110`;
const TESLA_MODEL_Y_L_NOTE = `Tesla 대한민국 현행 Model Y 공식 페이지 기준. Model Y L은 New Model Y 계열의 단순 트림이 아니라 전장 4,970mm, 확장 휠베이스, 듀얼 모터 상시 AWD, 6인승을 갖춘 롱휠베이스 파생 차체이므로 별도 마스터 ID로 분리한다. Tesla Korea 공식 액세서리의 동일모델 출시연월 2026-07을 국내 시작월로 적용하며 배터리 총용량 kWh는 공식 미공개이므로 추산하지 않고 공란으로 유지한다. 국내 출시 연월 교차 근거: ${TESLA_MODEL_Y_L_LAUNCH_URL}`;
const teslaCurrentModelYRows = [
  ['검증중', '교차확인', '신차', '수입', '테슬라', '모델 Y', 'New Model Y Premium', '전기 AWD', 'Premium Long Range AWD', `${TESLA_NEW_MODEL_Y_ID}::v01::t01`, TESLA_NEW_MODEL_Y_ID, 1, 1, '1세대 부분변경(리프레시)', '', '2025-02', '현재', '2025', '현재', '전기', '', '', '아니오', 'AWD', 5, '', '테슬라 모델 Y,Tesla Model Y,New Model Y,New Model Y Long Range,New Model Y Long Range AWD,모델Y 주니퍼,Juniper,Model Y Refresh,모델Y 리프레시,Premium Long Range AWD,프리미엄 롱 레인지 AWD', TESLA_MODEL_Y_URL, TESLA_NEW_MODEL_Y_NOTE, DATA_AS_OF],
  ['검증중', '교차확인', '신차', '수입', '테슬라', '모델 Y', 'New Model Y Premium', '전기 RWD', 'Premium RWD', `${TESLA_NEW_MODEL_Y_ID}::v02::t01`, TESLA_NEW_MODEL_Y_ID, 2, 1, '1세대 부분변경(리프레시)', '', '2025-02', '현재', '2025', '현재', '전기', '', '', '아니오', 'RWD', 5, '', '테슬라 모델 Y,Tesla Model Y,New Model Y,New Model Y RWD,모델Y 주니퍼,Juniper,Model Y Refresh,모델Y 리프레시,Premium RWD,프리미엄 후륜구동', TESLA_MODEL_Y_URL, TESLA_NEW_MODEL_Y_NOTE, DATA_AS_OF],
  ['검증중', '교차확인', '신차', '수입', '테슬라', '모델 Y', 'Model Y L', '전기 AWD', 'Model Y L', `${TESLA_MODEL_Y_L_ID}::v01::t01`, TESLA_MODEL_Y_L_ID, 1, 1, '1세대 롱휠베이스 파생형', '', '2026-07', '현재', '2026', '현재', '전기', '', '', '아니오', 'AWD', 6, '', '테슬라 모델 Y L,Tesla Model Y L,모델Y L,Model YL,6인승,3열 6인승,롱휠베이스,Long Wheelbase', TESLA_MODEL_Y_URL, TESLA_MODEL_Y_L_NOTE, DATA_AS_OF],
];
const TESLA_LEGACY_MODEL_Y_PERFORMANCE_ID = 'mf-087.md-004.sm-legacy-performance-2023__model-y-performance';
const TESLA_2023_EV_SUBSIDY_URL = 'https://ev.or.kr/nportal/file/downloadJfile.do?FILE_MASK=20230811108EEAB79E31F04E7880390AADCEC516EC';
const TESLA_2021_REGISTRATION_DATA_URL = 'https://www.data.go.kr/data/15111234/fileData.do?recommendDataYn=Y';
const teslaLegacyModelYPerformanceRows = [[
  '검증중', '교차확인', '중고차', '수입', '테슬라', '모델 Y', 'Model Y 2020-2024', '전기 AWD', 'Performance',
  `${TESLA_LEGACY_MODEL_Y_PERFORMANCE_ID}::v01::t01`, TESLA_LEGACY_MODEL_Y_PERFORMANCE_ID, 1, 1,
  '1세대 초기형', '', '2023-08', '2025-01', '2023', '2025', '전기', '', '', '아니오', 'AWD', 5, '',
  '테슬라 모델 Y 퍼포먼스,Tesla Model Y Performance,Model Y Performance AWD,모델Y 퍼포먼스,퍼포먼스 AWD',
  TESLA_2023_EV_SUBSIDY_URL,
  '환경부 무공해차 통합누리집의 2023-08 공식 보조금 차종표에서 Model Y Performance의 국내 유통 및 리스·렌탈 추가보조금 대상을 확인했고 2024년 공식 차종표로 존속을 교차확인했다. 시작월은 공식 문서로 직접 증명되는 2023-08보다 앞당기지 않았으며, New Model Y 생산구분 시작 직전인 2025-01까지의 구형 이력으로 보수적으로 닫는다. Tesla 공식 Model Y 매뉴얼의 Performance 좌석 구성 기준으로 5인승을 적용한다.',
  DATA_AS_OF,
]];
const TESLA_LEGACY_MODEL_Y_LONG_RANGE_ID = 'mf-087.md-004.sm-legacy-long-range-2023__model-y-long-range';
const teslaLegacyModelYLongRangeRows = [[
  '검증중', '교차확인', '중고차', '수입', '테슬라', '모델 Y', 'Model Y 2020-2024', '전기 AWD', 'Long Range AWD',
  `${TESLA_LEGACY_MODEL_Y_LONG_RANGE_ID}::v01::t01`, TESLA_LEGACY_MODEL_Y_LONG_RANGE_ID, 1, 1,
  '1세대 초기형', '', '2023-08', '2025-01', '2023', '2025', '전기', '', '', '아니오', 'AWD', 5, '',
  '테슬라 모델 Y 롱 레인지,Tesla Model Y Long Range,Model Y Long Range AWD,Model Y Long Range 19인치,모델Y 롱레인지 19인치,롱 레인지 AWD',
  TESLA_2023_EV_SUBSIDY_URL,
  '환경부 무공해차 통합누리집의 2023-08 공식 보조금 차종표에서 Model Y Long Range의 국내 유통 및 리스·렌탈 추가보조금 대상을 확인했고 2024년 차종표의 Model Y Long Range 및 Long Range 19인치로 존속을 교차확인했다. 19인치는 별도 상용 트림이 아닌 휠 인증 변형이므로 별칭으로 흡수한다. 시작월은 공식 문서로 직접 증명되는 시점보다 앞당기지 않고 New Model Y 생산구분 직전 2025-01까지로 닫는다.',
  DATA_AS_OF,
]];
const TESLA_NEW_MODEL_Y_LAUNCH_SERIES_ID = 'mf-087.md-004.sm-juniper-launch-series-2025__new-model-y-launch-series';
const TESLA_NEW_MODEL_Y_LAUNCH_SERIES_URL = 'https://ir.tesla.com/_flysystem/s3/sec/000162828025002993/tsla-20250129-gen.pdf';
const TESLA_KR_LAUNCH_SERIES_URL = 'https://shop.tesla.com/ko_kr/product/men_s-model-y-launch-series-tee';
const teslaNewModelYLaunchSeriesRows = [[
  '검증중', '교차확인', '중고차', '수입', '테슬라', '모델 Y', 'New Model Y Launch Series', '전기 AWD', 'Launch Series Long Range AWD',
  `${TESLA_NEW_MODEL_Y_LAUNCH_SERIES_ID}::v01::t01`, TESLA_NEW_MODEL_Y_LAUNCH_SERIES_ID, 1, 1,
  '1세대 부분변경(리프레시) 한정판', '', '2025-02', '', '2025', '2025', '전기', '', '', '아니오', 'AWD', 5, '',
  '테슬라 New Model Y Launch Series,Tesla New Model Y Launch Series,모델 Y 론치 시리즈,모델Y 런치 시리즈,Launch Series Long Range AWD,롱 레인지 AWD 런치 시리즈',
  TESLA_NEW_MODEL_Y_LAUNCH_SERIES_URL,
  `Tesla 공식 2024 Q4·연간 자료에서 New Model Y Launch Series가 Long Range AWD 한정 구성임을 확인했다. Tesla Korea 공식 스토어도 국내 Model Y Launch Series 차량에서 영감을 받은 컬렉션을 명시한다(${TESLA_KR_LAUNCH_SERIES_URL}). 구형 Model Y와 분리하고 New Model Y 국내 생산구분 시작 2025-02를 적용한다. 현재 국내 주문 페이지에는 없는 한정판이므로 중고차로 분류하되 공식 종료월은 추정하지 않고 공란으로 유지한다.`,
  DATA_AS_OF,
]];
const TESLA_LEGACY_MODEL_Y_2021_PERFORMANCE_ID = 'mf-087.md-004.sm-legacy-performance-2021__model-y-performance';
const TESLA_LEGACY_MODEL_Y_2021_LONG_RANGE_ID = 'mf-087.md-004.sm-legacy-long-range-2021__model-y-long-range';
const teslaLegacyModelY2021Rows = [
  [
    '검증중', '교차확인', '중고차', '수입', '테슬라', '모델 Y', 'Model Y 2021-2024', '전기 AWD', 'Performance',
    `${TESLA_LEGACY_MODEL_Y_2021_PERFORMANCE_ID}::v01::t01`, TESLA_LEGACY_MODEL_Y_2021_PERFORMANCE_ID, 1, 1,
    '1세대 초기형', '', '2021-05', '2025-01', '2021', '2025', '전기', '', '', '아니오', 'AWD', 5, '',
    '테슬라 모델 Y 퍼포먼스,Tesla Model Y Performance,Model Y Performance AWD,모델Y 퍼포먼스,퍼포먼스 AWD',
    TESLA_2021_REGISTRATION_DATA_URL,
    `공공데이터포털의 지자체 등록차량 원천에서 Model Y Performance 5인승의 2021-05-11 국내 등록을 확인해 시작월을 2021-05로 확정했다. 환경부 2023·2024 공식 보조금 차종표에서도 국내 유통 및 리스·렌탈 추가보조금 대상을 교차확인했다(${TESLA_2023_EV_SUBSIDY_URL}). New Model Y 생산구분 시작 직전인 2025-01까지의 구형 이력으로 닫는다.`, DATA_AS_OF,
  ],
  [
    '검증중', '교차확인', '중고차', '수입', '테슬라', '모델 Y', 'Model Y 2021-2024', '전기 AWD', 'Long Range AWD',
    `${TESLA_LEGACY_MODEL_Y_2021_LONG_RANGE_ID}::v01::t01`, TESLA_LEGACY_MODEL_Y_2021_LONG_RANGE_ID, 1, 1,
    '1세대 초기형', '', '2021-05', '2025-01', '2021', '2025', '전기', '', '', '아니오', 'AWD', 5, '',
    '테슬라 모델 Y 롱 레인지,Tesla Model Y Long Range,Model Y Long Range AWD,Model Y Long Range 19인치,모델Y 롱레인지 19인치,롱 레인지 AWD',
    TESLA_2021_REGISTRATION_DATA_URL,
    `공공데이터포털의 지자체 등록차량 원천에서 Model Y Long Range 5인승의 2021-05-12 국내 등록을 확인해 시작월을 2021-05로 확정했다. 환경부 2023·2024 공식 보조금 차종표에서도 국내 유통과 리스·렌탈 추가보조금 대상을 확인했다(${TESLA_2023_EV_SUBSIDY_URL}). 2024 표의 Long Range 19인치는 휠 인증 변형으로 별칭에 흡수하고 New Model Y 생산구분 직전 2025-01까지로 닫는다.`, DATA_AS_OF,
  ],
];

const TESLA_MODEL_3_LEGACY_REGISTRATION_URL = 'https://www.data.go.kr/data/15111234/fileData.do?recommendDataYn=Y';
const TESLA_MODEL_3_SRP_REGISTRATION_URL = 'https://state.gwd.go.kr/upload/report/kw_nws_data/kw_nws_5066_20240328083718.pdf';
const TESLA_MODEL_3_2022_SUBSIDY_URL = 'https://www.anyang.go.kr/main/contents.do?key=3952';
const TESLA_MODEL_3_LEGACY_ID = 'mf-087.md-003.sm-legacy-kr__model-3-legacy-korea';
const teslaLegacyModel3KrRows = [
  ['검증중', '교차확인', '중고차', '수입', '테슬라', '모델 3', '구형 Model 3 국내형', '전기 RWD', 'Standard Range Plus RWD', `${TESLA_MODEL_3_LEGACY_ID}::v01::t01`, TESLA_MODEL_3_LEGACY_ID, 1, 1, '1세대 초기형', '', '2020-01', '2022-12', '2020', '2022', '전기', '', '', '아니오', 'RWD', 5, '', '테슬라 모델 3 스탠다드 레인지 플러스,Model 3 Standard Range Plus RWD,Model 3 SRP RWD,SRP RWD HPL', TESLA_MODEL_3_SRP_REGISTRATION_URL, '강원특별자치도 공직자 재산등록 공고에서 국내 보유 실차를 2020년식 Model 3 Standard Range Plus RWD로 확인하고, 2022년 지자체 보조금표의 SRP RWD HPL 표기를 교차확인했다. 글로벌 2017 생산시점은 국내 시작으로 사용하지 않는다.', DATA_AS_OF],
  ['검증중', '교차확인', '중고차', '수입', '테슬라', '모델 3', '구형 Model 3 국내형', '전기 AWD', 'Long Range AWD', `${TESLA_MODEL_3_LEGACY_ID}::v02::t01`, TESLA_MODEL_3_LEGACY_ID, 2, 1, '1세대 초기형', '', '2020-08', '2023-08', '2020', '2023', '전기', '', '', '아니오', 'AWD', 5, '', '테슬라 모델 3 롱레인지,Model 3 Long Range,Model 3 Long Range AWD,롱 레인지 AWD', TESLA_MODEL_3_LEGACY_REGISTRATION_URL, '공공데이터포털 지자체 등록차량 원천에서 Model 3 Long Range 5인승의 2020-08 국내 등록을 확인했다. 국내 등록 근거 이전인 글로벌 2017 생산시점은 사용하지 않고 Highland 공개 전까지의 구형 이력으로 분리한다.', DATA_AS_OF],
  ['검증중', '교차확인', '중고차', '수입', '테슬라', '모델 3', '구형 Model 3 국내형', '전기 AWD', 'Performance AWD', `${TESLA_MODEL_3_LEGACY_ID}::v03::t01`, TESLA_MODEL_3_LEGACY_ID, 3, 1, '1세대 초기형', '', '2020-06', '2023-08', '2020', '2023', '전기', '', '', '아니오', 'AWD', 5, '', '테슬라 모델 3 퍼포먼스,Model 3 Performance,Model 3 Performance AWD,퍼포먼스 AWD', TESLA_MODEL_3_LEGACY_REGISTRATION_URL, '공공데이터포털 지자체 등록차량 원천에서 Model 3 Performance 5인승의 2020-06 국내 등록을 확인했다. 국내 등록 근거 이전인 글로벌 2017 생산시점은 사용하지 않고 Highland 공개 전까지의 구형 이력으로 분리한다.', DATA_AS_OF],
  ['검증중', '교차확인', '중고차', '수입', '테슬라', '모델 3', '구형 Model 3 국내형', '전기 RWD', 'RWD', `${TESLA_MODEL_3_LEGACY_ID}::v04::t01`, TESLA_MODEL_3_LEGACY_ID, 4, 1, '1세대 초기형', '', '2022-01', '2023-08', '2022', '2023', '전기', '', '', '아니오', 'RWD', 5, '', '테슬라 모델 3 RWD,Model 3 RWD,Model 3 RWD 003,Model 3 RWD 100', TESLA_MODEL_3_2022_SUBSIDY_URL, '2022년 지자체 전기차 보조금표에서 Model 3 RWD(003)와 Model 3 RWD 100을 국내 대상 차종으로 확인했다. Standard Range Plus 표기와 병존하므로 같은 트림으로 합치지 않고 별도 영구코드로 분리한다.', DATA_AS_OF],
];
const TESLA_MODEL_3_HIGHLAND_ID = 'mf-087.md-003.sm-highland__new-model-3';
const TESLA_MODEL_3_URL = 'https://www.tesla.com/ko_kr/model3?redirect=no';
const TESLA_MODEL_3_LAUNCH_URL = 'https://shop.tesla.com/ko_kr/product/1135833';
const TESLA_MODEL_3_PERFORMANCE_URL = 'https://www.tesla.com/ko_kr/blog/introducing-new-model-3-performance';
const TESLA_MODEL_3_NOTE = `Tesla 대한민국 현행 Model 3 공식 페이지와 한국 공인연비 페이지 기준. 국내 공인 트림은 Standard RWD, Premium Long Range RWD, Performance이며 모두 5인승이다. Highland 국내 동일모델 출시연월은 Tesla Korea 공식 액세서리 표시의 2024-04를 적용하고, Premium Long Range RWD는 국내 현행 전환 시점인 2026-07부터 분리한다. 배터리는 정격전압·Ah만 공개되고 총용량 kWh가 공식 미공개이므로 계산하지 않고 공란으로 유지한다. 국내 공인 제원: ${TESLA_RANGE_URL}; Highland 출시연월: ${TESLA_MODEL_3_LAUNCH_URL}`;
const teslaCurrentModel3Rows = [
  ['검증중', '교차확인', '신차', '수입', '테슬라', '모델 3', 'New Model 3 Highland', '전기 RWD', 'Standard RWD', `${TESLA_MODEL_3_HIGHLAND_ID}::v01::t01`, TESLA_MODEL_3_HIGHLAND_ID, 1, 1, '1세대 부분변경', 'Highland', '2024-04', '현재', '2024', '현재', '전기', '', '', '아니오', 'RWD', 5, '', '테슬라 모델 3,Tesla Model 3,New Model 3,모델3 하이랜드,Highland,Model 3 Standard RWD,스탠다드 RWD', TESLA_MODEL_3_URL, TESLA_MODEL_3_NOTE, DATA_AS_OF],
  ['검증중', '교차확인', '신차', '수입', '테슬라', '모델 3', 'New Model 3 Highland', '전기 AWD', 'Performance AWD', `${TESLA_MODEL_3_HIGHLAND_ID}::v02::t01`, TESLA_MODEL_3_HIGHLAND_ID, 2, 1, '1세대 부분변경', 'Highland', '2024-04', '현재', '2024', '현재', '전기', '', '', '아니오', 'AWD', 5, '', '테슬라 모델 3,Tesla Model 3,New Model 3,모델3 하이랜드,Highland,Model 3 Performance,Performance AWD,퍼포먼스 AWD', TESLA_MODEL_3_PERFORMANCE_URL, TESLA_MODEL_3_NOTE, DATA_AS_OF],
  ['검증중', '교차확인', '신차', '수입', '테슬라', '모델 3', 'New Model 3 Highland', '전기 RWD', 'Premium Long Range RWD', `${TESLA_MODEL_3_HIGHLAND_ID}::v03::t01`, TESLA_MODEL_3_HIGHLAND_ID, 3, 1, '1세대 부분변경', 'Highland', '2026-07', '현재', '2026', '현재', '전기', '', '', '아니오', 'RWD', 5, '', '테슬라 모델 3,Tesla Model 3,New Model 3,모델3 하이랜드,Highland,Model 3 Premium Long Range RWD,Premium RWD,프리미엄 롱레인지 RWD', TESLA_MODEL_3_URL, TESLA_MODEL_3_NOTE, DATA_AS_OF],
];
const TESLA_MODEL_3_HIGHLAND_LONG_RANGE_INVENTORY_URL = 'https://www.tesla.com/ko_KR/m3/order/LRW3E7EK6RC161365';
const TESLA_MODEL_3_2024_SUBSIDY_URL = 'https://ev.or.kr/nportal/file/downloadJfile.do?FILE_MASK=20240930101999F6579EEB4AF3A4204AD5CA54529C';
const teslaModel3HighlandHistoricalLongRangeRows = [[
  '검증중', '교차확인', '중고차', '수입', '테슬라', '모델 3', 'New Model 3 Highland', '전기 AWD', 'Long Range AWD',
  `${TESLA_MODEL_3_HIGHLAND_ID}::v04::t01`, TESLA_MODEL_3_HIGHLAND_ID, 4, 1,
  '1세대 부분변경', 'Highland', '2024-04', '2026-06', '2024', '2026', '전기', '', '', '아니오', 'AWD', 5, '',
  '테슬라 모델 3 롱 레인지 AWD,Tesla Model 3 Long Range AWD,New Model 3 Long Range AWD,Model 3 Highland Long Range,모델3 하이랜드 롱레인지,롱 레인지 상시 사륜구동',
  TESLA_MODEL_3_HIGHLAND_LONG_RANGE_INVENTORY_URL,
  `Tesla Korea 공식 인증중고차 원천에서 제조연도 2024, 생산일자 2024-04-15, 최초등록일 2024-05-03인 Model 3 Long Range 상시 사륜구동(AWD) 실차를 확인했다. 2024 환경부 공식 보조금 차종표의 Model 3 Long Range 및 리스·렌탈 추가보조금 대상으로 교차확인했다(${TESLA_MODEL_3_2024_SUBSIDY_URL}). Highland 국내 생산 시작월 2024-04부터 현행 Premium Long Range RWD 전환 직전인 2026-06까지의 이력형으로 분리한다. 종료월은 두 공식 국내 구성의 경계에 따른 보수적 추론이다.`,
  DATA_AS_OF,
]];
const TESLA_MODEL_S_REFRESH_ID = 'mf-087.md-001.sm-refresh-2023__model-s';
const TESLA_MODEL_X_REFRESH_ID = 'mf-087.md-002.sm-refresh-2023__model-x';
const TESLA_SX_LAUNCH_URL = 'https://www.tesla.com/ko_kr/blog/tesla-model-s-model-x-plaid-launch-south-korea';
const TESLA_SX_DELIVERY_URL = 'https://www.tesla.com/ko_kr/blog/tesla-model-s-model-x-plaid-first-delivery-south-korea';
const TESLA_SX_NOTE = `Tesla Korea 2023-03-30 공식 국내 출시 및 2023-06-16 첫 인도 자료와 현행 한국 공인연비 기준. 신형 Model S·Model X는 기본 AWD와 Plaid로 분리하며, Model X AWD는 국내 공인 5·6·7인승을 각각 별도 트림행키로 발급하고 Plaid는 국내 공인 6인승만 발급한다. 배터리는 정격전압·Ah만 공개되고 총용량 kWh가 공식 미공개이므로 계산하지 않고 공란으로 유지한다. 첫 인도 교차 근거: ${TESLA_SX_DELIVERY_URL}; 국내 공인 제원: ${TESLA_RANGE_URL}`;
const teslaRefreshModelSRows = [
  ['검증중', '교차확인', '중고차', '수입', '테슬라', '모델 S', '신형 Model S 2023', '전기 AWD', 'AWD', `${TESLA_MODEL_S_REFRESH_ID}::v01::t01`, TESLA_MODEL_S_REFRESH_ID, 1, 1, '1세대 2차 부분변경', 'Palladium', '2023-03', '2025-05', '2023', '2025', '전기', '', '', '아니오', 'AWD', 5, '', '테슬라 모델 S,Tesla Model S,신형 모델 S,Model S AWD,듀얼 모터 AWD,기본 AWD', TESLA_SX_LAUNCH_URL, TESLA_SX_NOTE, DATA_AS_OF],
  ['검증중', '교차확인', '중고차', '수입', '테슬라', '모델 S', '신형 Model S 2023', '전기 AWD', 'Plaid', `${TESLA_MODEL_S_REFRESH_ID}::v02::t01`, TESLA_MODEL_S_REFRESH_ID, 2, 1, '1세대 2차 부분변경', 'Palladium', '2023-03', '2025-05', '2023', '2025', '전기', '', '', '아니오', 'AWD', 5, '', '테슬라 모델 S,Tesla Model S,신형 모델 S,Model S Plaid,플래드,트라이 모터 AWD', TESLA_SX_LAUNCH_URL, TESLA_SX_NOTE, DATA_AS_OF],
];
const teslaRefreshModelXRows = [
  ...[5, 6, 7].map((seats, index) => ['검증중', '교차확인', '중고차', '수입', '테슬라', '모델 X', '신형 Model X 2023', '전기 AWD', `AWD ${seats}인승`, `${TESLA_MODEL_X_REFRESH_ID}::v01::t${String(index + 1).padStart(2, '0')}`, TESLA_MODEL_X_REFRESH_ID, 1, index + 1, '1세대 2차 부분변경', 'Palladium', '2023-03', '2025-05', '2023', '2025', '전기', '', '', '아니오', 'AWD', seats, '', `테슬라 모델 X,Tesla Model X,신형 모델 X,Model X AWD,듀얼 모터 AWD,${seats}인승,${seats} Seater`, TESLA_SX_LAUNCH_URL, TESLA_SX_NOTE, DATA_AS_OF]),
  ['검증중', '교차확인', '중고차', '수입', '테슬라', '모델 X', '신형 Model X 2023', '전기 AWD', 'Plaid 6인승', `${TESLA_MODEL_X_REFRESH_ID}::v02::t01`, TESLA_MODEL_X_REFRESH_ID, 2, 1, '1세대 2차 부분변경', 'Palladium', '2023-03', '2025-05', '2023', '2025', '전기', '', '', '아니오', 'AWD', 6, '', '테슬라 모델 X,Tesla Model X,신형 모델 X,Model X Plaid,플래드,트라이 모터 AWD,6인승,6 Seater', TESLA_SX_LAUNCH_URL, TESLA_SX_NOTE, DATA_AS_OF],
];
const TESLA_MODEL_X_MANUAL_URL = 'https://www.tesla.com/ownersmanual/modelx/ko_kr/Owners_Manual.pdf';
const teslaModelXPlaid5Rows = [[
  '제외', '1차확인', '중고차', '수입', '테슬라', '모델 X', '신형 Model X 2023', '전기 AWD', 'Plaid 5인승', `${TESLA_MODEL_X_REFRESH_ID}::v02::t02`, TESLA_MODEL_X_REFRESH_ID, 2, 2,
  '1세대 2차 부분변경', 'Palladium', '2023-03', '2025-05', '2023', '2025', '전기', '', '', '아니오', 'AWD', 5, '',
  '테슬라 모델 X,Tesla Model X,신형 모델 X,Model X Plaid,플래드,트라이 모터 AWD,5인승,5 Seater', TESLA_MODEL_X_MANUAL_URL,
  `최신 한국어 Model X 사용자 매뉴얼의 중량표에는 Plaid 5·6인승이 함께 나오지만, 매뉴얼은 표기된 옵션이 특정 판매지역에서 실제 제공됨을 보장하지 않는다고 명시한다. Tesla 대한민국 한국공인연비에는 Plaid 6인승만 인증되어 있어 Plaid 5인승의 국내 판매·등록을 증명할 수 없다. 영구키는 보존하되 국내 실등록 또는 주문 근거 확보 전까지 배정을 차단한다. 국내 공인 제원: ${TESLA_RANGE_URL}`,
  DATA_AS_OF,
]];
const TESLA_SX_2025_UPDATE_URL = 'https://service.tesla.com/docs/ModelS/ServiceManual/Palladium/ko-kr/GUID-F95246AE-1597-4EF0-A567-816C0CBF00E8.html';
const TESLA_MODEL_S_2025_ID = 'mf-087.md-001.sm-refresh-2025__model-s-2025-plus';
const TESLA_MODEL_X_2025_ID = 'mf-087.md-002.sm-refresh-2025__model-x-2025-plus';
const TESLA_SX_2025_NOTE = `Tesla 공식 정비 설명서는 2025-06부터 Model S·Model X가 신형 부품과 기능으로 업데이트되었고 정비 절차도 2025+로 구분된다고 명시한다. 따라서 2023 국내 출시 Palladium 리프레시와 분리한 후속 업데이트형 영구코드를 발급한다. 국내 현행 트림·좌석은 Tesla 대한민국 한국공인연비 및 최신 한국어 사용자 매뉴얼로 교차확인한다. Ryzen 등 인포테인먼트 프로세서는 연식·트림과 일대일 대응하지 않는 생산 중 하드웨어 사양이므로 차종 영구코드 축으로 사용하지 않으며, 실차의 컨트롤 > 소프트웨어 > 추가 차량 정보에서 별도 확인한다. 국내 공인 제원: ${TESLA_RANGE_URL}`;
const tesla2025ModelSRows = [
  ['검증중', '교차확인', '신차', '수입', '테슬라', '모델 S', 'Model S 2025+ 업데이트', '전기 AWD', 'AWD', `${TESLA_MODEL_S_2025_ID}::v01::t01`, TESLA_MODEL_S_2025_ID, 1, 1, '1세대 3차 부분변경', 'Palladium 2025+', '2025-06', '현재', '2025', '현재', '전기', '', '', '아니오', 'AWD', 5, '', '테슬라 모델 S,Tesla Model S,Model S 2025+,모델 S 리리프레시,2025 Model S Refresh,Model S AWD,듀얼 모터 AWD', TESLA_SX_2025_UPDATE_URL, TESLA_SX_2025_NOTE, DATA_AS_OF],
  ['검증중', '교차확인', '신차', '수입', '테슬라', '모델 S', 'Model S 2025+ 업데이트', '전기 AWD', 'Plaid', `${TESLA_MODEL_S_2025_ID}::v02::t01`, TESLA_MODEL_S_2025_ID, 2, 1, '1세대 3차 부분변경', 'Palladium 2025+', '2025-06', '현재', '2025', '현재', '전기', '', '', '아니오', 'AWD', 5, '', '테슬라 모델 S,Tesla Model S,Model S 2025+,모델 S 리리프레시,2025 Model S Refresh,Model S Plaid,플래드', TESLA_SX_2025_UPDATE_URL, TESLA_SX_2025_NOTE, DATA_AS_OF],
];
const tesla2025ModelXRows = [
  ...[5, 6, 7].map((seats, index) => ['검증중', '교차확인', '신차', '수입', '테슬라', '모델 X', 'Model X 2025+ 업데이트', '전기 AWD', `AWD ${seats}인승`, `${TESLA_MODEL_X_2025_ID}::v01::t${String(index + 1).padStart(2, '0')}`, TESLA_MODEL_X_2025_ID, 1, index + 1, '1세대 3차 부분변경', 'Palladium 2025+', '2025-06', '현재', '2025', '현재', '전기', '', '', '아니오', 'AWD', seats, '', `테슬라 모델 X,Tesla Model X,Model X 2025+,모델 X 리리프레시,2025 Model X Refresh,Model X AWD,${seats}인승,${seats} Seater`, TESLA_SX_2025_UPDATE_URL, TESLA_SX_2025_NOTE, DATA_AS_OF]),
  ...[5, 6].map((seats, index) => [seats === 5 ? '제외' : '검증중', seats === 5 ? '1차확인' : '교차확인', '신차', '수입', '테슬라', '모델 X', 'Model X 2025+ 업데이트', '전기 AWD', `Plaid ${seats}인승`, `${TESLA_MODEL_X_2025_ID}::v02::t${String(index + 1).padStart(2, '0')}`, TESLA_MODEL_X_2025_ID, 2, index + 1, '1세대 3차 부분변경', 'Palladium 2025+', '2025-06', '현재', '2025', '현재', '전기', '', '', '아니오', 'AWD', seats, '', `테슬라 모델 X,Tesla Model X,Model X 2025+,모델 X 리리프레시,2025 Model X Refresh,Model X Plaid,플래드,${seats}인승,${seats} Seater`, TESLA_MODEL_X_MANUAL_URL, seats === 5 ? `최신 한국어 Model X 사용자 매뉴얼에는 Plaid 5인승 중량표가 있으나 Tesla 대한민국 한국공인연비는 Plaid 6인승만 인증한다. 매뉴얼 표기만으로 국내 판매를 확정할 수 없어 영구키를 보존한 채 배정을 차단한다. 국내 공인 제원: ${TESLA_RANGE_URL}` : TESLA_SX_2025_NOTE, DATA_AS_OF]),
];
const TESLA_MODEL_X_UNPROVEN_PLAID_5_KEYS = new Set([
  `${TESLA_MODEL_X_REFRESH_ID}::v02::t02`,
  `${TESLA_MODEL_X_2025_ID}::v02::t01`,
]);
const TESLA_SX_LEGACY_ENV_URL = 'https://www.data.go.kr/data/15049386/fileData.do';
const TESLA_SX_LEGACY_ENERGY_REPORT_URL = 'https://clik.nanet.go.kr/clikr-collection/policyinfo/40/167/2019/CLIKC1982724910319482_attach_1.pdf';
const TESLA_MODEL_S_LEGACY_KR_ID = 'mf-087.md-001.sm-legacy-kr-2019__model-s-korea-legacy';
const TESLA_MODEL_X_LEGACY_KR_ID = 'mf-087.md-002.sm-legacy-kr-2019__model-x-korea-legacy';
const teslaLegacySxKrRows = [
  ...([
    { trim: '75D', kwh: 75, seq: 1 },
    { trim: '90D', kwh: 90, seq: 2 },
    { trim: '100D', kwh: 100, seq: 3 },
    { trim: 'P100D', kwh: 100, seq: 4 },
  ] as const).map(({ trim, kwh, seq }) => [
    '검증중', '교차확인', '중고차', '수입', '테슬라', '모델 S', '구형 Model S 국내형 2019', '전기 AWD', trim,
    `${TESLA_MODEL_S_LEGACY_KR_ID}::v${String(seq).padStart(2, '0')}::t01`, TESLA_MODEL_S_LEGACY_KR_ID, seq, 1,
    '1세대 부분변경', '', '2019-02', '2021-01', '2019', '2021', '전기', '', '', '아니오', 'AWD', 5, '',
    `테슬라 모델 S ${trim},Tesla Model S ${trim},Model S ${trim},${trim}`, TESLA_SX_LEGACY_ENV_URL,
    `한국환경공단 친환경차 정보의 2019-02-20 국내 등록 정보에서 Model S ${trim} 5인승을 확인했다. 글로벌 2012 생산시점은 국내 시작으로 사용하지 않고 공공 국내자료 확인월부터 2021-01 신형 전환 전까지의 보수적 검증 구간으로 분리한다.`, DATA_AS_OF,
  ]),
  ...([
    { trim: '75D', kwh: 75, seq: 1 },
    { trim: '100D', kwh: 100, seq: 2 },
  ] as const).map(({ trim, kwh, seq }) => [
    '검증중', '교차확인', '중고차', '수입', '테슬라', '모델 X', '구형 Model X 국내형 2019', '전기 AWD', trim,
    `${TESLA_MODEL_X_LEGACY_KR_ID}::v${String(seq).padStart(2, '0')}::t01`, TESLA_MODEL_X_LEGACY_KR_ID, seq, 1,
    '1세대 초기형', '', '2019-08', '2021-01', '2019', '2021', '전기', '', '', '아니오', 'AWD', 6, '',
    `테슬라 모델 X ${trim},Tesla Model X ${trim},Model X ${trim},${trim},6인승`, TESLA_SX_LEGACY_ENERGY_REPORT_URL,
    `한국에너지공단 자료를 인용한 2019-08 국내 공공 보고서에서 Model X ${trim}의 정부 공인 연비를 확인했다. 글로벌 생산시점은 국내 시작으로 사용하지 않고 확인월부터 2021-01 신형 전환 전까지의 보수적 검증 구간으로 분리한다. 좌석은 기존 국내 마스터의 6인승 의미를 유지한다.`, DATA_AS_OF,
  ]),
];
const TESLA_CYBERTRUCK_KR_ID = 'mf-087.md-005.sm-korea-2025__cybertruck';
const TESLA_CYBERTRUCK_URL = 'https://www.tesla.com/ko_KR/cybertruck?redirect=no';
const TESLA_CYBERTRUCK_LAUNCH_URL = 'https://shop.tesla.com/ko_kr/product/cybertruck-underseat-storage-bin';
const TESLA_CYBERTRUCK_NOTE = `Tesla 대한민국 현행 Cybertruck 공식 페이지와 Tesla Korea 공식 액세서리 표시 기준. 국내 현행 트림은 Premium AWD와 Cyberbeast이며 모두 AWD 5인승이다. Tesla Korea가 표시한 동일모델 출시연월 2025-11을 국내 시작월로 기록한다. 배터리 총용량 kWh는 공식 국내 페이지에서 공개하지 않으므로 해외 추정값이나 전압·Ah 환산값을 넣지 않고 공란으로 유지한다. 국내 출시연월 교차 근거: ${TESLA_CYBERTRUCK_LAUNCH_URL}`;
const teslaCybertruckKrRows = [
  ['검증중', '교차확인', '신차', '수입', '테슬라', '사이버트럭', 'Cybertruck 국내형 2025', '전기 AWD', 'Premium AWD', `${TESLA_CYBERTRUCK_KR_ID}::v01::t01`, TESLA_CYBERTRUCK_KR_ID, 1, 1, '1세대', '', '2025-11', '현재', '2025', '현재', '전기', '', '', '아니오', 'AWD', 5, '', '테슬라 사이버트럭,Tesla Cybertruck,Cybertruck,사이버 트럭,Premium AWD,프리미엄 AWD,듀얼 모터 AWD', TESLA_CYBERTRUCK_URL, TESLA_CYBERTRUCK_NOTE, DATA_AS_OF],
  ['검증중', '교차확인', '신차', '수입', '테슬라', '사이버트럭', 'Cybertruck 국내형 2025', '전기 AWD', 'Cyberbeast', `${TESLA_CYBERTRUCK_KR_ID}::v02::t01`, TESLA_CYBERTRUCK_KR_ID, 2, 1, '1세대', '', '2025-11', '현재', '2025', '현재', '전기', '', '', '아니오', 'AWD', 5, '', '테슬라 사이버트럭,Tesla Cybertruck,Cybertruck,사이버 트럭,Cyberbeast,사이버비스트,트라이 모터 AWD', TESLA_CYBERTRUCK_URL, TESLA_CYBERTRUCK_NOTE, DATA_AS_OF],
];
const GENESIS_G80_PREFACELIFT_CORRECTED_ID = 'mf-007.md-002.sm-rg3-prefacelift-corrected__g80-2020';
const GENESIS_G80_LAUNCH_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-%E3%80%8EThe-All-new-G80-%E3%80%8F%EC%B6%9C%EC%8B%9C/';
const GENESIS_G80_SPORT_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-%252C-G80-%EC%8A%A4%ED%8F%AC%EC%B8%A0-%EC%B6%9C%EC%8B%9C/';
const GENESIS_G80_PREFACELIFT_NOTE = `제네시스 공식 2020-03-30 3세대 G80 국내 출시자료와 2023-12-26 부분변경 판매개시 자료 기준. 초기형 가솔린 2.5 터보(2,497cc)와 3.5 터보(3,470cc), RWD·AWD 조합을 2020-03~2023-11로 한정한다. 기존 RG3 키는 종료월이 현재로 잘못 고정되어 의미를 바꾸지 않고 차단 보존한다.`;
const genesisG80PrefaceliftCorrectedRows = ([
  { engine: '2.5T', cc: 2497, displacement: 2.5, drive: '2WD', seq: 1 },
  { engine: '2.5T', cc: 2497, displacement: 2.5, drive: 'AWD', seq: 2 },
  { engine: '3.5T', cc: 3470, displacement: 3.5, drive: '2WD', seq: 3 },
  { engine: '3.5T', cc: 3470, displacement: 3.5, drive: 'AWD', seq: 4 },
] as const).flatMap((config) => ([
  ['기본형', '2020-03', 1, GENESIS_G80_LAUNCH_URL, GENESIS_G80_PREFACELIFT_NOTE],
  ['스포츠 패키지', '2021-08', 2, GENESIS_G80_SPORT_URL, `${GENESIS_G80_PREFACELIFT_NOTE} 스포츠 패키지는 제네시스 공식 2021-08-10 출시자료에 따라 별도 시작월을 적용한다.`],
] as const).map(([trim, productionStart, trimSeq, evidenceUrl, evidenceNote]) => [
  '확정', '확정', '중고차', '국산', '제네시스', 'G80', 'G80 3세대 초기형 RG3',
  `가솔린 ${config.engine} ${config.drive}`, trim,
  `${GENESIS_G80_PREFACELIFT_CORRECTED_ID}::v${String(config.seq).padStart(2, '0')}::t${String(trimSeq).padStart(2, '0')}`,
  GENESIS_G80_PREFACELIFT_CORRECTED_ID, config.seq, trimSeq, '3세대 초기형', 'RG3', productionStart, '2023-11', '2020', '2023',
  '가솔린', config.cc, config.displacement, '예', config.drive, 5, '',
  `제네시스 G80,Genesis G80,G80 3세대,G80 초기형,The All-new G80,RG3,가솔린 ${config.engine},${config.drive},${config.drive === '2WD' ? 'RWD,후륜구동' : '사륜구동'},${trim},${trim === '스포츠 패키지' ? 'G80 스포츠,G80 Sport' : 'G80 기본 모델'}`,
  evidenceUrl, evidenceNote, DATA_AS_OF,
]));
const GENESIS_G80_FACELIFT_ID = 'mf-007.md-002.sm-rg3-pe__g80-facelift';
const GENESIS_G80_FACELIFT_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-G80-%EB%B6%80%EB%B6%84%EB%B3%80%EA%B2%BD-%EB%AA%A8%EB%8D%B8-%EC%B6%9C%EC%8B%9C/';
const GENESIS_G80_2026_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-%252C-2026-G80-%C2%B7G80-%EB%B8%94%EB%9E%99-%EC%B6%9C%EC%8B%9C/';
const GENESIS_G80_FACELIFT_NOTE = `제네시스 2023-12-26 공식 G80 부분변경 출시자료와 2026 G80 공식 출시자료 기준. 부분변경 내연기관은 가솔린 2.5 터보(2,497cc)와 3.5 터보(3,470cc), RWD와 AWD, 기본형과 스포츠 패키지 조합으로 분리한다. 2026년형에서도 두 엔진과 스포츠 패키지가 계속 운영됨을 교차했다. 현행 연식 교차 근거: ${GENESIS_G80_2026_URL}`;
const genesisG80FaceliftRows = ([
  { engine: '2.5T', cc: 2497, displacement: 2.5, drive: '2WD', seq: 1 },
  { engine: '2.5T', cc: 2497, displacement: 2.5, drive: 'AWD', seq: 2 },
  { engine: '3.5T', cc: 3470, displacement: 3.5, drive: '2WD', seq: 3 },
  { engine: '3.5T', cc: 3470, displacement: 3.5, drive: 'AWD', seq: 4 },
] as const).flatMap((config) => ['기본형', '스포츠 패키지'].map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '국산', '제네시스', 'G80', 'G80 부분변경 RG3',
  `가솔린 ${config.engine} ${config.drive}`, trim,
  `${GENESIS_G80_FACELIFT_ID}::v${String(config.seq).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`,
  GENESIS_G80_FACELIFT_ID, config.seq, trimIndex + 1, '3세대 부분변경', 'RG3', '2023-12', '현재', '2024', '현재',
  '가솔린', config.cc, config.displacement, '예', config.drive, 5, '',
  `제네시스 G80,Genesis G80,G80 부분변경,G80 페이스리프트,RG3 PE,가솔린 ${config.engine},${config.drive},${config.drive === '2WD' ? 'RWD,후륜구동' : '사륜구동'},${trim},${trim === '스포츠 패키지' ? 'G80 스포츠,G80 Sport' : 'G80 기본 모델'}`,
  GENESIS_G80_FACELIFT_URL, GENESIS_G80_FACELIFT_NOTE, DATA_AS_OF,
]));
const GENESIS_GV80_FACELIFT_ID = 'mf-007.md-005.sm-jx1-pe__gv80-facelift';
const GENESIS_GV80_FACELIFT_URL = 'https://newsroom.genesis.com/ko-ko/GV80-%EB%B6%80%EB%B6%84%EB%B3%80%EA%B2%BD-%EB%AA%A8%EB%8D%B8-%C2%B7-GV80-%EC%BF%A0%ED%8E%98-%EA%B3%B5%EA%B0%9C/';
const GENESIS_GV80_SPEC_URL = 'https://www.genesis.com/kr/ko/models/luxury-suv-genesis/gv80/specs.html';
const GENESIS_GV80_2026_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-2026-GV80-2026-GV80-%EC%BF%A0%ED%8E%98-%EC%B6%9C%EC%8B%9C/';
const GENESIS_GV80_FACELIFT_NOTE = `제네시스 2023-09 공식 GV80 부분변경 공개자료와 현행 국내 제원 기준. 일반형 GV80 부분변경은 가솔린 2.5 터보(2,497cc)와 3.5 터보(3,470cc), 2WD와 AWD, 5·6·7인승 조합으로 분리한다. 2026 GV80 공식 자료에서 두 엔진의 현행 운영을 교차했다. 현행 제원: ${GENESIS_GV80_SPEC_URL}; 현행 연식 근거: ${GENESIS_GV80_2026_URL}`;
const genesisGv80FaceliftRows = ([
  { engine: '2.5T', cc: 2497, displacement: 2.5, drive: '2WD', seq: 1 },
  { engine: '2.5T', cc: 2497, displacement: 2.5, drive: 'AWD', seq: 2 },
  { engine: '3.5T', cc: 3470, displacement: 3.5, drive: '2WD', seq: 3 },
  { engine: '3.5T', cc: 3470, displacement: 3.5, drive: 'AWD', seq: 4 },
] as const).flatMap((config) => [5, 6, 7].map((seats, seatIndex) => [
  '검증중', '교차확인', '신차', '국산', '제네시스', 'GV80', 'GV80 부분변경 JX1',
  `가솔린 ${config.engine} ${config.drive}`, `기본형 ${seats}인승`,
  `${GENESIS_GV80_FACELIFT_ID}::v${String(config.seq).padStart(2, '0')}::t${String(seatIndex + 1).padStart(2, '0')}`,
  GENESIS_GV80_FACELIFT_ID, config.seq, seatIndex + 1, '1세대 부분변경', 'JX1', '2023-09', '현재', '2024', '현재',
  '가솔린', config.cc, config.displacement, '예', config.drive, seats, '',
  `제네시스 GV80,Genesis GV80,GV80 부분변경,GV80 페이스리프트,JX1 PE,가솔린 ${config.engine},${config.drive},${config.drive === '2WD' ? 'RWD,후륜구동' : '사륜구동'},${seats}인승,${seats} Seater,기본형`,
  GENESIS_GV80_FACELIFT_URL, GENESIS_GV80_FACELIFT_NOTE, DATA_AS_OF,
]));
const GENESIS_GV70_FACELIFT_ID = 'mf-007.md-006.sm-jk1-pe__gv70-facelift';
const GENESIS_GV70_FACELIFT_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-%252C-GV70-%EB%B6%80%EB%B6%84%EB%B3%80%EA%B2%BD-%EB%AA%A8%EB%8D%B8-%EC%B6%9C%EC%8B%9C/';
const GENESIS_GV70_SPEC_URL = 'https://www.genesis.com/kr/ko/models/luxury-suv-genesis/gv70/specs.html';
const GENESIS_GV70_FACELIFT_NOTE = `제네시스 2024-05-08 공식 GV70 부분변경 출시자료와 현행 국내 제원 기준. 부분변경 내연기관은 가솔린 2.5 터보(2,497cc)와 3.5 터보(3,470cc), 2WD와 AWD, 기본형과 스포츠 패키지 조합으로 분리한다. 공식 현행 제원에서 각 엔진의 2WD·AWD와 스포츠 패키지를 교차했다. 현행 제원: ${GENESIS_GV70_SPEC_URL}`;
const genesisGv70FaceliftRows = ([
  { engine: '2.5T', cc: 2497, displacement: 2.5, drive: '2WD', seq: 1 },
  { engine: '2.5T', cc: 2497, displacement: 2.5, drive: 'AWD', seq: 2 },
  { engine: '3.5T', cc: 3470, displacement: 3.5, drive: '2WD', seq: 3 },
  { engine: '3.5T', cc: 3470, displacement: 3.5, drive: 'AWD', seq: 4 },
] as const).flatMap((config) => ['기본형', '스포츠 패키지'].map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '국산', '제네시스', 'GV70', 'GV70 부분변경 JK1',
  `가솔린 ${config.engine} ${config.drive}`, trim,
  `${GENESIS_GV70_FACELIFT_ID}::v${String(config.seq).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`,
  GENESIS_GV70_FACELIFT_ID, config.seq, trimIndex + 1, '1세대 부분변경', 'JK1', '2024-05', '현재', '2025', '현재',
  '가솔린', config.cc, config.displacement, '예', config.drive, 5, '',
  `제네시스 GV70,Genesis GV70,GV70 부분변경,GV70 페이스리프트,JK1 PE,가솔린 ${config.engine},${config.drive},${config.drive === '2WD' ? 'RWD,후륜구동' : '사륜구동'},${trim},${trim === '스포츠 패키지' ? 'GV70 스포츠,GV70 Sport' : 'GV70 기본 모델'}`,
  GENESIS_GV70_FACELIFT_URL, GENESIS_GV70_FACELIFT_NOTE, DATA_AS_OF,
]));
const GENESIS_G70_2023_ID = 'mf-007.md-003.sm-ik-2023__g70';
const GENESIS_G70_2023_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-%252C-2023-G70-%C2%B7G70-%EC%8A%88%ED%8C%85-%EB%B8%8C%EB%A0%88%EC%9D%B4%ED%81%AC-%EC%B6%9C%EC%8B%9C/';
const GENESIS_G70_SPEC_URL = 'https://www.genesis.com/kr/ko/models/luxury-sedan-genesis/g70/specs.html';
const GENESIS_G70_2026_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-%252C-2026-G70-%EB%B0%8F-G70-%EA%B7%B8%EB%9E%98%ED%94%84%EC%9D%B4%ED%8A%B8-%EC%97%90%EB%94%94%EC%85%98-%EC%B6%9C%EC%8B%9C/';
const GENESIS_G70_2023_NOTE = `제네시스 2023-05 공식 G70 상품성 개선 모델 출시자료와 현행 국내 제원 기준. 세단은 가솔린 2.5 터보(2,497cc)와 3.3 터보(3,342cc), 2WD와 AWD, 기본형과 스포츠 패키지 조합으로 분리한다. 2026 공식 자료와 현행 제원으로 두 엔진의 계속 운영을 교차했다. 현행 제원: ${GENESIS_G70_SPEC_URL}; 현행 연식 근거: ${GENESIS_G70_2026_URL}`;
const genesisG70_2023Rows = ([
  { engine: '2.5T', cc: 2497, displacement: 2.5, drive: '2WD', seq: 1 },
  { engine: '2.5T', cc: 2497, displacement: 2.5, drive: 'AWD', seq: 2 },
  { engine: '3.3T', cc: 3342, displacement: 3.3, drive: '2WD', seq: 3 },
  { engine: '3.3T', cc: 3342, displacement: 3.3, drive: 'AWD', seq: 4 },
] as const).flatMap((config) => ['기본형', '스포츠 패키지'].map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '국산', '제네시스', 'G70', '2023 G70 IK',
  `가솔린 ${config.engine} ${config.drive}`, trim,
  `${GENESIS_G70_2023_ID}::v${String(config.seq).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`,
  GENESIS_G70_2023_ID, config.seq, trimIndex + 1, '1세대 상품성 개선', 'IK', '2023-05', '현재', '2023', '현재',
  '가솔린', config.cc, config.displacement, '예', config.drive, 5, '',
  `제네시스 G70,Genesis G70,2023 G70,G70 상품성 개선,IK,가솔린 ${config.engine},${config.drive},${config.drive === '2WD' ? 'RWD,후륜구동' : '사륜구동'},${trim},${trim === '스포츠 패키지' ? 'G70 스포츠,G70 Sport' : 'G70 스탠다드'}`,
  GENESIS_G70_2023_URL, GENESIS_G70_2023_NOTE, DATA_AS_OF,
]));
const GENESIS_G70_GRAPHITE_ID = 'mf-007.md-003.sm-ik-2026__g70-graphite';
const genesisG70GraphiteRows = (['2WD', 'AWD'] as const).map((drive, index) => [
  '검증중', '교차확인', '신차', '국산', '제네시스', 'G70', '2026 G70 그래파이트 에디션',
  `가솔린 3.3T ${drive}`, '그래파이트 에디션', `${GENESIS_G70_GRAPHITE_ID}::v${String(index + 1).padStart(2, '0')}::t01`,
  GENESIS_G70_GRAPHITE_ID, index + 1, 1, '1세대 2026 연식', 'IK', '2026-01', '현재', '2026', '현재',
  '가솔린', 3342, 3.3, '예', drive, 5, '',
  `제네시스 G70,Genesis G70,G70 그래파이트,G70 Graphite Edition,가솔린 3.3T,${drive},${drive === '2WD' ? 'RWD,후륜구동' : '사륜구동'},그래파이트 에디션`,
  GENESIS_G70_2026_URL, `제네시스 2026-01-12 공식 출시자료 기준. G70 그래파이트 에디션은 가솔린 3.3 터보 단일 파워트레인이며 공식 현행 제원에 표시된 2WD·AWD를 각각 분리한다. 현행 제원: ${GENESIS_G70_SPEC_URL}`, DATA_AS_OF,
]);
const GENESIS_G70_SB_2023_ID = 'mf-007.md-003.sm-ik-2023__g70-shooting-brake';
const GENESIS_G70_SB_2022_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-%252C-G70-%EC%8A%88%ED%8C%85-%EB%B8%8C%EB%A0%88%EC%9D%B4%ED%81%AC-%EC%B6%9C%EC%8B%9C/';
const GENESIS_G70_SB_SPEC_URL = 'https://www.genesis.com/kr/ko/models/luxury-sedan-genesis/g70-shooting-brake/specs.html';
const GENESIS_G70_SB_NOTE = `제네시스 공식 2023-05 G70 슈팅 브레이크 상품성 개선 출시자료와 현행 국내 제원 기준. 2023년형부터 가솔린 2.5 터보(2,497cc) 단일 엔진이며 2WD·AWD, 기본형·스포츠 모델을 분리한다. 2022 초기형은 공식 출시자료상 가솔린 2.0 터보 단일 엔진이었다. 초기형 근거: ${GENESIS_G70_SB_2022_URL}; 현행 제원: ${GENESIS_G70_SB_SPEC_URL}`;
const genesisG70Sb2023Rows = (['2WD', 'AWD'] as const).flatMap((drive, driveIndex) => ['기본형', '스포츠 모델'].map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '국산', '제네시스', 'G70', '2023 G70 슈팅 브레이크 IK',
  `가솔린 2.5T ${drive}`, trim,
  `${GENESIS_G70_SB_2023_ID}::v${String(driveIndex + 1).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`,
  GENESIS_G70_SB_2023_ID, driveIndex + 1, trimIndex + 1, '1세대 상품성 개선', 'IK', '2023-05', '현재', '2023', '현재',
  '가솔린', 2497, 2.5, '예', drive, 5, '',
  `제네시스 G70 슈팅 브레이크,Genesis G70 Shooting Brake,G70 SB,2023 G70 슈팅 브레이크,가솔린 2.5T,${drive},${drive === '2WD' ? 'RWD,후륜구동' : '사륜구동'},${trim},${trim === '스포츠 모델' ? 'G70 슈팅 브레이크 스포츠,Shooting Brake Sport' : '프리미엄,스탠다드'}`,
  GENESIS_G70_2023_URL, GENESIS_G70_SB_NOTE, DATA_AS_OF,
]));
const GENESIS_GV60_PERFORMANCE_ID = 'mf-007.md-007.sm-jw__gv60-performance';
const GENESIS_GV60_INITIAL_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-%252C-%EB%9F%AD%EC%85%94%EB%A6%AC-%EC%A0%84%EA%B8%B0%EC%B0%A8-GV60-%EB%B0%9C%ED%91%9C/';
const GENESIS_GV60_FACELIFT_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-GV60-%EB%B6%80%EB%B6%84%EB%B3%80%EA%B2%BD-%EB%AA%A8%EB%8D%B8-%EC%B6%9C%EC%8B%9C/';
const genesisGv60PerformanceRows = [
  ['검증중', '교차확인', '중고차', '국산', '제네시스', 'GV60', 'GV60 초기형 퍼포먼스', '전기 AWD 77.4kWh', '퍼포먼스 AWD', `${GENESIS_GV60_PERFORMANCE_ID}::v01::t01`, GENESIS_GV60_PERFORMANCE_ID, 1, 1, '1세대', 'JW', '2021-10', '2025-02', '2021', '2025', '전기', '', '', '아니오', 'AWD', 5, 77.4, '제네시스 GV60,Genesis GV60,GV60 퍼포먼스,Performance AWD,고성능 AWD,77.4kWh', GENESIS_GV60_INITIAL_URL, '제네시스 공식 2021 GV60 발표자료 기준. 초기형 3개 모델 중 퍼포먼스 AWD는 77.4kWh 배터리와 고성능 사륜구동으로 스탠다드 AWD와 별도 분리한다. 2025-03 84kWh 부분변경 직전까지의 중고차 코드다.', DATA_AS_OF],
  ['검증중', '교차확인', '신차', '국산', '제네시스', 'GV60', 'GV60 부분변경 퍼포먼스', '전기 AWD 84.0kWh', '퍼포먼스 AWD', `${GENESIS_GV60_PERFORMANCE_ID}::v02::t01`, GENESIS_GV60_PERFORMANCE_ID, 2, 1, '1세대 부분변경', 'JW', '2025-03', '현재', '2025', '현재', '전기', '', '', '아니오', 'AWD', 5, 84, '제네시스 GV60,Genesis GV60,GV60 부분변경,GV60 퍼포먼스,Performance AWD,고성능 AWD,84kWh', GENESIS_GV60_FACELIFT_URL, '제네시스 공식 2025 GV60 부분변경 출시자료 기준. 84kWh 라인업의 퍼포먼스 AWD는 스탠다드 AWD와 모터 출력·가격이 달라 별도 영구코드로 분리한다.', DATA_AS_OF],
];
const GENESIS_GV60_MAGMA_ID = 'mf-007.md-007.sm-jw-magma-2026__gv60-magma';
const GENESIS_GV60_MAGMA_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-%252C-GV60-%EB%A7%88%EA%B7%B8%EB%A7%88-%EC%B6%9C%EC%8B%9C/';
const genesisGv60MagmaRows = [
  ['검증중', '교차확인', '신차', '국산', '제네시스', 'GV60', '2026 GV60 마그마', '전기 AWD 84.0kWh', '마그마', `${GENESIS_GV60_MAGMA_ID}::v01::t01`, GENESIS_GV60_MAGMA_ID, 1, 1, '1세대 고성능', 'JW', '2026-01', '현재', '2026', '현재', '전기', '', '', '아니오', 'AWD', 5, 84, '제네시스 GV60 마그마,Genesis GV60 Magma,GV60 Magma,마그마,고성능 전기차,84kWh,AWD', GENESIS_GV60_MAGMA_URL, '제네시스 공식 2026-01-13 국내 출시자료 기준. 브랜드 최초 고성능 모델 GV60 마그마는 84kWh 4세대 배터리와 듀얼 모터 AWD를 사용하는 독립 판매 모델로 일반 GV60 퍼포먼스와 별도 코드로 분리한다.', DATA_AS_OF],
];
const GENESIS_G90_RS4_ID = 'mf-007.md-004.sm-rs4__g90-current';
const GENESIS_EQ900_PRODUCT_ID = 'mf-007.md-004.sm-hi-eq900-2016__eq900-product';
const GENESIS_EQ900_URL = 'https://newsroom.genesis.com/ko-ko/%EC%B4%88%EB%8C%80%ED%98%95-%EB%9F%AD%EC%85%94%EB%A6%AC-%EC%84%B8%EB%8B%A8-%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-%E3%80%8EEQ900-%E3%80%8F%EC%B6%9C%EC%8B%9C/';
const GENESIS_G90_LAUNCH_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-%E3%80%8EG90-%E3%80%8F%EC%B6%9C%EC%8B%9C/';
const genesisEq900ProductRows = [[
  '확정', '확정', '중고차', '국산', '제네시스', 'EQ900', 'EQ900 HI',
  '가솔린 3.8 GDi AWD', '프레스티지', `${GENESIS_EQ900_PRODUCT_ID}::v01::t01`,
  GENESIS_EQ900_PRODUCT_ID, 1, 1, '1세대', 'HI', '2015-12', '2018-10', '2016', '2018',
  '가솔린', 3778, 3.8, '아니오', 'AWD', 5, '',
  '제네시스 EQ900,Genesis EQ900,EQ900 HI,3.8 GDi,H-TRAC,AWD,프레스티지,Prestige',
  GENESIS_EQ900_URL,
  `제네시스 공식 2015-12 EQ900 출시자료에서 3.8 GDi·프레스티지와 H-TRAC AWD 운영을 확인했다. 2018-11 G90 공식 출시자료가 EQ900의 페이스리프트 및 국내 차명 전환을 명시하므로 생산종료를 2018-10으로 닫는다. 정확배기량 3,778cc는 동일 HI 계보의 공식 G90 3.8 제원과 교차했다. 전환 근거: ${GENESIS_G90_LAUNCH_URL}`,
  DATA_AS_OF,
]];
const KIA_K5_2025_LPG_ID = 'mf-002.md-001.sm-dl3-pe-my2025__k5-2025-lpg';
const KIA_K5_2025_PRICE_URL = 'https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_k5pe.pdf';
const kiaK5_2025LpgRows = [[
  '확정', '확정', '중고차', '국산', '기아', 'K5', '2025 더 뉴 K5 DL3',
  'LPG 2.0 2WD', '프레스티지', `${KIA_K5_2025_LPG_ID}::v01::t01`,
  KIA_K5_2025_LPG_ID, 1, 1, '3세대 부분변경 2025', 'DL3', '2025-01', '2026-06', '2025', '2026',
  'LPG', 1999, 2, '아니오', '2WD', 5, '',
  '2025 K5 LPG,더 뉴 K5 DL3 LPG,K5 LPI,K5 LPG 2.0,프레스티지,Prestige',
  KIA_K5_2025_PRICE_URL,
  '기아 공식 K5_202501 국내 가격표에서 더 뉴 K5의 스마트스트림 L2.0·원형 봄베와 프레스티지 트림을 확인했다. 실제상품은 2025년식·2025-04 등록·LPG 2.0·프레스티지로 축이 일치한다. The 2027 K5 공식 출시월 2026-07 직전인 2026-06에서 닫는다. 2023-11/12 등록 트렌디는 이 2025 근거로 소급하지 않는다.',
  DATA_AS_OF,
]];
const KIA_K5_2026_BEST_PRODUCT_ID = 'mf-002.md-001.sm-dl3-pe-my2026__k5-best-product';
const KIA_K5_2026_BEST_URL = 'https://worldwide.kia.com/ko/newsroom-korea/view/?id=1396';
const kiaK5_2026BestProductRows = ([
  { seq: 1, powertrain: '가솔린 2.0 2WD', cc: 1999, liters: 2, turbo: '아니오' },
  { seq: 2, powertrain: '가솔린 1.6T 2WD', cc: 1598, liters: 1.6, turbo: '예' },
] as const).map((config) => [
  '확정', '확정', '중고차', '국산', '기아', 'K5', 'The 2026 K5 DL3', config.powertrain, '베스트 셀렉션',
  `${KIA_K5_2026_BEST_PRODUCT_ID}::v${String(config.seq).padStart(2, '0')}::t01`, KIA_K5_2026_BEST_PRODUCT_ID,
  config.seq, 1, '3세대 부분변경 2026 연식', 'DL3', '2025-06', '2026-06', '2026', '2026',
  '가솔린', config.cc, config.liters, config.turbo, '2WD', 5, '',
  `The 2026 K5,K5 DL3,베스트 셀렉션,베스트셀렉션,프레스티지 베스트 셀렉션,${config.powertrain}`,
  KIA_K5_2026_BEST_URL,
  '기아 공식 2025-06-19 The 2026 K5 국내 출시자료에서 신설 베스트 셀렉션과 2.0 가솔린·1.6 가솔린 터보 조합을 확인했다. 실제상품의 2026 연식·배기량·트림과 일치하며 The 2027 K5 출시월 2026-07 직전까지로 닫는다.',
  DATA_AS_OF,
]);
const KIA_K5_FACELIFT_GAS_ID = 'mf-002.md-001.sm-dl3-pe-2023__k5-facelift-gas-product';
const KIA_K5_FACELIFT_LAUNCH_URL = 'https://www.hyundaimotorgroup.com/ko/amp/CONT0000000000119790';
const kiaK5FaceliftGasProductRows = (['프레스티지', '노블레스', '시그니처'] as const).map((trim, trimIndex) => [
  '확정', '확정', '중고차', '국산', '기아', 'K5', '더 뉴 K5 DL3', '가솔린 2.0 2WD', trim,
  `${KIA_K5_FACELIFT_GAS_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`, KIA_K5_FACELIFT_GAS_ID,
  1, trimIndex + 1, '3세대 부분변경', 'DL3', '2023-11', '2025-05', '2024', '2025',
  '가솔린', 1999, 2, '아니오', '2WD', 5, '',
  `더 뉴 K5 DL3,K5 페이스리프트,가솔린 2.0,${trim}`,
  KIA_K5_FACELIFT_LAUNCH_URL,
  '현대자동차그룹 공식 2023-11-02 더 뉴 K5 출시자료에서 3세대 부분변경, 2.0 가솔린과 프레스티지·노블레스·시그니처 구성을 확인했다. 실제상품의 2024/2025 연식·1,999cc·프레스티지는 공식 축과 일치한다. 트림 미상 2025 상품은 세 공식 트림이 모두 후보가 되도록 유지해 자동 확정하지 않는다. 베스트 셀렉션이 신설된 The 2026 K5 출시 직전인 2025-05에서 닫고, LPG 렌터카 트렌디와 하이브리드는 이 근거로 확장하지 않는다.',
  DATA_AS_OF,
]);
const HYUNDAI_SONATA_2024_2025_RENT_ID = 'mf-001.md-018.sm-dn8-edge-rent-my2024-2025__sonata-rental-product';
const HYUNDAI_SONATA_2024_PRICE_URL = 'https://www.hyundai.com/kr/en/sedan/sonata-the-edge/price';
const HYUNDAI_SONATA_2025_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/sonata-the-edge-2025-price.pdf';
const hyundaiSonata2024_2025RentalProductRows = (['Business 1', 'Business 2'] as const).map((trim, trimIndex) => [
  '확정', '확정', '중고차', '국산', '현대', '쏘나타', '쏘나타 DN8 디 엣지',
  'LPG 2.0 렌터카 2WD', trim,
  `${HYUNDAI_SONATA_2024_2025_RENT_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`,
  HYUNDAI_SONATA_2024_2025_RENT_ID, 1, trimIndex + 1, '8세대 부분변경 렌터카', 'DN8',
  '2024-01', '2025-08', '2024', '2025', 'LPG', 1999, 2, '아니오', '2WD', 5, '',
  `쏘나타 디 엣지 렌터카,Sonata The Edge Rental,LPG 2.0,${trim},비즈니스 ${trimIndex + 1},비즈니스`,
  HYUNDAI_SONATA_2025_PRICE_URL,
  `현대 공식 2024-01 국내 가격 페이지와 2025 쏘나타 디 엣지 가격표에서 LPG 2.0 렌터카 Business 1·Business 2를 각각 확인했다. 2025 가격표는 배기량 1,999cc와 2024-10-25 현 모델 출시일도 명시한다. 실제상품의 공급사 표기 '비즈니스'는 숫자가 빠져 두 공식 트림 모두의 별칭으로만 두며 자동 확정하지 않는다. 2026 렌터카 계보 시작 직전인 2025-08에서 닫는다. 2024 교차근거: ${HYUNDAI_SONATA_2024_PRICE_URL}`,
  DATA_AS_OF,
]);
const GENESIS_GV80_INITIAL_PRODUCT_ID = 'mf-007.md-005.sm-jx1-2020__gv80-initial-product';
const GENESIS_GV80_INITIAL_DIESEL_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-%E3%80%8EGV80-%E3%80%8F%EC%B6%9C%EC%8B%9C/';
const GENESIS_GV80_INITIAL_GAS_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-GV80-%EA%B0%80%EC%86%94%EB%A6%B0-%EC%B6%9C%EC%8B%9C/';
const genesisGv80InitialProductRows = ([
  { seq: 1, powertrain: '디젤 3.0 2WD 5인승', fuel: '디젤', cc: 2996, liters: 3, turbo: '예', drive: '2WD', start: '2020-01', url: GENESIS_GV80_INITIAL_DIESEL_URL },
  { seq: 2, powertrain: '디젤 3.0 AWD 5인승', fuel: '디젤', cc: 2996, liters: 3, turbo: '예', drive: 'AWD', start: '2020-01', url: GENESIS_GV80_INITIAL_DIESEL_URL },
  { seq: 3, powertrain: '가솔린 2.5T AWD 5인승', fuel: '가솔린', cc: 2497, liters: 2.5, turbo: '예', drive: 'AWD', start: '2020-03', url: GENESIS_GV80_INITIAL_GAS_URL },
  { seq: 4, powertrain: '가솔린 3.5T AWD 5인승', fuel: '가솔린', cc: 3470, liters: 3.5, turbo: '예', drive: 'AWD', start: '2020-03', url: GENESIS_GV80_INITIAL_GAS_URL },
] as const).map((config) => [
  '확정', '확정', '중고차', '국산', '제네시스', 'GV80', 'GV80 JX1 초기형', config.powertrain, '기본 사양',
  `${GENESIS_GV80_INITIAL_PRODUCT_ID}::v${String(config.seq).padStart(2, '0')}::t01`, GENESIS_GV80_INITIAL_PRODUCT_ID,
  config.seq, 1, '1세대 초기형', 'JX1', config.start, '2023-09', '2020', '2023', config.fuel, config.cc, config.liters,
  config.turbo, config.drive, 5, '',
  `제네시스 GV80,GV80 JX1,${config.powertrain},기본,기본형,기본 사양`, config.url,
  '제네시스 국내 공식 자료에서 2020-01 GV80 디젤 3.0 출시, 2020-03 가솔린 2.5/3.5 터보 추가, 엔진·구동방식·인승을 각각 고르는 Your Genesis 체계를 확인했다. 실제상품에 존재하는 5인승과 2WD/AWD 조합만 제한 발급했다. 공식 부분변경 공개월 2023-09까지 초기형으로 닫으며 쿠페·부분변경과 합치지 않는다. 기본/기본형은 별도 판매 트림이 아니라 무옵션 구성을 뜻하는 공급사 별칭으로만 둔다.',
  DATA_AS_OF,
]);
const KIA_NIRO_SG2_HEV_PRODUCT_ID = 'mf-002.md-061.sm-sg2-2022__niro-hev-product';
const KIA_NIRO_SG2_PRICE_URL = 'https://www.kia.com/content/dam/kwcms/kr/ko/files/XDE/price/price_niro.pdf';
const KIA_NIRO_SG2_HERITAGE_URL = 'https://heritage.kia.com/kr/vehicles/the-all-new-niro/';
const kiaNiroSg2HevProductRows = (['트렌디', '프레스티지', '시그니처'] as const).map((trim, trimIndex) => [
  '확정', '확정', '중고차', '국산', '기아', '니로', '디 올 뉴 니로 SG2', '하이브리드 1.6 FWD', trim,
  `${KIA_NIRO_SG2_HEV_PRODUCT_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`, KIA_NIRO_SG2_HEV_PRODUCT_ID,
  1, trimIndex + 1, '2세대', 'SG2', '2022-01', '2026-02', '2023', '2026', '하이브리드', 1580, 1.6,
  '아니오', 'FWD', 5, '', `디 올 뉴 니로,니로 SG2,1.6 하이브리드,${trim}`,
  KIA_NIRO_SG2_PRICE_URL,
  `기아 국내 공식 디 올 뉴 니로 가격표에서 1.6 하이브리드와 트렌디·프레스티지·시그니처를 확인했다. 기아 헤리티지 공식 자료에서 2022년 2세대, 전륜구동, 배기량 1,580cc를 교차 확인했다. 실제상품의 2024 트렌디는 단일 확정하며, 트림 신호가 빠진 2025 상품은 세 후보로 유지한다. 더 뉴 니로 공개 전인 2026-02에서 닫는다. 교차근거: ${KIA_NIRO_SG2_HERITAGE_URL}`,
  DATA_AS_OF,
]);
const KIA_RAY_2026_PRODUCT_ID = 'mf-002.md-058.sm-tam-my2026__ray-product';
const KIA_RAY_2026_PRICE_URL = 'https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_ray.pdf';
const KIA_RAY_EV_2026_PRICE_URL = 'https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_ray-ev.pdf';
const kiaRay2026ProductRows = ([
  { variant: 1, trimSeq: 1, subModel: 'The 2026 Ray 가솔린 승용', powertrain: '가솔린 1.0 2WD 5인승', trim: '프레스티지', fuel: '가솔린', cc: 998, drive: '2WD', seats: 5, battery: '', start: '2022-09', url: KIA_RAY_2026_PRICE_URL },
  { variant: 1, trimSeq: 2, subModel: 'The 2026 Ray 가솔린 승용', powertrain: '가솔린 1.0 2WD 5인승', trim: '시그니처', fuel: '가솔린', cc: 998, drive: '2WD', seats: 5, battery: '', start: '2022-09', url: KIA_RAY_2026_PRICE_URL },
  { variant: 2, trimSeq: 1, subModel: 'The 2026 Ray 가솔린 2인승 밴', powertrain: '가솔린 1.0 2WD 2인승 밴', trim: '프레스티지 스페셜', fuel: '가솔린', cc: 998, drive: '2WD', seats: 2, battery: '', start: '2022-09', url: KIA_RAY_2026_PRICE_URL },
  { variant: 3, trimSeq: 1, subModel: 'The 2026 Ray EV 4인승 승용', powertrain: '전기 35.2kWh FWD 4인승', trim: '에어', fuel: '전기', cc: '', drive: 'FWD', seats: 4, battery: 35.2, start: '2023-09', url: KIA_RAY_EV_2026_PRICE_URL },
] as const).map((config) => [
  '확정', '확정', '중고차', '국산', '기아', '레이', config.subModel, config.powertrain, config.trim,
  `${KIA_RAY_2026_PRODUCT_ID}::v${String(config.variant).padStart(2, '0')}::t${String(config.trimSeq).padStart(2, '0')}`,
  KIA_RAY_2026_PRODUCT_ID, config.variant, config.trimSeq, '2세대 부분변경 2026 연식', 'TAM', config.start, '2026-07', '2023', '2026',
  config.fuel, config.cc, config.fuel === '가솔린' ? 1 : '', '아니오', config.drive, config.seats, config.battery,
  `기아 레이,The 2026 Ray,레이 TAM,${config.powertrain},${config.trim}`,
  config.url,
  `기아 공식 2026-05 국내 가격표에서 ${config.powertrain}·${config.trim} 조합을 확인했다. 실제상품의 연식·연료·인승·트림 축과 일치하는 조합만 발급하며 트림 미상 상품은 자동 연결하지 않는다. The 2027 Ray 시작 직전인 2026-07에서 닫는다.`,
  DATA_AS_OF,
]);
const KIA_K8_2026_BEST_PRODUCT_ID = 'mf-002.md-065.sm-gl3-pe-my2026__k8-best-product';
const KIA_K8_2026_BEST_URL = 'https://worldwide.kia.com/ko/newsroom-korea/view/?id=1396';
const kiaK8_2026BestProductRows = [[
  '확정', '확정', '중고차', '국산', '기아', 'K8', 'The 2026 K8 GL3', '가솔린 2.5 2WD', '베스트 셀렉션',
  `${KIA_K8_2026_BEST_PRODUCT_ID}::v01::t01`, KIA_K8_2026_BEST_PRODUCT_ID, 1, 1,
  '2세대 부분변경 2026 연식', 'GL3', '2025-06', '2026-05', '2026', '2026', '가솔린', 2497, 2.5, '아니오', '2WD', 5, '',
  'The 2026 K8,K8 GL3,2.5 26MY 베스트 셀렉션 2WD,노블레스 라이트 베스트 셀렉션,베스트셀렉션',
  KIA_K8_2026_BEST_URL,
  '기아 공식 2025-06-19 The 2026 K8 국내 출시자료에서 2.5 가솔린 베스트 셀렉션을 확인했다. 실제상품 6대가 모두 2026년식·2026-05 등록·2,497cc이며, 4대는 2WD까지 명시한다. 공급사 결합명 노블레스 라이트 베스트 셀렉션은 독립 트림으로 만들지 않고 공식 베스트 셀렉션의 원문 별칭으로만 보존한다. 실제상품 등록월까지만 닫아 이후 연식으로 확장하지 않는다.',
  DATA_AS_OF,
]];
const GENESIS_GV70_INITIAL_PRODUCT_ID = 'mf-007.md-006.sm-jk1-2020__gv70-initial-product';
const GENESIS_GV70_INITIAL_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-GV70-%EC%A0%84-%EC%84%B8%EA%B3%84-%EB%8F%99%EC%8B%9C-%EA%B3%B5%EA%B0%9C/';
const GENESIS_GV70_FACELIFT_LAUNCH_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-%252C-GV70-%EB%B6%80%EB%B6%84%EB%B3%80%EA%B2%BD-%EB%AA%A8%EB%8D%B8-%EC%B6%9C%EC%8B%9C/';
const genesisGv70InitialProductRows = ([
  { seq: 1, powertrain: '가솔린 2.5T 2WD', fuel: '가솔린', cc: 2497, drive: '2WD' },
  { seq: 2, powertrain: '가솔린 2.5T AWD', fuel: '가솔린', cc: 2497, drive: 'AWD' },
  { seq: 3, powertrain: '디젤 2.2 AWD', fuel: '디젤', cc: 2151, drive: 'AWD' },
  { seq: 4, powertrain: '가솔린 3.5T AWD', fuel: '가솔린', cc: 3470, drive: 'AWD' },
] as const).map((config) => [
  '확정', '확정', '중고차', '국산', '제네시스', 'GV70', 'GV70 초기형 JK1',
  config.powertrain, '기본형', `${GENESIS_GV70_INITIAL_PRODUCT_ID}::v${String(config.seq).padStart(2, '0')}::t01`,
  GENESIS_GV70_INITIAL_PRODUCT_ID, config.seq, 1, '1세대 초기형', 'JK1', '2020-12', '2024-04', '2021', '2024',
  config.fuel, config.cc, config.fuel === '디젤' ? 2.2 : config.cc === 2497 ? 2.5 : 3.5, '예', config.drive, 5, '',
  `제네시스 GV70,Genesis GV70,GV70 JK1,초기형,${config.powertrain},기본형`,
  GENESIS_GV70_INITIAL_URL,
  `제네시스 공식 2020-12 GV70 공개자료의 엔진·정확배기량·구동 표를 기준으로 실제상품 보유 조합만 발급했다. 디젤 정확배기량은 공식표의 2,151cc이며 상품의 2,200 표시는 표시배기량으로 처리한다. 2024-05-08 공식 부분변경 출시 직전인 2024-04에서 닫는다. 경계 근거: ${GENESIS_GV70_FACELIFT_LAUNCH_URL}`,
  DATA_AS_OF,
]);
const GENESIS_G90_LWB_ID = 'mf-007.md-004.sm-rs4-lwb__g90-long-wheelbase';
const GENESIS_G90_BLACK_ID = 'mf-007.md-004.sm-rs4-black-2024__g90-black';
const GENESIS_G90_LWB_BLACK_ID = 'mf-007.md-004.sm-rs4-lwb-black-2025__g90-long-wheelbase-black';
const GENESIS_G90_SPECS_URL = 'https://www.genesis.com/kr/ko/models/luxury-sedan-genesis/g90/specs.html';
const GENESIS_G90_2023_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-%252C-2023-G90-%EC%B6%9C%EC%8B%9C/';
const GENESIS_G90_LWB_URL = 'https://newsroom.genesis.com/ko-ko/genesis-g90-long-wheel-base-kr/';
const GENESIS_G90_BLACK_URL = 'https://newsroom.genesis.com/ko-ko/%EC%99%84%EB%B2%BD%ED%95%9C-%EB%B8%94%EB%9E%99%EC%9D%98-%ED%83%84%EC%83%9D-%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-G90-%EB%B8%94%EB%9E%99-%EC%B6%9C%EC%8B%9C/';
const GENESIS_G90_LWB_BLACK_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-G90-%EB%A1%B1%ED%9C%A0%EB%B2%A0%EC%9D%B4%EC%8A%A4-%EB%B8%94%EB%9E%99-%EC%B2%AB-%EC%B6%9C%EC%8B%9C/';
const genesisG90CurrentRows = [
  ['검증중', '교차확인', '신차', '국산', '제네시스', 'G90', 'G90 RS4', '가솔린 3.5T 2WD', '기본 4인승', `${GENESIS_G90_RS4_ID}::v01::t01`, GENESIS_G90_RS4_ID, 1, 1, '4세대', 'RS4', '2021-12', '현재', '2022', '현재', '가솔린', 3470, '', '아니오', '2WD', 4, '', '제네시스 G90,Genesis G90,G90 RS4,3.5 터보,2WD,4인승', GENESIS_G90_SPECS_URL, '제네시스 공식 현행 제원표에서 가솔린 3.5 터보 2WD의 4인승 형식을 확인했다. 기존 5인승 영구코드와 좌석 수가 달라 별도 코드로 분리한다.', DATA_AS_OF],
  ['검증중', '교차확인', '신차', '국산', '제네시스', 'G90', 'G90 RS4', '가솔린 3.5T AWD', '기본 4인승', `${GENESIS_G90_RS4_ID}::v02::t01`, GENESIS_G90_RS4_ID, 2, 1, '4세대', 'RS4', '2021-12', '현재', '2022', '현재', '가솔린', 3470, '', '아니오', 'AWD', 4, '', '제네시스 G90,Genesis G90,G90 RS4,3.5 터보,AWD,4인승', GENESIS_G90_SPECS_URL, '제네시스 공식 현행 제원표에서 가솔린 3.5 터보 AWD의 4인승 형식을 확인했다. 기존 5인승 영구코드와 좌석 수가 달라 별도 코드로 분리한다.', DATA_AS_OF],
  ...(['2WD', 'AWD'] as const).flatMap((drive, driveIndex) => ([4, 5] as const).map((seats, seatIndex) => ['검증중', '교차확인', '신차', '국산', '제네시스', 'G90', '2023 G90 RS4', `가솔린 3.5T 48V e-S/C ${drive}`, `기본 ${seats}인승`, `${GENESIS_G90_RS4_ID}::v${String(3 + driveIndex).padStart(2, '0')}::t${String(seatIndex + 1).padStart(2, '0')}`, GENESIS_G90_RS4_ID, 3 + driveIndex, seatIndex + 1, '4세대', 'RS4', '2023-03', '현재', '2023', '현재', '가솔린', 3470, '', '아니오', drive, seats, '', `제네시스 G90,Genesis G90,G90 RS4,3.5 터보 48V 일렉트릭 슈퍼차저,e-S/C,${drive},${seats}인승`, GENESIS_G90_2023_URL, '제네시스 공식 2023 G90 출시자료에서 일반형에 3.5 터보 48V e-S/C가 추가된 사실과 현행 공식 제원표의 구동·좌석 형식을 확인했다.', DATA_AS_OF])),
];
const genesisG90LongWheelbaseRows = ([4, 5] as const).map((seats, index) => ['검증중', '교차확인', '신차', '국산', '제네시스', 'G90', 'G90 롱휠베이스 RS4', '가솔린 3.5T 48V e-S/C AWD', `롱휠베이스 ${seats}인승`, `${GENESIS_G90_LWB_ID}::v01::t${String(index + 1).padStart(2, '0')}`, GENESIS_G90_LWB_ID, 1, index + 1, '4세대 롱휠베이스', 'RS4', '2021-12', '현재', '2022', '현재', '가솔린', 3470, '', '아니오', 'AWD', seats, '', `제네시스 G90 롱휠베이스,Genesis G90 Long Wheel Base,G90 LWB,3.5 터보 48V e-S/C,AWD,${seats}인승`, GENESIS_G90_LWB_URL, '제네시스 공식 자료 기준 2021-12 완전변경과 함께 출시된 롱휠베이스다. 3.5 터보 48V e-S/C AWD 전용이며 공식 제원표의 4/5인승을 분리한다.', DATA_AS_OF]);
const genesisG90BlackRows = ([4, 5] as const).map((seats, index) => ['검증중', '교차확인', '신차', '국산', '제네시스', 'G90', '2024 G90 Black', '가솔린 3.5T 48V e-S/C AWD', `Black ${seats}인승`, `${GENESIS_G90_BLACK_ID}::v01::t${String(index + 1).padStart(2, '0')}`, GENESIS_G90_BLACK_ID, 1, index + 1, '4세대 Black', 'RS4', '2024-03', '현재', '2024', '현재', '가솔린', 3470, '', '아니오', 'AWD', seats, '', `제네시스 G90 블랙,Genesis G90 Black,G90 Black,3.5 터보 48V e-S/C,AWD,${seats}인승`, GENESIS_G90_BLACK_URL, '제네시스 공식 2024-03-21 국내 출시자료 기준. G90 Black은 3.5 터보 48V e-S/C AWD 단일 구동 조합이며 공식 제원표의 4/5인승을 분리한다.', DATA_AS_OF]);
const genesisG90LongWheelbaseBlackRows = ([4, 5] as const).map((seats, index) => ['검증중', '교차확인', '신차', '국산', '제네시스', 'G90', '2025 G90 롱휠베이스 Black', '가솔린 3.5T 48V e-S/C AWD', `롱휠베이스 Black ${seats}인승`, `${GENESIS_G90_LWB_BLACK_ID}::v01::t${String(index + 1).padStart(2, '0')}`, GENESIS_G90_LWB_BLACK_ID, 1, index + 1, '4세대 롱휠베이스 Black', 'RS4', '2025-03', '현재', '2025', '현재', '가솔린', 3470, '', '아니오', 'AWD', seats, '', `제네시스 G90 롱휠베이스 블랙,Genesis G90 Long Wheel Base Black,G90 LWB Black,3.5 터보 48V e-S/C,AWD,${seats}인승`, GENESIS_G90_LWB_BLACK_URL, '제네시스 공식 2025-03-05 국내 출시자료 기준. 롱휠베이스 Black은 3.5 터보 48V e-S/C AWD 단일 구동 조합이며 공식 제원표의 4/5인승을 분리한다.', DATA_AS_OF]);
const GENESIS_GV80_COUPE_ID = 'mf-007.md-005.sm-jx1c-2023__gv80-coupe';
const GENESIS_GV80_COUPE_BLACK_ID = 'mf-007.md-005.sm-jx1c-black-2024__gv80-coupe-black';
const GENESIS_GV80_COUPE_LAUNCH_URL = 'https://newsroom.genesis.com/ko-ko/GV80-%EB%B6%80%EB%B6%84%EB%B3%80%EA%B2%BD-%EB%AA%A8%EB%8D%B8-%C2%B7-GV80-%EC%BF%A0%ED%8E%98-%EA%B3%B5%EA%B0%9C/';
const GENESIS_GV80_COUPE_BLACK_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-%252C-GV80-%EB%B8%94%EB%9E%99-%C2%B7GV80-%EC%BF%A0%ED%8E%98-%EB%B8%94%EB%9E%99-%EA%B3%B5%EA%B0%9C/';
const genesisGv80CoupeRows = [
  ['검증중', '교차확인', '신차', '국산', '제네시스', 'GV80', 'GV80 쿠페 JX1C', '가솔린 3.5T 48V e-S/C AWD', '기본형', `${GENESIS_GV80_COUPE_ID}::v01::t01`, GENESIS_GV80_COUPE_ID, 1, 1, '1세대 쿠페', 'JX1C', '2023-10', '현재', '2024', '현재', '가솔린', 3470, 3.5, '예', 'AWD', 5, '', '제네시스 GV80 쿠페,Genesis GV80 Coupe,GV80 Coupe,3.5 터보 48V 일렉트릭 슈퍼차저,e-S/C,AWD,5인승', GENESIS_GV80_COUPE_LAUNCH_URL, '제네시스 공식 GV80 쿠페 공개자료와 현행 국내 제원표 기준. 쿠페 전용 415마력 3.5 터보 48V e-S/C AWD 5인승을 기존 3.5T와 별도 영구코드로 분리한다.', DATA_AS_OF],
];
const genesisGv80CoupeBlackRows = [
  ['검증중', '교차확인', '신차', '국산', '제네시스', 'GV80', '2024 GV80 쿠페 Black', '가솔린 2.5T AWD', 'Black', `${GENESIS_GV80_COUPE_BLACK_ID}::v01::t01`, GENESIS_GV80_COUPE_BLACK_ID, 1, 1, '1세대 쿠페 Black', 'JX1C', '2024-10', '현재', '2025', '현재', '가솔린', 2497, 2.5, '예', 'AWD', 5, '', '제네시스 GV80 쿠페 블랙,Genesis GV80 Coupe Black,GV80 Coupe Black,2.5 터보,AWD,5인승', GENESIS_GV80_COUPE_BLACK_URL, '제네시스 공식 2024-10-02 공개자료와 현행 국내 제원표 기준. GV80 쿠페 Black의 2.5 터보 AWD 5인승을 최초 공개 시점부터 분리한다.', DATA_AS_OF],
  ['검증중', '교차확인', '신차', '국산', '제네시스', 'GV80', '2024 GV80 쿠페 Black', '가솔린 3.5T AWD', 'Black', `${GENESIS_GV80_COUPE_BLACK_ID}::v02::t01`, GENESIS_GV80_COUPE_BLACK_ID, 2, 1, '1세대 쿠페 Black', 'JX1C', '2024-10', '현재', '2025', '현재', '가솔린', 3470, 3.5, '예', 'AWD', 5, '', '제네시스 GV80 쿠페 블랙,Genesis GV80 Coupe Black,GV80 Coupe Black,3.5 터보,AWD,5인승', GENESIS_GV80_COUPE_BLACK_URL, '제네시스 공식 2024-10-02 공개자료와 현행 국내 제원표 기준. GV80 쿠페 Black의 3.5 터보 AWD 5인승을 최초 공개 시점부터 분리한다.', DATA_AS_OF],
  ['검증중', '교차확인', '신차', '국산', '제네시스', 'GV80', '2024 GV80 쿠페 Black', '가솔린 3.5T 48V e-S/C AWD', 'Black', `${GENESIS_GV80_COUPE_BLACK_ID}::v03::t01`, GENESIS_GV80_COUPE_BLACK_ID, 3, 1, '1세대 쿠페 Black', 'JX1C', '2024-10', '현재', '2025', '현재', '가솔린', 3470, 3.5, '예', 'AWD', 5, '', '제네시스 GV80 쿠페 블랙,Genesis GV80 Coupe Black,GV80 Coupe Black,3.5 터보 48V 일렉트릭 슈퍼차저,e-S/C,AWD,5인승', GENESIS_GV80_COUPE_BLACK_URL, '제네시스 공식 2024-10-02 공개자료와 현행 국내 제원표 기준. GV80 쿠페 Black의 3.5 터보 48V e-S/C AWD 5인승을 별도 영구코드로 분리한다.', DATA_AS_OF],
];
const GENESIS_GV80_BLACK_ID = 'mf-007.md-005.sm-jx1-pe-black-2024__gv80-black';
const GENESIS_GV80_BLACK_SPECS_URL = 'https://www.genesis.com/kr/ko/models/luxury-suv-genesis/gv80-black/specs.html';
const genesisGv80BlackRows = ([
  { seq: 1, cc: 2497, liters: 2.5, label: '가솔린 2.5T AWD' },
  { seq: 2, cc: 3470, liters: 3.5, label: '가솔린 3.5T AWD' },
] as const).flatMap((engine) => ([5, 6, 7] as const).map((seats, seatIndex) => [
  '검증중', '교차확인', '신차', '국산', '제네시스', 'GV80', '2024 GV80 Black JX1', engine.label, `Black ${seats}인승`,
  `${GENESIS_GV80_BLACK_ID}::v${String(engine.seq).padStart(2, '0')}::t${String(seatIndex + 1).padStart(2, '0')}`, GENESIS_GV80_BLACK_ID, engine.seq, seatIndex + 1,
  '1세대 부분변경 Black', 'JX1', '2024-10', '현재', '2025', '현재', '가솔린', engine.cc, engine.liters, '예', 'AWD', seats, '',
  `제네시스 GV80 블랙,Genesis GV80 Black,GV80 Black,${engine.liters} 터보,AWD,${seats}인승`, GENESIS_GV80_BLACK_SPECS_URL,
  '제네시스 공식 2024-10-02 Black 공개자료와 현행 국내 전용 제원·견적 기준. GV80 Black은 2.5T/3.5T AWD와 5/6/7인승으로 운영되어 엔진·좌석 조합별 영구코드로 분리한다.', DATA_AS_OF,
]));
const GENESIS_G80_BLACK_ID = 'mf-007.md-002.sm-rg3-pe-black-2025__g80-black';
const GENESIS_G80_BLACK_URL = 'https://newsroom.genesis.com/ko-ko/%EC%A0%9C%EB%84%A4%EC%8B%9C%EC%8A%A4-G80-%EB%B8%94%EB%9E%99-%ED%8C%90%EB%A7%A4%EA%B0%9C%EC%8B%9C/';
const genesisG80BlackRows = ([
  { seq: 1, cc: 2497, liters: 2.5, label: '가솔린 2.5T AWD' },
  { seq: 2, cc: 3470, liters: 3.5, label: '가솔린 3.5T AWD' },
] as const).map((engine) => [
  '검증중', '교차확인', '신차', '국산', '제네시스', 'G80', '2025 G80 Black RG3', engine.label, 'Black',
  `${GENESIS_G80_BLACK_ID}::v${String(engine.seq).padStart(2, '0')}::t01`, GENESIS_G80_BLACK_ID, engine.seq, 1,
  '3세대 부분변경 Black', 'RG3', '2025-01', '현재', '2025', '현재', '가솔린', engine.cc, engine.liters, '예', 'AWD', 5, '',
  `제네시스 G80 블랙,Genesis G80 Black,G80 Black,${engine.liters} 터보,AWD,5인승`, GENESIS_G80_BLACK_URL,
  '제네시스 공식 2025-01-08 국내 판매개시 자료와 현행 국내 제원표 기준. G80 Black은 2.5T/3.5T AWD 5인승으로 운영되어 엔진별 영구코드로 분리한다.', DATA_AS_OF,
]);
const HYUNDAI_GRANDEUR_GN11_ID = 'mf-001.md-004.sm-gn11__the-new-grandeur';
const HYUNDAI_GRANDEUR_GN11_PRICE_URL = 'https://www.hyundai.com/kr/ko/e/vehicles/the-new-grandeur/price';
const hyundaiGrandeurGn11Rows = ([
  { seq: 1, cc: 2497, liters: 2.5, fuel: '가솔린', turbo: '아니오', drive: '2WD', label: '가솔린 2.5 2WD', trims: ['프리미엄', '익스클루시브', '캘리그래피', 'Black Ink'] },
  { seq: 2, cc: 3470, liters: 3.5, fuel: '가솔린', turbo: '아니오', drive: '2WD', label: '가솔린 3.5 2WD', trims: ['프리미엄', '익스클루시브', '캘리그래피', 'Black Ink'] },
  { seq: 3, cc: 3470, liters: 3.5, fuel: '가솔린', turbo: '아니오', drive: '4WD', label: '가솔린 3.5 4WD', trims: ['프리미엄', '익스클루시브', '캘리그래피', 'Black Ink'] },
  { seq: 4, cc: 3470, liters: 3.5, fuel: 'LPG', turbo: '아니오', drive: '2WD', label: 'LPG 3.5 2WD', trims: ['프리미엄', '익스클루시브'] },
  { seq: 5, cc: 1598, liters: 1.6, fuel: '하이브리드', turbo: '예', drive: '2WD', label: '하이브리드 1.6T 2WD', trims: ['프리미엄', '익스클루시브', '캘리그래피', 'Black Ink'] },
] as const).flatMap((powertrain) => powertrain.trims.map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '국산', '현대', '그랜저', 'The new GRANDEUR GN11', powertrain.label, trim,
  `${HYUNDAI_GRANDEUR_GN11_ID}::v${String(powertrain.seq).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`,
  HYUNDAI_GRANDEUR_GN11_ID, powertrain.seq, trimIndex + 1,
  '7세대 부분변경', 'GN11', '2026-05', '현재', '2026', '현재', powertrain.fuel, powertrain.cc, powertrain.liters,
  powertrain.turbo, powertrain.drive, 5, '',
  `현대 그랜저,Hyundai Grandeur,The new GRANDEUR,더 뉴 그랜저,GN11,${powertrain.label},${trim}${trim === 'Black Ink' ? ',블랙 잉크' : ''}`,
  HYUNDAI_GRANDEUR_GN11_PRICE_URL,
  '현대자동차 공식 The new GRANDEUR 가격표의 모델 출시일 2026-05-14와 현행 모델소개·2026-07-01 가격 기준. 공식 페이지의 개발코드 GN11과 가솔린 2.5·3.5, LPG 3.5, 하이브리드 1.6T 및 HTRAC 선택 조합을 반영했다. 가격 기준일을 생산 시작일로 오인하지 않는다. 기존 GN7 현행 코드는 개발코드·터보 여부·아너스 트림이 현행 공식 자료와 충돌해 의미를 변경하지 않고 차단 보존한다.', DATA_AS_OF,
]));
const KIA_CARNIVAL_XLINE_ID = 'mf-002.md-036.sm-ka4-pe-xline-2026__carnival-x-line';
const KIA_CARNIVAL_2026_PRICE_URL = 'https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_carnival.pdf';
const kiaCarnivalXlineRows = ([
  { seq: 1, cc: 3470, liters: 3.5, fuel: '가솔린', label: '가솔린 3.5 2WD' },
  { seq: 2, cc: 1598, liters: 1.6, fuel: '하이브리드', label: '하이브리드 1.6T 2WD' },
] as const).flatMap((engine) => ([7, 9] as const).map((seats, seatIndex) => [
  '검증중', '교차확인', '신차', '국산', '기아', '카니발', '2026 카니발 X-Line KA4', engine.label, `X-Line ${seats}인승`,
  `${KIA_CARNIVAL_XLINE_ID}::v${String(engine.seq).padStart(2, '0')}::t${String(seatIndex + 1).padStart(2, '0')}`, KIA_CARNIVAL_XLINE_ID, engine.seq, seatIndex + 1,
  '4세대 부분변경 X-Line', 'KA4', seats === 7 ? '2026-05' : '2026-07', '현재', '2026', '현재', engine.fuel, engine.cc, engine.liters, engine.seq === 2 ? '예' : '아니오', '2WD', seats, '',
  `기아 카니발 X-Line,Kia Carnival X-Line,카니발 엑스라인,${engine.liters},${seats}인승,2WD`, KIA_CARNIVAL_2026_PRICE_URL,
  seats === 7
    ? '기아 공식 2026-05-01 국내 가격표·카탈로그 기준. X-Line 7인승은 시그니처 기반 전용 트림이며 3.5 가솔린 또는 1.6 터보 하이브리드를 선택하므로 파워트레인별 영구코드로 분리한다.'
    : '기아 공식 2026-07·08 국내 가격표 기준. X-Line은 9인승에도 판매되며 3.5 가솔린 또는 1.6 터보 하이브리드를 선택할 수 있다. 기존 7인승 영구키를 유지하고 9인승을 별도 트림키로 분리한다.', DATA_AS_OF,
]));
const KIA_SORENTO_XLINE_ID = 'mf-002.md-027.sm-mq4-pe-xline-2026__sorento-x-line';
const KIA_SORENTO_2026_PRICE_URL = 'https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_sorento.pdf';
const kiaSorentoXlineRows = ([
  { seq: 1, cc: 2497, liters: 2.5, fuel: '가솔린', label: '가솔린 2.5T 2WD', drive: '2WD' },
  { seq: 2, cc: 2497, liters: 2.5, fuel: '가솔린', label: '가솔린 2.5T 4WD', drive: '4WD' },
  { seq: 3, cc: 2151, liters: 2.2, fuel: '디젤', label: '디젤 2.2 2WD', drive: '2WD' },
  { seq: 4, cc: 2151, liters: 2.2, fuel: '디젤', label: '디젤 2.2 4WD', drive: '4WD' },
  { seq: 5, cc: 1598, liters: 1.6, fuel: '하이브리드', label: '하이브리드 1.6T 2WD', drive: '2WD' },
  { seq: 6, cc: 1598, liters: 1.6, fuel: '하이브리드', label: '하이브리드 1.6T 4WD', drive: '4WD' },
] as const).flatMap((engine) => ([5, 6, 7] as const).map((seats, seatIndex) => [
  '검증중', '교차확인', '신차', '국산', '기아', '쏘렌토', '2026 쏘렌토 X-Line MQ4', engine.label, `X-Line ${seats}인승`,
  `${KIA_SORENTO_XLINE_ID}::v${String(engine.seq).padStart(2, '0')}::t${String(seatIndex + 1).padStart(2, '0')}`,
  KIA_SORENTO_XLINE_ID, engine.seq, seatIndex + 1,
  '4세대 부분변경 2026 X-Line', 'MQ4', '2026-05', '현재', '2026', '현재', engine.fuel, engine.cc, engine.liters, '예', engine.drive, seats, '',
  `기아 쏘렌토 X-Line,Kia Sorento X-Line,쏘렌토 엑스라인,The 2026 Sorento X-Line,${engine.label},${seats}인승`,
  KIA_SORENTO_2026_PRICE_URL,
  '기아 공식 2026-05 가격표·현행 특징 페이지 기준. X-Line은 시그니처 기반 전용 외장·내장 트림이며 2.5 가솔린 터보·2.2 디젤·1.6 터보 하이브리드, 2WD·4WD, 5·6·7인승 조합을 선택할 수 있다. 기존 2023년형 시그니처 X라인의 영구코드 의미를 바꾸지 않고 2026 X-Line을 별도 코드로 분리한다.', DATA_AS_OF,
]));
const KIA_SPORTAGE_XLINE_ID = 'mf-002.md-025.sm-nq5-pe-xline__sportage-x-line';
const KIA_SPORTAGE_XLINE_PRICE_URL = 'https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_sportageql.pdf';
const kiaSportageXlineRows = ([
  { seq: 1, cc: 1598, liters: 1.6, fuel: '가솔린', turbo: '예', drive: '2WD', label: '가솔린 1.6T 2WD' },
  { seq: 2, cc: 1598, liters: 1.6, fuel: '가솔린', turbo: '예', drive: '4WD', label: '가솔린 1.6T 4WD' },
  { seq: 3, cc: 1999, liters: 2.0, fuel: 'LPG', turbo: '아니오', drive: '2WD', label: 'LPG 2.0 2WD' },
  { seq: 4, cc: 1598, liters: 1.6, fuel: '하이브리드', turbo: '예', drive: '2WD', label: '하이브리드 1.6T 2WD' },
  { seq: 5, cc: 1598, liters: 1.6, fuel: '하이브리드', turbo: '예', drive: '4WD', label: '하이브리드 1.6T 4WD' },
] as const).map((powertrain) => [
  '검증중', '교차확인', '신차', '국산', '기아', '스포티지', '더 뉴 스포티지 X-Line NQ5', powertrain.label, 'X-Line',
  `${KIA_SPORTAGE_XLINE_ID}::v${String(powertrain.seq).padStart(2, '0')}::t01`, KIA_SPORTAGE_XLINE_ID, powertrain.seq, 1,
  '5세대 부분변경 X-Line', 'NQ5', '2024-11', '현재', '2025', '현재', powertrain.fuel, powertrain.cc, powertrain.liters,
  powertrain.turbo, powertrain.drive, 5, '',
  `기아 스포티지 X-Line,Kia Sportage X-Line,스포티지 엑스라인,더 뉴 스포티지 X-Line,NQ5,${powertrain.label}`,
  KIA_SPORTAGE_XLINE_PRICE_URL,
  '기아 공식 The 2026 Sportage 현행 가격표·특징 페이지 기준. X-Line은 시그니처 기본 품목에 전용 외장 디자인·19인치 블랙 휠·스웨이드 헤드라이닝을 더한 독립 트림이다. 가솔린 1.6T와 하이브리드 1.6T는 2WD·4WD, LPG 2.0은 2WD로 분리한다. 기존 시그니처 X라인 코드는 공식 현행 트림명과 달라 의미를 변경하지 않고 차단 보존한다.', DATA_AS_OF,
]);
const KIA_CARNIVAL_HIGH_ROOF_ID = 'mf-002.md-036.sm-ka4-high-roof-2026__carnival-high-roof';
const KIA_CARNIVAL_HIGH_ROOF_URL = 'https://worldwide.kia.com/ko/newsroom-korea/view/?id=1529';
const kiaCarnivalHighRoofRows = ([
  { seq: 1, cc: 3470, liters: 3.5, fuel: '가솔린', turbo: '아니오', label: '가솔린 3.5 2WD' },
  { seq: 2, cc: 1598, liters: 1.6, fuel: '하이브리드', turbo: '예', label: '하이브리드 1.6T 2WD' },
] as const).flatMap((engine) => ([
  { seq: 1, trim: '노블레스' },
  { seq: 2, trim: '시그니처' },
] as const).map((grade) => [
  '검증중', '교차확인', '신차', '국산', '기아', '카니발', '2026 카니발 하이루프 KA4', engine.label, `하이루프 9인승 ${grade.trim}`,
  `${KIA_CARNIVAL_HIGH_ROOF_ID}::v${String(engine.seq).padStart(2, '0')}::t${String(grade.seq).padStart(2, '0')}`, KIA_CARNIVAL_HIGH_ROOF_ID, engine.seq, grade.seq,
  '4세대 부분변경 하이루프', 'KA4', '2026-06', '현재', '2026', '현재', engine.fuel, engine.cc, engine.liters, engine.turbo, '2WD', 9, '',
  `기아 카니발 하이루프,Kia Carnival High Roof,카니발 하이 루프,${engine.liters},9인승,${grade.trim},2WD`, KIA_CARNIVAL_HIGH_ROOF_URL,
  '기아 공식 2026-06-12 국내 출시 자료와 현행 가격 페이지 기준. 일반 카니발보다 전고를 270mm 높인 9인승 하이루프이며 하이리무진과 별도 라인업이다. 3.5 가솔린·1.6 터보 하이브리드와 노블레스·시그니처 조합을 각각 영구코드로 분리한다.', DATA_AS_OF,
]));

const KIA_K5_BEST_SELECTION_ID = 'mf-002.md-001.sm-dl3-pe-best-selection-2026__k5-best-selection';
const KIA_K5_BEST_SELECTION_URL = 'https://worldwide.kia.com/ko/newsroom-korea/view/?id=1396';
const kiaK5BestSelectionRows = ([
  { seq: 1, cc: 1999, liters: 2.0, fuel: '가솔린', turbo: '아니오', label: '가솔린 2.0' },
  { seq: 2, cc: 1598, liters: 1.6, fuel: '가솔린', turbo: '예', label: '가솔린 1.6T' },
  { seq: 3, cc: 1999, liters: 2.0, fuel: '하이브리드', turbo: '아니오', label: '하이브리드 2.0' },
] as const).map((engine) => [
  '검증중', '교차확인', '신차', '국산', '기아', 'K5', '2026 K5 베스트 셀렉션 DL3', engine.label, '베스트 셀렉션',
  `${KIA_K5_BEST_SELECTION_ID}::v${String(engine.seq).padStart(2, '0')}::t01`, KIA_K5_BEST_SELECTION_ID, engine.seq, 1,
  '3세대 부분변경 연식변경', 'DL3', '2025-06', '현재', '2026', '현재', engine.fuel, engine.cc, engine.liters, engine.turbo, '', 5, '',
  `기아 K5 베스트 셀렉션,Kia K5 Best Selection,The 2026 K5,${engine.liters},베스트셀렉션`, KIA_K5_BEST_SELECTION_URL,
  '기아 공식 2025-06-19 The 2026 K5 국내 출시 자료 기준. 베스트 셀렉션은 이 연식변경에서 신설된 트림이므로 2023년 부분변경 최초 출시 시점과 합치지 않고 2.0 가솔린·1.6 가솔린 터보·2.0 하이브리드별 영구코드로 분리한다.', DATA_AS_OF,
]);

const KIA_K5_2027_ID = 'mf-002.md-001.sm-dl3-pe-my2027__k5-2027';
const KIA_K5_2027_RENT_ID = 'mf-002.md-001.sm-dl3-pe-my2027-rent__k5-2027-rental';
const KIA_K5_2027_PRICE_URL = 'https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_k5.pdf';
const KIA_K5_2027_NOTE = '기아 공식 The 2027 K5 2026-08 가격표 기준. 자가용은 하이브리드 프레스티지·베스트 셀렉션·노블레스·시그니처, 2.0 가솔린 스마트 셀렉션·프레스티지·베스트 셀렉션·노블레스·시그니처, 1.6 가솔린 터보 프레스티지·베스트 셀렉션·노블레스·시그니처, 2.0 LPG 프레스티지·노블레스·시그니처로 구성된다. 렌터카 2.0 LPG는 별도 판매유형이며 트렌디·프레스티지로 구성되어 자가용 LPG와 별도 영구코드 계보로 분리한다.';
const KIA_K5_2027_VARIANTS = [
  { seq: 1, powertrain: '하이브리드 2.0', fuel: '하이브리드', cc: 1999, liters: 2.0, turbo: '아니오', trims: ['프레스티지', '베스트 셀렉션', '노블레스', '시그니처'] },
  { seq: 2, powertrain: '가솔린 2.0', fuel: '가솔린', cc: 1999, liters: 2.0, turbo: '아니오', trims: ['스마트 셀렉션', '프레스티지', '베스트 셀렉션', '노블레스', '시그니처'] },
  { seq: 3, powertrain: '가솔린 1.6T', fuel: '가솔린', cc: 1598, liters: 1.6, turbo: '예', trims: ['프레스티지', '베스트 셀렉션', '노블레스', '시그니처'] },
  { seq: 4, powertrain: 'LPG 2.0', fuel: 'LPG', cc: 1999, liters: 2.0, turbo: '아니오', trims: ['프레스티지', '노블레스', '시그니처'] },
] as const;
const kiaK5_2027Rows = KIA_K5_2027_VARIANTS.flatMap((variant) => variant.trims.map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '국산', '기아', 'K5', 'The 2027 K5 DL3', variant.powertrain, trim,
  `${KIA_K5_2027_ID}::v${String(variant.seq).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`, KIA_K5_2027_ID, variant.seq, trimIndex + 1,
  '3세대 부분변경 연식변경', 'DL3', '2026-07', '현재', '2027', '현재', variant.fuel, variant.cc, variant.liters, variant.turbo, '2WD', 5, '',
  ['기아 K5', 'Kia K5', 'The 2027 K5', '2027 K5', '더 뉴 K5 DL3', variant.powertrain, trim].join(','),
  KIA_K5_2027_PRICE_URL, KIA_K5_2027_NOTE, DATA_AS_OF,
]));
const kiaK5_2027RentalRows = ['트렌디', '프레스티지'].map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '국산', '기아', 'K5', 'The 2027 K5 렌터카 DL3', 'LPG 2.0 렌터카', trim,
  `${KIA_K5_2027_RENT_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`, KIA_K5_2027_RENT_ID, 1, trimIndex + 1,
  '3세대 부분변경 연식변경 렌터카', 'DL3', '2026-07', '현재', '2027', '현재', 'LPG', 1999, 2.0, '아니오', '2WD', 5, '',
  ['기아 K5 렌터카', 'Kia K5 Rental', 'The 2027 K5 렌터카', '2027 K5 LPG 렌터카', 'K5 장기렌터카', `렌터카 ${trim}`, `LPG ${trim}`].join(','),
  KIA_K5_2027_PRICE_URL, `${KIA_K5_2027_NOTE} 렌터카 전용 가격은 면세가격이며 원형 봄베와 6단 자동변속기 사양을 공식 가격표에서 확인했다.`, DATA_AS_OF,
]);

const KIA_K8_BEST_SELECTION_ID = 'mf-002.md-065.sm-gl3-pe-best-selection-2026__k8-best-selection';
const KIA_K8_BEST_SELECTION_URL = 'https://worldwide.kia.com/ko/newsroom-korea/view/?id=1396';
const kiaK8BestSelectionRows = ([
  { seq: 1, cc: 2497, liters: 2.5, fuel: '가솔린', turbo: '아니오', label: '가솔린 2.5 2WD' },
  { seq: 2, cc: 3470, liters: 3.5, fuel: '가솔린', turbo: '아니오', label: '가솔린 3.5 2WD' },
  { seq: 3, cc: 1598, liters: 1.6, fuel: '하이브리드', turbo: '예', label: '하이브리드 1.6T 2WD' },
] as const).map((engine) => [
  '검증중', '교차확인', '신차', '국산', '기아', 'K8', '2026 K8 베스트 셀렉션 GL3', engine.label, '베스트 셀렉션',
  `${KIA_K8_BEST_SELECTION_ID}::v${String(engine.seq).padStart(2, '0')}::t01`, KIA_K8_BEST_SELECTION_ID, engine.seq, 1,
  '1세대 부분변경 연식변경', 'GL3', '2025-06', '현재', '2026', '현재', engine.fuel, engine.cc, engine.liters, engine.turbo, '2WD', 5, '',
  `기아 K8 베스트 셀렉션,Kia K8 Best Selection,The 2026 K8,${engine.liters},베스트셀렉션,2WD`, KIA_K8_BEST_SELECTION_URL,
  '기아 공식 2025-06-19 The 2026 K8 국내 출시 자료 기준. 베스트 셀렉션은 이 연식변경에서 신설됐으며 2.5 가솔린·3.5 가솔린·1.6 터보 하이브리드에 운영되므로 파워트레인별 영구코드로 분리한다.', DATA_AS_OF,
]);

const KIA_EV_2026_AWD_URL = 'https://worldwide.kia.com/ko/newsroom-korea/view/?id=1488';
const KIA_EV3_2026_AWD_ID = 'mf-002.md-ev3.sm-sv-awd-2026__ev3-long-range-awd';
const KIA_EV4_2026_AWD_ID = 'mf-002.md-072.sm-ct-awd-2026__ev4-long-range-awd';
const KIA_EV3_GT_ID = 'mf-002.md-ev3.sm-sv-gt-2026__ev3-gt';
const KIA_EV4_GT_ID = 'mf-002.md-072.sm-ct-gt-2026__ev4-gt';
const ev2026Grades = ['에어', '어스', 'GT-Line'] as const;
const kiaEv3_2026AwdRows = ev2026Grades.map((trim, index) => [
  '검증중', '교차확인', '신차', '국산', '기아', 'EV3', '2026 EV3 롱레인지 4WD SV', '전기 81.4kWh 4WD', trim,
  `${KIA_EV3_2026_AWD_ID}::v01::t${String(index + 1).padStart(2, '0')}`, KIA_EV3_2026_AWD_ID, 1, index + 1,
  '1세대 연식변경 4WD', 'SV', '2026-02', '현재', '2026', '현재', '전기', '', '', '아니오', '4WD', 5, 81.4,
  `기아 EV3 롱레인지 4WD,Kia EV3 Long Range AWD,The 2026 EV3,81.4kWh,${trim}`, KIA_EV_2026_AWD_URL,
  '기아 공식 2026-02-02 국내 출시 자료 기준. EV3 롱레인지 4WD는 2026 연식변경에서 신규 추가됐으므로 최초 출시 시점과 합치지 않고 에어·어스·GT-Line별 영구코드로 분리한다.', DATA_AS_OF,
]);
const kiaEv4_2026AwdRows = ev2026Grades.map((trim, index) => [
  '검증중', '교차확인', '신차', '국산', '기아', 'EV4', '2026 EV4 롱레인지 4WD CT', '전기 81.4kWh 4WD', trim,
  `${KIA_EV4_2026_AWD_ID}::v01::t${String(index + 1).padStart(2, '0')}`, KIA_EV4_2026_AWD_ID, 1, index + 1,
  '1세대 연식변경 4WD', 'CT', '2026-02', '현재', '2026', '현재', '전기', '', '', '아니오', '4WD', 5, 81.4,
  `기아 EV4 롱레인지 4WD,Kia EV4 Long Range AWD,The 2026 EV4,81.4kWh,${trim}`, KIA_EV_2026_AWD_URL,
  '기아 공식 2026-02-02 국내 출시 자료 기준. EV4 롱레인지 4WD는 2026 연식변경에서 신규 추가됐으므로 최초 출시 시점과 합치지 않고 에어·어스·GT-Line별 영구코드로 분리한다.', DATA_AS_OF,
]);
const kiaEvGtRows = ([
  { model: 'EV3', code: 'SV', id: KIA_EV3_GT_ID },
  { model: 'EV4', code: 'CT', id: KIA_EV4_GT_ID },
] as const).map((vehicle) => [
  '검증중', '교차확인', '신차', '국산', '기아', vehicle.model, `2026 ${vehicle.model} GT ${vehicle.code}`, '전기 81.4kWh GT 4WD', 'GT',
  `${vehicle.id}::v01::t01`, vehicle.id, 1, 1, '1세대 GT', vehicle.code, '2026-02', '현재', '2026', '현재', '전기', '', '', '아니오', '4WD', 5, 81.4,
  `기아 ${vehicle.model} GT,Kia ${vehicle.model} GT,The Kia ${vehicle.model} GT,81.4kWh,듀얼모터,4WD`, KIA_EV_2026_AWD_URL,
  `기아 공식 2026-02-02 국내 출시 자료 기준. ${vehicle.model} GT는 81.4kWh 배터리와 전륜 145kW·후륜 70kW 듀얼 모터 4WD를 적용한 고성능 독립 라인업이므로 일반 GT-Line과 별도 영구코드로 분리한다.`, DATA_AS_OF,
]);

const KIA_EV5_LAUNCH_URL = 'https://worldwide.kia.com/en/newsroom/view/?id=161194';
const KIA_EV5_2026_URL = 'https://worldwide.kia.com/ko/newsroom-korea/view/?id=1488';
const KIA_EV5_LONG_2WD_ID = 'mf-002.md-074.sm-ov-launch-2025__ev5-long-range-2wd';
const KIA_EV5_STANDARD_2WD_ID = 'mf-002.md-074.sm-ov-standard-2026__ev5-standard-2wd';
const KIA_EV5_LONG_AWD_ID = 'mf-002.md-074.sm-ov-awd-2026__ev5-long-range-awd';
const KIA_EV5_GT_ID = 'mf-002.md-074.sm-ov-gt-2026__ev5-gt';
const kiaEv5Long2wdRows = ev2026Grades.map((trim, index) => [
  '검증중', '교차확인', '신차', '국산', '기아', 'EV5', 'EV5 롱레인지 2WD OV', '전기 81.4kWh 2WD', trim,
  `${KIA_EV5_LONG_2WD_ID}::v01::t${String(index + 1).padStart(2, '0')}`, KIA_EV5_LONG_2WD_ID, 1, index + 1,
  '1세대 국내 출시', 'OV', '2025-07', '현재', '2025', '현재', '전기', '', '', '아니오', '2WD', 5, 81.4,
  `기아 EV5 롱레인지,Kia EV5 Long Range,EV5 81.4kWh,2WD,${trim}`, KIA_EV5_LAUNCH_URL,
  '기아 공식 2025-07-08 EV5 국내·글로벌 출시 자료와 현행 국내 가격표 기준. 국내 최초형 롱레인지 81.4kWh 2WD의 에어·어스·GT-Line을 트림별 영구코드로 분리한다.', DATA_AS_OF,
]);
const kiaEv5Standard2wdRows = ev2026Grades.map((trim, index) => [
  '검증중', '교차확인', '신차', '국산', '기아', 'EV5', '2026 EV5 스탠다드 2WD OV', '전기 60.3kWh 2WD', trim,
  `${KIA_EV5_STANDARD_2WD_ID}::v01::t${String(index + 1).padStart(2, '0')}`, KIA_EV5_STANDARD_2WD_ID, 1, index + 1,
  '1세대 스탠다드 추가', 'OV', '2026-02', '현재', '2026', '현재', '전기', '', '', '아니오', '2WD', 5, 60.3,
  `기아 EV5 스탠다드,Kia EV5 Standard,EV5 60.3kWh,2WD,${trim}`, KIA_EV5_2026_URL,
  '기아 공식 2026-02-02 국내 출시 자료와 현행 국내 가격표 기준. 60.3kWh 스탠다드는 이 시점에 추가됐으므로 에어·어스·GT-Line을 트림별 영구코드로 분리한다.', DATA_AS_OF,
]);
const kiaEv5LongAwdRows = ev2026Grades.map((trim, index) => [
  '검증중', '교차확인', '신차', '국산', '기아', 'EV5', '2026 EV5 롱레인지 4WD OV', '전기 81.4kWh 4WD', trim,
  `${KIA_EV5_LONG_AWD_ID}::v01::t${String(index + 1).padStart(2, '0')}`, KIA_EV5_LONG_AWD_ID, 1, index + 1,
  '1세대 4WD 추가', 'OV', '2026-02', '현재', '2026', '현재', '전기', '', '', '아니오', '4WD', 5, 81.4,
  `기아 EV5 롱레인지 4WD,Kia EV5 Long Range AWD,EV5 81.4kWh,4WD,${trim}`, KIA_EV5_2026_URL,
  '기아 공식 2026-02-02 국내 출시 자료와 현행 국내 가격표 기준. EV5 롱레인지 4WD는 이 시점에 추가됐으므로 에어·어스·GT-Line을 트림별 영구코드로 분리한다.', DATA_AS_OF,
]);
const kiaEv5GtRows = [[
  '검증중', '교차확인', '신차', '국산', '기아', 'EV5', '2026 EV5 GT OV', '전기 81.4kWh GT 4WD', 'GT',
  `${KIA_EV5_GT_ID}::v01::t01`, KIA_EV5_GT_ID, 1, 1, '1세대 GT', 'OV', '2026-02', '현재', '2026', '현재', '전기', '', '', '아니오', '4WD', 5, 81.4,
  '기아 EV5 GT,Kia EV5 GT,The Kia EV5 GT,81.4kWh,듀얼모터,4WD', KIA_EV5_2026_URL,
  '기아 공식 2026-02-02 국내 출시 자료 기준. EV5 GT는 81.4kWh 배터리와 전륜 155kW·후륜 70kW 듀얼 모터 4WD를 적용한 고성능 독립 라인업이므로 일반 GT-Line과 별도 영구코드로 분리한다.', DATA_AS_OF,
]];

const KIA_EV9_2026_URL = 'https://worldwide.kia.com/ko/newsroom-korea/view/?id=1488';
const KIA_EV9_STANDARD_2026_ID = 'mf-002.md-ev9.sm-mv1-standard-2026__ev9-standard';
const KIA_EV9_LIGHT_LONG_2026_ID = 'mf-002.md-ev9.sm-mv1-light-2026__ev9-light-long-range';
const kiaEv9Standard2026Rows = (['라이트', '에어', '어스'] as const).flatMap((trim, trimIndex) => ([6, 7] as const).map((seats, seatIndex) => [
  '검증중', '교차확인', '신차', '국산', '기아', 'EV9', '2026 EV9 스탠다드 MV1', '전기 76.1kWh 2WD', `${trim} ${seats}인승`,
  `${KIA_EV9_STANDARD_2026_ID}::v01::t${String(trimIndex * 2 + seatIndex + 1).padStart(2, '0')}`, KIA_EV9_STANDARD_2026_ID, 1, trimIndex * 2 + seatIndex + 1,
  '1세대 2026 연식변경 스탠다드', 'MV1', '2026-02', '현재', '2026', '현재', '전기', '', '', '아니오', '2WD', seats, 76.1,
  `기아 EV9 스탠다드,Kia EV9 Standard,The 2026 EV9,76.1kWh,${trim},${seats}인승,2WD`, KIA_EV9_2026_URL,
  '기아 공식 2026-02-02 국내 연식변경 출시자료와 현행 가격표 기준. 76.1kWh 스탠다드 및 라이트 트림은 2026 EV9에서 도입됐으며 라이트·에어·어스의 6/7인승을 각각 영구코드로 분리한다.', DATA_AS_OF,
]));
const kiaEv9LightLong2026Rows = ([
  { seq: 1, drive: '2WD' },
  { seq: 2, drive: '4WD' },
] as const).flatMap((variant) => ([6, 7] as const).map((seats, seatIndex) => [
  '검증중', '교차확인', '신차', '국산', '기아', 'EV9', '2026 EV9 라이트 롱레인지 MV1', `전기 99.8kWh ${variant.drive}`, `라이트 ${seats}인승`,
  `${KIA_EV9_LIGHT_LONG_2026_ID}::v${String(variant.seq).padStart(2, '0')}::t${String(seatIndex + 1).padStart(2, '0')}`, KIA_EV9_LIGHT_LONG_2026_ID, variant.seq, seatIndex + 1,
  '1세대 2026 연식변경 라이트', 'MV1', '2026-02', '현재', '2026', '현재', '전기', '', '', '아니오', variant.drive, seats, 99.8,
  `기아 EV9 라이트 롱레인지,Kia EV9 Light Long Range,The 2026 EV9,99.8kWh,${variant.drive},${seats}인승`, KIA_EV9_2026_URL,
  '기아 공식 2026-02-02 국내 연식변경 출시자료와 현행 가격표 기준. 라이트는 2026 EV9에서 신규 도입됐으므로 99.8kWh 롱레인지 2WD/4WD와 6/7인승을 각각 영구코드로 분리한다.', DATA_AS_OF,
]));

const KIA_EV6_PE_GT_ID = 'mf-002.md-ev6.sm-cv-pe-gt-2024__new-ev6-gt';
const KIA_EV6_PE_GT_URL = 'https://www.hyundaimotorgroup.com/ko/news/CONT0000000000165334';
const kiaEv6PeGtRows = [[
  '검증중', '교차확인', '신차', '국산', '기아', 'EV6', '더 뉴 EV6 GT CV PE', '전기 84kWh GT 4WD', 'GT',
  `${KIA_EV6_PE_GT_ID}::v01::t01`, KIA_EV6_PE_GT_ID, 1, 1, '1세대 부분변경 GT', 'CV', '2024-11', '현재', '2025', '현재', '전기', '', '', '아니오', '4WD', 5, 84,
  '기아 더 뉴 EV6 GT,Kia New EV6 GT,EV6 GT 84kWh,448kW,4WD,5인승', KIA_EV6_PE_GT_URL,
  '현대자동차그룹·기아 공식 2024-11-26 국내 판매개시 자료와 현행 가격표 기준. 더 뉴 EV6 GT는 84kWh 배터리와 합산 448kW 듀얼 모터 4WD를 적용하므로 기존 77.4kWh EV6 GT 및 일반 GT-Line과 별도 영구코드로 분리한다.', DATA_AS_OF,
]];

const KIA_PV5_PASSENGER_PRICE_URL = 'https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_pv5-passenger.pdf';
const KIA_PV5_PASSENGER_PLUS_ID = 'mf-002.md-073.sm-pv5-passenger-plus-2025__pv5-passenger-plus';
const kiaPv5PassengerPlusRows = [[
  '검증중', '교차확인', '신차', '국산', '기아', 'PV5', 'PV5 패신저', '전기 71.2kWh 2WD 5인승', '플러스 2-3-0',
  `${KIA_PV5_PASSENGER_PLUS_ID}::v01::t01`, KIA_PV5_PASSENGER_PLUS_ID, 1, 1, '1세대', 'SW', '2025-07', '현재', '2025', '현재', '전기', '', '', '아니오', '2WD', 5, 71.2,
  '기아 PV5 패신저 플러스,Kia PV5 Passenger Plus,PV5 5인승 플러스,2-3-0,71.2kWh', KIA_PV5_PASSENGER_PRICE_URL,
  '기아 국내 공식 PV5 패신저 가격표 기준. 71.2kWh 2WD 5인승 2-3-0 시트 배열의 플러스 트림을 기존 베이직과 별도 영구코드로 분리한다.', DATA_AS_OF,
]];

const HYUNDAI_2026_SANTA_FE_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/santafe-2026-price.pdf';
const HYUNDAI_2026_SANTA_FE_HEV_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/santafe-hev-2026-price.pdf';
const HYUNDAI_SANTA_FE_TM_2021_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog_en/santafe-price.pdf';
const HYUNDAI_SANTA_FE_TM_2021_PRODUCT_ID = 'mf-001.md-017.sm-tm-pe-2021-product__santafe-2021';
const hyundaiSantaFeTm2021ProductRows = [
  ['가솔린 2.5T 2WD', '프리미엄 초이스', 2497, 2.5, 1],
  ['디젤 2.2 2WD', '프리미엄', 2151, 2.2, 2],
].map(([powertrain, trim, cc, liters, seq]) => [
  '확정', '확정', '중고차', '국산', '현대', '싼타페', '2021 싼타페 TM 부분변경', powertrain, trim,
  `${HYUNDAI_SANTA_FE_TM_2021_PRODUCT_ID}::v${String(seq).padStart(2, '0')}::t01`,
  HYUNDAI_SANTA_FE_TM_2021_PRODUCT_ID, seq, 1, '4세대 부분변경', 'TM', '2020-07', '2023-07', '2021', '2023',
  String(powertrain).startsWith('가솔린') ? '가솔린' : '디젤', cc, liters, '예', '2WD', 5, '',
  `현대 싼타페 TM 부분변경,Hyundai Santa Fe TM,2021 싼타페,${powertrain},5인승,${trim}`,
  HYUNDAI_SANTA_FE_TM_2021_PRICE_URL,
  '현대자동차 2021 싼타페 국내 가격표 기준. 가솔린 2.5 터보와 디젤 2.2를 엔진 선택으로 제공하며 5인승이 기본이고 7인승은 선택 품목이다. Premium 및 Premium Choice 공식 판매 트림을 상품 원문에 필요한 조합만 별도 영구키로 보강한다.',
  DATA_AS_OF,
]);
const GENESIS_G90_HI_50_5SEAT_ID = 'mf-007.md-004.sm-hi-2018-50-5seat__g90-product';
const GENESIS_G90_HI_CATALOG_URL = 'https://www.genesis.com/content/dam/genesis-p2/kr/assets/models/GENESIS-G90_KOR_test.pdf';
const genesisG90Hi50FiveSeatRows = [[
  '확정', '확정', '중고차', '국산', '제네시스', 'G90', 'G90 1세대 부분변경 HI', '가솔린 5.0 AWD 5인승', '프레스티지',
  `${GENESIS_G90_HI_50_5SEAT_ID}::v01::t01`, GENESIS_G90_HI_50_5SEAT_ID, 1, 1, '1세대 부분변경', 'HI',
  '2018-11', '2021-11', '2019', '2021', '가솔린', 5038, 5.0, '아니오', 'AWD', 5, '',
  '제네시스 G90 5.0 프레스티지,Genesis G90 5.0 Prestige,G90 HI,타우 V8 5.0,AWD,5인승,세단',
  GENESIS_G90_HI_CATALOG_URL,
  '제네시스 공식 G90 출시자료와 국내 카탈로그 기준. 2018-11 출시한 일반 세단 5.0 프레스티지는 타우 V8 5,038cc와 AWD를 사용하며, 카탈로그에서 별도 G90 Limousine 섹션과 구분되는 일반 세단 5인승 상품 조합을 보강한다.',
  DATA_AS_OF,
]];
const HYUNDAI_TUCSON_NX4_2023_PRODUCT_ID = 'mf-001.md-032.sm-nx4-my2023-product__tucson';
const HYUNDAI_TUCSON_2023_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/tucson-price.pdf';
const hyundaiTucsonNx4_2023ProductRows = [[
  '확정', '확정', '중고차', '국산', '현대', '투싼', '2023 투싼 NX4', '디젤 2.0 4WD', '인스퍼레이션',
  `${HYUNDAI_TUCSON_NX4_2023_PRODUCT_ID}::v01::t01`, HYUNDAI_TUCSON_NX4_2023_PRODUCT_ID, 1, 1,
  '4세대 2023 연식', 'NX4', '2022-07', '2023-11', '2023', '2023', '디젤', 1998, 2.0, '예', '4WD', 5, '',
  '현대 투싼 NX4,Hyundai Tucson NX4,2023 투싼,디젤 2.0,HTRAC,4WD,인스퍼레이션', HYUNDAI_TUCSON_2023_PRICE_URL,
  '현대 공식 투싼 가격표(현 모델 출시일 2022-07-13) 기준. 인스퍼레이션에 스마트스트림 디젤 2.0과 HTRAC 선택이 가능함을 확인해 2023 연식 실상품의 5인승 조합을 보강한다.', DATA_AS_OF,
]];
const HYUNDAI_PALISADE_LX2_7SEAT_PRODUCT_ID = 'mf-001.md-058.sm-lx2-pe-7seat-product__palisade';
const HYUNDAI_PALISADE_2024_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/palisade-price.pdf';
const hyundaiPalisadeLx2SevenSeatProductRows = ['르블랑', '프레스티지'].map((trim, index) => [
  '확정', '확정', '중고차', '국산', '현대', '팰리세이드', '더 뉴 팰리세이드 LX2', '디젤 2.2 2WD 7인승', trim,
  `${HYUNDAI_PALISADE_LX2_7SEAT_PRODUCT_ID}::v01::t${String(index + 1).padStart(2, '0')}`,
  HYUNDAI_PALISADE_LX2_7SEAT_PRODUCT_ID, 1, index + 1, '1세대 부분변경', 'LX2', '2022-05', '2024-12', '2023', '2024',
  '디젤', 2199, 2.2, '예', '2WD', 7, '',
  `현대 더 뉴 팰리세이드,Hyundai Palisade LX2 Facelift,디젤 2.2,2WD,7인승,${trim}`,
  HYUNDAI_PALISADE_2024_PRICE_URL,
  '현대 공식 2024 팰리세이드 가격표 기준. 7인승이 기본이며 8인승 변경이 가능하고, 디젤 2.2 엔진은 공통 선택 품목이다. 기존 마스터에 누락된 디젤 2.2 2WD 7인승 르블랑·프레스티지 실상품 조합을 보강한다.', DATA_AS_OF,
]);
const KIA_SPORTAGE_NQ5_LPG_GRAVITY_ID = 'mf-002.md-025.sm-nq5-2022-lpg-gravity__sportage-product';
const KIA_SPORTAGE_2022_PRICE_URL = 'https://www.kia.com/content/dam/kwcms/kr/ko/files/RQL/price/price_sportageql.pdf';
const kiaSportageNq5LpgGravityRows = [[
  '확정', '확정', '중고차', '국산', '기아', '스포티지', '스포티지 NQ5 2022', 'LPG 2.0 2WD', '그래비티',
  `${KIA_SPORTAGE_NQ5_LPG_GRAVITY_ID}::v01::t01`, KIA_SPORTAGE_NQ5_LPG_GRAVITY_ID, 1, 1,
  '5세대', 'NQ5', '2022-07', '2023-06', '2023', '2023', 'LPG', 1999, 2.0, '아니오', '2WD', 5, '',
  '기아 스포티지 NQ5,2023 스포티지,2.0 LPG,2.0 LPi,LPG 2WD,그래비티,노블레스 그래비티',
  KIA_SPORTAGE_2022_PRICE_URL,
  '기아 공식 2022-07 스포티지 가격표와 2022-09 RV 통합 가격표 기준. 2.0 LPG 2WD는 1,999cc이며 그래비티는 노블레스 기본품목을 바탕으로 한 공식 판매 트림이다. 2023-07 The 2024 스포티지 출시 전 확인 구간으로 기간을 제한하고 공급사 표기 노블레스 그래비티를 제한 별칭으로 보존한다.', DATA_AS_OF,
]];
const KIA_SORENTO_MQ4_PE_DIESEL_GRAVITY_ID = 'mf-002.md-027.sm-mq4-pe-2024-diesel-gravity__sorento-product';
const KIA_SORENTO_2023_PRICE_URL = 'https://www.kia.com/content/dam/kwcms/kr/ko/files/JUM/price/price_sorento.pdf';
const kiaSorentoMq4PeDieselGravityRows = [[
  '확정', '확정', '중고차', '국산', '기아', '쏘렌토', '더 뉴 쏘렌토 MQ4 2024', '디젤 2.2 2WD', '그래비티',
  `${KIA_SORENTO_MQ4_PE_DIESEL_GRAVITY_ID}::v01::t01`, KIA_SORENTO_MQ4_PE_DIESEL_GRAVITY_ID, 1, 1,
  '4세대 부분변경', 'MQ4 PE', '2023-08', '2024-08', '2024', '2024', '디젤', 2151, 2.2, '예', '2WD', 7, '',
  '더 뉴 쏘렌토 MQ4,2024 쏘렌토,2.2 디젤,디젤 2WD,그래비티,시그니처 그래비티,7인승',
  KIA_SORENTO_2023_PRICE_URL,
  '기아 공식 쏘렌토 2023-11 가격표 기준. 그래비티는 시그니처 기본품목 기반 공식 트림이며 7인승 선택, 디젤 2.2 2WD 2,151cc 제원을 확인했다. 2024-09-02 The 2025 쏘렌토 출시 전 확인 구간으로 제한한다.', DATA_AS_OF,
]];
const HYUNDAI_2026_TUCSON_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/tucson-2026-price.pdf';
const HYUNDAI_2026_TUCSON_HEV_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/tucson-hybrid-2026-price.pdf';
const HYUNDAI_2026_SONATA_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/sonata-the-edge2026-price.pdf';
const HYUNDAI_2026_SANTA_FE_HPICK_ID = 'mf-001.md-017.sm-mx5-hpick-2026__santafe-h-pick';
const HYUNDAI_2026_SANTA_FE_BLACK_INK_ID = 'mf-001.md-017.sm-mx5-black-ink-2026__santafe-black-ink';
const HYUNDAI_2026_TUCSON_HPICK_ID = 'mf-001.md-032.sm-nx4-hpick-2026__tucson-h-pick';
const HYUNDAI_2026_SONATA_S_ID = 'mf-001.md-018.sm-dn8-s-2026__sonata-the-edge-s';
const HYUNDAI_2026_SONATA_GAP_ID = 'mf-001.md-018.sm-dn8-my2026-gap__sonata-the-edge-2026';
const HYUNDAI_2026_SONATA_RENT_ID = 'mf-001.md-018.sm-dn8-my2026-rent__sonata-the-edge-rental';

const hyundai2026SantaFeHPickRows = ([
  { fuel: '가솔린', label: '가솔린 2.5T', cc: 2497, liters: 2.5, url: HYUNDAI_2026_SANTA_FE_PRICE_URL },
  { fuel: '하이브리드', label: '하이브리드 1.6T', cc: 1598, liters: 1.6, url: HYUNDAI_2026_SANTA_FE_HEV_PRICE_URL },
] as const).flatMap((engine, engineIndex) => (['2WD', '4WD'] as const).flatMap((drive, driveIndex) => ([5, 6, 7] as const).map((seats, seatIndex) => {
  const variantSeq = engineIndex * 6 + driveIndex * 3 + seatIndex + 1;
  return [
    '검증중', '교차확인', '신차', '국산', '현대', '싼타페', '2026 싼타페 MX5 H-Pick', `${engine.label} ${drive} ${seats}인승`, `H-Pick ${seats}인승`,
    `${HYUNDAI_2026_SANTA_FE_HPICK_ID}::v${String(variantSeq).padStart(2, '0')}::t01`, HYUNDAI_2026_SANTA_FE_HPICK_ID, variantSeq, 1,
    '5세대 2026 연식변경', 'MX5', '2025-08', '현재', '2026', '현재', engine.fuel, engine.cc, engine.liters, '예', drive, seats, '',
    `현대 2026 싼타페 H-Pick,Hyundai Santa Fe H-Pick,MX5,${engine.label},${drive},${seats}인승`, engine.url,
    `현대 공식 2026 싼타페 가격표(현 모델 출시일 2025-08-07) 기준. H-Pick은 2026 연식변경 신규 트림이므로 차종 최초 출시 코드와 분리한다.`, DATA_AS_OF,
  ];
})));

const hyundai2026SantaFeBlackInkRows = ([
  { fuel: '가솔린', label: '가솔린 2.5T', cc: 2497, liters: 2.5, url: HYUNDAI_2026_SANTA_FE_PRICE_URL },
  { fuel: '하이브리드', label: '하이브리드 1.6T', cc: 1598, liters: 1.6, url: HYUNDAI_2026_SANTA_FE_HEV_PRICE_URL },
] as const).flatMap((engine, engineIndex) => (['2WD', '4WD'] as const).flatMap((drive, driveIndex) => ([5, 6, 7] as const).map((seats, seatIndex) => {
  const variantSeq = engineIndex * 6 + driveIndex * 3 + seatIndex + 1;
  return [
    '검증중', '교차확인', '신차', '국산', '현대', '싼타페', '2026 싼타페 MX5 Black Ink', `${engine.label} ${drive} ${seats}인승`, `Black Ink ${seats}인승`,
    `${HYUNDAI_2026_SANTA_FE_BLACK_INK_ID}::v${String(variantSeq).padStart(2, '0')}::t01`, HYUNDAI_2026_SANTA_FE_BLACK_INK_ID, variantSeq, 1,
    '5세대 2026 연식변경 Black Ink', 'MX5', '2025-08', '현재', '2026', '현재', engine.fuel, engine.cc, engine.liters, '예', drive, seats, '',
    `현대 2026 싼타페 Black Ink,현대 2026 싼타페 블랙 잉크,Hyundai Santa Fe Black Ink,MX5,${engine.label},${drive},${seats}인승`, engine.url,
    '현대 공식 2026 싼타페 가격표(현 모델 출시일 2025-08-07) 기준. Black Ink는 캘리그래피 기본 품목에 전용 휠·외장·내장 디자인을 더한 독립 판매 트림이며 2WD/HTRAC와 5·6·7인승을 제공한다. 국내 가격표에 없는 XRT와 혼동하지 않고 2026 연식변경 신규 영구코드로 분리한다.', DATA_AS_OF,
  ];
})));

const HYUNDAI_PALISADE_LX3_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/palisade-2025-price.pdf';
const HYUNDAI_PALISADE_LX3_ID = 'mf-001.md-058.sm-lx3';
const hyundaiPalisadeLx3MissingExclusiveRows = ([
  { seq: 9, fuel: '가솔린', powertrain: '가솔린 2.5T 2WD', drive: '2WD', seats: 7 },
  { seq: 10, fuel: '가솔린', powertrain: '가솔린 2.5T 4WD', drive: '4WD', seats: 7 },
  { seq: 11, fuel: '가솔린', powertrain: '가솔린 2.5T 4WD', drive: '4WD', seats: 9 },
  { seq: 12, fuel: '하이브리드', powertrain: '하이브리드 2.5T 4WD', drive: '4WD', seats: 9 },
] as const).map((variant) => [
  '검증중', '교차확인', '신차', '국산', '현대', '팰리세이드', '팰리세이드 LX3', variant.powertrain, '익스클루시브',
  `${HYUNDAI_PALISADE_LX3_ID}::v${String(variant.seq).padStart(2, '0')}::t01`, HYUNDAI_PALISADE_LX3_ID, variant.seq, 1,
  '2세대 완전변경', 'LX3', '2025-01', '현재', '2025', '현재', variant.fuel, 2497, 2.5, '예', variant.drive, variant.seats, '',
  `현대 디 올 뉴 팰리세이드,Hyundai The all-new PALISADE,LX3,${variant.powertrain},${variant.seats}인승,익스클루시브,Exclusive${variant.drive === '4WD' ? ',HTRAC' : ''}`,
  HYUNDAI_PALISADE_LX3_PRICE_URL,
  '현대 공식 디 올 뉴 팰리세이드 가격표(현 모델 출시일 2025-01-15) 기준. 가솔린 2.5T와 하이브리드 2.5T 모두 7·9인승 및 2WD·HTRAC를 제공하며 익스클루시브는 각 인승의 기본 트림이다. 기존 LX3 20개 영구키 의미는 보존하고 누락된 익스클루시브 조합만 같은 마스터의 새 파워트레인 순번으로 보강한다.', DATA_AS_OF,
]);

const HYUNDAI_NEW_STARIA_HEV_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/the-new-staria-hybrid_price.pdf';
const HYUNDAI_NEW_STARIA_TOURER_HEV_ID = 'mf-001.md-060.sm-us4-pe-tourer-hev-2026__the-new-staria-tourer-hybrid';
const HYUNDAI_NEW_STARIA_CARGO_HEV_ID = 'mf-001.md-060.sm-us4-pe-cargo-hev-2026__the-new-staria-cargo-hybrid';
const hyundaiNewStariaHybridRows = ([
  { masterId: HYUNDAI_NEW_STARIA_TOURER_HEV_ID, subModel: '더 뉴 스타리아 투어러 하이브리드', body: '투어러', seats: 11 },
  { masterId: HYUNDAI_NEW_STARIA_TOURER_HEV_ID, subModel: '더 뉴 스타리아 투어러 하이브리드', body: '투어러', seats: 9 },
  { masterId: HYUNDAI_NEW_STARIA_CARGO_HEV_ID, subModel: '더 뉴 스타리아 카고 하이브리드', body: '카고', seats: 2 },
  { masterId: HYUNDAI_NEW_STARIA_CARGO_HEV_ID, subModel: '더 뉴 스타리아 카고 하이브리드', body: '카고', seats: 5 },
] as const).flatMap((variant, variantIndex) => (['스마트', '모던'] as const).map((trim, trimIndex) => {
  const powertrainSeq = variant.masterId === HYUNDAI_NEW_STARIA_TOURER_HEV_ID ? variantIndex + 1 : variantIndex - 1;
  return [
    '검증중', '교차확인', '신차', '국산', '현대', '스타리아', variant.subModel, `하이브리드 1.6T 2WD ${variant.seats}인승`, trim,
    `${variant.masterId}::v${String(powertrainSeq).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`, variant.masterId, powertrainSeq, trimIndex + 1,
    `2세대 부분변경 ${variant.body}`, 'US4', '2025-12', '현재', '2026', '현재', '하이브리드', 1598, 1.6, '예', '2WD', variant.seats, '',
    `현대 더 뉴 스타리아 ${variant.body} 하이브리드,Hyundai The new STARIA ${variant.body} Hybrid,US4,1.6T HEV,${variant.seats}인승,${trim}`,
    HYUNDAI_NEW_STARIA_HEV_PRICE_URL,
    `현대 공식 더 뉴 스타리아 ${variant.body} 하이브리드 가격표(현 모델 출시일 2025-12-17) 기준. ${variant.body} ${variant.seats}인승의 스마트·모던 트림을 차체 용도와 인승별 영구코드로 분리한다. 기존 2025-03 시작 더 뉴 스타리아 코드는 출시시점·인승·트림이 현행 공식 자료와 충돌해 별도 차단 보존한다.`, DATA_AS_OF,
  ];
}));

const HYUNDAI_NEW_STARIA_LPG_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/the-new-staria_price.pdf';
const HYUNDAI_NEW_STARIA_TOURER_LPG_ID = 'mf-001.md-060.sm-us4-pe-tourer-lpg-2026__the-new-staria-tourer-lpg';
const HYUNDAI_NEW_STARIA_CARGO_LPG_ID = 'mf-001.md-060.sm-us4-pe-cargo-lpg-2026__the-new-staria-cargo-lpg';
const hyundaiNewStariaLpgRows = ([
  { masterId: HYUNDAI_NEW_STARIA_TOURER_LPG_ID, subModel: '더 뉴 스타리아 투어러 LPG', body: '투어러', seats: 11, seq: 1 },
  { masterId: HYUNDAI_NEW_STARIA_TOURER_LPG_ID, subModel: '더 뉴 스타리아 투어러 LPG', body: '투어러', seats: 9, seq: 2 },
  { masterId: HYUNDAI_NEW_STARIA_CARGO_LPG_ID, subModel: '더 뉴 스타리아 카고 LPG', body: '카고', seats: 3, seq: 1 },
  { masterId: HYUNDAI_NEW_STARIA_CARGO_LPG_ID, subModel: '더 뉴 스타리아 카고 LPG', body: '카고', seats: 5, seq: 2 },
] as const).flatMap((variant) => (['스마트', '모던'] as const).map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '국산', '현대', '스타리아', variant.subModel, `LPG 3.5 2WD ${variant.seats}인승`, trim,
  `${variant.masterId}::v${String(variant.seq).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`, variant.masterId, variant.seq, trimIndex + 1,
  `2세대 부분변경 ${variant.body}`, 'US4', '2025-12', '현재', '2026', '현재', 'LPG', 3470, 3.5, '아니오', '2WD', variant.seats, '',
  `현대 더 뉴 스타리아 ${variant.body} LPG,Hyundai The new STARIA ${variant.body} LPG,US4,LPG 3.5,${variant.seats}인승,${trim}`,
  HYUNDAI_NEW_STARIA_LPG_PRICE_URL,
  `현대 공식 더 뉴 스타리아 ${variant.body} 가격표(현 모델 출시일 2025-12-17) 기준. 스마트스트림 LPG 3.5 2WD ${variant.body} ${variant.seats}인승의 스마트·모던 트림을 차체 용도와 인승별 영구코드로 분리한다.`, DATA_AS_OF,
]));

const HYUNDAI_NEW_STARIA_EV_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/the-new-staria-electric_price.pdf';
const HYUNDAI_NEW_STARIA_LOUNGE_EV_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/the-new-staria-lounge-electric_price.pdf';
const HYUNDAI_NEW_STARIA_LIMOUSINE_EV_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/the-new-staria-limousine-electric_price.pdf';
const HYUNDAI_NEW_STARIA_TOURER_EV_ID = 'mf-001.md-060.sm-us4-pe-tourer-ev-2026__the-new-staria-tourer-electric';
const HYUNDAI_NEW_STARIA_CARGO_EV_ID = 'mf-001.md-060.sm-us4-pe-cargo-ev-2026__the-new-staria-cargo-electric';
const HYUNDAI_NEW_STARIA_LOUNGE_EV_ID = 'mf-001.md-060.sm-us4-pe-lounge-ev-2026__the-new-staria-lounge-electric';
const HYUNDAI_NEW_STARIA_LIMOUSINE_EV_ID = 'mf-001.md-060.sm-us4-pe-limousine-ev-2026__the-new-staria-limousine-electric';
const hyundaiNewStariaElectricRows = ([
  { masterId: HYUNDAI_NEW_STARIA_TOURER_EV_ID, subModel: '더 뉴 스타리아 투어러 일렉트릭', body: '투어러', seats: 11, seq: 1, trim: '모던', url: HYUNDAI_NEW_STARIA_EV_PRICE_URL },
  { masterId: HYUNDAI_NEW_STARIA_CARGO_EV_ID, subModel: '더 뉴 스타리아 카고 일렉트릭', body: '카고', seats: 3, seq: 1, trim: '모던', url: HYUNDAI_NEW_STARIA_EV_PRICE_URL },
  { masterId: HYUNDAI_NEW_STARIA_CARGO_EV_ID, subModel: '더 뉴 스타리아 카고 일렉트릭', body: '카고', seats: 5, seq: 2, trim: '모던', url: HYUNDAI_NEW_STARIA_EV_PRICE_URL },
  { masterId: HYUNDAI_NEW_STARIA_LOUNGE_EV_ID, subModel: '더 뉴 스타리아 라운지 일렉트릭', body: '라운지', seats: 11, seq: 1, trim: '프레스티지', url: HYUNDAI_NEW_STARIA_LOUNGE_EV_PRICE_URL },
  { masterId: HYUNDAI_NEW_STARIA_LOUNGE_EV_ID, subModel: '더 뉴 스타리아 라운지 일렉트릭', body: '라운지', seats: 7, seq: 2, trim: '프레스티지', url: HYUNDAI_NEW_STARIA_LOUNGE_EV_PRICE_URL },
  { masterId: HYUNDAI_NEW_STARIA_LOUNGE_EV_ID, subModel: '더 뉴 스타리아 라운지 일렉트릭', body: '라운지', seats: 7, seq: 2, trim: '인스퍼레이션', url: HYUNDAI_NEW_STARIA_LOUNGE_EV_PRICE_URL },
  { masterId: HYUNDAI_NEW_STARIA_LIMOUSINE_EV_ID, subModel: '더 뉴 스타리아 리무진 일렉트릭', body: '리무진', seats: 6, seq: 1, trim: '인스퍼레이션', url: HYUNDAI_NEW_STARIA_LIMOUSINE_EV_PRICE_URL },
] as const).map((variant, index, variants) => {
  const trimSeq = variants.slice(0, index + 1).filter((row) => row.masterId === variant.masterId && row.seq === variant.seq).length;
  return [
    '검증중', '교차확인', '신차', '국산', '현대', '스타리아', variant.subModel, `EV 84.0kWh 2WD ${variant.seats}인승`, variant.trim,
    `${variant.masterId}::v${String(variant.seq).padStart(2, '0')}::t${String(trimSeq).padStart(2, '0')}`, variant.masterId, variant.seq, trimSeq,
    `2세대 부분변경 ${variant.body} 전기형`, 'US4', '2026-04', '현재', '2026', '현재', '전기', '', '', '아니오', '2WD', variant.seats, 84,
    `현대 더 뉴 스타리아 ${variant.body} 일렉트릭,Hyundai The new STARIA ${variant.body} Electric,US4,EV,84kWh,160kW,${variant.seats}인승,${variant.trim}`,
    variant.url,
    `현대 공식 더 뉴 스타리아 ${variant.body} 일렉트릭 가격표(현 모델 출시일 2026-04-23) 기준. 84.0kWh 리튬 이온 배터리와 160kW 모터를 사용하는 ${variant.body} ${variant.seats}인승 ${variant.trim} 트림을 차체 용도·인승·트림별 영구코드로 분리한다.`, DATA_AS_OF,
  ];
});

const HYUNDAI_NEW_STARIA_LOUNGE_LPG_URL = 'https://www.hyundai.com/kr/ko/e/vehicles/the-new-staria-lounge/price';
const HYUNDAI_NEW_STARIA_LOUNGE_HEV_URL = 'https://www.hyundai.com/kr/ko/e/vehicles/the-new-staria-lounge-hybrid/price';
const HYUNDAI_NEW_STARIA_LIMOUSINE_HEV_URL = 'https://www.hyundai.com/contents/repn-car/catalog/the-new-staria-limousine-hybrid_price.pdf';
const HYUNDAI_NEW_STARIA_LOUNGE_LPG_ID = 'mf-001.md-060.sm-us4-pe-lounge-lpg-2026__the-new-staria-lounge-lpg';
const HYUNDAI_NEW_STARIA_LOUNGE_HEV_ID = 'mf-001.md-060.sm-us4-pe-lounge-hev-2026__the-new-staria-lounge-hybrid';
const HYUNDAI_NEW_STARIA_LIMOUSINE_HEV_ID = 'mf-001.md-060.sm-us4-pe-limousine-hev-2026__the-new-staria-limousine-hybrid';
const hyundaiNewStariaLoungeLimousineRows = ([
  { masterId: HYUNDAI_NEW_STARIA_LOUNGE_LPG_ID, subModel: '더 뉴 스타리아 라운지 LPG', body: '라운지', seats: 9, seq: 1, trim: '프레스티지', fuel: 'LPG', cc: 3470, liters: 3.5, turbo: '아니오', start: '2025-12', url: HYUNDAI_NEW_STARIA_LOUNGE_LPG_URL, valid: false },
  { masterId: HYUNDAI_NEW_STARIA_LOUNGE_LPG_ID, subModel: '더 뉴 스타리아 라운지 LPG', body: '라운지', seats: 9, seq: 1, trim: '인스퍼레이션', fuel: 'LPG', cc: 3470, liters: 3.5, turbo: '아니오', start: '2025-12', url: HYUNDAI_NEW_STARIA_LOUNGE_LPG_URL, valid: false },
  { masterId: HYUNDAI_NEW_STARIA_LOUNGE_LPG_ID, subModel: '더 뉴 스타리아 라운지 LPG', body: '라운지', seats: 7, seq: 2, trim: '인스퍼레이션', fuel: 'LPG', cc: 3470, liters: 3.5, turbo: '아니오', start: '2025-12', url: HYUNDAI_NEW_STARIA_LOUNGE_LPG_URL, valid: true },
  { masterId: HYUNDAI_NEW_STARIA_LOUNGE_HEV_ID, subModel: '더 뉴 스타리아 라운지 하이브리드', body: '라운지', seats: 9, seq: 1, trim: '프레스티지', fuel: '하이브리드', cc: 1598, liters: 1.6, turbo: '예', start: '2025-12', url: HYUNDAI_NEW_STARIA_LOUNGE_HEV_URL, valid: true },
  { masterId: HYUNDAI_NEW_STARIA_LOUNGE_HEV_ID, subModel: '더 뉴 스타리아 라운지 하이브리드', body: '라운지', seats: 9, seq: 1, trim: '인스퍼레이션', fuel: '하이브리드', cc: 1598, liters: 1.6, turbo: '예', start: '2025-12', url: HYUNDAI_NEW_STARIA_LOUNGE_HEV_URL, valid: true },
  { masterId: HYUNDAI_NEW_STARIA_LOUNGE_HEV_ID, subModel: '더 뉴 스타리아 라운지 하이브리드', body: '라운지', seats: 7, seq: 2, trim: '인스퍼레이션', fuel: '하이브리드', cc: 1598, liters: 1.6, turbo: '예', start: '2025-12', url: HYUNDAI_NEW_STARIA_LOUNGE_HEV_URL, valid: true },
  { masterId: HYUNDAI_NEW_STARIA_LIMOUSINE_HEV_ID, subModel: '더 뉴 스타리아 리무진 하이브리드', body: '리무진', seats: 9, seq: 1, trim: '인스퍼레이션', fuel: '하이브리드', cc: 1598, liters: 1.6, turbo: '예', start: '2026-04', url: HYUNDAI_NEW_STARIA_LIMOUSINE_HEV_URL, valid: true },
  { masterId: HYUNDAI_NEW_STARIA_LIMOUSINE_HEV_ID, subModel: '더 뉴 스타리아 리무진 하이브리드', body: '리무진', seats: 6, seq: 2, trim: '인스퍼레이션', fuel: '하이브리드', cc: 1598, liters: 1.6, turbo: '예', start: '2026-04', url: HYUNDAI_NEW_STARIA_LIMOUSINE_HEV_URL, valid: true },
] as const).map((variant, index, variants) => {
  const trimSeq = variants.slice(0, index + 1).filter((row) => row.masterId === variant.masterId && row.seq === variant.seq).length;
  const powertrain = variant.fuel === 'LPG' ? `LPG 3.5 2WD ${variant.seats}인승` : `하이브리드 1.6T 2WD ${variant.seats}인승`;
  const launch = variant.body === '리무진' ? '2026-04-23' : '2025-12-17';
  return [
    variant.valid ? '검증중' : '제외', variant.valid ? '교차확인' : '1차확인', '신차', '국산', '현대', '스타리아', variant.subModel, powertrain, variant.trim,
    `${variant.masterId}::v${String(variant.seq).padStart(2, '0')}::t${String(trimSeq).padStart(2, '0')}`, variant.masterId, variant.seq, trimSeq,
    `2세대 부분변경 ${variant.body}`, 'US4', variant.start, '현재', '2026', '현재', variant.fuel, variant.cc, variant.liters, variant.turbo, '2WD', variant.seats, '',
    `현대 더 뉴 스타리아 ${variant.body} ${variant.fuel},Hyundai The new STARIA ${variant.body} ${variant.fuel === 'LPG' ? 'LPG' : 'Hybrid'},US4,${variant.seats}인승,${variant.trim}`,
    variant.url,
    variant.valid
      ? `현대 공식 더 뉴 스타리아 ${variant.body} ${variant.fuel} 가격표·현행 가격 페이지 기준. 현 모델 출시일 ${launch}, ${powertrain} ${variant.trim} 트림을 차체·인승·동력계별 영구코드로 분리한다.`
      : '현대 공식 2026-04-23 더 뉴 스타리아 전체 라인업 자료는 라운지 LPI를 7인승만 운영한다고 명시한다. 9인승 라운지는 하이브리드이며 LPG 9인승 신규 발급은 잘못된 조합이므로 영구키를 삭제·재사용하지 않고 자동매칭을 차단한다.', DATA_AS_OF,
  ];
});

const HYUNDAI_2024_STARIA_HEV_URL = 'https://www.hyundai.com/contents/repn-car/catalog/staria-hybrid-24-price.pdf';
const HYUNDAI_2024_STARIA_LOUNGE_HEV_URL = 'https://www.hyundai.com/contents/repn-car/catalog/staria-lounge-hybrid-24-price.pdf';
const HYUNDAI_2024_STARIA_TOURER_HEV_ID = 'mf-001.md-060.sm-us4-tourer-hev-2024__staria-tourer-hybrid';
const HYUNDAI_2024_STARIA_CARGO_HEV_ID = 'mf-001.md-060.sm-us4-cargo-hev-2024__staria-cargo-hybrid';
const HYUNDAI_2024_STARIA_LOUNGE_HEV_ID = 'mf-001.md-060.sm-us4-lounge-hev-2024__staria-lounge-hybrid';
const HYUNDAI_2025_STARIA_LIMOUSINE_HEV_ID = 'mf-001.md-060.sm-us4-limousine-hev-2025__staria-limousine-hybrid';
const hyundai2024StariaHybridRows = ([
  { masterId: HYUNDAI_2024_STARIA_TOURER_HEV_ID, subModel: '2024 스타리아 투어러 하이브리드', body: '투어러', seats: 11, seq: 1, trim: '모던', start: '2024-03', end: '2025-11', myStart: '2024', myEnd: '2025', url: HYUNDAI_2024_STARIA_HEV_URL },
  { masterId: HYUNDAI_2024_STARIA_TOURER_HEV_ID, subModel: '2024 스타리아 투어러 하이브리드', body: '투어러', seats: 9, seq: 2, trim: '모던', start: '2024-03', end: '2025-11', myStart: '2024', myEnd: '2025', url: HYUNDAI_2024_STARIA_HEV_URL },
  { masterId: HYUNDAI_2024_STARIA_CARGO_HEV_ID, subModel: '2024 스타리아 카고 하이브리드', body: '카고', seats: 3, seq: 1, trim: '모던', start: '2024-03', end: '2025-11', myStart: '2024', myEnd: '2025', url: HYUNDAI_2024_STARIA_HEV_URL },
  { masterId: HYUNDAI_2024_STARIA_CARGO_HEV_ID, subModel: '2024 스타리아 카고 하이브리드', body: '카고', seats: 5, seq: 2, trim: '모던', start: '2024-03', end: '2025-11', myStart: '2024', myEnd: '2025', url: HYUNDAI_2024_STARIA_HEV_URL },
  { masterId: HYUNDAI_2024_STARIA_LOUNGE_HEV_ID, subModel: '2024 스타리아 라운지 하이브리드', body: '라운지', seats: 9, seq: 1, trim: '프레스티지', start: '2024-03', end: '2025-11', myStart: '2024', myEnd: '2025', url: HYUNDAI_2024_STARIA_LOUNGE_HEV_URL },
  { masterId: HYUNDAI_2024_STARIA_LOUNGE_HEV_ID, subModel: '2024 스타리아 라운지 하이브리드', body: '라운지', seats: 9, seq: 1, trim: '인스퍼레이션', start: '2024-03', end: '2025-11', myStart: '2024', myEnd: '2025', url: HYUNDAI_2024_STARIA_LOUNGE_HEV_URL },
  { masterId: HYUNDAI_2024_STARIA_LOUNGE_HEV_ID, subModel: '2024 스타리아 라운지 하이브리드', body: '라운지', seats: 7, seq: 2, trim: '인스퍼레이션', start: '2024-03', end: '2025-11', myStart: '2024', myEnd: '2025', url: HYUNDAI_2024_STARIA_LOUNGE_HEV_URL },
  { masterId: HYUNDAI_2025_STARIA_LIMOUSINE_HEV_ID, subModel: '2025 스타리아 리무진 하이브리드', body: '리무진', seats: 9, seq: 1, trim: '리무진', start: '2025-02', end: '2026-03', myStart: '2025', myEnd: '2026', url: HYUNDAI_2024_STARIA_LOUNGE_HEV_URL },
  { masterId: HYUNDAI_2025_STARIA_LIMOUSINE_HEV_ID, subModel: '2025 스타리아 리무진 하이브리드', body: '리무진', seats: 7, seq: 2, trim: '리무진', start: '2025-02', end: '2026-03', myStart: '2025', myEnd: '2026', url: HYUNDAI_2024_STARIA_LOUNGE_HEV_URL },
] as const).map((variant, index, variants) => {
  const trimSeq = variants.slice(0, index + 1).filter((row) => row.masterId === variant.masterId && row.seq === variant.seq).length;
  const launch = variant.body === '리무진' ? '2025-02-19' : '2024-03-05';
  return [
    '검증중', '교차확인', '중고차', '국산', '현대', '스타리아', variant.subModel, `하이브리드 1.6T 2WD ${variant.seats}인승`, variant.trim,
    `${variant.masterId}::v${String(variant.seq).padStart(2, '0')}::t${String(trimSeq).padStart(2, '0')}`, variant.masterId, variant.seq, trimSeq,
    `1세대 ${variant.body} 하이브리드`, 'US4', variant.start, variant.end, variant.myStart, variant.myEnd, '하이브리드', 1598, 1.6, '예', '2WD', variant.seats, '',
    `현대 스타리아 ${variant.body} 하이브리드,Hyundai STARIA ${variant.body} Hybrid,US4,1.6T HEV,${variant.seats}인승,${variant.trim}`,
    variant.url,
    `현대 공식 2024 스타리아 하이브리드 ${variant.body} 가격표 기준. 현 모델 출시일 ${launch}, 1.6 터보 하이브리드 2WD ${variant.seats}인승 ${variant.trim} 조합을 차체·인승별 영구코드로 복원한다. 더 뉴 스타리아 부분변경형과 생산기간을 분리한다.`, DATA_AS_OF,
  ];
});

const hyundai2026TucsonHPickRows = ([
  { label: '가솔린 1.6T 2WD', fuel: '가솔린', drive: '2WD', url: HYUNDAI_2026_TUCSON_PRICE_URL },
  { label: '하이브리드 1.6T 2WD', fuel: '하이브리드', drive: '2WD', url: HYUNDAI_2026_TUCSON_HEV_PRICE_URL },
  { label: '하이브리드 1.6T 4WD', fuel: '하이브리드', drive: '4WD', url: HYUNDAI_2026_TUCSON_HEV_PRICE_URL },
] as const).map((variant, index) => [
  '검증중', '교차확인', '신차', '국산', '현대', '투싼', '2026 투싼 NX4 H-Pick', variant.label, 'H-Pick',
  `${HYUNDAI_2026_TUCSON_HPICK_ID}::v${String(index + 1).padStart(2, '0')}::t01`, HYUNDAI_2026_TUCSON_HPICK_ID, index + 1, 1,
  '4세대 부분변경 2026 연식변경', 'NX4', '2025-08', '현재', '2026', '현재', variant.fuel, 1598, 1.6, '예', variant.drive, 5, '',
  `현대 2026 투싼 H-Pick,Hyundai Tucson H-Pick,NX4,${variant.label}`, variant.url,
  '현대 공식 2026 투싼 가격표(현 모델 출시일 2025-08-07) 기준. H-Pick은 2026 연식변경 신규 트림이므로 2023-12 부분변경 최초 출시 코드와 분리한다.', DATA_AS_OF,
]);

const hyundai2026SonataSRows = ([
  { label: '가솔린 2.0', fuel: '가솔린', cc: 1999, liters: 2, turbo: '아니오' },
  { label: '가솔린 1.6T', fuel: '가솔린', cc: 1598, liters: 1.6, turbo: '예' },
  { label: '하이브리드 2.0', fuel: '하이브리드', cc: 1999, liters: 2, turbo: '아니오' },
] as const).map((variant, index) => [
  '검증중', '교차확인', '신차', '국산', '현대', '쏘나타', '쏘나타 DN8 디 엣지', variant.label, 'S',
  `${HYUNDAI_2026_SONATA_S_ID}::v${String(index + 1).padStart(2, '0')}::t01`, HYUNDAI_2026_SONATA_S_ID, index + 1, 1,
  '8세대 부분변경 2026 연식변경', 'DN8', '2025-09', '현재', '2026', '현재', variant.fuel, variant.cc, variant.liters, variant.turbo, '2WD', 5, '',
  `현대 2026 쏘나타 디 엣지 S,Hyundai Sonata The Edge S,DN8,${variant.label}`, HYUNDAI_2026_SONATA_PRICE_URL,
  '현대 공식 2026 쏘나타 디 엣지 가격표와 공식 출시 자료 기준. S는 2026 연식변경에서 신설된 트림이므로 2023-05 부분변경 최초 출시 코드와 분리한다.', DATA_AS_OF,
]);

const hyundai2026SonataGapRows = ([
  { seq: 1, powertrain: '가솔린 2.0', trim: '인스퍼레이션', fuel: '가솔린' },
  { seq: 2, powertrain: 'LPG 2.0', trim: '프리미엄', fuel: 'LPG' },
] as const).map((variant) => [
  '검증중', '교차확인', '신차', '국산', '현대', '쏘나타', '쏘나타 DN8 디 엣지', variant.powertrain, variant.trim,
  `${HYUNDAI_2026_SONATA_GAP_ID}::v${String(variant.seq).padStart(2, '0')}::t01`, HYUNDAI_2026_SONATA_GAP_ID, variant.seq, 1,
  '8세대 부분변경 2026 연식변경', 'DN8', '2025-09', '현재', '2026', '현재', variant.fuel, 1999, 2, '아니오', '2WD', 5, '',
  `현대 2026 쏘나타 디 엣지,Hyundai Sonata The Edge,DN8,${variant.powertrain},${variant.trim}`, HYUNDAI_2026_SONATA_PRICE_URL,
  '현대 공식 2026 쏘나타 디 엣지 가격표(현 모델 출시일 2025-09-29) 기준. 기존 현행 마스터에서 빠진 가솔린 2.0 인스퍼레이션과 일반판매용 LPG 2.0 프리미엄을 공식 확인 시점의 별도 영구코드로 보강한다.', DATA_AS_OF,
]);

const hyundai2026SonataRentalRows = ['Business 1', 'Business 2'].map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '국산', '현대', '쏘나타', '쏘나타 DN8 디 엣지', 'LPG 2.0 렌터카', trim,
  `${HYUNDAI_2026_SONATA_RENT_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`, HYUNDAI_2026_SONATA_RENT_ID, 1, trimIndex + 1,
  '8세대 부분변경 2026 연식변경 렌터카', 'DN8', '2025-09', '현재', '2026', '현재', 'LPG', 1999, 2, '아니오', '2WD', 5, '',
  `현대 2026 쏘나타 디 엣지 렌터카,Hyundai Sonata The Edge Rental,DN8,LPG 2.0 렌터카,${trim},비즈니스 ${trimIndex + 1}`, HYUNDAI_2026_SONATA_PRICE_URL,
  '현대 공식 2026 쏘나타 디 엣지 가격표의 렌터카 전용 섹션(현 모델 출시일 2025-09-29) 기준. LPG 2.0 렌터카는 Business 1과 Business 2로 구성되며 일반판매용 LPG 트림과 별도 영구코드 계보로 분리한다.', DATA_AS_OF,
]);

const HYUNDAI_2025_KONA_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/kona-2025-price.pdf';
const HYUNDAI_2025_KONA_HEV_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/kona-hybrid-2025-price.pdf';
const HYUNDAI_2025_KONA_HPICK_ID = 'mf-001.md-055.sm-sx2-hpick-2025__kona-h-pick';
const HYUNDAI_2025_KONA_BLACK_ID = 'mf-001.md-055.sm-sx2-black-2025__kona-black-exterior';
const hyundai2025KonaHPickRows = ([
  { label: '가솔린 1.6T 2WD', fuel: '가솔린', cc: 1598, liters: 1.6, turbo: '예', url: HYUNDAI_2025_KONA_PRICE_URL },
  { label: '하이브리드 1.6 2WD', fuel: '하이브리드', cc: 1580, liters: 1.6, turbo: '아니오', url: HYUNDAI_2025_KONA_HEV_PRICE_URL },
] as const).map((variant, index) => [
  '검증중', '교차확인', '신차', '국산', '현대', '코나', '2025 코나 SX2 H-Pick', variant.label, 'H-Pick',
  `${HYUNDAI_2025_KONA_HPICK_ID}::v${String(index + 1).padStart(2, '0')}::t01`, HYUNDAI_2025_KONA_HPICK_ID, index + 1, 1,
  '2세대 2025 연식변경', 'SX2', '2025-04', '현재', '2025', '현재', variant.fuel, variant.cc, variant.liters, variant.turbo, '2WD', 5, '',
  `현대 2025 코나 H-Pick,Hyundai Kona H-Pick,SX2,${variant.label}`, variant.url,
  '현대 공식 2025 코나 가격표(현 모델 출시일 2025-04-23) 기준. 2024 공식 가격표에는 없던 H-Pick이 2025 연식변경에서 추가됐으므로 차종 최초 출시 코드와 분리한다.', DATA_AS_OF,
]);

const hyundai2025KonaBlackRows = ([
  { label: '가솔린 1.6T 2WD', fuel: '가솔린', cc: 1598, liters: 1.6, turbo: '예', drive: '2WD', url: HYUNDAI_2025_KONA_PRICE_URL },
  { label: '가솔린 1.6T 4WD', fuel: '가솔린', cc: 1598, liters: 1.6, turbo: '예', drive: '4WD', url: HYUNDAI_2025_KONA_PRICE_URL },
  { label: '가솔린 2.0 2WD', fuel: '가솔린', cc: 1999, liters: 2, turbo: '아니오', drive: '2WD', url: HYUNDAI_2025_KONA_PRICE_URL },
  { label: '하이브리드 1.6 2WD', fuel: '하이브리드', cc: 1580, liters: 1.6, turbo: '아니오', drive: '2WD', url: HYUNDAI_2025_KONA_HEV_PRICE_URL },
] as const).map((variant, index) => [
  '검증중', '교차확인', '신차', '국산', '현대', '코나', '2025 코나 SX2 Black Exterior', variant.label, 'Black Exterior',
  `${HYUNDAI_2025_KONA_BLACK_ID}::v${String(index + 1).padStart(2, '0')}::t01`, HYUNDAI_2025_KONA_BLACK_ID, index + 1, 1,
  '2세대 2025 연식변경', 'SX2', '2025-04', '현재', '2025', '현재', variant.fuel, variant.cc, variant.liters, variant.turbo, variant.drive, 5, '',
  `현대 2025 코나 Black Exterior,코나 블랙 익스테리어,Hyundai Kona Black Exterior,SX2,${variant.label}`, variant.url,
  '현대 공식 2025 코나 가격표(현 모델 출시일 2025-04-23)의 별도 가격 행 기준. 인스퍼레이션 기본 품목에 블랙 전용 외장을 적용한 구성이므로 일반 인스퍼레이션과 별도 영구코드로 분리한다.', DATA_AS_OF,
]);

const HYUNDAI_2027_KONA_PRICE_URL = 'https://www.hyundai.com/content/dam/hyundai/kr/ko/data/vehicles/price/en/kona-price-en.pdf';
const HYUNDAI_2027_KONA_HEV_PRICE_URL = 'https://www.hyundai.com/content/dam/hyundai/kr/ko/data/vehicles/price/en/kona-hybrid-price-en.pdf';
const HYUNDAI_2027_KONA_ID = 'mf-001.md-055.sm-sx2-my2027__kona-2027';
const HYUNDAI_2027_KONA_NOTE = '현대자동차 공식 2027 KONA 가격표의 모델 출시일 2026-04-07 기준. 가솔린 1.6 터보는 8단 자동변속기와 2WD·HTRAC 조합, 가솔린 2.0은 IVT 2WD, 하이브리드 1.6은 2WD로 운영된다. 2027 연식의 재편된 트림을 이전 SX2 계보와 분리하며 코나 Electric 계보에는 적용하지 않는다.';
const hyundai2027KonaRows = ([
  ...(['Modern', 'H-Pick', 'Premium', 'Inspiration', 'Black Exterior', 'N Line'] as const).map((trim, index) => ({ seq: 1, trimSeq: index + 1, powertrain: '가솔린 1.6T 2WD', trim, fuel: '가솔린', cc: 1598, liters: 1.6, turbo: '예', drive: '2WD', url: HYUNDAI_2027_KONA_PRICE_URL })),
  ...(['Premium', 'Inspiration', 'Black Exterior', 'N Line'] as const).map((trim, index) => ({ seq: 2, trimSeq: index + 1, powertrain: '가솔린 1.6T 4WD', trim, fuel: '가솔린', cc: 1598, liters: 1.6, turbo: '예', drive: '4WD', url: HYUNDAI_2027_KONA_PRICE_URL })),
  ...(['Modern', 'H-Pick'] as const).map((trim, index) => ({ seq: 3, trimSeq: index + 1, powertrain: '가솔린 2.0 2WD', trim, fuel: '가솔린', cc: 1999, liters: 2, turbo: '아니오', drive: '2WD', url: HYUNDAI_2027_KONA_PRICE_URL })),
  ...(['Modern', 'H-Pick', 'Premium', 'Inspiration', 'Black Exterior', 'N Line'] as const).map((trim, index) => ({ seq: 4, trimSeq: index + 1, powertrain: '하이브리드 1.6 2WD', trim, fuel: '하이브리드', cc: 1580, liters: 1.6, turbo: '아니오', drive: '2WD', url: HYUNDAI_2027_KONA_HEV_PRICE_URL })),
]).map((variant) => [
  '검증중', '교차확인', '신차', '국산', '현대', '코나', '2027 코나 SX2', variant.powertrain, variant.trim,
  `${HYUNDAI_2027_KONA_ID}::v${String(variant.seq).padStart(2, '0')}::t${String(variant.trimSeq).padStart(2, '0')}`, HYUNDAI_2027_KONA_ID, variant.seq, variant.trimSeq,
  '2세대 2027 연식변경', 'SX2', '2026-04', '현재', '2027', '현재', variant.fuel, variant.cc, variant.liters, variant.turbo, variant.drive, 5, '',
  `현대 2027 코나,Hyundai 2027 KONA,Hyundai Kona,SX2,${variant.powertrain},${variant.trim}`, variant.url, HYUNDAI_2027_KONA_NOTE, DATA_AS_OF,
]);

const HYUNDAI_2026_AVANTE_HEV_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/avante-hybrid-2026-price.pdf';
const HYUNDAI_2026_AVANTE_PRICE_URL = 'https://www.hyundai.com/contents/repn-car/catalog/avante-2026-price.pdf';
const HYUNDAI_2026_AVANTE_HEV_ID = 'mf-001.md-019.sm-cn7-hev-2026__avante-hybrid-2026';
const HYUNDAI_2026_AVANTE_LPI_ID = 'mf-001.md-019.sm-cn7-lpi-2026__avante-lpi-2026';
const HYUNDAI_2026_AVANTE_RENT_ID = 'mf-001.md-019.sm-cn7-lpi-rent-2026__avante-lpi-rental-2026';
const hyundai2026AvanteHevRows = ([
  { trim: '모던 라이트', aliases: '현대 2026 아반떼 하이브리드 모던 라이트,Avante Hybrid Modern Lite,Modern Light,모던라이트' },
  { trim: 'N Line', aliases: '현대 2026 아반떼 하이브리드 N Line,Avante Hybrid N Line,아반떼 HEV N라인,N라인' },
] as const).map((variant, index) => [
  '검증중', '교차확인', '신차', '국산', '현대', '아반떼', '2026 아반떼 하이브리드 CN7', '하이브리드 1.6 2WD', variant.trim,
  `${HYUNDAI_2026_AVANTE_HEV_ID}::v01::t${String(index + 1).padStart(2, '0')}`, HYUNDAI_2026_AVANTE_HEV_ID, 1, index + 1,
  '7세대 부분변경 2026 연식변경', 'CN7', '2025-04', '현재', '2026', '현재', '하이브리드', 1580, 1.6, '아니오', '2WD', 5, '',
  variant.aliases, HYUNDAI_2026_AVANTE_HEV_PRICE_URL,
  `현대 공식 2026 아반떼 출시 자료(2025-04-15)와 하이브리드 가격표 기준. ${variant.trim}은 2026 연식변경 현행 트림으로 기존 연식 트림과 별도 영구코드로 분리한다.`, DATA_AS_OF,
]);

const hyundai2026AvanteLpiGapRows = ['모던', '인스퍼레이션'].map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '국산', '현대', '아반떼', '2026 아반떼 LPi CN7', 'LPG 1.6', trim,
  `${HYUNDAI_2026_AVANTE_LPI_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`, HYUNDAI_2026_AVANTE_LPI_ID, 1, trimIndex + 1,
  '7세대 부분변경 2026 연식변경', 'CN7', '2025-04', '현재', '2026', '현재', 'LPG', 1591, 1.6, '아니오', '2WD', 5, '',
  `현대 2026 아반떼 LPi,Hyundai Avante LPi,CN7,LPG 1.6,LPi 1.6,${trim}`, HYUNDAI_2026_AVANTE_PRICE_URL,
  '현대 공식 2026 아반떼 가격표(현 모델 출시일 2025-04-15) 기준. 일반판매용 LPi는 스마트·모던·인스퍼레이션으로 구성되며 기존 현행 마스터에서 빠진 모던과 인스퍼레이션을 공식 확인 시점의 별도 영구코드로 보강한다.', DATA_AS_OF,
]);

const hyundai2026AvanteRentalRows = ['스마트', '모던'].map((trim, trimIndex) => [
  '검증중', '교차확인', '신차', '국산', '현대', '아반떼', '2026 아반떼 LPi 렌터카 CN7', 'LPG 1.6 렌터카', trim,
  `${HYUNDAI_2026_AVANTE_RENT_ID}::v01::t${String(trimIndex + 1).padStart(2, '0')}`, HYUNDAI_2026_AVANTE_RENT_ID, 1, trimIndex + 1,
  '7세대 부분변경 2026 연식변경 렌터카', 'CN7', '2025-04', '현재', '2026', '현재', 'LPG', 1591, 1.6, '아니오', '2WD', 5, '',
  `현대 2026 아반떼 LPi 렌터카,Hyundai Avante LPi Rental,CN7,LPG 1.6 렌터카,LPi 렌터카,${trim}`, HYUNDAI_2026_AVANTE_PRICE_URL,
  '현대 공식 2026 아반떼 가격표의 렌터카 전용 섹션(현 모델 출시일 2025-04-15) 기준. LPi 렌터카는 스마트·모던으로 구성되며 일반판매용 LPi와 별도 영구코드 계보로 분리한다.', DATA_AS_OF,
]);

const E2008_SUPERSEDED_KEYS = new Set([
  'mf-021.md-024.sm-e-2008-2세대::v01::t01',
  'mf-021.md-024.sm-e-2008-2세대::v01::t02',
]);
const CASPER_ELECTRIC_FALSE_EARLY_KEYS = new Set([
  `${CASPER_ELECTRIC_ID}::v01::t01`,
  `${CASPER_ELECTRIC_ID}::v02::t02`,
  `${CASPER_ELECTRIC_ID}::v02::t03`,
]);
const HYUNDAI_CASPER_PRE_2027_MASTER_ID = 'mf-001.md-062.sm-ax1';
const TESLA_MODEL_Y_SUPERSEDED_KEYS = new Set([
  'mf-087.md-004.sm-모델-y::v01::t02',
  'mf-087.md-004.sm-모델-y::v02::t02',
  'mf-087.md-004.sm-모델-y::v04::t01',
]);
const TESLA_MODEL_Y_2023_RWD_KEY = 'mf-087.md-004.sm-모델-y::v02::t01';
const TESLA_MODEL_Y_UNBOUNDED_LONG_RANGE_KEY = 'mf-087.md-004.sm-모델-y::v01::t01';
const TESLA_MODEL_Y_FALSE_EARLY_LAUNCH_SERIES_KEY = 'mf-087.md-004.sm-모델-y::v01::t03';
const TESLA_MODEL_Y_UNPROVEN_STANDARD_RANGE_KEY = 'mf-087.md-004.sm-모델-y::v03::t01';
const TESLA_MODEL_Y_SUPERSEDED_2023_EVIDENCE_KEYS = new Set([
  'mf-087.md-004.sm-legacy-performance-2023__model-y-performance::v01::t01',
  'mf-087.md-004.sm-legacy-long-range-2023__model-y-long-range::v01::t01',
]);
const TESLA_MODEL_Y_2023_RWD_URL = 'https://www.tesla.com/ko_kr/blog/tesla-model-y-rwd-launch-south-korea';
const TESLA_MODEL_3_SUPERSEDED_KEYS = new Set([
  'mf-087.md-003.sm-모델-3::v01::t01',
  'mf-087.md-003.sm-모델-3::v01::t02',
  'mf-087.md-003.sm-모델-3::v02::t01',
  'mf-087.md-003.sm-모델-3::v02::t04',
  'mf-087.md-003.sm-모델-3::v02::t02',
  'mf-087.md-003.sm-모델-3::v02::t03',
]);
const TESLA_MODEL_SX_SUPERSEDED_KEYS = new Set([
  'mf-087.md-001.sm-모델-s::v01::t01',
  'mf-087.md-001.sm-모델-s::v02::t01',
  'mf-087.md-001.sm-모델-s::v02::t02',
  'mf-087.md-001.sm-모델-s::v02::t03',
  'mf-087.md-001.sm-모델-s::v02::t04',
  'mf-087.md-001.sm-모델-s::v02::t05',
  'mf-087.md-001.sm-모델-s::v03::t01',
  'mf-087.md-002.sm-모델-x::v01::t01',
  'mf-087.md-002.sm-모델-x::v01::t02',
  'mf-087.md-002.sm-모델-x::v01::t03',
  'mf-087.md-002.sm-모델-x::v02::t01',
  'mf-087.md-002.sm-모델-x::v03::t01',
  'mf-087.md-002.sm-모델-x::v04::t01',
]);
const TESLA_CYBERTRUCK_SUPERSEDED_KEYS = new Set([
  'mf-087.md-005.sm-사이버트럭::v01::t01',
  'mf-087.md-005.sm-사이버트럭::v02::t01',
]);
const GENESIS_G80_PREFACELIFT_KEYS = new Set([
  'mf-007.md-002.sm-rg3__g80-rg3::v01::t01',
  'mf-007.md-002.sm-rg3__g80-rg3::v01::t02',
  'mf-007.md-002.sm-rg3__g80-rg3::v02::t01',
  'mf-007.md-002.sm-rg3__g80-rg3::v02::t02',
  'mf-007.md-002.sm-rg3__g80-rg3::v03::t01',
  'mf-007.md-002.sm-rg3__g80-rg3::v04::t01',
]);
const GENESIS_G80_DIESEL_UNSAFE_KEYS = new Set([
  'mf-007.md-002.sm-rg3__g80-rg3::v05::t01',
]);
const GENESIS_GV80_PREFACELIFT_KEYS = new Set([
  'mf-007.md-005.sm-jx1::v01::t01',
  'mf-007.md-005.sm-jx1::v02::t01',
  'mf-007.md-005.sm-jx1::v03::t01',
  'mf-007.md-005.sm-jx1::v04::t01',
  'mf-007.md-005.sm-jx1::v05::t01',
]);
const GENESIS_GV70_PREFACELIFT_GAS_KEYS = new Set([
  'mf-007.md-006.sm-jk1__gv70-jk1::v01::t01',
  'mf-007.md-006.sm-jk1__gv70-jk1::v02::t01',
  'mf-007.md-006.sm-jk1__gv70-jk1::v05::t01',
]);
const GENESIS_GV70_DIESEL_UNSAFE_KEYS = new Set([
  'mf-007.md-006.sm-jk1__gv70-jk1::v03::t01',
  'mf-007.md-006.sm-jk1__gv70-jk1::v04::t01',
]);
const GENESIS_G70_2020_PHASE_KEYS = new Set([
  'mf-007.md-003.sm-ik__new-g70-ik::v01::t01',
  'mf-007.md-003.sm-ik__new-g70-ik::v02::t01',
  'mf-007.md-003.sm-ik__new-g70-ik::v05::t01',
  'mf-007.md-003.sm-ik__new-g70-ik::v06::t01',
  'mf-007.md-003.sm-ik__new-g70-ik::v07::t01',
  'mf-007.md-003.sm-ik__new-g70-ik::v08::t01',
]);
const GENESIS_G70_FALSE_2020_25T_KEYS = new Set([
  'mf-007.md-003.sm-ik__new-g70-ik::v03::t01',
  'mf-007.md-003.sm-ik__new-g70-ik::v04::t01',
]);
const GENESIS_G70_SB_2022_20T_KEYS = new Set([
  'mf-007.md-003.sm-ik::v01::t01',
  'mf-007.md-003.sm-ik::v03::t01',
]);
const GENESIS_G70_SB_FALSE_2022_25T_KEYS = new Set([
  'mf-007.md-003.sm-ik::v02::t01',
  'mf-007.md-003.sm-ik::v04::t01',
]);
const GENESIS_G90_FALSE_2021_BLACK_KEYS = new Set([
  'mf-007.md-004.sm-rs4::v01::t01',
]);
const GENESIS_GV80_COUPE_FALSE_EARLY_BLACK_KEYS = new Set([
  'mf-007.md-005.sm-jx1c::v01::t02',
  'mf-007.md-005.sm-jx1c::v02::t02',
]);
const KIA_CARNIVAL_FALSE_EARLY_XLINE_KEYS = new Set([
  'mf-002.md-036.sm-ka4::v04::t03',
  'mf-002.md-036.sm-ka4::v05::t03',
  'mf-002.md-036.sm-ka4::v06::t04',
]);
const KIA_K5_FALSE_EARLY_BEST_SELECTION_KEYS = new Set([
  'mf-002.md-001.sm-dl3::v01::t01',
  'mf-002.md-001.sm-dl3::v02::t01',
  'mf-002.md-001.sm-dl3::v04::t01',
]);
const KIA_K5_PRE_2027_CURRENT_KEYS = new Set([
  'mf-002.md-001.sm-dl3::v01::t02',
  'mf-002.md-001.sm-dl3::v01::t03',
  'mf-002.md-001.sm-dl3::v01::t04',
  'mf-002.md-001.sm-dl3::v01::t05',
  'mf-002.md-001.sm-dl3::v02::t02',
  'mf-002.md-001.sm-dl3::v02::t03',
  'mf-002.md-001.sm-dl3::v02::t04',
  'mf-002.md-001.sm-dl3::v03::t01',
  'mf-002.md-001.sm-dl3::v03::t02',
  'mf-002.md-001.sm-dl3::v04::t02',
  'mf-002.md-001.sm-dl3::v04::t03',
  'mf-002.md-001.sm-dl3::v04::t04',
  'mf-002.md-001.sm-dl3-pe-best-selection-2026__k5-best-selection::v01::t01',
  'mf-002.md-001.sm-dl3-pe-best-selection-2026__k5-best-selection::v02::t01',
  'mf-002.md-001.sm-dl3-pe-best-selection-2026__k5-best-selection::v03::t01',
]);
const KIA_K8_FALSE_EARLY_BEST_SELECTION_KEYS = new Set([
  'mf-002.md-065.sm-gl3::v01::t03',
  'mf-002.md-065.sm-gl3::v05::t03',
]);
const KIA_EV_FALSE_EARLY_AWD_KEYS = new Set([
  'mf-002.md-ev3.sm-sv__ev3-sv::v03::t01',
  'mf-002.md-ev3.sm-sv__ev3-sv::v03::t02',
  'mf-002.md-ev3.sm-sv__ev3-sv::v03::t03',
  'mf-002.md-072.sm-ev4::v03::t01',
  'mf-002.md-072.sm-ev4::v03::t02',
  'mf-002.md-072.sm-ev4::v03::t03',
]);
const KIA_EV5_WRONG_START_KEYS = new Set([
  'mf-002.md-074.sm-ev5::v01::t01',
  'mf-002.md-074.sm-ev5::v01::t02',
  'mf-002.md-074.sm-ev5::v01::t03',
  'mf-002.md-074.sm-ev5::v02::t01',
  'mf-002.md-074.sm-ev5::v02::t02',
  'mf-002.md-074.sm-ev5::v02::t03',
  'mf-002.md-074.sm-ev5::v03::t01',
  'mf-002.md-074.sm-ev5::v03::t02',
  'mf-002.md-074.sm-ev5::v03::t03',
]);
const KIA_EV9_FALSE_EARLY_2026_KEYS = new Set([
  'mf-002.md-ev9.sm-mv1__ev9-mv1::v01::t01',
  'mf-002.md-ev9.sm-mv1__ev9-mv1::v01::t02',
  'mf-002.md-ev9.sm-mv1__ev9-mv1::v01::t03',
  'mf-002.md-ev9.sm-mv1__ev9-mv1::v01::t04',
  'mf-002.md-ev9.sm-mv1__ev9-mv1::v02::t01',
  'mf-002.md-ev9.sm-mv1__ev9-mv1::v02::t02',
  'mf-002.md-ev9.sm-mv1__ev9-mv1::v03::t01',
  'mf-002.md-ev9.sm-mv1__ev9-mv1::v03::t02',
]);
const KIA_PV5_CONCEPT_LAYOUT_KEYS = new Set([
  'mf-002.md-073.sm-pv5__passenger::v01::t02',
  'mf-002.md-073.sm-pv5__passenger::v01::t03',
]);
const HYUNDAI_FALSE_EARLY_2026_TRIM_KEYS = new Set([
  ...Array.from({ length: 12 }, (_, index) => `mf-001.md-017.sm-mx5::v${String(index + 1).padStart(2, '0')}::t03`),
  'mf-001.md-018.sm-dn8__쏘나타-디-엣지-하이브리드-dn8::v01::t01',
  'mf-001.md-018.sm-dn8::v01::t01',
  'mf-001.md-018.sm-dn8::v02::t01',
  'mf-001.md-032.sm-nx4::v01::t05',
  'mf-001.md-032.sm-nx4::v05::t06',
  'mf-001.md-032.sm-nx4::v06::t04',
]);
const HYUNDAI_SONATA_PRE_2026_COMBINED_BUSINESS_KEY = 'mf-001.md-018.sm-dn8::v03::t03';
const HYUNDAI_KONA_FALSE_EARLY_HPICK_KEYS = new Set([
  'mf-001.md-055.sm-sx2::v01::t03',
  'mf-001.md-055.sm-sx2::v05::t02',
]);
const HYUNDAI_KONA_PRE_2027_MASTER_IDS = new Set([
  HYUNDAI_2025_KONA_HPICK_ID,
  HYUNDAI_2025_KONA_BLACK_ID,
]);
const HYUNDAI_KONA_PRE_2027_VARIANTS = new Set(['v01', 'v02', 'v03', 'v05', 'v06']);
const HYUNDAI_AVANTE_RETIRED_NLINE_KEYS = new Set([
  'mf-001.md-019.sm-cn7::v02::t03',
  'mf-001.md-019.sm-cn7::v02::t05',
  'mf-001.md-019.sm-cn7::v04::t03',
  'mf-001.md-019.sm-cn7::v04::t05',
]);
const HYUNDAI_GRANDEUR_FALSE_GN7_CURRENT_KEYS = new Set(
  Array.from({ length: 5 }, (_, powertrainIndex) => {
    const trimCount = powertrainIndex === 3 ? 2 : 4;
    return Array.from({ length: trimCount }, (_, trimIndex) =>
      `mf-001.md-004.sm-gn7::v${String(powertrainIndex + 1).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`);
  }).flat(),
);
const KIA_SPORTAGE_MISNAMED_XLINE_KEYS = new Set([
  'mf-002.md-025.sm-nq5::v01::t04',
  'mf-002.md-025.sm-nq5::v02::t04',
  'mf-002.md-025.sm-nq5::v04::t03',
  'mf-002.md-025.sm-nq5::v05::t04',
]);
const HYUNDAI_STARIA_FALSE_CURRENT_KEYS = new Set(
  Array.from({ length: 9 }, (_, variantIndex) => {
    const trimCount = variantIndex === 3 || variantIndex === 7 ? 2 : 1;
    return Array.from({ length: trimCount }, (_, trimIndex) =>
      `mf-001.md-060.sm-us4::v${String(variantIndex + 1).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`);
  }).flat(),
);
const HYUNDAI_STARIA_LEGACY_AMBIGUOUS_KEYS = new Set([
  'mf-001.md-060.sm-us4__스타리아-us4::v05::t01',
  'mf-001.md-060.sm-us4__스타리아-us4::v05::t02',
  'mf-001.md-060.sm-us4__스타리아-us4::v09::t01',
  'mf-001.md-060.sm-us4__스타리아-us4::v11::t01',
  'mf-001.md-060.sm-us4__스타리아-us4::v12::t01',
]);
const HYUNDAI_STARIA_FALSE_CURRENT_LOUNGE_LPG_9_KEYS = new Set([
  `${HYUNDAI_NEW_STARIA_LOUNGE_LPG_ID}::v01::t01`,
  `${HYUNDAI_NEW_STARIA_LOUNGE_LPG_ID}::v01::t02`,
]);
const VOLVO_EX30_SUPERSEDED_KEYS = new Set([
  'mf-017.md-025.sm-ex30::v01::t01',
  'mf-017.md-025.sm-ex30-크로스-컨트리::v01::t01',
]);
const VOLVO_XC40_UNBOUNDED_KEYS = new Set(Array.from({ length: 7 }, (_, index) =>
  `mf-017.md-023.sm-xc40::v01::t${String(index + 1).padStart(2, '0')}`));
const VOLVO_XC90_UNBOUNDED_CURRENT_KEYS = new Set([
  'mf-017.md-010.sm-xc90-2세대::v01::t02',
  'mf-017.md-010.sm-xc90-2세대::v01::t03',
  'mf-017.md-010.sm-xc90-2세대::v03::t01',
  'mf-017.md-010.sm-xc90-2세대::v03::t02',
  'mf-017.md-010.sm-xc90-2세대::v03::t03',
  'mf-017.md-010.sm-xc90-2세대::v03::t04',
]);
const VOLVO_V60CC_UNBOUNDED_CURRENT_KEYS = new Set(Array.from({ length: 4 }, (_, index) =>
  `mf-017.md-017.sm-v60-크로스컨트리-2세대::v01::t${String(index + 1).padStart(2, '0')}`));
const VOLVO_V90CC_UNBOUNDED_CURRENT_KEYS = new Set(Array.from({ length: 4 }, (_, index) =>
  `mf-017.md-022.sm-v90-크로스컨트리::v02::t${String(index + 1).padStart(2, '0')}`));
const VOLVO_S60_MIXED_PERIOD_KEYS = new Set([
  ...Array.from({ length: 6 }, (_, index) => `mf-017.md-009.sm-s60-3세대::v01::t${String(index + 1).padStart(2, '0')}`),
  'mf-017.md-009.sm-s60-3세대::v02::t01',
]);
const VOLVO_C40_GLOBAL_START_KEY = 'mf-017.md-024.sm-c40-리차지::v01::t01';
const VOLVO_XC40_RECHARGE_GLOBAL_START_KEYS = new Set([
  'mf-017.md-023.sm-xc40-리차지::v01::t01',
  'mf-017.md-023.sm-xc40-리차지::v01::t02',
]);
const RENAULT_QM6_FALSE_CURRENT_KEYS = new Set([
  ...Array.from({ length: 5 }, (_, index) => `mf-005.md-011.sm-hzg::v01::t${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 5 }, (_, index) => `mf-005.md-011.sm-hzg::v02::t${String(index + 1).padStart(2, '0')}`),
]);
const RENAULT_SM6_FALSE_CURRENT_KEYS = new Set([
  ...Array.from({ length: 3 }, (_, index) => `mf-005.md-010.sm-lfd::v01::t${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 4 }, (_, index) => `mf-005.md-010.sm-lfd::v02::t${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 6 }, (_, index) => `mf-005.md-010.sm-lfd::v03::t${String(index + 1).padStart(2, '0')}`),
  'mf-005.md-010.sm-lfd::v04::t01',
]);
const KGM_KORANDO_C300_FALSE_CURRENT_KEYS = new Set([
  ...Array.from({ length: 3 }, (_, index) => `mf-004.md-011.sm-c300::v01::t${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 6 }, (_, index) => `mf-004.md-011.sm-c300::v02::t${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 6 }, (_, index) => `mf-004.md-011.sm-c300::v03::t${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 3 }, (_, index) => `mf-004.md-011.sm-c300::v04::t${String(index + 1).padStart(2, '0')}`),
]);
const KGM_KORANDO_EMOTION_UNBOUNDED_KEY = 'mf-004.md-011.sm-e100::v01::t01';
const HYUNDAI_VENUE_UNBOUNDED_KEYS = new Set(
  Array.from({ length: 5 }, (_, index) => `mf-001.md-059.sm-qx1::v01::t${String(index + 1).padStart(2, '0')}`),
);
const KIA_SELTOS_SP3_FALSE_EARLY_KEYS = new Set([
  ...Array.from({ length: 5 }, (_, index) => `mf-002.md-064.sm-sp3::v01::t${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 4 }, (_, index) => `mf-002.md-064.sm-sp3::v02::t${String(index + 1).padStart(2, '0')}`),
  'mf-002.md-064.sm-sp3::v03::t01',
]);
const KIA_NIRO_SG2_FALSE_EARLY_PE_KEYS = new Set(
  Array.from({ length: 3 }, (_, index) => `mf-002.md-061.sm-sg2::v01::t${String(index + 1).padStart(2, '0')}`),
);
const KIA_NIRO_SG2_PREFACELIFT_HEV_KEYS = new Set(
  Array.from({ length: 4 }, (_, index) => `mf-002.md-061.sm-sg2__디-new-니로-sg2::v01::t${String(index + 1).padStart(2, '0')}`),
);
const KIA_RAY_EV_FALSE_EARLY_KEYS = new Set([
  'mf-002.md-058.sm-tam::v02::t01',
  'mf-002.md-058.sm-tam::v02::t02',
  'mf-002.md-058.sm-tam__van::v02::t01',
]);
const KIA_RAY_GAS_PRE_2027_KEYS = new Set([
  ...Array.from({ length: 5 }, (_, index) => `mf-002.md-058.sm-tam::v01::t${String(index + 1).padStart(2, '0')}`),
  'mf-002.md-058.sm-tam__van::v01::t01',
  'mf-002.md-058.sm-tam__van::v01::t02',
]);
const KIA_RAY_GAS_FALSE_EARLY_XLINE_KEY = 'mf-002.md-058.sm-tam::v01::t06';
const KIA_MORNING_PRE_2027_KEYS = new Set([
  ...Array.from({ length: 4 }, (_, index) => `mf-002.md-013.sm-ja::v01::t${String(index + 1).padStart(2, '0')}`),
  'mf-002.md-013.sm-ja__van::v01::t01',
]);
const rows = [
  ...filanteRows, ...ioniq5StandardRows, ...ioniq5LongRows, ...ioniq5BusinessRows,
  ...ioniq5_58Rows, ...ioniq5_77Rows, ...ioniq5_2022BusinessRows,
  ...ioniq5_72Rows,
  ...niroDe64Rows,
  ...soulSk3Rows,
  ...avanteAdLpiRows,
  ...casperElectricRows,
  ...casperElectricPhasedRows,
  ...hyundai2027CasperRows,
  ...boltEv2022Rows,
  ...ioniqElectric38Rows,
  ...bmwI3_120Rows,
  ...bmwI3_94Rows,
  ...ioniqElectric28Rows,
  ...ioniq5FaceliftStandardRows,
  ...ioniq5FaceliftLongRows,
  ...volvoEx90Rows,
  ...benzEqc80Rows,
  ...peugeot5008P67Rows,
  ...fordRangerP703Rows,
  ...fordBroncoRows,
  ...miniElectricF56Rows,
  ...peugeotE208Rows,
  ...peugeotE2008Rows,
  ...ds3Etense2022Rows,
  ...teslaCurrentModelYRows,
  ...teslaCurrentModel3Rows,
  ...teslaRefreshModelSRows,
  ...teslaRefreshModelXRows,
  ...teslaCybertruckKrRows,
  ...genesisG80PrefaceliftCorrectedRows,
  ...genesisG80FaceliftRows,
  ...genesisGv80FaceliftRows,
  ...genesisGv70FaceliftRows,
  ...genesisG70_2023Rows,
  ...genesisG70GraphiteRows,
  ...genesisG70Sb2023Rows,
  ...genesisGv60PerformanceRows,
  ...genesisGv60MagmaRows,
  ...genesisEq900ProductRows,
  ...kiaK5_2025LpgRows,
  ...kiaK5_2026BestProductRows,
  ...kiaK5FaceliftGasProductRows,
  ...hyundaiSonata2024_2025RentalProductRows,
  ...genesisGv80InitialProductRows,
  ...kiaNiroSg2HevProductRows,
  ...kiaRay2026ProductRows,
  ...kiaK8_2026BestProductRows,
  ...genesisGv70InitialProductRows,
  ...genesisG90CurrentRows,
  ...genesisG90LongWheelbaseRows,
  ...genesisG90BlackRows,
  ...genesisG90LongWheelbaseBlackRows,
  ...genesisGv80CoupeRows,
  ...genesisGv80CoupeBlackRows,
  ...genesisGv80BlackRows,
  ...genesisG80BlackRows,
  ...kiaCarnivalXlineRows,
  ...kiaCarnivalHighRoofRows,
  ...kiaK5BestSelectionRows,
  ...kiaK5_2027Rows,
  ...kiaK5_2027RentalRows,
  ...kiaK8BestSelectionRows,
  ...kiaEv3_2026AwdRows,
  ...kiaEv4_2026AwdRows,
  ...kiaEvGtRows,
  ...kiaEv5Long2wdRows,
  ...kiaEv5Standard2wdRows,
  ...kiaEv5LongAwdRows,
  ...kiaEv5GtRows,
  ...kiaEv9Standard2026Rows,
  ...kiaEv9LightLong2026Rows,
  ...kiaEv6PeGtRows,
  ...kiaPv5PassengerPlusRows,
  ...hyundai2026SantaFeHPickRows,
  ...hyundai2026TucsonHPickRows,
  ...hyundai2026SonataSRows,
  ...hyundai2026SonataGapRows,
  ...hyundai2026SonataRentalRows,
  ...hyundai2025KonaHPickRows,
  ...hyundai2025KonaBlackRows,
  ...hyundai2027KonaRows,
  ...hyundai2026AvanteHevRows,
  ...hyundai2026AvanteLpiGapRows,
  ...hyundai2026AvanteRentalRows,
  ...teslaLegacyModelYPerformanceRows,
  ...teslaLegacyModelYLongRangeRows,
  ...teslaNewModelYLaunchSeriesRows,
  ...teslaLegacyModelY2021Rows,
  ...teslaLegacyModel3KrRows,
  ...teslaModelXPlaid5Rows,
  ...teslaLegacySxKrRows,
  ...kiaSorentoXlineRows,
  ...hyundaiGrandeurGn11Rows,
  ...kiaSportageXlineRows,
  ...hyundai2026SantaFeBlackInkRows,
  ...hyundaiPalisadeLx3MissingExclusiveRows,
  ...hyundaiNewStariaHybridRows,
  ...hyundaiNewStariaLpgRows,
  ...hyundaiNewStariaElectricRows,
  ...hyundaiNewStariaLoungeLimousineRows,
  ...hyundai2024StariaHybridRows,
  // Append-only: keep every previously captured sheet-row offset stable.
  ...tesla2025ModelSRows,
  ...tesla2025ModelXRows,
  ...teslaModel3HighlandHistoricalLongRangeRows,
  ...polestar4Rows,
  ...renaultScenicRows,
  ...volvoEx30KoreaRows,
  ...volvoEx30CrossCountryKoreaRows,
  ...volvoXc40_2026Rows,
  ...volvoXc90_2026Rows,
  ...volvoS90_2026Rows,
  ...volvoV60cc_2026Rows,
  ...volvoV90ccMy23Rows,
  ...volvoXc60My23Rows,
  ...volvoS60B5KoreaRows,
  ...volvoC40My24Rows,
  ...volvoXc40RechargeKoreaRows,
  ...renaultQm6_2025Rows,
  ...renaultSm6_2025Rows,
  ...kgmKorando_2025Rows,
  ...kgmKorandoEv_2024Rows,
  ...hyundaiVenue_2025Rows,
  ...kiaSeltosSp3_2026Rows,
  ...kiaNiroPe_2026Rows,
  ...kiaRayEv_2023Rows,
  ...kiaRayGas_2027Rows,
  ...kiaMorning_2027Rows,
  // Product-backed historical gap: append-only to preserve all earlier offsets.
  ...hyundaiSantaFeTm2021ProductRows,
  ...genesisG90Hi50FiveSeatRows,
  ...hyundaiTucsonNx4_2023ProductRows,
  ...hyundaiPalisadeLx2SevenSeatProductRows,
  ...kiaSportageNq5LpgGravityRows,
  ...kiaSorentoMq4PeDieselGravityRows,
];

if (rows.some((row) => row.length !== HEADERS.length)) throw new Error('현행 렌트 보강 행은 A:AD 30열이어야 합니다.');

function syncLocal() {
  const artifactPath = fileURLToPath(new URL('../public/data/vehicle-trim-master.json', import.meta.url));
  const registryPath = fileURLToPath(new URL('../data/vehicle-trim-key-registry.json', import.meta.url));
  const added = buildVehicleTrimMasterArtifact([HEADERS, ...rows], '1T_RrErmGoj_yG9S1u7n--2NDolTOw8wA8ROQjPWuAlg', '차종마스터');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as VehicleTrimMasterArtifact;
  const present = new Set(artifact.records.map((record) => record.trim_row_key));
  const correctedSportageGravity = added.records.find((record) => record.master_id === KIA_SPORTAGE_NQ5_LPG_GRAVITY_ID);
  if (!correctedSportageGravity) throw new Error('스포티지 LPG 그래비티 보강행 생성 실패');
  artifact.records = [...artifact.records, ...added.records.filter((record) => !present.has(record.trim_row_key))]
    // 이 키는 최초 추가 직후 독립 게이트에서 단일 가격표로 2025년까지 확장한
    // 기간 과잉을 발견했다. 동일 차량축은 유지하고 공식 확인 구간만 좁힌다.
    .map((record) => record.master_id === KIA_SPORTAGE_NQ5_LPG_GRAVITY_ID
      ? { ...correctedSportageGravity }
      : record)
    .map((record) => record.master_id === HYUNDAI_VENUE_2025_ID ? {
      ...record,
      management_status: '확정' as const,
      verification_status: '확정' as const,
      usage_tier: 'automatic' as const,
      turbo: null,
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => record.master_id === GENESIS_G80_PREFACELIFT_CORRECTED_ID ? {
      ...record,
      management_status: '확정' as const,
      verification_status: '확정' as const,
      usage_tier: 'automatic' as const,
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => record.master_id === GENESIS_EQ900_PRODUCT_ID ? {
      ...record,
      management_status: '확정' as const,
      verification_status: '확정' as const,
      usage_tier: 'automatic' as const,
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => CASPER_ELECTRIC_FALSE_EARLY_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: `기존 AX1e 영구코드는 프리미엄·크로스·라운지를 모두 최초 캐스퍼 Electric 출시월 2024-08부터 현행으로 열었지만, 현대자동차 캐스퍼 공식 출시 이벤트는 프리미엄 2024-10-18, 크로스 2025-02-11, 라운지 2026-03-17부터 각각 확인된다. 키와 잘못 입력된 시작 의미는 보존하되 자동 배정을 차단하고 트림별 실제 출시월의 신규 영구코드로 재발급한다. 현행 가격표: ${CASPER_ELECTRIC_PRICE_URL}`,
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => record.master_id === HYUNDAI_CASPER_PRE_2027_MASTER_ID ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      production_end: '현재',
      model_year_end: '현재',
      evidence_note: `2024-10 더 뉴 캐스퍼 AX1 승용·VAN 계보로 보존하고, 현대자동차 공식 2027 CASPER가 확인되는 2026-07 직전인 2026-06에서 닫는다. 2027 연식 승용 6조합과 VAN 4조합은 별도 영구코드로 발급한다. 현행 근거: ${HYUNDAI_2027_CASPER_PRICE_URL}`,
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => record.trim_row_key === KGM_KORANDO_EMOTION_UNBOUNDED_KEY ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 E100 E5 영구코드는 2022-02 코란도 이모션 초기 계보를 배터리 구분 없이 현재까지 연장해 2024 코란도 EV의 73.4kWh E5와 자동 충돌한다. 키 의미와 이력은 보존한 채 자동 배정을 차단하고, 공식 2024 코란도 EV E3·E5 국내형을 별도 코드로 분리한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => KGM_KORANDO_C300_FALSE_CURRENT_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 C300 영구코드는 디젤 1.6과 가솔린 1.5의 여러 초기 트림을 2019-02부터 모두 현재까지 열어 후기형 차량에 과매칭한다. 키 의미와 이력은 보존한 채 자동 배정을 차단하고, KG모빌리티 공식 2024-11 가격표로 확인되는 가솔린 1.5T C5·C5 Plus·C7·Black Edition 후기형을 별도 코드로 분리한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => RENAULT_SM6_FALSE_CURRENT_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 영구코드는 2020년 부분변경 이후의 LE·SE·SE Plus·RE·프리미에르·필·인스파이어를 모두 현재까지 자동으로 열어 실제 연식별 트림 체계를 과매칭한다. 키 의미와 이력은 보존한 채 자동 배정을 차단하고, 르노코리아 공식 2025-06 가격표로 확인되는 TCe 260 필·TCe 300 INSPIRE·LPe 필 국내형을 별도 코드로 분리한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => HYUNDAI_VENUE_UNBOUNDED_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 QX1 영구코드는 Smart·Modern·Modern Plus·Premium·Flux를 모두 2019-07부터 현재까지로 기록했다. 현대 공식 초기 가격표와 2025-04-02 출시 가격표의 트림 구성이 달라 동명 트림까지 연식 경계 없이 자동 합쳐질 수 있다. 원래 키 의미와 이력은 보존하되 자동 매칭을 차단하고, 공식 2025 라인업 Smart·Premium·FLUX를 별도 영구코드로 분리한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => KIA_SELTOS_SP3_FALSE_EARLY_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 SP3 영구코드는 디 올 뉴 셀토스를 2025-07부터 국내 판매된 것으로 1년 일찍 열었고, 공식 판매 조합인 가솔린 터보 4WD는 누락한 반면 비터보 가솔린과 빈 트림 코드를 포함했다. 원래 키 의미와 이력은 보존하되 자동 매칭을 차단하고, 기아 공식 2026-07-01 가격표 기준 파워트레인·구동·트림 조합을 신규 영구코드로 분리한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => KIA_NIRO_SG2_FALSE_EARLY_PE_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 더 뉴 니로 SG2 영구코드는 2026년형 부분변경 HEV를 2025-04부터 1년 이상 일찍 열었다. 기아 공식 2026 상품계획과 2026-05 가격표에 맞춰 원래 키 의미와 이력은 보존하되 자동 매칭을 차단하고, 공식 시점의 신규 영구코드로 분리한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => KIA_NIRO_SG2_PREFACELIFT_HEV_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      production_end: '현재',
      model_year_end: '현재',
      evidence_note: '기아 공식 2022-01 국내 출시자료로 시작 경계를 유지하고, 공식 2026 상품계획과 2026-05 The new Niro 가격표에 따라 디 올 뉴 니로 HEV 이력을 2026-04까지로 닫는다. EV는 동일 부분변경 근거가 없어 별도 계보를 유지한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => KIA_RAY_EV_FALSE_EARLY_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 영구코드는 35.2kWh 2세대 레이 EV를 2022-09부터 1년 일찍 열었고 승용 라이트·에어 및 2인승 밴 에어만 포함해 차체·인승 조합이 불완전했다. 기아 공식 2023년 출시 이력과 2023-09 렌트 카탈로그에 맞춰 원래 키 의미와 이력은 보존하되 자동 매칭을 차단하고, 4인승 승용·2인승 밴·1인승 밴의 라이트·에어를 신규 영구코드로 분리한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => KIA_RAY_GAS_PRE_2027_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      production_end: '현재',
      model_year_end: '현재',
      evidence_note: `2022-09 시작 The new Kia Ray 가솔린 승용·밴 이력으로 보존하고, 기아 공식 The 2027 Ray 가격표가 적용되는 2026-08 직전인 2026-07에서 닫는다. 2027 연식의 승용 4개 트림과 1·2인승 밴 각 3개 트림은 별도 영구코드로 분리한다. 현행 근거: ${KIA_RAY_GAS_PRICE_URL}`,
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => record.trim_row_key === KIA_RAY_GAS_FALSE_EARLY_XLINE_KEY ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: `기존 시그니처 X라인 코드는 X-Line을 2022-09부터 현재까지 합본했으나 2022-09 공식 가격표는 스탠다드·프레스티지·시그니처를 제시하고 현행 The 2027 Ray가 2026-08부터 X-Line을 독립 트림으로 제시한다. 원래 영구키와 잘못 입력된 의미는 보존하되 자동 배정을 차단하고 현행 X-Line은 별도 코드로 발급한다. 현행 근거: ${KIA_RAY_GAS_PRICE_URL}`,
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => KIA_MORNING_PRE_2027_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      production_end: '현재',
      model_year_end: '현재',
      evidence_note: `2023-07 시작 The new Morning JA 부분변경 이력으로 보존하고, 기아 공식 The 2027 모닝 판매 개시 2026-05 직전인 2026-04에서 닫는다. 2027 연식 승용 4개 트림과 2인승 밴 2개 트림은 별도 영구코드로 분리한다. 출시 근거: ${KIA_MORNING_2027_LAUNCH_URL}`,
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => RENAULT_QM6_FALSE_CURRENT_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 영구코드는 2019년형 LE·RE·시그니처·프리미에르 계보를 모두 현재까지 자동으로 열어 종료된 트림을 현행 차량에 과매칭한다. 키 의미와 이력은 보존한 채 자동 배정을 차단하고, 르노코리아 공식 2025-02 가격표로 확인되는 LPe LE·LPe RE·GDe RE 국내형을 별도 코드로 분리한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => VOLVO_XC40_RECHARGE_GLOBAL_START_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 영구코드는 Twin·Twin Ultimate를 글로벌 시점 2021-10부터 국내 판매된 것처럼 열어 실제 출시월과 트림 체계를 과매칭한다. 키 의미와 이력은 보존한 채 자동 배정을 차단하고, 볼보자동차코리아가 국내 판매를 직접 확인한 2023-02 시점부터 Recharge Twin 단일 국내형 수동 코드로 분리한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => record.trim_row_key === VOLVO_C40_GLOBAL_START_KEY ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 영구코드는 C40의 글로벌 데뷔 시점 2021-10을 국내 생산 시작처럼 사용해 실제 국내 출시·출고 경계를 과매칭한다. 키 의미와 이력은 보존한 채 자동 배정을 차단하고, 볼보자동차코리아가 직접 확인한 2023-08 출시 MY2024 Recharge Twin 국내형을 별도 영구코드로 분리한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => VOLVO_S60_MIXED_PERIOD_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 영구코드는 T5·B5와 R-Design·Inscription·Ultimate·Ultra 등 서로 다른 국내 연식의 파워트레인·트림을 모두 2019-04~2024-12로 열어 실제 차량을 과매칭한다. 키 의미와 이력은 보존하되 자동 배정을 차단하고, 공식 국내 자료로 기간을 직접 확인한 B5 Inscription 및 MY2023 B5 Ultimate 계보를 별도 영구코드로 분리한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => VOLVO_V90CC_UNBOUNDED_CURRENT_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 영구코드는 B5 Ultimate·Ultra·Pro·Plus를 B5 도입 전인 2017-03부터 현재까지 열어 실제 연식과 국내 트림 체계를 과매칭한다. 원래 코드 의미와 이력을 보존한 채 자동 배정을 차단하고, 2022-08 기준 공식 MY2023 국내 B5 AWD Plus·Ultimate 체계를 별도 영구코드로 분리한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => VOLVO_V60CC_UNBOUNDED_CURRENT_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 영구코드는 B5·Ultimate·Ultra·Pro 등 서로 다른 시기의 명칭을 2019-03부터 현재까지 동시에 열어 실제 연식과 트림을 과매칭한다. 원래 코드 의미는 보존하되 자동 배정을 차단하고, 공식 국내 구성으로 직접 확인되는 2026년식 B5 AWD Ultra를 별도 영구코드로 분리했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => VOLVO_XC90_UNBOUNDED_CURRENT_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 영구코드는 B6·T8의 Ultimate·Ultra·Black Edition 및 Bright·Dark 테마를 2015-08부터 현재까지 한 세대 시작점으로 합쳐 실제 국내 연식과 트림 체계를 과매칭한다. 원래 코드 의미는 보존하되 자동 배정을 차단하고, 2025-07 출시된 신형 2026년식 국내 가격 조합을 별도 영구코드로 분리했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => VOLVO_XC40_UNBOUNDED_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 영구코드는 R-Design·Momentum·Inscription·Black Edition·Ultimate·Ultra 등 서로 다른 연식의 트림을 2018-03부터 현재까지 한 파워트레인으로 합쳐 실제 차량 연식과 구동 조합을 과매칭한다. 코드와 원래 의미는 보존하되 자동 배정을 차단하고 공식 2026년식 B4 AWD 국내 조합을 별도 코드로 분리했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => VOLVO_EX30_SUPERSEDED_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 영구코드는 글로벌 69kWh 명목 표기와 국내 출시 전 시작월 또는 비공식 혼합 트림명을 사용해 국내 판매 조합을 안전하게 식별할 수 없다. 코드와 원래 의미는 보존하되 자동 매칭을 차단하고, 볼보자동차코리아 공식 국내 출시 사양은 별도 영구코드로 발급했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => record.master_id === TESLA_NEW_MODEL_Y_ID ? {
      ...record,
      generation_name: '1세대 부분변경(리프레시)',
      trim_aliases: (record.drivetrain === 'AWD'
        ? '테슬라 모델 Y,Tesla Model Y,New Model Y,New Model Y Long Range,New Model Y Long Range AWD,모델Y 주니퍼,Juniper,Model Y Refresh,모델Y 리프레시,Premium Long Range AWD,프리미엄 롱 레인지 AWD'
        : '테슬라 모델 Y,Tesla Model Y,New Model Y,New Model Y RWD,모델Y 주니퍼,Juniper,Model Y Refresh,모델Y 리프레시,Premium RWD,프리미엄 후륜구동').split(','),
      evidence_note: TESLA_NEW_MODEL_Y_NOTE,
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => record.trim_row_key === `${TESLA_MODEL_Y_L_ID}::v01::t01` ? {
      ...record,
      generation_name: '1세대 롱휠베이스 파생형',
      production_start: '2026-07',
      evidence_url: TESLA_MODEL_Y_L_LAUNCH_URL,
      evidence_note: TESLA_MODEL_Y_L_NOTE,
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => record.master_id === TESLA_MODEL_S_REFRESH_ID || record.master_id === TESLA_MODEL_X_REFRESH_ID ? {
      ...record,
      market_status: '중고차' as const,
      production_end: '2025-05',
      model_year_end: '2025',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => TESLA_MODEL_X_UNPROVEN_PLAID_5_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_url: TESLA_MODEL_X_MANUAL_URL,
      evidence_note: `최신 한국어 Model X 사용자 매뉴얼에는 Plaid 5인승 중량표가 있으나 Tesla 대한민국 한국공인연비는 Plaid 6인승만 인증한다. 매뉴얼은 표기 옵션이 특정 판매지역에서 실제 제공됨을 보장하지 않는다고 명시하므로 국내 판매·등록 근거 확보 전까지 영구키를 보존한 채 배정을 차단한다. 국내 공인 제원: ${TESLA_RANGE_URL}`,
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => E2008_SUPERSEDED_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 해외(포르투갈) 가격표 근거로 국내 세부 연식과 트림명을 확정할 수 없고, 국내 공식 명칭 Allure·GT Line 및 Allure·GT와 충돌해 자동 매칭에서 차단한다. 원래 영구키 의미는 보존하며 국내 공식 조합은 신규 코드로 분리했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => TESLA_MODEL_Y_SUPERSEDED_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '현행 트림명은 확인되지만 2020-01부터 현재까지를 한 행으로 합친 생산기간이 실제 New Model Y 및 Model Y L 국내 출시 시점과 충돌해 자동 매칭에서 차단한다. 원래 영구키 의미는 보존하며 공식 국내 시점별 신규 코드를 발급했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => record.trim_row_key === TESLA_MODEL_Y_2023_RWD_KEY ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      generation_name: '',
      production_start: '2020-01',
      production_end: '',
      model_year_start: '2020',
      model_year_end: '',
      trim_aliases: '테슬라 모델 Y RWD,Tesla Model Y RWD,Model Y 후륜구동,2023 Model Y RWD',
      evidence_url: TESLA_MODEL_Y_2023_RWD_URL,
      evidence_note: 'Tesla Korea 공식 자료에서 Model Y RWD의 국내 출시일을 2023-07-14, 5인승으로 확인했다. 글로벌 생산 시작 2020-01을 국내 시작월로 사용하던 값을 바로잡고, New Model Y 국내 생산구분 시작 2025-02 직전인 2025-01까지의 구형 국내 이력으로 닫는다. 종료월은 두 공식 국내 세대 경계에 따른 보수적 추론이다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => record.trim_row_key === TESLA_MODEL_Y_UNBOUNDED_LONG_RANGE_KEY ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '글로벌 생산시점 2020-01부터 종료 미상까지를 한 행으로 묶어 국내 초기 도입차, 2023~2024 국내 인증차, 2025 New Model Y를 구분할 수 없다. 영구키 의미와 이력은 보존하되 자동 매칭을 차단하고, 공식 국내 문서로 기간이 확인되는 Long Range AWD는 별도 코드로 발급한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => record.trim_row_key === TESLA_MODEL_Y_FALSE_EARLY_LAUNCH_SERIES_KEY ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: 'Launch Series를 구형 Model Y의 2020-01 시작 트림으로 기록해 2025 New Model Y 리프레시 한정판과 세대가 충돌한다. 원래 영구키와 잘못 입력된 의미는 보존하되 자동 매칭을 차단하고, 공식 New Model Y Launch Series Long Range AWD는 별도 코드로 발급한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => TESLA_MODEL_Y_SUPERSEDED_2023_EVIDENCE_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '최초에는 2023 환경부 보조금 문서로 직접 확인되는 보수적 구간만 코드화했으나, 공공데이터포털 등록차량 원천에서 동일 트림의 2021-05 국내 등록을 추가 확인했다. 이미 발급된 영구키의 시작연도 의미를 변경하지 않고 이 코드는 차단하며, 2021 국내 등록 기준 신규 영구코드로 대체한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => record.trim_row_key === TESLA_MODEL_Y_UNPROVEN_STANDARD_RANGE_KEY ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '2021 지자체 전기차 보조금 공고에는 Model Y(Standard Range)가 대상 차종으로 존재하지만, 공공데이터포털 국내 등록차량 원천에서는 Long Range·Performance와 달리 실제 등록을 확인하지 못했다. 2020-01~2024-01 활성 기간도 국내 실차 근거가 아니므로 2023 국내 공식 출시 RWD와 합치지 않고 자동 매칭을 차단한다. 국내 등록 근거 확보 전에는 신규 영구코드를 발급하지 않는다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => TESLA_MODEL_3_SUPERSEDED_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '현행 트림명을 2017년부터 현재까지 합본했거나 Premium RWD를 공식 국내 공인명칭 Premium Long Range RWD와 다르게 축약해 Highland 이전·이후 차량이 자동 혼합될 수 있어 차단한다. 원래 영구키 의미와 이력은 보존하고 공식 국내 시점별 신규 코드로 재발급했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => TESLA_MODEL_SX_SUPERSEDED_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: 'Model S·Model X의 글로벌 생산시점을 국내 시작일로 사용했거나 구형과 2023년 국내 출시 신형을 합본해 자동 오매칭 위험이 있어 차단한다. 원래 영구키 의미와 이력은 보존하고, 국내 공공자료로 확인되는 구형 트림 및 2023년 신형·좌석 구성은 시점별 신규 코드로 재발급했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => TESLA_CYBERTRUCK_SUPERSEDED_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '글로벌 생산 시작 2023-11을 국내 현행 시작으로 사용하거나 공식 국내 미공개 배터리 총용량 123kWh를 확정해 국내 2025-11 출시차와 자동 혼합될 수 있어 차단한다. 원래 영구키 의미와 이력은 보존하고 국내 공식 트림명·출시월 기준 신규 코드로 재발급했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => GENESIS_G80_PREFACELIFT_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      production_end: '현재',
      model_year_end: '현재',
      evidence_note: '2020-03 출시 초기형 RG3 조합으로, 제네시스 공식 2023-12-26 부분변경 판매 개시 시점에 맞춰 생산기간을 종료했다. 원래 영구키와 파워트레인·트림 의미는 보존하며 부분변경 조합은 신규 코드로 분리했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => GENESIS_G80_DIESEL_UNSAFE_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      market_status: '중고차' as const,
      evidence_note: '2023-12 부분변경 공식 엔진 라인업에서 디젤 2.2가 제외됐는데도 2020-03부터 현재까지로 남아 현행 차량에 자동 매칭될 수 있어 차단한다. 정확한 국내 판매 종료월을 공식 원문으로 추가 확정하기 전까지 원래 영구키와 의미를 보존한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => GENESIS_GV80_PREFACELIFT_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      production_end: '현재',
      model_year_end: '현재',
      evidence_note: '2020-01 출시 초기형 GV80 JX1 조합으로, 제네시스 공식 2023-09 부분변경 공개 시점에 맞춰 초기형 생산기간을 종료했다. 원래 영구키와 파워트레인·좌석 의미는 보존하며 부분변경의 엔진·구동·인승 조합은 신규 코드로 분리했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => GENESIS_GV70_PREFACELIFT_GAS_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      production_end: '현재',
      model_year_end: '현재',
      evidence_note: '2020-12 출시 초기형 GV70 JK1 가솔린 조합으로, 제네시스 공식 2024-05 부분변경 출시 직전인 2024-04에 초기형 생산기간을 종료했다. 원래 영구키와 파워트레인 의미는 보존하며 부분변경의 엔진·구동·트림 조합은 신규 코드로 분리했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => GENESIS_GV70_DIESEL_UNSAFE_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      market_status: '중고차' as const,
      evidence_note: '2024-05 부분변경 공식 현행 엔진 라인업에서 디젤 2.2가 제외됐지만, 2020-12부터 현재까지 열린 기존 행만으로는 국내 판매 종료월을 안전하게 확정할 수 없어 자동 매칭에서 차단한다. 원래 영구키와 디젤·구동 의미는 보존하며 공식 종료월을 추가 확보하기 전까지 생산종료를 임의 추정하지 않는다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => GENESIS_G70_2020_PHASE_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      production_end: '현재',
      model_year_end: '현재',
      evidence_note: '2020-10 부분변경 G70 IK 조합으로, 제네시스 공식 2023-05 상품성 개선 모델 출시 직전인 2023-04에 생산기간을 종료했다. 원래 영구키와 엔진·구동 의미는 보존하며 2023년형 현행 엔진 조합은 신규 코드로 분리했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => GENESIS_G70_FALSE_2020_25T_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '가솔린 2.5 터보는 제네시스 공식 자료상 2023-05 신규 도입 엔진인데 기존 행은 2020-10부터 현재까지로 기록되어 차량 시기를 잘못 흡수한다. 원래 영구키의 2.5T·구동 의미는 보존하되 자동 매칭에서 차단하고 공식 2023 시점의 신규 코드로 분리했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => GENESIS_G70_SB_2022_20T_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      production_end: '현재',
      model_year_end: '현재',
      evidence_note: '제네시스 공식 2022-06-27 국내 출시자료의 가솔린 2.0 터보 초기형 G70 슈팅 브레이크 조합으로, 2023-05 2.5 터보 상품성 개선 모델 직전인 2023-04에 생산기간을 종료했다. 원래 영구키와 구동 의미는 보존한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => GENESIS_G70_SB_FALSE_2022_25T_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '제네시스 공식 자료상 국내 G70 슈팅 브레이크는 2022-06 출시 당시 2.0 터보 단일 엔진이고 2.5 터보는 2023-05 신규 도입됐으나, 기존 행은 2022-07부터 현재까지로 기록돼 시기를 잘못 흡수한다. 원래 영구키의 2.5T·구동 의미는 보존하고 자동 매칭에서 차단한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => GENESIS_G90_FALSE_2021_BLACK_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 코드는 G90 Black을 2021-12부터 생산된 일반 3.5T AWD로 기록해 2024-03-21 공식 출시 시점과 전용 3.5T 48V e-S/C AWD 파워트레인에 모두 충돌한다. 원래 영구키는 이력 보존하되 자동 매칭에서 차단하고 공식 출시 시점의 신규 Black 코드를 발급했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => GENESIS_GV80_COUPE_FALSE_EARLY_BLACK_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 코드는 GV80 쿠페 Black을 일반 쿠페 출시 시점인 2023-10부터 현행으로 기록했지만, 제네시스 공식 Black 최초 공개일은 2024-10-02다. 원래 영구키의 엔진·차체 의미는 보존하되 생산시점 충돌로 자동 매칭에서 차단하고 공식 시점의 신규 Black 코드로 분리했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => KIA_CARNIVAL_FALSE_EARLY_XLINE_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 코드는 카니발 X-Line을 2023-11 부분변경 출시 시점부터 기록했으나 당시 국내 공식 라인업은 그래비티였고, 현행 공식 2026 가격표의 X-Line은 7인승 전용이다. 원래 영구키는 이력 보존하되 조기 시점 또는 9인승 구성 충돌로 자동 매칭에서 차단하고 2026 공식 7인승 코드를 신규 발급했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => KIA_K5_FALSE_EARLY_BEST_SELECTION_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 코드는 K5 베스트 셀렉션을 2023-11 부분변경 출시 시점부터 기록했으나, 기아 공식 자료상 이 트림은 2025-06-19 The 2026 K5에서 신설됐다. 원래 영구키의 파워트레인·트림 의미는 보존하되 생산시점 충돌로 자동 매칭에서 차단하고 공식 시점의 신규 코드를 발급했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => KIA_K5_PRE_2027_CURRENT_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      production_end: '현재',
      model_year_end: '현재',
      evidence_note: `기존 더 뉴 K5 DL3 및 The 2026 K5 이력으로 보존하고, 기아 공식 The 2027 K5 출시월 2026-07 직전인 2026-06에서 닫는다. 2027 연식은 자가용 16개 조합과 렌터카 LPG 2개 조합을 별도 영구코드로 발급하며, 자가용 LPG와 렌터카 LPG를 혼합하지 않는다. 현행 근거: ${KIA_K5_2027_PRICE_URL}`,
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => KIA_K8_FALSE_EARLY_BEST_SELECTION_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 코드는 K8 베스트 셀렉션을 2024-08 부분변경 출시 시점부터 기록했으나, 기아 공식 자료상 이 트림은 2025-06-19 The 2026 K8에서 신설됐다. 원래 영구키의 파워트레인·트림 의미는 보존하되 생산시점 충돌로 자동 매칭에서 차단하고 공식 시점의 신규 코드를 발급했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => KIA_EV_FALSE_EARLY_AWD_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 코드는 EV3·EV4 롱레인지 4WD를 각 차종 최초 출시 시점부터 기록했으나, 기아 공식 자료상 두 4WD 모델은 2026-02-02 연식변경에서 신규 추가됐다. 원래 영구키의 배터리·구동·트림 의미는 보존하되 생산시점 충돌로 자동 매칭에서 차단하고 공식 시점의 신규 코드를 발급했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => KIA_EV5_WRONG_START_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 코드는 EV5의 국내 최초형 81.4kWh 2WD와 2026년 추가된 60.3kWh 2WD·81.4kWh 4WD를 모두 2026-05부터로 합쳤다. 원래 영구키의 배터리·구동·트림 의미는 보존하되 공식 출시시점 충돌로 자동 매칭에서 차단하고 시점별 신규 코드를 발급했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => KIA_EV9_FALSE_EARLY_2026_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 코드는 EV9 76.1kWh 스탠다드 또는 라이트 트림을 2023-06 최초 출시 시점부터 기록했으나, 기아 공식 자료상 스탠다드와 라이트는 2026-02-02 연식변경에서 도입됐다. 원래 영구키의 배터리·구동·트림·좌석 의미는 보존하되 시점 충돌로 자동 매칭에서 차단하고 공식 시점의 신규 코드를 발급했다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => KIA_PV5_CONCEPT_LAYOUT_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 코드의 2-2-3과 1-2-2는 기아 공식 컨셉 페이지에서 각각 7인승과 5인승 시트 배열로 제시되지만, 국내 현행 가격표의 판매 트림으로는 확인되지 않는다. 컨셉 사양이 실제 렌트·구독 재고에 자동 매칭되지 않도록 원래 영구키는 보존하고 차단한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => HYUNDAI_FALSE_EARLY_2026_TRIM_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 코드는 싼타페·투싼 H-Pick 또는 쏘나타 S 트림을 해당 차량의 2023년 최초 출시 시점부터 현재까지로 합친 코드이다. 현대 공식 자료상 해당 트림은 2026 연식변경에서 신설됐으므로 초기 차량의 자동 매칭을 차단하고, 공식 출시 시점의 신규 영구코드로 분리한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => record.trim_row_key === HYUNDAI_SONATA_PRE_2026_COMBINED_BUSINESS_KEY ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      production_end: '현재',
      model_year_end: '현재',
      evidence_note: `기존 LPG 2.0 비즈니스 영구키는 2023-05 쏘나타 디 엣지의 과거 이력으로 보존하고, 현대 공식 2026 가격표의 현 모델 출시일 2025-09-29 직전인 2025-08에서 닫는다. 2026 렌터카 전용 Business 1·Business 2는 일반판매용 LPG와 혼합하지 않고 별도 계보로 발급한다. 현행 근거: ${HYUNDAI_2026_SONATA_PRICE_URL}`,
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => HYUNDAI_KONA_FALSE_EARLY_HPICK_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 코드는 코나 H-Pick을 2023-01 차종 최초 출시 시점부터 현재까지로 합친 코드이지만, 현대 공식 2024 코나 가격표에는 H-Pick이 없고 2025 가격표에서 2025-04-23 출시 신규 트림으로 확인된다. 초기 차량 오매칭을 차단하고 공식 시점의 신규 영구코드로 분리한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => (HYUNDAI_KONA_PRE_2027_MASTER_IDS.has(record.master_id)
      || (record.master_id === 'mf-001.md-055.sm-sx2'
        && HYUNDAI_KONA_PRE_2027_VARIANTS.has(record.trim_row_key.split('::')[1] ?? ''))) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      production_end: '현재',
      model_year_end: '현재',
      evidence_note: `현대자동차 공식 2027 KONA 가격표의 모델 출시일 2026-04-07 직전인 2026-03에서 기존 SX2 내연기관·하이브리드 계보를 닫는다. 2027 연식의 8단 자동 가솔린 1.6T 및 재편 트림은 별도 영구코드로 발급한다. 코나 Electric 계보는 이번 변경 대상이 아니다. 현행 근거: ${HYUNDAI_2027_KONA_PRICE_URL}`,
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => HYUNDAI_AVANTE_RETIRED_NLINE_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      production_end: '현재',
      model_year_end: '현재',
      evidence_note: '현대 공식 2025 아반떼 가격표의 N Line 모던·인스퍼레이션 구성은 2025-04-15 출시한 2026 연식변경에서 단일 N Line 트림으로 재편됐다. 원래 영구키의 이력 매칭은 보존하되 생산종료를 2025-03으로 닫는다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => HYUNDAI_GRANDEUR_FALSE_GN7_CURRENT_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 코드는 2026-07 현행 부분변경 모델을 GN7로 기록했지만 현대 공식 현행 페이지의 개발코드는 GN11이다. 가솔린 2.5·3.5의 터보 여부도 잘못됐고, 아너스는 부분변경 현행 가격표 트림이 아니다. 영구키 의미와 이력은 보존하되 자동 매칭을 차단하고 공식 GN11 신규 코드로 재발급한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => record.master_id === HYUNDAI_GRANDEUR_GN11_ID ? {
      ...record,
      production_start: '2026-05',
      evidence_note: '현대자동차 공식 The new GRANDEUR 가격표의 모델 출시일 2026-05-14와 현행 모델소개·2026-07-01 가격 기준. 공식 페이지의 개발코드 GN11과 가솔린 2.5·3.5, LPG 3.5, 하이브리드 1.6T 및 HTRAC 선택 조합을 반영했다. 가격 기준일을 생산 시작일로 오인하지 않는다. 기존 GN7 현행 코드는 개발코드·터보 여부·아너스 트림이 현행 공식 자료와 충돌해 의미를 변경하지 않고 차단 보존한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => KIA_SPORTAGE_MISNAMED_XLINE_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 코드는 공식 독립 트림 X-Line을 시그니처 X라인으로 기록했고 LPG 2.0 X-Line 조합도 누락했다. 영구키의 원래 명칭 의미는 보존하되 자동 매칭을 차단하고, 공식 현행 명칭과 파워트레인 조합으로 신규 영구코드를 발급한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => HYUNDAI_STARIA_FALSE_CURRENT_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 코드는 더 뉴 스타리아를 2025-03 시작으로 기록했지만 현대 공식 현행 가격표의 출시일은 2025-12-17이다. 하이브리드 카고 2·5인승, 투어러 9·11인승 및 스마트·모던 구성과도 충돌하고 LPG·바이퓨얼 오분류가 섞여 있다. 영구키 의미는 보존하되 자동 매칭을 차단하고 공식 차체·인승·연료별 신규 코드로 재발급한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => HYUNDAI_STARIA_LEGACY_AMBIGUOUS_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '기존 US4 통합 마스터가 2024-02에 처음 출시된 스타리아 하이브리드를 2021-04 시작으로 기록했거나, 라운지와 리무진을 하나의 트림명으로 합쳐 차체·인승 의미를 안전하게 확정할 수 없다. 영구키와 원래 의미는 보존하되 자동매칭을 차단하고 공식 연식·차체별 신규 코드만 사용한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .map((record) => HYUNDAI_STARIA_FALSE_CURRENT_LOUNGE_LPG_9_KEYS.has(record.trim_row_key) ? {
      ...record,
      management_status: '제외' as const,
      verification_status: '1차확인' as const,
      usage_tier: 'blocked' as const,
      evidence_note: '현대 공식 2026-04-23 더 뉴 스타리아 전체 라인업 자료는 라운지 LPI를 7인승만 운영한다고 명시한다. 9인승 라운지는 하이브리드이며 LPG 9인승 신규 발급은 잘못된 조합이므로 영구키를 삭제·재사용하지 않고 자동매칭을 차단한다.',
      data_as_of: DATA_AS_OF,
    } : record)
    .sort((a, b) => a.trim_row_key.localeCompare(b.trim_row_key));
  artifact.data_as_of = DATA_AS_OF;
  artifact.row_count = artifact.records.length;
  artifact.manual_assignable_count = artifact.records.filter((record) => record.usage_tier === 'manual').length;
  artifact.automatic_assignable_count = artifact.records.filter((record) => record.usage_tier === 'automatic').length;
  artifact.blocked_count = artifact.row_count - artifact.manual_assignable_count - artifact.automatic_assignable_count;
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as TrimKeyRegistry;
  const generated = trimKeyRecordsFromValues([HEADERS, ...rows])
    .map((record, index) => ({ ...record, capturedSheetRow: START_ROW + index }));
  const sportageGravityKey = `${KIA_SPORTAGE_NQ5_LPG_GRAVITY_ID}::v01::t01`;
  const correctedSportageGravityRegistry = generated.find((record) => record.code === sportageGravityKey);
  if (!correctedSportageGravityRegistry) throw new Error('스포티지 LPG 그래비티 레지스트리 생성 실패');
  const registered = new Set(registry.records.map((record) => record.code));
  const liveRowOverrides = new Map<string, number>([
    [`${GENESIS_EQ900_PRODUCT_ID}::v01::t01`, 7564],
    [`${KIA_K5_2025_LPG_ID}::v01::t01`, 7565],
    ...genesisGv70InitialProductRows.map((row, index) => [String(row[9]), 7566 + index] as const),
    ...kiaK5_2026BestProductRows.map((row, index) => [String(row[9]), 7570 + index] as const),
    ...kiaRay2026ProductRows.map((row, index) => [String(row[9]), 7572 + index] as const),
    [`${KIA_K8_2026_BEST_PRODUCT_ID}::v01::t01`, 7576],
    ...kiaK5FaceliftGasProductRows.map((row, index) => [String(row[9]), 7577 + index] as const),
    ...hyundaiSonata2024_2025RentalProductRows.map((row, index) => [String(row[9]), 7580 + index] as const),
    ...genesisGv80InitialProductRows.map((row, index) => [String(row[9]), 7582 + index] as const),
    ...kiaNiroSg2HevProductRows.map((row, index) => [String(row[9]), 7586 + index] as const),
    [sportageGravityKey, 7595],
  ]);
  registry.records = [
    // 발급된 영구키의 의미와 최초 감사 좌표를 생성 순서로 다시 덮지 않는다.
    // 행 이동 뒤 capturedSheetRow가 낡을 수 있으므로 실제 수정 대상은 항상 라이브 키 검색으로 찾는다.
    ...registry.records,
    ...generated.filter((record) => !registered.has(record.code)),
  ].map((record) => record.code === sportageGravityKey
    // 최초 발급 직후 같은 검증 사이클에서 발견한 기간 과잉을 정본에도 함께
    // 바로잡는다. 제조사·모델·세대·동력계·트림 축은 바뀌지 않는다.
    ? { ...record, semantic: correctedSportageGravityRegistry.semantic }
    : record)
    .map((record) => liveRowOverrides.has(record.code)
    ? { ...record, capturedSheetRow: liveRowOverrides.get(record.code)! }
    : record)
    .sort((a, b) => a.code.localeCompare(b.code));
  registry.capturedAt = DATA_AS_OF;
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  console.log(`PASS 현행 렌트 핵심 ${added.records.length}행 동기화`);
}

if (process.argv.includes('--sync-local')) syncLocal();
else {
  const tailArg = process.argv.find((arg) => arg.startsWith('--tail='));
  const tailCount = tailArg ? Number(tailArg.slice('--tail='.length)) : rows.length;
  const selectedRows = rows.slice(-tailCount);
  console.log(JSON.stringify({ startRow: START_ROW + rows.length - selectedRows.length, endRow: START_ROW + rows.length - 1, rows: selectedRows }));
}
