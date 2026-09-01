/** Publish a non-operational review tab for three Hyundai models. */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { MASTER_SHEET_ID } from '../lib/domain/vehicle-master-sheet';
import {
  MASTER_FONT, MASTER_FONT_SIZE, MASTER_ROW_PX, masterCategoryColorRequests,
} from '../lib/domain/vehicle-master-sheet-format';

type Rec = Record<string, any>;
const APPLY = process.argv.includes('--apply');
const MAKER = process.argv.includes('--maker=전체') ? '전체' : process.argv.includes('--maker=제네시스') ? '제네시스' : process.argv.includes('--maker=기아') ? '기아' : '현대';
const ALL_PRODUCT_MAKERS = ['현대', '기아', '제네시스', '르노코리아', '쉐보레', 'KG모빌리티', '테슬라', '벤츠', 'BMW', '미니', '아우디', '지프', '볼보', '폴스타', '포드', '캐딜락', '폭스바겐'];
const SELECTED_MAKERS = MAKER === '전체' ? ALL_PRODUCT_MAKERS : [MAKER];
const REVIEW_TAB = MAKER === '전체' ? '차종마스터_규격검토' : `${MAKER}_규격검토`;
const LEGACY_REVIEW_TAB = '현대3종_규격검토';
const HYUNDAI_MODELS = [
  '아반떼', '싼타페', '스타리아', '그랜저', '쏘나타', '투싼', '팰리세이드',
  '캐스퍼', '베뉴', '아이오닉5', '아이오닉6', '엑센트', '스타렉스', '코나',
];
const KIA_MODELS = ['카니발', '레이', 'K5', 'K8', '쏘렌토', 'EV6', '셀토스', '스포티지', '니로', 'K7', '모닝', 'K9', 'K3', '모하비'];
const GENESIS_MODELS = ['G80', 'GV70', 'GV80', 'G90', 'G70', 'EQ900'];
let TARGET_MODELS = new Set(MAKER === '전체' ? [...HYUNDAI_MODELS, ...KIA_MODELS, ...GENESIS_MODELS] : MAKER === '제네시스' ? GENESIS_MODELS : MAKER === '기아' ? KIA_MODELS : HYUNDAI_MODELS);
const S = (value: unknown) => String(value ?? '').trim();

