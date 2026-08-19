/** Rental/subscription commercial coverage additions backed by Korean OEM sources. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildVehicleTrimMasterArtifact, type VehicleTrimMasterArtifact } from '../lib/domain/vehicle-trim-master';
import { trimKeyRecordsFromValues, type TrimKeyRegistry } from '../lib/domain/vehicle-trim-key-contract';

const DATA_AS_OF = '2026-08-16';
const START_ROW = 6795;
const SOLATI_2497_CAPTURED_START_ROW = 7552;
const HEADERS = [
  '관리상태', '검증상태', '신차/중고차', '원산지', '제조사', '모델', '세부모델', '파워트레인', '세부트림',
  '트림행키', '마스터ID', '파워트레인순번', '트림순번', '세대명', '개발코드', '생산시작', '생산종료',
  '연식시작', '연식종료', '연료', '정확배기량(cc)', '표시배기량(L)', '터보', '구동방식', '인승',
  '배터리(kWh)', '트림별칭', '근거URL', '근거메모', '데이터기준일',
] as const;
const MASTER_ID = 'mf-002.md-075.sm-pu__bongo3-ev-60k';
const EVIDENCE_URL = 'https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_bongo3-ev.pdf';
const EVIDENCE_NOTE = '기아 2026 봉고III EV 공식 가격표·제원 기준. 1톤 킹캡 초장축 2WD, 135kW 모터, 60.4kWh 배터리, 스마트 셀렉션/GL/GLS. 생산시작은 공식 2026년형 가격표 게시월 기준 1차확인.';

const bongoRows = ['스마트 셀렉션', 'GL', 'GLS'].map((trim, index) => [
  '검증중', '1차확인', '신차', '국산', '기아', '봉고3', '봉고III EV 1톤 킹캡 초장축',
  '전기 60.4kWh 2WD', trim, `${MASTER_ID}::v01::t0${index + 1}`, MASTER_ID, 1, index + 1,
  '4세대', 'PU', '2026-05', '현재', '2026', '현재', '전기', '', '', '아니오', '2WD', 3, 60.4,
  '봉고3 EV,봉고III EV,봉고 EV', EVIDENCE_URL, EVIDENCE_NOTE, DATA_AS_OF,
]);

const PORTER_MASTER_ID = 'mf-001.md-067.sm-hr__porter2-electric-60k';
const PORTER_URL = 'https://www.hyundai.com/contents/repn-car/catalog/porter2-electric-2026-price.pdf';
const PORTER_NOTE = '현대 2026 포터II 일렉트릭 공식 가격표 기준. 현 모델 출시일 2025-12-16, 슈퍼캡 초장축 2WD, 135kW 모터, 60.4kWh 배터리, 스타일/스마트/프리미엄 스페셜 1차확인.';
const porterRows = ['스타일 스페셜', '스마트 스페셜', '프리미엄 스페셜'].map((trim, index) => [
  '검증중', '1차확인', '신차', '국산', '현대', '포터', '포터II 일렉트릭 슈퍼캡 초장축',
  '전기 60.4kWh 2WD', trim, `${PORTER_MASTER_ID}::v01::t0${index + 1}`, PORTER_MASTER_ID, 1, index + 1,
  '4세대', 'HR', '2025-12', '현재', '2026', '현재', '전기', '', '', '아니오', '2WD', 3, 60.4,
  '포터2 EV,포터II EV,포터 일렉트릭', PORTER_URL, PORTER_NOTE, DATA_AS_OF,
]);
const NEXO_MASTER_ID = 'mf-001.md-068.sm-nh2__the-all-new-nexo';
const NEXO_URL = 'https://www.hyundai.com/contents/repn-car/catalog/the-all-new-nexo_price.pdf';
const NEXO_NOTE = '현대 디 올 뉴 넥쏘 공식 가격표·헤리티지 제원 기준. 2025-06 출시, 수소전기 150kW, 전륜구동, 5인승, 익스클루시브/익스클루시브 스페셜/프레스티지 1차확인.';
const nexoRows = ['익스클루시브', '익스클루시브 스페셜', '프레스티지'].map((trim, index) => [
  '검증중', '1차확인', '신차', '국산', '현대', '넥쏘', '디 올 뉴 넥쏘 NH2',
  '수소전기 150kW FWD', trim, `${NEXO_MASTER_ID}::v01::t0${index + 1}`, NEXO_MASTER_ID, 1, index + 1,
  '2세대', 'NH2', '2025-06', '현재', '2025', '현재', '수소', '', '', '아니오', 'FWD', 5, '',
  '올 뉴 넥쏘,신형 넥쏘,NEXO NH2', NEXO_URL, NEXO_NOTE, DATA_AS_OF,
]);
const PORTER_LPG_URL = 'https://www.hyundai.com/contents/repn-car/catalog/porter2-2026-price.pdf';
const PORTER_LPG_NOTE = '현대 2026 포터II 공식 가격표·제원 기준. 현행 모델 출시일 2025-12-16, LPG 2.5 터보 2,469cc. 2WD 초장축은 수동6단/자동5단, 4WD 장축은 수동6단이며 스마트/모던/프리미엄 트림을 구성함. 1차확인.';
const PORTER_LPG_CONFIGS = [
  { suffix: '2wd-standard-extra', subModel: '포터II LPG 1톤 일반캡 초장축', drive: '2WD', seats: 3, transmissions: ['수동6단', '자동5단'] },
  { suffix: '2wd-super-extra', subModel: '포터II LPG 1톤 슈퍼캡 초장축', drive: '2WD', seats: 3, transmissions: ['수동6단', '자동5단'] },
  { suffix: '2wd-double-extra', subModel: '포터II LPG 1톤 더블캡 초장축', drive: '2WD', seats: 6, transmissions: ['수동6단', '자동5단'] },
  { suffix: '4wd-standard-long', subModel: '포터II LPG 1톤 일반캡 장축 4WD', drive: '4WD', seats: 3, transmissions: ['수동6단'] },
  { suffix: '4wd-super-long', subModel: '포터II LPG 1톤 슈퍼캡 장축 4WD', drive: '4WD', seats: 3, transmissions: ['수동6단'] },
  { suffix: '4wd-double-long', subModel: '포터II LPG 0.8톤 더블캡 장축 4WD', drive: '4WD', seats: 6, transmissions: ['수동6단'] },
] as const;
const porterLpgRows = PORTER_LPG_CONFIGS.flatMap((config) => {
  const masterId = `mf-001.md-069.sm-hr__porter2-lpg-${config.suffix}`;
  return config.transmissions.flatMap((transmission, powertrainIndex) =>
    ['스마트', '모던', '프리미엄'].map((trim, trimIndex) => [
      '검증중', '1차확인', '신차', '국산', '현대', '포터', config.subModel,
      `LPG 2.5T ${config.drive} ${transmission}`, trim,
      `${masterId}::v${String(powertrainIndex + 1).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`,
      masterId, powertrainIndex + 1, trimIndex + 1, '4세대', 'HR', '2025-12', '현재', '2026', '현재',
      'LPG', 2469, 2.5, '예', config.drive, config.seats, '',
      `포터2 LPG,포터II LPG,포터 LPG 터보,${config.subModel.replace('포터II LPG ', '')}`,
      PORTER_LPG_URL, PORTER_LPG_NOTE, DATA_AS_OF,
    ]),
  );
});
const BONGO_LPG_2WD_URL = 'https://www.kia.com/kr/vehicles/bongo3/price/1ton-t-lpdi-2wd';
const BONGO_LPG_4WD_URL = 'https://www.kia.com/kr/vehicles/bongo3/price/1ton-t-lpdi-4wd';
const BONGO_LPG_12T_URL = 'https://www.kia.com/kr/vehicles/bongo3/price/1p2ton-t-lpdi-2wd';
const BONGO_LPG_NOTE = '기아 The 2026 Bongo III 공식 가격·제원 및 2023-11-23 LPG 터보 출시자료 기준. 스마트스트림 LPG 2.5 터보 2,469cc. 캡·적재량·축·구동·변속기별 실제 판매 트림을 분리함. 1차확인.';
type BongoLpgConfig = {
  suffix: string;
  subModel: string;
  drive: '2WD' | '4WD';
  seats: number;
  url: string;
  variants: ReadonlyArray<{ transmission: string; trims: readonly string[] }>;
};
const oneTon2wdVariants = [
  { transmission: '수동6단', trims: ['L 라이트', 'L', 'GL', 'GLS'] },
  { transmission: '자동5단', trims: ['L 라이트', 'L', 'GL', 'GLS'] },
] as const;
const BONGO_LPG_CONFIGS: readonly BongoLpgConfig[] = [
  { suffix: '1t-2wd-king-extra', subModel: '봉고III LPG 1톤 킹캡 초장축', drive: '2WD', seats: 3, url: BONGO_LPG_2WD_URL,
    variants: [{ transmission: '수동6단', trims: ['L 라이트', 'L', 'GL', 'GLS'] }, { transmission: '자동5단', trims: ['L 라이트', 'L', '스마트 셀렉션', 'GL', 'GLS'] }] },
  { suffix: '1t-2wd-double-extra', subModel: '봉고III LPG 1톤 더블캡 초장축', drive: '2WD', seats: 6, url: BONGO_LPG_2WD_URL, variants: oneTon2wdVariants },
  { suffix: '1t-2wd-standard-extra', subModel: '봉고III LPG 1톤 표준캡 초장축', drive: '2WD', seats: 3, url: BONGO_LPG_2WD_URL, variants: oneTon2wdVariants },
  { suffix: '1t-4wd-king-long', subModel: '봉고III LPG 1톤 킹캡 장축 4WD', drive: '4WD', seats: 3, url: BONGO_LPG_4WD_URL,
    variants: [{ transmission: '수동6단', trims: ['GL 라이트', 'GL', 'GLS'] }] },
  { suffix: '1t-4wd-double-long', subModel: '봉고III LPG 1톤 더블캡 장축 4WD', drive: '4WD', seats: 6, url: BONGO_LPG_4WD_URL,
    variants: [{ transmission: '수동6단', trims: ['GL 라이트', 'GL', 'GLS'] }] },
  { suffix: '1t-4wd-standard-long', subModel: '봉고III LPG 1톤 표준캡 장축 4WD', drive: '4WD', seats: 3, url: BONGO_LPG_4WD_URL,
    variants: [{ transmission: '수동6단', trims: ['GL 라이트', 'GL', 'GLS'] }] },
  { suffix: '1p2t-2wd-king-extra', subModel: '봉고III LPG 1.2톤 킹캡 초장축', drive: '2WD', seats: 3, url: BONGO_LPG_12T_URL,
    variants: [{ transmission: '수동6단', trims: ['GL', 'GLS'] }, { transmission: '자동5단', trims: ['스마트 셀렉션', 'GL', 'GLS'] }] },
  { suffix: '1p2t-2wd-standard-extra', subModel: '봉고III LPG 1.2톤 표준캡 초장축', drive: '2WD', seats: 3, url: BONGO_LPG_12T_URL,
    variants: [{ transmission: '수동6단', trims: ['GL', 'GLS'] }, { transmission: '자동5단', trims: ['GL', 'GLS'] }] },
];
const bongoLpgRows = BONGO_LPG_CONFIGS.flatMap((config) => {
  const masterId = `mf-002.md-076.sm-pu__bongo3-lpg-${config.suffix}`;
  return config.variants.flatMap((variant, powertrainIndex) => variant.trims.map((trim, trimIndex) => [
    '검증중', '1차확인', '신차', '국산', '기아', '봉고3', config.subModel,
    `LPG 2.5T ${config.drive} ${variant.transmission}`, trim,
    `${masterId}::v${String(powertrainIndex + 1).padStart(2, '0')}::t${String(trimIndex + 1).padStart(2, '0')}`,
    masterId, powertrainIndex + 1, trimIndex + 1, '4세대', 'PU', '2023-11', '현재', '2026', '현재',
    'LPG', 2469, 2.5, '예', config.drive, config.seats, '',
    `봉고3 LPG,봉고III LPG,봉고 LPG 터보,${config.subModel.replace('봉고III LPG ', '')}`,
    config.url, BONGO_LPG_NOTE, DATA_AS_OF,
  ]));
});
const SOLATI_URL = 'https://www.hyundai.com/ccontents/carmng/CP00000012/solati-2025-7-price.pdf';
const SOLATI_SPEC_URL = 'https://www.hyundai.com/kr/ko/c/products/bus/solati';
const SOLATI_CATALOG_URL = 'https://www.hyundai.com/ccontents/carmng/CP00000012/solati-catalog.pdf';
const SOLATI_LEGACY_NOTE = `현대 쏠라티 2025-07 공식 가격표 및 모델 제원 기준으로 처음 발급했으나 정확 배기량을 공란으로 등록한 영구키다. 이후 공식 카탈로그에서 A2.5 CRDi 디젤 eVGT의 총배기량 2,497cc를 확인했지만 발급된 키의 의미를 바꾸지 않고 차단하며, 정확 제원을 가진 신규 키로 재발급한다. 카탈로그: ${SOLATI_CATALOG_URL}`;
const SOLATI_2497_NOTE = `현대 쏠라티 2025-07 공식 가격표와 공식 카탈로그 기준. A2.5 CRDi 디젤 eVGT 2,497cc, 170PS/43kgf·m, 자동8단, 후륜구동이며 15인승 스탠다드·디럭스·럭셔리와 16인승 디럭스를 구분한다. eVGT 명시를 터보 근거로 사용한다. 현행 모델 페이지: ${SOLATI_SPEC_URL}`;
const SOLATI_CONFIGS = [
  { suffix: '15-seat', subModel: '쏠라티 15인승', seats: 15, trims: ['스탠다드', '디럭스', '럭셔리'] },
  { suffix: '16-seat', subModel: '쏠라티 16인승', seats: 16, trims: ['디럭스'] },
] as const;
const solatiRows = SOLATI_CONFIGS.flatMap((config) => {
  const masterId = `mf-001.md-070.sm-eu__solati-${config.suffix}`;
  return config.trims.map((trim, trimIndex) => [
    '제외', '1차확인', '신차', '국산', '현대', '쏠라티', config.subModel,
    '디젤 2.5 CRDi RWD 자동8단', trim, `${masterId}::v01::t${String(trimIndex + 1).padStart(2, '0')}`,
    masterId, 1, trimIndex + 1, '1세대', 'EU', '2025-07', '현재', '2025', '현재',
    '디젤', '', 2.5, '예', 'RWD', config.seats, '',
    `솔라티,SOLATI,쏠라티 버스,${config.seats}인승 쏠라티`, SOLATI_URL, SOLATI_LEGACY_NOTE, DATA_AS_OF,
  ]);
});
const solati2497Rows = SOLATI_CONFIGS.flatMap((config) => {
  const masterId = `mf-001.md-070.sm-eu__solati-${config.suffix}-2497`;
  return config.trims.map((trim, trimIndex) => [
    '검증중', '교차확인', '신차', '국산', '현대', '쏠라티', config.subModel,
    '디젤 2.5 CRDi eVGT RWD 자동8단', trim, `${masterId}::v01::t${String(trimIndex + 1).padStart(2, '0')}`,
    masterId, 1, trimIndex + 1, '1세대', 'EU', '2025-07', '현재', '2025', '현재',
    '디젤', 2497, 2.5, '예', 'RWD', config.seats, '',
    `솔라티,SOLATI,쏠라티 버스,${config.seats}인승 쏠라티,A2.5 CRDi,eVGT`, SOLATI_CATALOG_URL, SOLATI_2497_NOTE, DATA_AS_OF,
  ]);
});
const BONGO_POWERGATE_URL = 'https://www.kia.com/kr/vehicles/bongo3-powergate/price';
const BONGO_POWERGATE_NOTE = '기아 2026-08 봉고III 파워게이트 공식 가격·특장제원 기준. 킹캡 초장축 2WD, 수직형(2단)/턴인형(2단), 리프트능력 600kg. 1톤은 자동5단 L, 1.2톤은 수동6단 기본·자동5단 선택 GL. 1차확인.';
const BONGO_POWERGATE_CONFIGS = [
  { suffix: '1t-vertical', subModel: '봉고III LPG 1톤 파워게이트 수직형(2단) 킹캡 초장축', trim: 'L', transmissions: ['자동5단'] },
  { suffix: '1t-turn-in', subModel: '봉고III LPG 1톤 파워게이트 턴인형(2단) 킹캡 초장축', trim: 'L', transmissions: ['자동5단'] },
  { suffix: '1p2t-vertical', subModel: '봉고III LPG 1.2톤 파워게이트 수직형(2단) 킹캡 초장축', trim: 'GL', transmissions: ['수동6단', '자동5단'] },
  { suffix: '1p2t-turn-in', subModel: '봉고III LPG 1.2톤 파워게이트 턴인형(2단) 킹캡 초장축', trim: 'GL', transmissions: ['수동6단', '자동5단'] },
] as const;
const bongoPowergateRows = BONGO_POWERGATE_CONFIGS.flatMap((config) => {
  const masterId = `mf-002.md-077.sm-pu__bongo3-lpg-powergate-${config.suffix}`;
  return config.transmissions.map((transmission, powertrainIndex) => [
    '검증중', '1차확인', '신차', '국산', '기아', '봉고3', config.subModel,
    `LPG 2.5T 2WD ${transmission}`, config.trim, `${masterId}::v${String(powertrainIndex + 1).padStart(2, '0')}::t01`,
    masterId, powertrainIndex + 1, 1, '4세대', 'PU', '2023-11', '현재', '2026', '현재',
    'LPG', 2469, 2.5, '예', '2WD', 3, '',
    `봉고3 파워게이트,봉고III 파워게이트,${config.subModel.replace('봉고III LPG ', '')}`,
    BONGO_POWERGATE_URL, BONGO_POWERGATE_NOTE, DATA_AS_OF,
  ]);
});
const BONGO_TOPCAR_URL = 'https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_topcar.pdf';
type BongoTopcarConfig = {
  suffix: string;
  body: string;
  cab: '킹캡' | '표준캡';
  trim: 'L라이트' | 'L' | 'GL';
  transmissions: readonly ('수동6단' | '자동5단')[];
};
const BONGO_BUILT_IN_CONFIGS: readonly BongoTopcarConfig[] = [
  { suffix: 'low-king-llight', body: '로우', cab: '킹캡', trim: 'L라이트', transmissions: ['수동6단', '자동5단'] },
  { suffix: 'standard-king-llight', body: '스탠다드', cab: '킹캡', trim: 'L라이트', transmissions: ['수동6단', '자동5단'] },
  { suffix: 'standard-king-l', body: '스탠다드', cab: '킹캡', trim: 'L', transmissions: ['수동6단', '자동5단'] },
  { suffix: 'standard-king-gl', body: '스탠다드', cab: '킹캡', trim: 'GL', transmissions: ['자동5단'] },
  { suffix: 'high-king-llight', body: '하이', cab: '킹캡', trim: 'L라이트', transmissions: ['수동6단', '자동5단'] },
  { suffix: 'high-standard-l', body: '하이', cab: '표준캡', trim: 'L', transmissions: ['수동6단', '자동5단'] },
  { suffix: 'high-king-l', body: '하이', cab: '킹캡', trim: 'L', transmissions: ['수동6단', '자동5단'] },
  { suffix: 'high-king-gl', body: '하이', cab: '킹캡', trim: 'GL', transmissions: ['자동5단'] },
];
const BONGO_FROZEN_CONFIGS: readonly BongoTopcarConfig[] = [
  { suffix: 'low-king-llight', body: '로우', cab: '킹캡', trim: 'L라이트', transmissions: ['수동6단', '자동5단'] },
  { suffix: 'standard-king-llight', body: '스탠다드', cab: '킹캡', trim: 'L라이트', transmissions: ['수동6단', '자동5단'] },
  { suffix: 'standard-standard-l', body: '스탠다드', cab: '표준캡', trim: 'L', transmissions: ['수동6단', '자동5단'] },
  { suffix: 'standard-king-l', body: '스탠다드', cab: '킹캡', trim: 'L', transmissions: ['수동6단', '자동5단'] },
  { suffix: 'standard-king-gl', body: '스탠다드', cab: '킹캡', trim: 'GL', transmissions: ['자동5단'] },
  { suffix: 'high-king-llight', body: '하이', cab: '킹캡', trim: 'L라이트', transmissions: ['수동6단', '자동5단'] },
  { suffix: 'high-king-l', body: '하이', cab: '킹캡', trim: 'L', transmissions: ['수동6단', '자동5단'] },
  { suffix: 'high-king-gl', body: '하이', cab: '킹캡', trim: 'GL', transmissions: ['자동5단'] },
];
function buildBongoTopcarRows(
  kind: '내장탑차' | '냉동탑차',
  modelCode: '078' | '079',
  configs: readonly BongoTopcarConfig[],
) {
  const slug = kind === '내장탑차' ? 'built-in' : 'frozen';
  const note = `기아 봉고III 특장 2026-07 공식 가격표 기준. LPG 2.5 터보 1톤 2WD ${kind}의 로우/스탠다드/하이, 킹캡/표준캡, L라이트/L/GL 실제 판매 조합과 5단 자동변속기 선택 가능 여부를 분리함. GL은 자동5단 기본. 1차확인.`;
  return configs.flatMap((config) => {
    const masterId = `mf-002.md-${modelCode}.sm-pu__bongo3-lpg-${slug}-${config.suffix}`;
    const subModel = `봉고III LPG 1톤 ${kind} ${config.body} ${config.cab} 초장축`;
    return config.transmissions.map((transmission, powertrainIndex) => [
      '검증중', '1차확인', '신차', '국산', '기아', '봉고3', subModel,
      `LPG 2.5T 2WD ${transmission}`, config.trim,
      `${masterId}::v${String(powertrainIndex + 1).padStart(2, '0')}::t01`, masterId,
      powertrainIndex + 1, 1, '4세대', 'PU', '2023-11', '현재', '2026', '현재',
      'LPG', 2469, 2.5, '예', '2WD', 3, '',
      `봉고3 ${kind},봉고III ${kind},봉고 ${kind},${kind} ${config.body} ${config.cab} 초장축`,
      BONGO_TOPCAR_URL, note, DATA_AS_OF,
    ]);
  });
}
const bongoBuiltInRows = buildBongoTopcarRows('내장탑차', '078', BONGO_BUILT_IN_CONFIGS);
const bongoFrozenRows = buildBongoTopcarRows('냉동탑차', '079', BONGO_FROZEN_CONFIGS);
const BONGO_REFRIGERATED_CONFIGS = [
  { modelCode: '080', suffix: 'standard-king', body: '냉장탑차 스탠다드', transmissions: ['자동5단'] },
  { modelCode: '080', suffix: 'high-king', body: '냉장탑차 하이', transmissions: ['수동6단', '자동5단'] },
  { modelCode: '081', suffix: 'standard-king', body: '냉장탑 파워게이트 스탠다드', transmissions: ['자동5단'] },
] as const;
const BONGO_REFRIGERATED_NOTE = '기아 봉고III 특장 2026-07 공식 가격표 기준. LPG 2.5 터보 1톤 2WD 냉장탑차 스탠다드/하이 및 냉장탑 파워게이트 스탠다드 판매 조합을 분리함. 냉장탑 스탠다드와 파워게이트는 자동5단 기본, 하이는 수동6단 기본·자동5단 선택. 1차확인.';
const bongoRefrigeratedRows = BONGO_REFRIGERATED_CONFIGS.flatMap((config) => {
  const masterId = `mf-002.md-${config.modelCode}.sm-pu__bongo3-lpg-${config.modelCode === '080' ? 'refrigerated' : 'refrigerated-powergate'}-${config.suffix}`;
  const subModel = `봉고III LPG 1톤 ${config.body} 킹캡 초장축`;
  return config.transmissions.map((transmission, powertrainIndex) => [
    '검증중', '1차확인', '신차', '국산', '기아', '봉고3', subModel,
    `LPG 2.5T 2WD ${transmission}`, 'L',
    `${masterId}::v${String(powertrainIndex + 1).padStart(2, '0')}::t01`, masterId,
    powertrainIndex + 1, 1, '4세대', 'PU', '2023-11', '현재', '2026', '현재',
    'LPG', 2469, 2.5, '예', '2WD', 3, '',
    `봉고3 ${config.body},봉고III ${config.body},봉고 ${config.body},${config.body} 킹캡 초장축`,
    BONGO_TOPCAR_URL, BONGO_REFRIGERATED_NOTE, DATA_AS_OF,
  ]);
});
const BONGO_EV_TOPCAR_URL = 'https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_topcar-ev.pdf';
const BONGO_EV_TOPCAR_CONFIGS = [
  { modelCode: '082', suffix: 'built-in-low', body: 'EV 내장탑차 로우' },
  { modelCode: '082', suffix: 'built-in-standard', body: 'EV 내장탑차 스탠다드' },
  { modelCode: '082', suffix: 'built-in-high', body: 'EV 내장탑차 하이' },
  { modelCode: '083', suffix: 'frozen-low', body: 'EV 냉동탑차 로우' },
  { modelCode: '083', suffix: 'frozen-standard', body: 'EV 냉동탑차 스탠다드' },
  { modelCode: '083', suffix: 'frozen-high', body: 'EV 냉동탑차 하이' },
  { modelCode: '084', suffix: 'wing-manual', body: 'EV 윙바디 수동식' },
  { modelCode: '084', suffix: 'wing-electric', body: 'EV 윙바디 전동식' },
  { modelCode: '085', suffix: 'sliding-low', body: 'EV 양문형 미닫이탑차 로우' },
  { modelCode: '085', suffix: 'sliding-high', body: 'EV 양문형 미닫이탑차 하이' },
  { modelCode: '086', suffix: 'powergate-vertical', body: 'EV 파워게이트 수직형(2단)' },
  { modelCode: '086', suffix: 'powergate-turn-in', body: 'EV 파워게이트 턴인형(2단)' },
] as const;
const BONGO_EV_TOPCAR_NOTE = '기아 봉고III EV 특장 2026-07 공식 가격표·제원 기준. EV 1톤 킹캡 초장축 2WD GL, 135kW 모터·60.4kWh 배터리. 내장/냉동탑차, 윙바디, 양문형 미닫이탑차, 파워게이트 실제 판매 차체형식을 분리함. 윙바디 수동식/전동식은 변속기가 아닌 윙 개폐방식. 1차확인.';
const bongoEvTopcarRows = BONGO_EV_TOPCAR_CONFIGS.map((config) => {
  const masterId = `mf-002.md-${config.modelCode}.sm-pu__bongo3-${config.suffix}`;
  const subModel = `봉고III ${config.body} 킹캡 초장축`;
  return [
    '검증중', '1차확인', '신차', '국산', '기아', '봉고3', subModel,
    '전기 60.4kWh 2WD', 'GL', `${masterId}::v01::t01`, masterId, 1, 1,
    '4세대', 'PU', '2026-05', '현재', '2026', '현재', '전기', '', '', '아니오', '2WD', 3, 60.4,
    `봉고3 ${config.body},봉고III ${config.body},봉고 EV 특장,${config.body} 킹캡 초장축`,
    BONGO_EV_TOPCAR_URL, BONGO_EV_TOPCAR_NOTE, DATA_AS_OF,
  ];
});
const BONGO_LPG_LOGISTICS_CONFIGS = [
  { modelCode: '087', suffix: 'sliding-low', body: '양문형 미닫이탑차 로우', trim: 'L', transmissions: ['자동5단'] },
  { modelCode: '087', suffix: 'sliding-high', body: '양문형 미닫이탑차 하이', trim: 'L', transmissions: ['자동5단'] },
  { modelCode: '088', suffix: 'delivery-high', body: '택배전용탑차 하이', trim: 'L', transmissions: ['자동5단'] },
  { modelCode: '089', suffix: 'built-in-powergate-high', body: '내장탑 파워게이트 하이', trim: 'L', transmissions: ['자동5단'] },
  { modelCode: '090', suffix: 'walk-through-van', body: '워크스루밴', trim: 'L', transmissions: ['자동5단'] },
] as const;
const BONGO_LPG_LOGISTICS_NOTE = '기아 봉고III 특장 2026-07 공식 가격표 기준. LPG 2.5 터보 1톤 킹캡 초장축 2WD 양문형 미닫이탑차, 택배전용탑차, 내장탑 파워게이트, 워크스루밴의 실제 판매 차체형식을 분리함. 모두 L·자동5단 기본 구성. 1차확인.';
const bongoLpgLogisticsRows = BONGO_LPG_LOGISTICS_CONFIGS.flatMap((config) => {
  const masterId = `mf-002.md-${config.modelCode}.sm-pu__bongo3-lpg-${config.suffix}`;
  const subModel = `봉고III LPG 1톤 ${config.body} 킹캡 초장축`;
  return config.transmissions.map((transmission, powertrainIndex) => [
    '검증중', '1차확인', '신차', '국산', '기아', '봉고3', subModel,
    `LPG 2.5T 2WD ${transmission}`, config.trim,
    `${masterId}::v${String(powertrainIndex + 1).padStart(2, '0')}::t01`, masterId,
    powertrainIndex + 1, 1, '4세대', 'PU', '2023-11', '현재', '2026', '현재',
    'LPG', 2469, 2.5, '예', '2WD', 3, '',
    `봉고3 ${config.body},봉고III ${config.body},봉고 ${config.body},${config.body} 킹캡 초장축`,
    BONGO_TOPCAR_URL, BONGO_LPG_LOGISTICS_NOTE, DATA_AS_OF,
  ]);
});
const BONGO_LPG_WING_CONFIGS = [
  { suffix: 'manual-llight', body: '윙바디 수동식', trim: 'L라이트', transmissions: ['수동6단', '자동5단'] },
  { suffix: 'electric-llight', body: '윙바디 전동식', trim: 'L라이트', transmissions: ['수동6단', '자동5단'] },
  { suffix: 'manual-l', body: '윙바디 수동식', trim: 'L', transmissions: ['수동6단', '자동5단'] },
  { suffix: 'electric-l', body: '윙바디 전동식', trim: 'L', transmissions: ['수동6단', '자동5단'] },
  { suffix: 'manual-gl', body: '윙바디 수동식', trim: 'GL', transmissions: ['자동5단'] },
  { suffix: 'electric-gl', body: '윙바디 전동식', trim: 'GL', transmissions: ['자동5단'] },
  { suffix: 'expanded-gl', body: '윙바디 확장형', trim: 'GL', transmissions: ['자동5단'] },
] as const;
const BONGO_LPG_WING_NOTE = '기아 봉고III 특장 2026-07 공식 가격표 기준. LPG 2.5 터보 1톤 킹캡 초장축 2WD 윙바디 수동식/전동식/확장형, L라이트/L/GL 및 수동6단·자동5단 판매 조합을 분리함. 수동식/전동식은 변속기가 아닌 윙 개폐방식. GL은 자동5단 기본. 1차확인.';
const bongoLpgWingRows = BONGO_LPG_WING_CONFIGS.flatMap((config) => {
  const masterId = `mf-002.md-091.sm-pu__bongo3-lpg-wing-${config.suffix}`;
  const subModel = `봉고III LPG 1톤 ${config.body} 킹캡 초장축`;
  return config.transmissions.map((transmission, powertrainIndex) => [
    '검증중', '1차확인', '신차', '국산', '기아', '봉고3', subModel,
    `LPG 2.5T 2WD ${transmission}`, config.trim,
    `${masterId}::v${String(powertrainIndex + 1).padStart(2, '0')}::t01`, masterId,
    powertrainIndex + 1, 1, '4세대', 'PU', '2023-11', '현재', '2026', '현재',
    'LPG', 2469, 2.5, '예', '2WD', 3, '',
    `봉고3 ${config.body},봉고III ${config.body},봉고 윙바디,${config.body} 킹캡 초장축`,
    BONGO_TOPCAR_URL, BONGO_LPG_WING_NOTE, DATA_AS_OF,
  ]);
});
const PORTER_SPECIAL_2024_URL = 'https://www.hyundai.com/contents/repn-car/catalog/porter2-special-2024-price.pdf';
const PORTER_SPECIAL_BUILT_IN_CONFIGS = [
  { modelCode: '071', suffix: 'standard-super-style', body: '내장탑차', cab: '슈퍼캡', seats: 3, trim: '스타일' },
  { modelCode: '071', suffix: 'standard-super-smart', body: '내장탑차', cab: '슈퍼캡', seats: 3, trim: '스마트' },
  { modelCode: '071', suffix: 'standard-super-modern-plus', body: '내장탑차', cab: '슈퍼캡', seats: 3, trim: '모던 플러스' },
  { modelCode: '071', suffix: 'standard-double-smart', body: '내장탑차', cab: '더블캡', seats: 6, trim: '스마트' },
  { modelCode: '072', suffix: 'high-standard-smart', body: '하이내장탑차', cab: '일반캡', seats: 3, trim: '스마트' },
  { modelCode: '072', suffix: 'high-super-style', body: '하이내장탑차', cab: '슈퍼캡', seats: 3, trim: '스타일' },
  { modelCode: '072', suffix: 'high-super-smart', body: '하이내장탑차', cab: '슈퍼캡', seats: 3, trim: '스마트' },
  { modelCode: '072', suffix: 'high-super-modern-plus', body: '하이내장탑차', cab: '슈퍼캡', seats: 3, trim: '모던 플러스' },
  { modelCode: '073', suffix: 'built-in-powergate-super-smart', body: '내장탑 파워게이트', cab: '슈퍼캡', seats: 3, trim: '스마트' },
  { modelCode: '074', suffix: 'low-super-style', body: '저상내장탑차', cab: '슈퍼캡', seats: 3, trim: '스타일' },
] as const;
const PORTER_SPECIAL_BUILT_IN_NOTE = '현대 2024 포터II 특장차 공식 가격표 기준. 현 모델 출시일 2024-01-09, 스마트스트림 LPG 2.5 터보 2,469cc. 내장탑차/하이내장탑차/내장탑 파워게이트/저상내장탑차의 캡·트림과 공통 선택사양인 자동5단을 수동6단과 분리함. 생산종료는 공식 근거가 없어 공란 유지. 1차확인.';
const porterSpecialBuiltInRows = PORTER_SPECIAL_BUILT_IN_CONFIGS.flatMap((config) => {
  const masterId = `mf-001.md-${config.modelCode}.sm-hr__porter2-lpg-special-${config.suffix}`;
  const subModel = `포터II LPG 1톤 ${config.body} ${config.cab} 초장축`;
  return ['수동6단', '자동5단'].map((transmission, powertrainIndex) => [
    '검증중', '1차확인', '중고차', '국산', '현대', '포터', subModel,
    `LPG 2.5T 2WD ${transmission}`, config.trim,
    `${masterId}::v${String(powertrainIndex + 1).padStart(2, '0')}::t01`, masterId,
    powertrainIndex + 1, 1, '4세대', 'HR', '2024-01', '', '2024', '2024',
    'LPG', 2469, 2.5, '예', '2WD', config.seats, '',
    `포터2 ${config.body},포터II ${config.body},포터 ${config.body},${config.body} ${config.cab} 초장축`,
    PORTER_SPECIAL_2024_URL, PORTER_SPECIAL_BUILT_IN_NOTE, DATA_AS_OF,
  ]);
});
const PORTER_SPECIAL_COLD_CONFIGS = [
  { modelCode: '075', suffix: 'frozen-standard-smart', body: '냉동탑차 트윈컴프', cab: '일반캡', trim: '스마트' },
  { modelCode: '075', suffix: 'frozen-super-style', body: '냉동탑차 트윈컴프', cab: '슈퍼캡', trim: '스타일' },
  { modelCode: '075', suffix: 'frozen-super-smart', body: '냉동탑차 트윈컴프', cab: '슈퍼캡', trim: '스마트' },
  { modelCode: '075', suffix: 'frozen-super-modern-plus', body: '냉동탑차 트윈컴프', cab: '슈퍼캡', trim: '모던 플러스' },
  { modelCode: '076', suffix: 'ultra-low-frozen-super-smart', body: '초저온냉동탑차 트윈컴프 일체형', cab: '슈퍼캡', trim: '스마트' },
  { modelCode: '077', suffix: 'high-frozen-standard-smart', body: '하이냉동탑차 트윈컴프', cab: '일반캡', trim: '스마트' },
  { modelCode: '077', suffix: 'high-frozen-super-style', body: '하이냉동탑차 트윈컴프', cab: '슈퍼캡', trim: '스타일' },
  { modelCode: '077', suffix: 'high-frozen-super-smart', body: '하이냉동탑차 트윈컴프', cab: '슈퍼캡', trim: '스마트' },
  { modelCode: '077', suffix: 'high-frozen-super-modern-plus', body: '하이냉동탑차 트윈컴프', cab: '슈퍼캡', trim: '모던 플러스' },
  { modelCode: '078', suffix: 'low-frozen-super-style', body: '저상냉동탑차 트윈컴프', cab: '슈퍼캡', trim: '스타일' },
  { modelCode: '079', suffix: 'refrigerated-super-style', body: '냉장탑차 트윈컴프', cab: '슈퍼캡', trim: '스타일' },
  { modelCode: '079', suffix: 'refrigerated-super-smart', body: '냉장탑차 트윈컴프', cab: '슈퍼캡', trim: '스마트' },
  { modelCode: '080', suffix: 'high-refrigerated-super-style', body: '하이냉장탑차 트윈컴프', cab: '슈퍼캡', trim: '스타일' },
  { modelCode: '080', suffix: 'high-refrigerated-super-smart', body: '하이냉장탑차 트윈컴프', cab: '슈퍼캡', trim: '스마트' },
] as const;
const PORTER_SPECIAL_COLD_NOTE = '현대 2024 포터II 특장차 공식 가격표 기준. 2024-01-09 출시 스마트스트림 LPG 2.5 터보 2,469cc. 냉동/초저온/하이/저상냉동 및 냉장/하이냉장 탑차의 캡·트림·트윈컴프 구성과 공통 자동5단 선택을 수동6단과 분리함. 생산종료는 공식 근거가 없어 공란 유지. 1차확인.';
const porterSpecialColdRows = PORTER_SPECIAL_COLD_CONFIGS.flatMap((config) => {
  const masterId = `mf-001.md-${config.modelCode}.sm-hr__porter2-lpg-special-${config.suffix}`;
  const subModel = `포터II LPG 1톤 ${config.body} ${config.cab} 초장축`;
  return ['수동6단', '자동5단'].map((transmission, powertrainIndex) => [
    '검증중', '1차확인', '중고차', '국산', '현대', '포터', subModel,
    `LPG 2.5T 2WD ${transmission}`, config.trim,
    `${masterId}::v${String(powertrainIndex + 1).padStart(2, '0')}::t01`, masterId,
    powertrainIndex + 1, 1, '4세대', 'HR', '2024-01', '', '2024', '2024',
    'LPG', 2469, 2.5, '예', '2WD', 3, '',
    `포터2 ${config.body},포터II ${config.body},포터 ${config.body},${config.body} ${config.cab} 초장축`,
    PORTER_SPECIAL_2024_URL, PORTER_SPECIAL_COLD_NOTE, DATA_AS_OF,
  ]);
});
const PORTER_SPECIAL_WING_CONFIGS = [
  { modelCode: '081', suffix: 'manual-style', body: '윙바디 수동식', trim: '스타일' },
  { modelCode: '081', suffix: 'manual-smart', body: '윙바디 수동식', trim: '스마트' },
  { modelCode: '082', suffix: 'electric-style', body: '윙바디 전동식', trim: '스타일' },
  { modelCode: '082', suffix: 'electric-smart', body: '윙바디 전동식', trim: '스마트' },
  { modelCode: '082', suffix: 'electric-modern-plus', body: '윙바디 전동식', trim: '모던 플러스' },
] as const;
const PORTER_SPECIAL_WING_NOTE = '현대 2024 포터II 특장차 공식 가격표 기준. LPG 2.5 터보 1톤 슈퍼캡 초장축 2WD 윙바디 수동식/전동식, 스타일/스마트/모던 플러스와 수동6단·자동5단 판매 조합을 분리함. 수동식/전동식은 변속기가 아닌 윙 개폐방식. 생산종료는 공식 근거가 없어 공란 유지. 1차확인.';
const porterSpecialWingRows = PORTER_SPECIAL_WING_CONFIGS.flatMap((config) => {
  const masterId = `mf-001.md-${config.modelCode}.sm-hr__porter2-lpg-special-wing-${config.suffix}`;
  const subModel = `포터II LPG 1톤 ${config.body} 슈퍼캡 초장축`;
  return ['수동6단', '자동5단'].map((transmission, powertrainIndex) => [
    '검증중', '1차확인', '중고차', '국산', '현대', '포터', subModel,
    `LPG 2.5T 2WD ${transmission}`, config.trim,
    `${masterId}::v${String(powertrainIndex + 1).padStart(2, '0')}::t01`, masterId,
    powertrainIndex + 1, 1, '4세대', 'HR', '2024-01', '', '2024', '2024',
    'LPG', 2469, 2.5, '예', '2WD', 3, '',
    `포터2 ${config.body},포터II ${config.body},포터 윙바디,${config.body} 슈퍼캡 초장축`,
    PORTER_SPECIAL_2024_URL, PORTER_SPECIAL_WING_NOTE, DATA_AS_OF,
  ]);
});
const PORTER_EV_SPECIAL_URL = 'https://www.hyundai.com/kr/en/fcev-ev/porter2-electric-special-vehicle/price';
const PORTER_EV_SPECIAL_SPEC_URL = 'https://org1.hyundai.com/kr/ko/e/vehicles/porter2-electric-special/intro';
const PORTER_EV_SPECIAL_CONFIGS = [
  { modelCode: '083', suffix: 'low-built-in', body: 'EV 저상내장탑차' },
  { modelCode: '084', suffix: 'built-in', body: 'EV 내장탑차' },
  { modelCode: '085', suffix: 'high-built-in', body: 'EV 하이내장탑차' },
  { modelCode: '086', suffix: 'powergate', body: 'EV 파워게이트' },
  { modelCode: '087', suffix: 'manual-wing', body: 'EV 윙바디 수동식' },
  { modelCode: '088', suffix: 'electric-wing', body: 'EV 윙바디 전동식' },
] as const;
const PORTER_EV_SPECIAL_NOTE = `현대 포터II Electric 특장차 공식 가격 페이지 2026-08-01 기준. 저상/일반/하이 내장탑차, 파워게이트, 수동식/전동식 윙바디 6종. 기본차 2026 가격표의 135kW·60.4kWh를 적용했으나 특장 소개 제원은 60.3kWh로 표기가 병존하여 1차확인 수동 후보로 유지. 세부 트림명은 공식 가격 페이지에 없어 '단일 사양'으로 기록. 제원 보조근거: ${PORTER_EV_SPECIAL_SPEC_URL}`;
const porterEvSpecialRows = PORTER_EV_SPECIAL_CONFIGS.map((config) => {
  const masterId = `mf-001.md-${config.modelCode}.sm-hr__porter2-${config.suffix}`;
  const subModel = `포터II ${config.body} 슈퍼캡 초장축`;
  return [
    '검증중', '1차확인', '신차', '국산', '현대', '포터', subModel,
    '전기 60.4kWh 2WD', '단일 사양', `${masterId}::v01::t01`, masterId, 1, 1,
    '4세대', 'HR', '2025-12', '현재', '2026', '현재', '전기', '', '', '아니오', '2WD', 3, 60.4,
    `포터2 ${config.body},포터II ${config.body},포터 EV 특장,${config.body} 슈퍼캡 초장축`,
    PORTER_EV_SPECIAL_URL, PORTER_EV_SPECIAL_NOTE, DATA_AS_OF,
  ];
});
const PORTER_SPECIAL_2020_URL = 'https://www.hyundai.com/content/dam/hyundai/kr/ko/data/vehicles/price/porter2-special-vehicle-price.pdf';
const PORTER_DIESEL_COLD_2020_CONFIGS = [
  { modelCode: '089', suffix: 'frozen-standard-smart', body: '냉동탑차', cab: '일반캡', trim: '스마트' },
  { modelCode: '089', suffix: 'frozen-super-style', body: '냉동탑차', cab: '슈퍼캡', trim: '스타일' },
  { modelCode: '089', suffix: 'frozen-super-smart', body: '냉동탑차', cab: '슈퍼캡', trim: '스마트' },
  { modelCode: '089', suffix: 'frozen-super-modern-plus', body: '냉동탑차', cab: '슈퍼캡', trim: '모던 플러스' },
  { modelCode: '090', suffix: 'high-frozen-standard-smart', body: '하이냉동탑차', cab: '일반캡', trim: '스마트' },
  { modelCode: '090', suffix: 'high-frozen-super-style', body: '하이냉동탑차', cab: '슈퍼캡', trim: '스타일' },
  { modelCode: '090', suffix: 'high-frozen-super-smart', body: '하이냉동탑차', cab: '슈퍼캡', trim: '스마트' },
  { modelCode: '090', suffix: 'high-frozen-super-modern-plus', body: '하이냉동탑차', cab: '슈퍼캡', trim: '모던 플러스' },
] as const;
const PORTER_DIESEL_COLD_2020_NOTE = '현대 2020 포터II 특장차 공식 가격표(2020-03-01 기준)와 포터II 기본차 가격표 기준. 2.5 CRDi 유로6 2WD 초장축 냉동탑차/하이냉동탑차의 일반캡·슈퍼캡 및 스타일/스마트/모던 플러스 실제 판매 조합을 반영하고, 기본 수동6단과 공통 A/T(자동5단) 선택을 분리함. 생산종료는 공식 근거가 없어 공란 유지. 1차확인.';
const porterDieselCold2020Rows = PORTER_DIESEL_COLD_2020_CONFIGS.flatMap((config) => {
  const masterId = `mf-001.md-${config.modelCode}.sm-hr__porter2-diesel-2020-${config.suffix}`;
  const subModel = `포터II 디젤 1톤 ${config.body} ${config.cab} 초장축`;
  return ['수동6단', '자동5단'].map((transmission, powertrainIndex) => [
    '검증중', '1차확인', '중고차', '국산', '현대', '포터', subModel,
    `디젤 2.5T 2WD ${transmission}`, config.trim,
    `${masterId}::v${String(powertrainIndex + 1).padStart(2, '0')}::t01`, masterId,
    powertrainIndex + 1, 1, '4세대', 'HR', '2020-03', '', '2020', '2020',
    '디젤', 2497, 2.5, '예', '2WD', 3, '',
    `포터2 ${config.body},포터II ${config.body},포터 디젤 ${config.body},${config.body} ${config.cab} 초장축`,
    PORTER_SPECIAL_2020_URL, PORTER_DIESEL_COLD_2020_NOTE, DATA_AS_OF,
  ]);
});
const PORTER_DIESEL_BODY_2020_CONFIGS = [
  { modelCode: '091', suffix: 'built-in-super-style', body: '내장탑차', cab: '슈퍼캡', trim: '스타일', seats: 3 },
  { modelCode: '091', suffix: 'built-in-super-smart', body: '내장탑차', cab: '슈퍼캡', trim: '스마트', seats: 3 },
  { modelCode: '091', suffix: 'built-in-super-modern-plus', body: '내장탑차', cab: '슈퍼캡', trim: '모던 플러스', seats: 3 },
  { modelCode: '091', suffix: 'built-in-double-smart', body: '내장탑차', cab: '더블캡', trim: '스마트', seats: 6 },
  { modelCode: '092', suffix: 'high-built-in-standard-smart', body: '하이내장탑차', cab: '일반캡', trim: '스마트', seats: 3 },
  { modelCode: '092', suffix: 'high-built-in-super-style', body: '하이내장탑차', cab: '슈퍼캡', trim: '스타일', seats: 3 },
  { modelCode: '092', suffix: 'high-built-in-super-smart', body: '하이내장탑차', cab: '슈퍼캡', trim: '스마트', seats: 3 },
  { modelCode: '092', suffix: 'high-built-in-super-modern-plus', body: '하이내장탑차', cab: '슈퍼캡', trim: '모던 플러스', seats: 3 },
  { modelCode: '093', suffix: 'built-in-powergate-super-smart', body: '내장탑파워게이트', cab: '슈퍼캡', trim: '스마트', seats: 3 },
  { modelCode: '094', suffix: 'low-built-in-super-style', body: '저상내장탑차', cab: '슈퍼캡', trim: '스타일', seats: 3 },
  { modelCode: '095', suffix: 'manual-wing-super-style', body: '윙바디 수동식', cab: '슈퍼캡', trim: '스타일', seats: 3 },
  { modelCode: '095', suffix: 'manual-wing-super-smart', body: '윙바디 수동식', cab: '슈퍼캡', trim: '스마트', seats: 3 },
  { modelCode: '096', suffix: 'electric-wing-super-style', body: '윙바디 전동식', cab: '슈퍼캡', trim: '스타일', seats: 3 },
  { modelCode: '096', suffix: 'electric-wing-super-smart', body: '윙바디 전동식', cab: '슈퍼캡', trim: '스마트', seats: 3 },
] as const;
const PORTER_DIESEL_BODY_2020_NOTE = '현대 2020 포터II 특장차 공식 가격표(2020-03-01 기준)와 기본차 가격표 기준. 2.5 CRDi 유로6 2WD 초장축 내장탑차·하이내장탑차·내장탑파워게이트·저상내장탑차·수동식/전동식 윙바디의 실제 캡·트림 조합을 반영하고 기본 수동6단과 공통 A/T(자동5단)를 분리함. 윙바디 수동식/전동식은 변속기가 아닌 윙 개폐방식. 생산종료는 공식 근거가 없어 공란 유지. 1차확인.';
const porterDieselBody2020Rows = PORTER_DIESEL_BODY_2020_CONFIGS.flatMap((config) => {
  const masterId = `mf-001.md-${config.modelCode}.sm-hr__porter2-diesel-2020-${config.suffix}`;
  const subModel = `포터II 디젤 1톤 ${config.body} ${config.cab} 초장축`;
  return ['수동6단', '자동5단'].map((transmission, powertrainIndex) => [
    '검증중', '1차확인', '중고차', '국산', '현대', '포터', subModel,
    `디젤 2.5T 2WD ${transmission}`, config.trim,
    `${masterId}::v${String(powertrainIndex + 1).padStart(2, '0')}::t01`, masterId,
    powertrainIndex + 1, 1, '4세대', 'HR', '2020-03', '', '2020', '2020',
    '디젤', 2497, 2.5, '예', '2WD', config.seats, '',
    `포터2 ${config.body},포터II ${config.body},포터 디젤 ${config.body},${config.body} ${config.cab} 초장축`,
    PORTER_SPECIAL_2020_URL, PORTER_DIESEL_BODY_2020_NOTE, DATA_AS_OF,
  ]);
});
const rows = [
  ...bongoRows, ...porterRows, ...nexoRows, ...porterLpgRows, ...bongoLpgRows, ...solatiRows, ...solati2497Rows,
  ...bongoPowergateRows, ...bongoBuiltInRows, ...bongoFrozenRows, ...bongoRefrigeratedRows,
  ...bongoEvTopcarRows, ...bongoLpgLogisticsRows, ...bongoLpgWingRows, ...porterSpecialBuiltInRows,
  ...porterSpecialColdRows, ...porterSpecialWingRows, ...porterEvSpecialRows, ...porterDieselCold2020Rows,
  ...porterDieselBody2020Rows,
];

if (rows.some((row) => row.length !== HEADERS.length)) throw new Error('상용차 보강 행은 A:AD 30열이어야 합니다.');

function syncLocal() {
  const artifactPath = fileURLToPath(new URL('../public/data/vehicle-trim-master.json', import.meta.url));
  const registryPath = fileURLToPath(new URL('../data/vehicle-trim-key-registry.json', import.meta.url));
  const added = buildVehicleTrimMasterArtifact([HEADERS, ...rows], '1T_RrErmGoj_yG9S1u7n--2NDolTOw8wA8ROQjPWuAlg', '차종마스터');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as VehicleTrimMasterArtifact;
  const blockedSolatiCodes = new Set(solatiRows.map((row) => String(row[9])));
  const currentSolatiCodes = new Set(solati2497Rows.map((row) => String(row[9])));
  artifact.records = artifact.records.map((record) => blockedSolatiCodes.has(record.trim_row_key)
    ? { ...record, management_status: '제외', verification_status: '1차확인', usage_tier: 'blocked' as const }
    : currentSolatiCodes.has(record.trim_row_key)
      ? { ...record, data_as_of: DATA_AS_OF }
    : record);
  const present = new Set(artifact.records.map((record) => record.trim_row_key));
  artifact.records = [...artifact.records, ...added.records.filter((record) => !present.has(record.trim_row_key))]
    .sort((a, b) => a.trim_row_key.localeCompare(b.trim_row_key));
  artifact.data_as_of = DATA_AS_OF;
  artifact.row_count = artifact.records.length;
  artifact.manual_assignable_count = artifact.records.filter((record) => record.usage_tier === 'manual').length;
  artifact.automatic_assignable_count = artifact.records.filter((record) => record.usage_tier === 'automatic').length;
  artifact.blocked_count = artifact.row_count - artifact.manual_assignable_count - artifact.automatic_assignable_count;
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as TrimKeyRegistry;
  const solati2497CapturedRows = new Map(solati2497Rows.map((row, index) => [
    String(row[9]),
    SOLATI_2497_CAPTURED_START_ROW + index,
  ]));
  const generated = trimKeyRecordsFromValues([HEADERS, ...rows])
    .map((record, index) => ({
      ...record,
      capturedSheetRow: solati2497CapturedRows.get(record.code) ?? START_ROW + index,
    }));
  const registered = new Set(registry.records.map((record) => record.code));
  registry.records = [
    // 발급된 영구키의 의미와 최초 감사 좌표는 생성기 재실행으로 덮지 않는다.
    ...registry.records,
    ...generated.filter((record) => !registered.has(record.code)),
  ].sort((a, b) => a.code.localeCompare(b.code));
  registry.capturedAt = DATA_AS_OF;
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  console.log(`PASS 상용 렌트 핵심 ${added.records.length}행 동기화`);
}

if (process.argv.includes('--sync-local')) syncLocal();
else console.log(JSON.stringify({ startRow: START_ROW, endRow: START_ROW + rows.length - 1, rows }));