const SUB_MODEL_MAP: Record<string, string> = {
  '2021 싼타페 TM 부분변경': '더 뉴 싼타페 TM',
  '2026 싼타페 MX5 Black Ink': '디 올 뉴 싼타페 MX5',
  '2026 싼타페 MX5 H-Pick': '디 올 뉴 싼타페 MX5',
  '2026 아반떼 하이브리드 CN7': '더 뉴 아반떼 CN7',
  '2026 아반떼 LPi CN7': '더 뉴 아반떼 CN7',
  '2026 아반떼 LPi 렌터카 CN7': '더 뉴 아반떼 CN7',
  '2026 투싼 NX4 H-Pick': '더 뉴 투싼 NX4',
  'The new GRANDEUR GN11': '더 뉴 그랜저 GN11',
  '2027 캐스퍼 AX1 승용': '더 뉴 캐스퍼 AX1',
  '2027 캐스퍼 AX1 VAN': '더 뉴 캐스퍼 AX1',
  '캐스퍼 일렉트릭 AX1e 트림별 출시계보': '캐스퍼 일렉트릭 AX1e',
  '2027 아이오닉 5 영업용': '더 뉴 아이오닉5 NE',
  '2027 아이오닉 5 Long Range': '더 뉴 아이오닉5 NE',
  '2027 아이오닉 5 Standard': '더 뉴 아이오닉5 NE',
  '아이오닉 5 Long Range 72.6kWh': '아이오닉5 NE',
  '아이오닉 5 Long Range 77.4kWh': '아이오닉5 NE',
  '아이오닉 5 Standard 58.0kWh': '아이오닉5 NE',
  '아이오닉 5 영업용 2022': '아이오닉5 NE',
  '더 뉴 아이오닉 5 NE PE': '더 뉴 아이오닉5 NE PE',
  '2025 코나 SX2 Black Exterior': '디 올 뉴 코나 SX2',
  '2025 코나 SX2 H-Pick': '디 올 뉴 코나 SX2',
  '2027 코나 SX2': '디 올 뉴 코나 SX2',
  '2025 더 뉴 K5 DL3': '더 뉴 K5 DL3',
  'The 2026 K5 DL3': '더 뉴 K5 DL3',
  'The 2026 K8 GL3': '더 뉴 K8 GL3',
  '스포티지 NQ5 2022': '스포티지 NQ5',
  '더 뉴 쏘렌토 MQ4 2024': '더 뉴 쏘렌토 MQ4',
  'The 2027 K5 DL3': '더 뉴 K5 DL3',
  'The 2027 K5 렌터카 DL3': '더 뉴 K5 DL3',
  'K7 하이브리드 VG': 'K7 VG',
  'The 2027 Morning 가솔린 승용': '더 뉴 모닝 JA',
  'The 2027 Morning 가솔린 2인승 밴': '더 뉴 모닝 JA',
  '2026 쏘렌토 X-Line MQ4': '더 뉴 쏘렌토 MQ4',
  '2026 카니발 하이루프 KA4': '더 뉴 카니발 하이루프 KA4',
  '2026 카니발 X-Line KA4': '더 뉴 카니발 KA4',
  '2026 K8 베스트 셀렉션 GL3': '더 뉴 K8 GL3',
  'G80 3세대 초기형 RG3': 'G80 RG3',
  'G80 부분변경 RG3': 'G80 RG3 FL',
  '2025 G80 Black RG3': 'G80 RG3 FL',
  '2023 G70 슈팅 브레이크 IK': 'G70 슈팅 브레이크 IK',
  '2023 G70 IK': 'G70 IK',
  '2026 G70 그래파이트 에디션': 'G70 IK',
  '2023 G90 RS4': 'G90 RS4',
  '2024 G90 Black': 'G90 RS4',
  '2025 G90 롱휠베이스 Black': 'G90 롱휠베이스 RS4',
  'GV80 JX1 초기형': 'GV80 JX1',
  'GV80 부분변경 JX1': 'GV80 JX1 FL',
  '2024 GV80 Black JX1': 'GV80 JX1 FL',
  '2024 GV80 쿠페 Black': 'GV80 쿠페 JX1',
  '일렉트리파이드 G80 RG3 초기형': 'G80 EV RG3',
  'G80 전동화 부분변경 RG3': 'G80 EV RG3 FL',
  '일렉트리파이드 GV70 JK1 초기형': 'GV70 EV JK1',
  'GV70 전동화 부분변경 JK1': 'GV70 EV JK1 FL',
  'GV70 초기형 JK1': 'GV70 JK1',
  'GV70 부분변경 JK1': 'GV70 JK1 FL',
  '구형 Model 3 국내형': '모델 3',
  '구형 Model 3': '모델 3',
  'New Model 3 Highland': '모델 3 FL',
  'Model Y 2020-2024': '모델 Y',
  'Model Y 2021-2024': '모델 Y',
  'Model Y L': '모델 Y L',
  'New Model Y Premium': '모델 Y FL',
  'New Model Y Launch Series': '모델 Y FL',
  '니로 EV DE 64.0kWh': '니로 EV DE',
  'QM6 2025 국내형': 'QM6 HZG',
  'V60 Cross Country 2026': 'V60 크로스컨트리 2세대',
  '2026 XC40 B4 AWD': 'XC40',
  '2024 스타리아 카고 하이브리드': '스타리아 US4',
  '2024 스타리아 라운지 하이브리드': '스타리아 US4',
  '2024 스타리아 투어러 하이브리드': '스타리아 US4',
  '2025 스타리아 리무진 하이브리드': '스타리아 US4',
  '더 뉴 스타리아 라운지 LPG': '더 뉴 스타리아 US4',
  '더 뉴 스타리아 라운지 일렉트릭': '더 뉴 스타리아 US4',
  '더 뉴 스타리아 라운지 하이브리드': '더 뉴 스타리아 US4',
  '더 뉴 스타리아 리무진 일렉트릭': '더 뉴 스타리아 US4',
  '더 뉴 스타리아 리무진 하이브리드': '더 뉴 스타리아 US4',
  '더 뉴 스타리아 카고 LPG': '더 뉴 스타리아 US4',
  '더 뉴 스타리아 카고 일렉트릭': '더 뉴 스타리아 US4',
  '더 뉴 스타리아 카고 하이브리드': '더 뉴 스타리아 US4',
  '더 뉴 스타리아 투어러 LPG': '더 뉴 스타리아 US4',
  '더 뉴 스타리아 투어러 일렉트릭': '더 뉴 스타리아 US4',
  '더 뉴 스타리아 투어러 하이브리드': '더 뉴 스타리아 US4',
};

const canonicalDrive = (row: Rec) => {
  const drive = S(row.drivetrain).toUpperCase();
  if (!drive && row.model === '아반떼') return 'FWD';
  if (drive === '2WD') {
    const maker = S(row.maker);
    const model = S(row.model);
    const sub = S(row.sub_model);
    if (maker === '제네시스' || ['스타렉스', '아이오닉5', '아이오닉6', 'K9', '모하비', 'EV6'].includes(model)) return 'RWD';
    if (maker === '벤츠') return model === 'A-클래스' ? 'FWD' : 'RWD';
    if (maker === 'BMW') {
      if (model === '1시리즈') return /F20|F21/.test(sub) ? 'RWD' : /F40|F70/.test(sub) ? 'FWD' : '미확인';
      if (model === 'X1') return /E84/.test(sub) ? 'RWD' : /F48|U11/.test(sub) ? 'FWD' : '미확인';
      if (model === '2시리즈') return /F22|G42/.test(sub) ? 'RWD' : /F44|F74|F45|U06/.test(sub) ? 'FWD' : '미확인';
      return 'RWD';
    }
    if (maker === '포드' && model === '익스플로러') return 'RWD';
    if (maker === '폴스타') return '미확인';
    return 'FWD';
  }
  if (drive === '4WD') return 'AWD';
  if (['FWD', 'RWD', 'AWD'].includes(drive)) return drive;
  return drive || '미확인';
};
const brandedDriveSystem = (row: Rec) => {
  const drive = canonicalDrive(row);
  if (drive !== 'AWD') return '';
  if (/HTRAC/i.test(`${S(row.powertrain)} ${S(row.trim)} ${(row.trim_aliases || []).join(' ')}`)) return 'HTRAC';
  if (row.model === '스타리아') return 'HTRAC';
  if (row.model === '싼타페' && S(row.production_start) >= '2018-01') return 'HTRAC';
  return S(row.drivetrain).toUpperCase() === '4WD' ? '4WD' : '';
};
const canonicalTrim = (value: unknown, row?: Rec) => {
  const normalized = S(value)
    .replace(/\s+\d{1,2}인승(?=\s|$)/g, '')
    .replace(/(?:N\s*라인|엔\s*라인)/gi, 'N Line')
    .replace(/^(?:LPI|LPG|LPi|가솔린|디젤|하이브리드|전기)\s+/i, '')
    .replace(/^(?:HG\d{3}|GDI|VGT|VVT|CVX)\s+/i, '')
    .replace(/\b(?:GDI|VGT|VVT|CVX)\b\s*/g, '')
    .replace(/^Black Ink$/i, '블랙 잉크')
    .replace(/^H-Pick$/i, 'H-PICK')
    .replace(/^H-픽$/i, 'H-PICK')
    .replace(/^Business\s+(\d+)$/i, '비즈니스 $1')
    .replace(/^Premium$/i, '프리미엄')
    .replace(/^Modern$/i, '모던')
    .replace(/^Smart$/i, '스마트')
    .replace(/^Inspiration$/i, '인스퍼레이션')
    .replace(/^Black Exterior$/i, '블랙 익스테리어')
    .replace(/^VIP PACK$/i, 'VIP PACK')
    .replace(/^E-Value(?: Plus|\+)$/i, 'E-밸류 플러스')
    .replace(/^E-Lite$/i, 'E-라이트')
    .replace(/\s+HTRAC$/i, '')
    .replace(/^E-Lite$/i, 'E-라이트')
    .replace(/\s*[\[(（][^)\]）]*[)\]）]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const driveStripped = row && canonicalDrive(row) !== '미확인'
    ? normalized.replace(/^(?:FWD|RWD|AWD|4WD|2WD)$/i, '').replace(/\s+(?:FWD|RWD|AWD|4WD|2WD)$/i, '').trim()
    : normalized;
  return driveStripped || '기본형';
};
const bodyConfiguration = (row: Rec) => {
  const source = `${S(row.sub_model)} ${S(row.generation_name)} ${S(row.powertrain)} ${S(row.trim)}`;
  if (/카고/i.test(source)) return '카고';
  if (/투어러/i.test(source)) return '투어러';
  if (/라운지/i.test(source)) return '라운지';
  if (/리무진/i.test(source)) return '리무진';
  return S(row.body_configuration) || '승용';
};
const canonicalSubModel = (row: Rec) => {
  const fuel = S(row.fuel).toLowerCase();
  const isEv = fuel === '전기' || fuel === 'ev';
  if (isEv && row.model === '니로' && /SG2/.test(S(row.sub_model))) return '디 올 뉴 니로 EV SG2';
  if (isEv && row.model === '레이' && /TAM/.test(S(row.sub_model))) return /더 뉴/.test(S(row.sub_model)) ? '더 뉴 레이 EV TAM' : '레이 EV TAM';
  if (isEv && row.model === '코나' && /SX2/.test(S(row.sub_model))) return '디 올 뉴 코나 EV SX2';
  if (isEv && row.model === '코나' && /OS/.test(S(row.sub_model))) return '코나 EV OS';
  if (row.model !== '스타리아') return SUB_MODEL_MAP[S(row.sub_model)] || S(row.sub_model)
    .replace(/^20\d{2}\s+/, '')
    .replace(/\s+(?:20\d{2}|MY20\d{2}|국내형)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const body = bodyConfiguration(row);
  const prefix = S(row.sub_model).startsWith('더 뉴') ? '더 뉴 스타리아' : '스타리아';
  return ['카고', '투어러', '라운지', '리무진'].includes(body)
    ? `${prefix} ${body} US4`
    : `${prefix} US4`;
};
const IMPORTED_CLASS: Record<string, string> = {
  '벤츠|A-클래스': '준중형', '벤츠|C-클래스': '중형', '벤츠|E-클래스': '준대형', '벤츠|S-클래스': '대형',
  'BMW|1시리즈': '준중형', 'BMW|2시리즈': '준중형', 'BMW|5시리즈': '준대형', 'BMW|X1': '준중형', 'BMW|X4': '중형',
  '미니|에이스맨': '소형', '미니|컨트리맨': '준중형', '미니|쿠퍼': '소형',
  '아우디|A6': '준대형', '아우디|Q5': '중형', '지프|어벤저': '소형',
  '볼보|V60': '중형', '볼보|XC40': '준중형', '폴스타|폴스타 2': '중형',
  '포드|익스플로러': '대형', '캐딜락|XT6': '대형', '폭스바겐|골프': '준중형',
  '테슬라|모델 3': '중형', '테슬라|모델 Y': '중형',
};
const importedBodyStyle = (row: Rec) => {
  const key = `${S(row.maker)}|${S(row.model)}`;
  const sub = canonicalSubModel(row);
  if (key === 'BMW|2시리즈') return /액티브 투어러/.test(sub) ? 'MPV' : /그란쿠페/.test(sub) ? '세단' : '쿠페';
  if (['벤츠|C-클래스', '벤츠|E-클래스', '벤츠|S-클래스', 'BMW|5시리즈', '아우디|A6', '테슬라|모델 3'].includes(key)) return '세단';
  if (['BMW|1시리즈', '벤츠|A-클래스', '미니|쿠퍼', '폭스바겐|골프'].includes(key)) return '해치백';
  if (key === '볼보|V60') return '왜건';
  if (key === '폴스타|폴스타 2') return '패스트백';
  if (['BMW|X1', 'BMW|X4', '미니|에이스맨', '미니|컨트리맨', '아우디|Q5', '지프|어벤저',
    '볼보|XC40', '포드|익스플로러', '캐딜락|XT6', '테슬라|모델 Y'].includes(key)) return 'SUV';
  return '';
};
const DOMESTIC_OTHER_CLASS: Record<string, string> = {
  '그랑 콜레오스': '중형', 아르카나: '소형', QM6: '중형', SM3: '준중형', XM3: '소형',
  말리부: '중형', '볼트 EUV': '소형', 스파크: '경형', 콜로라도: '중형',
  트레일블레이저: '소형', 렉스턴: '대형', 토레스: '중형', 티볼리: '소형',
};
const vehicleClass = (row: Rec) => ({
  아반떼: '준중형', 싼타페: '중형', 스타리아: '대형', 그랜저: '준대형', 쏘나타: '중형',
  투싼: '준중형', 팰리세이드: '대형', 캐스퍼: '경형', 베뉴: '소형', 아이오닉5: '준중형',
  아이오닉6: '중형', 엑센트: '소형', 스타렉스: '대형', 코나: '소형',
  카니발: '대형', 레이: '경형', K5: '중형', K8: '준대형', 쏘렌토: '중형', EV6: '준중형',
  셀토스: '소형', 스포티지: '준중형', 니로: '소형', K7: '준대형', 모닝: '경형', K9: '대형', K3: '준중형', 모하비: '대형',
  G80: '준대형', GV70: '중형', GV80: '대형', G90: '대형', G70: '중형', EQ900: '대형',
}[S(row.model)] || (S(row.model) === '트랙스'
  ? (/크로스오버/.test(canonicalSubModel(row)) ? '준중형' : '소형')
  : DOMESTIC_OTHER_CLASS[S(row.model)])
  || IMPORTED_CLASS[`${S(row.maker)}|${S(row.model)}`] || '미확인');
const bodyStyle = (row: Rec) => importedBodyStyle(row) || (['아반떼', '그랜저', '쏘나타', '아이오닉6', '엑센트'].includes(S(row.model)) ? '세단'
  : ['싼타페', '투싼', '팰리세이드', '캐스퍼', '베뉴', '아이오닉5', '코나'].includes(S(row.model)) ? 'SUV'
    : ['K5', 'K8', 'K7', 'K9', 'K3'].includes(S(row.model)) ? '세단'
      : ['쏘렌토', 'EV6', '셀토스', '스포티지', '니로', '모하비'].includes(S(row.model)) ? 'SUV'
        : ['G80', 'G90', 'G70', 'EQ900'].includes(S(row.model)) ? '세단'
          : ['GV70', 'GV80'].includes(S(row.model)) ? 'SUV'
        : row.model === '모닝' ? '해치백'
          : row.model === '레이' && /밴|van/i.test(`${S(row.sub_model)} ${S(row.powertrain)} ${S(row.generation_name)}`) ? '밴'
            : bodyConfiguration(row) === '카고' ? '밴' : 'MPV');
const withinTenYears = (row: Rec) => {
  const end = S(row.production_end);
  if (end === '현재') return true;
  if (end) return end >= '2016-08';
  const yearEnd = S(row.model_year_end);
  return yearEnd === '현재' || Number(yearEnd) >= 2016;
};
const marketOrigin = (row: Rec) => ['현대', '기아', '제네시스', '르노코리아', '쉐보레', 'KG모빌리티'].includes(S(row.maker)) ? '국산' : '수입';

const artifact = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as { records: Rec[] };
const coverage = JSON.parse(readFileSync('tmp/product-master-vehicle-coverage.json', 'utf8')) as { report_type?: string; source?: Rec; rows: Rec[] };
if (S(coverage.report_type) !== 'product_master_vehicle_coverage_v2_supplier_direct_evidence'
  || S(coverage.source?.evidence_scope) !== 'supplier_direct_prefix_only') {
  throw new Error('supplier-direct coverage v2 보고서가 아니므로 규격검토본 생성을 중단합니다.');
}
const makerProducts = coverage.rows.filter((row) => SELECTED_MAKERS.includes(S(row.audit_axes?.maker || row.snap_maker)));
if (MAKER === '전체') {
  TARGET_MODELS = new Set(makerProducts.map((row) => S(row.audit_axes?.model || row.snap_model)).filter(Boolean));
}
const relevantKeys = new Set(makerProducts.flatMap((row) => [row.current_code, ...(row.candidate_keys || [])].map(S).filter(Boolean)));
const compactLineage = (value: unknown) => S(value).toLowerCase().replace(/[\s()[\]{}._/\\-]/g, '');
const productLineages = new Set(makerProducts.flatMap((row) => {
  const maker = S(row.audit_axes?.maker || row.snap_maker);
  const model = S(row.audit_axes?.model || row.snap_model);
  return [row.snap_sub_model, row.source_clues?.sub_model]
    .map((subModel) => `${maker}|${model}|${compactLineage(subModel)}`)
    .filter((key) => !key.endsWith('|'));
}));
const source = artifact.records
  .filter((row) => SELECTED_MAKERS.includes(S(row.maker))
    && TARGET_MODELS.has(S(row.model))
    && row.usage_tier !== 'blocked'
    && (withinTenYears(row)
      || productLineages.has(`${S(row.maker)}|${S(row.model)}|${compactLineage(row.sub_model)}`)
      || productLineages.has(`${S(row.maker)}|${S(row.model)}|${compactLineage(canonicalSubModel(row))}`)));
let rows = source.map((row) => [
  marketOrigin(row), S(row.maker), S(row.model), canonicalSubModel(row), canonicalTrim(row.trim, row),
  S(row.fuel), row.engine_cc ?? '', row.turbo ? '터보' : '', row.battery_kwh ?? '',
  canonicalDrive(row), brandedDriveSystem(row), Number(row.seats) || (row.model === '아반떼' ? 5 : '미확인'),
  vehicleClass(row), bodyStyle(row),
  S(row.model_year_start), S(row.model_year_end), S(row.production_start), S(row.production_end),
  S(row.sub_model), S(row.evidence_url), S(row.trim_row_key),
  canonicalDrive(row) === '미확인' || (!Number(row.seats) && row.model !== '아반떼') ? '검토필요' : '구조확인',
]);
const deduped = new Map<string, unknown[]>();
for (const row of rows) {
  const semanticKey = JSON.stringify(row.slice(0, 18).map(S));
  const prior = deduped.get(semanticKey);
  if (!prior) { deduped.set(semanticKey, row); continue; }
  prior[18] = [...new Set([...S(prior[18]).split('|'), S(row[18])].filter(Boolean))].join('|');
  prior[19] = [...new Set([...S(prior[19]).split('|'), S(row[19])].filter(Boolean))].join('|');
  prior[20] = [...new Set([...S(prior[20]).split('|'), S(row[20])].filter(Boolean))].join('|');
  prior[21] = '중복통합검토';
}
rows = [...deduped.values()];
const coreKey = (row: unknown[]) => JSON.stringify(row.slice(0, 5).map(S));
const groups = new Map<string, unknown[][]>();
for (const row of rows) groups.set(coreKey(row), [...(groups.get(coreKey(row)) || []), row]);
for (const row of rows) {
  const peers = groups.get(coreKey(row)) || [];
  const checks: Array<[string, number]> = [['연료', 5], ['배기량', 6], ['배터리', 8], ['구동', 9], ['인승', 11]];
  const questions = checks.flatMap(([label, index]) => {
    const values = [...new Set(peers.map((peer) => S(peer[index])).filter(Boolean))];
    return values.length > 1 ? [`${label}: ${values.join(' / ')}`] : [];
  });
  row.push(questions.map((question) => question.split(':')[0]).join('·'));
  row.push(questions.length ? `${questions.join(', ')} 중 확인` : '추가 질문 없음');
}
const compareText = (a: unknown, b: unknown) => S(a).localeCompare(S(b), 'ko', { numeric: true });
const compareProductionStartDesc = (a: unknown, b: unknown) => {
  const left = S(a);
  const right = S(b);
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return right.localeCompare(left, 'ko', { numeric: true });
};
rows.sort((a, b) => {
  for (const index of [0, 1, 2]) {
    const compared = compareText(a[index], b[index]);
    if (compared) return compared;
  }
  const productionCompared = compareProductionStartDesc(a[16], b[16]);
  if (productionCompared) return productionCompared;
  for (const index of [17, 3, 5, 6, 8, 9, 11, 4, 20]) {
    const compared = compareText(a[index], b[index]);
    if (compared) return compared;
  }
  return 0;
});
const productionSortViolations = rows.slice(1).filter((row, index) => {
  const prior = rows[index];
  if ([0, 1, 2].some((column) => S(prior[column]) !== S(row[column]))) return false;
  const priorStart = S(prior[16]);
  const currentStart = S(row[16]);
  return (!priorStart && Boolean(currentStart)) || (Boolean(priorStart) && Boolean(currentStart) && priorStart < currentStart);
}).length;

const headers = [
  '제조국', '제조사', '모델', '세부모델', '세부트림', '연료', '배기량cc', '과급', '배터리kWh',
  '구동', '구동시스템', '인승', '차종분류', '차체형태', '연식시작', '연식종료', '생산시작', '생산종료',
  '기존 세부모델', '공식근거', '기존 트림행키', '검증상태', '확인필요항목', '확인질문',
];
const report = {
  tab: REVIEW_TAB,
  source_rows: source.length,
  output_rows: rows.length,
  product_rows: makerProducts.length,
  product_referenced_master_keys: relevantKeys.size,
  product_rows_without_master_candidate: makerProducts.filter((row) => ![row.current_code, ...(row.candidate_keys || [])].map(S).filter(Boolean).length).length,
  by_model: Object.fromEntries([...TARGET_MODELS].map((model) => [model, rows.filter((row) => row[2] === model).length])),
  unknown_drive: rows.filter((row) => row[9] === '미확인').length,
  unknown_seats: rows.filter((row) => row[11] === '미확인').length,
  unknown_vehicle_class: rows.filter((row) => row[12] === '미확인').length,
  unknown_body_style: rows.filter((row) => row[13] === '미확인').length,
  production_sort_violations: productionSortViolations,
  question_rows: rows.filter((row) => row[23] !== '추가 질문 없음').length,
};
if (report.unknown_vehicle_class || report.unknown_body_style || report.production_sort_violations) {
  throw new Error(`Review gate failed: ${JSON.stringify({ unknown_vehicle_class: report.unknown_vehicle_class, unknown_body_style: report.unknown_body_style, production_sort_violations: report.production_sort_violations })}`);
}
const forbiddenIdentityToken = /(?:^|\s)(?:20\d{2}|가솔린|디젤|LPG|LPi|하이브리드|전기|수소|FWD|RWD|AWD|4WD|2WD|\d{1,2}인승)(?=\s|$)/i;
const identityIssues = rows.flatMap((row, rowIndex) => [2, 3, 4].flatMap((columnIndex) =>
  forbiddenIdentityToken.test(S(row[columnIndex]))
    ? [{ row: rowIndex + 2, column: headers[columnIndex], value: row[columnIndex] }]
    : []));
if (identityIssues.length) throw new Error(`Identity contamination: ${JSON.stringify(identityIssues.slice(0, 5))}`);
writeFileSync('tmp/hyundai-three-model-review.json', `${JSON.stringify({ report, headers, rows }, null, 2)}\n`);
if (!APPLY) {
  console.log(JSON.stringify({ mode: 'dry_run', ...report }, null, 2));
  process.exit(0);
}

const credentials = JSON.parse(readFileSync(
  process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8',
)) as Rec;
const token = (await new JWT({
  email: S(credentials.client_email), key: S(credentials.private_key),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  subject: process.env.GOOGLE_WORKSPACE_SUBJECT || 'pyh@teamjpk.com',
}).getAccessToken()).token;
if (!token) throw new Error('Sheets token missing');
const base = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}`;
const api = async (url: string, init: RequestInit = {}) => {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  const body = await response.json().catch(() => ({})) as Rec;
  if (!response.ok) throw new Error(`Sheets ${response.status}: ${JSON.stringify(body).slice(0, 600)}`);
  return body;
};
const metadata = await api(`${base}?fields=sheets(properties,conditionalFormats)`);
let existing = (metadata.sheets || []).find((sheet: Rec) => S(sheet.properties?.title) === REVIEW_TAB);
if (!existing && MAKER === '현대') {
  existing = (metadata.sheets || []).find((sheet: Rec) => S(sheet.properties?.title) === LEGACY_REVIEW_TAB);
  if (existing) {
    await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ updateSheetProperties: { properties: { sheetId: existing.properties.sheetId, title: REVIEW_TAB }, fields: 'title' } }] }) });
    existing.properties.title = REVIEW_TAB;
  }
}
if (!existing && MAKER === '전체') {
  existing = (metadata.sheets || []).find((sheet: Rec) => S(sheet.properties?.title) === '현대_규격검토');
  if (existing) {
    await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ updateSheetProperties: { properties: { sheetId: existing.properties.sheetId, title: REVIEW_TAB }, fields: 'title' } }] }) });
    existing.properties.title = REVIEW_TAB;
  }
}
let created = false;
let sheetId = existing?.properties?.sheetId;
if (!Number.isInteger(sheetId)) {
  const added = await api(`${base}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: REVIEW_TAB, gridProperties: { rowCount: rows.length + 1, columnCount: headers.length, frozenRowCount: 1 } } } }] }),
  });
  sheetId = added.replies?.[0]?.addSheet?.properties?.sheetId;
  created = true;
}
if (!Number.isInteger(sheetId)) throw new Error('Created sheetId missing');
if (!created && Number(existing?.properties?.gridProperties?.columnCount || 0) < headers.length) {
  await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ appendDimension: { sheetId, dimension: 'COLUMNS', length: headers.length - Number(existing.properties.gridProperties.columnCount || 0) } }] }) });
}
if (!created && Number(existing?.properties?.gridProperties?.rowCount || 0) < rows.length + 1) {
  await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ appendDimension: { sheetId, dimension: 'ROWS', length: rows.length + 1 - Number(existing.properties.gridProperties.rowCount || 0) } }] }) });
}
const reviewRange = `'${REVIEW_TAB}'!A1:X${rows.length + 1}`;
const snapshotRange = `'${REVIEW_TAB}'!A1:X${Math.max(rows.length + 1, Number(existing?.properties?.gridProperties?.rowCount || 0))}`;
const previous = created ? { values: [] } : await api(`${base}/values/${encodeURIComponent(snapshotRange)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`);
writeFileSync(`tmp/hyundai-three-model-review-snapshot-${Date.now()}.json`, `${JSON.stringify(previous, null, 2)}\n`);
try {
  if (!created) await api(`${base}/values/${encodeURIComponent(snapshotRange)}:clear`, { method: 'POST', body: '{}' });
  await api(`${base}/values/${encodeURIComponent(reviewRange)}?valueInputOption=RAW`, {
    method: 'PUT', body: JSON.stringify({ range: reviewRange, majorDimension: 'ROWS', values: [headers, ...rows] }),
  });
  await api(`${base}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [
      // 글꼴·크기·행 높이·구분색은 `vehicle-master-sheet-format` 표준(사장님 2026-08-18 · 9pt · 22px · 구분 열 글자색).
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: headers.length }, cell: { userEnteredFormat: { textFormat: { bold: true, fontFamily: MASTER_FONT, fontSize: MASTER_FONT_SIZE }, backgroundColor: { red: 0.92, green: 0.95, blue: 1 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: rows.length + 1, startColumnIndex: 0, endColumnIndex: headers.length }, cell: { userEnteredFormat: { textFormat: { fontFamily: MASTER_FONT, fontSize: MASTER_FONT_SIZE }, verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(textFormat,verticalAlignment)' } },
      ...masterCategoryColorRequests({ sheetId, headers, rowCount: rows.length + 1, existingRuleCount: created ? 0 : (existing?.conditionalFormats || []).length }),
      { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: rows.length + 1, startColumnIndex: 18, endColumnIndex: 24 }, cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat.wrapStrategy' } },
      { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, endRowIndex: rows.length + 1, startColumnIndex: 0, endColumnIndex: headers.length } } } },
      { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: rows.length + 1 }, properties: { pixelSize: MASTER_ROW_PX }, fields: 'pixelSize' } },
      ...[72, 70, 90, 190, 150, 80, 82, 64, 90, 70, 105, 64, 82, 82, 82, 82, 92, 92, 190, 260, 300, 90, 130, 300].map((pixelSize, column) => ({
        updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: column, endIndex: column + 1 }, properties: { pixelSize }, fields: 'pixelSize' },
      })),
    ] }),
  });
  const verify = await api(`${base}/values/${encodeURIComponent(reviewRange)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`);
  const values = verify.values || [];
  if (values.length !== rows.length + 1 || values[0]?.join('|') !== headers.join('|')) throw new Error('Post-read mismatch');
  console.log(JSON.stringify({ mode: 'published_verified', sheetId, ...report }, null, 2));
} catch (cause) {
  if (created) {
    await api(`${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ deleteSheet: { sheetId } }] }) });
  } else {
    await api(`${base}/values/${encodeURIComponent(snapshotRange)}:clear`, { method: 'POST', body: '{}' });
    if (previous.values?.length) {
      await api(`${base}/values/${encodeURIComponent(snapshotRange)}?valueInputOption=RAW`, {
        method: 'PUT', body: JSON.stringify({ range: snapshotRange, majorDimension: 'ROWS', values: previous.values }),
      });
    }
  }
  throw cause;
}
