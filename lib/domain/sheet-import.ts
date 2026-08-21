/**
 * sheet-import — 렌트사별 구글시트 → 매물 취합 엔진.
 *   공급사마다 고유 시트 + mapping_profile 학습. (v3 공용 source sync 없음)
 *   흐름: CSV → adapter.prepareTable → 헤더매핑 → 차종마스터 스냅 → 차번 dedup → 매물.
 *   ★ 저장은 여기 말고 master-ingress.commitSupplierProducts (입고 SSOT).
 */
import { snapToMaster, applySnap, fuelDisplay, fuelEmbeddedCc, type MasterEntry } from '@/lib/domain/vehicle-master-match';
import { applyColors } from '@/lib/domain/color-master';
import { type EntityRecord } from '@/lib/intake/entities';
import { normalizeProductOptionsText, isExactRealPlate, normalizeWonPair } from '@/lib/domain/product';
import { pendingSignature, previewPlateAllocator, type PlateAllocator } from '@/lib/domain/pending-plate';

// ── 헤더 별칭 사전 ── 렌트사 시트 컬럼명 → 프리패스 표준 필드. 국산 렌트 시트는 대동소이 → 자동 90%.
export const HEADER_ALIASES: Record<string, string> = {
  차량번호: 'car_number', 차번: 'car_number', 번호판: 'car_number', 등록번호: 'car_number',
  // 차대번호 = 번호판 없는 신차의 유일 신원. 번호판이 나오기 전에도 같은 차를 같은 차로 붙잡는다.
  //  이게 없으면 신차는 스펙서명 기반 임시번호(100신)에만 의존하는데, 시트 행 순서·표기가 바뀌면
  //  임시번호가 흔들려 같은 차가 새 매물로 갈라진다. VIN 이 있으면 그 흔들림이 사라진다.
  차대번호: 'vin', 차대: 'vin', vin: 'vin', 차대번호vin: 'vin', 제조번호: 'vin',
  제조사: 'maker', 메이커: 'maker', 브랜드: 'maker', 제조회사: 'maker',
  모델: 'model', 차명: 'model',
  // 오토플러스: 차종=숏모델, 모델명(트림풀명)=풀표기→트림. 일반시트 모델명만 있으면 model(아래 정확키 우선).
  //
  // ★「모델명(트림)」 계열은 트림이다 — 이름이 «모델명»으로 시작한다고 model 로 보내면 안 된다.
  //   빌린카 시트는 차종=「아반떼」, 모델명(트림)=「더뉴아반떼 25MY 자가용 가솔린 1.6 N라인
  //   인스퍼레이션」인데 이 열이 어느 별칭에도 안 걸려 통째로 버려졌다. 차종만 남으니 매처가
  //   짧은 이름으로 모델을 잠그고 트림·세대를 못 정해 검수로 떨어졌다(실측 2026-08-07 · 16대).
  '모델명(트림풀명)': 'trim_name',
  '모델명(트림)': 'trim_name', '모델명(풀명)': 'trim_name', '모델명(상세)': 'trim_name',
  '차명(세부모델+트림)': 'trim_name', '모델(트림)': 'trim_name', 모델명트림: 'trim_name',
  모델명: 'model',
  세부모델: 'sub_model', 세부: 'sub_model', 상세모델: 'sub_model', 세부차명: 'sub_model',
  파워: 'variant', 파워트레인: 'variant', 엔진: 'variant',
  트림: 'trim_name', 세부트림: 'trim_name', 등급: 'trim_name', 세부등급: 'trim_name',
  추가표기: 'trim_extra', 추가입력: 'trim_extra', 부가표기: 'trim_extra',
  연식: 'year', 년식: 'year',
  최초등록: 'first_registration_date', 최초등록일: 'first_registration_date', 등록일: 'first_registration_date', 등록년월: 'first_registration_date',
  // ★입고일자 = **상품으로 내놓은 날**. 최초등록일과 다른 값이다 —
  //   중고차는 등록이 몇 년 전이어도 상품화는 이번 달일 수 있다. 재고일수의 기준점이라 섞이면 안 된다.
  입고일자: 'arrival_date', 입고일: 'arrival_date', 상품화일: 'arrival_date', 판매시작일: 'arrival_date', 등록일자: 'arrival_date',
  연료: 'fuel_type', 유종: 'fuel_type', 연료타입: 'fuel_type',
  배기량: 'engine_cc', cc: 'engine_cc', 배기: 'engine_cc',
  소비자가격: 'vehicle_price', 소비자가: 'vehicle_price', 차량가격: 'vehicle_price', 차량가: 'vehicle_price', 차량가액: 'vehicle_price',
  주행: 'mileage', 주행거리: 'mileage', 누적주행: 'mileage', 키로수: 'mileage', km: 'mileage', 미터: 'mileage',
  색상: 'ext_color', 외장: 'ext_color', 외장색: 'ext_color', 외관색: 'ext_color', 컬러: 'ext_color', 외장색상: 'ext_color',
  내장: 'int_color', 내장색: 'int_color', 실내색: 'int_color', 내장색상: 'int_color',
  // 표준양식 헤더(2026-08-08). **정확일치가 꼭 필요하다** — 없으면 부분일치가 '색상'에 먼저 걸려
  //   내부색상까지 ext_color 로 가고, 이미 찬 자리라 무시돼 내장색이 통째로 비어 버린다.
  외부색상: 'ext_color', 내부색상: 'int_color',
  인승: 'seats', 승차인원: 'seats', 승차: 'seats',
  변속기: 'transmission', 변속: 'transmission', 미션: 'transmission',
  // 표준양식 헤더(2026-08-08). 열은 만들어 놓고 별칭이 없어 값이 통째로 버려지고 있었다.
  구동: 'drive_type', 구동방식: 'drive_type', 사륜: 'drive_type', 굴림: 'drive_type',
  // 렌트시트 「차종」=모델명(쏘나타). 세그먼트×차형 = 차종분류(구 차급).
  // 발행 판매시트는 같은 값을 「차종구분」(옵션 뒤 열)으로 낸다.
  차종: 'model',
  차종분류: 'vehicle_class', 차종구분: 'vehicle_class', 차급: 'vehicle_class',
  상태: 'vehicle_status', 판매상태: 'vehicle_status', 재고상태: 'vehicle_status',
  구분: 'product_type', 상품구분: 'product_type', 렌트구분: 'product_type',
  // 표준양식 헤더(2026-08-08). '차종분류'(vehicle_class)와 헷갈리지 않는다 — 정확일치가 먼저다.
  분류: 'product_type',
  사진: 'photo_link', 사진링크: 'photo_link', 이미지: 'photo_link', 사진url: 'photo_link', 이미지링크: 'photo_link',
  옵션: 'options', 선택옵션: 'options',
  메모: 'partner_memo', 비고: 'partner_memo', 특이사항: 'partner_memo',
  // 표준양식(2026-08-08). 정책코드를 적으면 **그 정책이 우선**한다 — 면책금·연령·면허를
  //   칸마다 적을 필요가 없다. 개별 정책 열은 «지금 붙은 정책이 무엇인지» 보여주는 표시일 뿐이다.
  정책코드: 'policy_code', 정책번호: 'policy_code',
  /**
   * ★**「정책UID」가 정본 참조다**(사장님 2026-08-21 「uid 만 안 바뀌면 되잖아」 · ERP 표준 3층
   *   대체키/업무코드/표시명). `pol_…` 는 뜻이 없어 정책명·업무코드(POL-0035)가 바뀌어도 안 깨진다.
   *   판매시트에 이 열이 생기기 전까지 ERP 상품 **808대의 policy_code 가 빈칸**이었다(실측 2026-08-21) —
   *   상품마스터 경로를 접으면서 정책이 지나갈 칸이 사라졌기 때문이다.
   */
  정책UID: 'policy_code',
};

// 매핑 대상 표준 필드(에디터 드롭다운). 라벨=한글, key=매물 필드.
export const IMPORT_FIELDS: { key: string; label: string }[] = [
  { key: 'car_number', label: '차량번호' }, { key: 'vin', label: '차대번호' },
  { key: 'maker', label: '제조사' }, { key: 'model', label: '모델' },
  { key: 'sub_model', label: '세부모델' }, { key: 'variant', label: '파워트레인' }, { key: 'trim_name', label: '트림' }, { key: 'trim_extra', label: '추가표기' }, { key: 'year', label: '연식' },
  { key: 'first_registration_date', label: '최초등록일' }, { key: 'fuel_type', label: '연료' }, { key: 'engine_cc', label: '배기량' },
  { key: 'mileage', label: '주행거리' }, { key: 'ext_color', label: '외장색' }, { key: 'int_color', label: '내장색' },
  { key: 'seats', label: '인승' }, { key: 'drive_type', label: '구동' }, { key: 'transmission', label: '변속기' }, { key: 'vehicle_class', label: '차종분류' },
  { key: 'vehicle_status', label: '상태' }, { key: 'product_type', label: '구분' }, { key: 'photo_link', label: '사진링크' },
  { key: 'options', label: '옵션' }, { key: 'partner_memo', label: '메모' },
  { key: 'policy_code', label: '정책코드' },
  // 소비자가(차량가). 공급사 시트 열 이름이 「소비자가격」인 곳이 많다 — 관리자만 보는 원가다.
  { key: 'vehicle_price', label: '차량가격' },
  // 입고일자 = 상품으로 내놓은 날. 재고일수(오늘 - 입고일자)의 기준점이다.
  { key: 'arrival_date', label: '입고일자' },
];

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');

/**
 * 시트 판매상태 → VEHICLE_STATES.
 * 연동 판단 SSOT: 시트에 차번이 있으면 데이터화하고, **출고불가 여부**만 규격 상태로 맞춘다.
 *  · 보류·불가·완료 → 출고불가
 *  · 공급사 계약중 → 출고불가(ERP의 계약중은 계약금 확인 엔진만 설정)
 *  · 판매중·할인판매·가능·빈값 → 출고가능 (오토플러스 등)
 *  · 이미 규격값이면 그대로
 */
/**
 * 시트 상태 → 상품상태(VEHICLE_STATES 6종). **운영 규칙 2026-07-31 확정.**
 *
 * 큰 원칙: **출고불가가 아니면 다 올린다.** 애매하면 출고협의로 올려 두고 영업자가 확인한다.
 *
 * ★**배차중과 배차대기는 다르다**(사장님 2026-08-10).
 *   · 배차대기 = 다음 손님을 기다리는 차 → **출고협의**. 팔 수 있다.
 *   · 배차중   = 지금 손님이 타고 있는 차 → **출고불가**. 파는 물건이 아니다.
 *
 *   전에는 둘 다 출고협의로 올렸다. 「반납 시점을 협의하면 되는 상품」이라 본 것인데,
 *   그 판단은 **옛 종합시트**(우리가 만든 과거 사본)를 재고로 잘못 알고 잰 것이었다.
 *   공급사 정본으로 다시 재니 아이카종합 1,877대 중 배차중이 1,827대다 —
 *   그대로 두면 남이 타고 있는 차 1,827대가 영업자 표에 상품으로 뜬다.
 *   바꿔도 지금 파는 437대 중 배차중에 기대는 차는 **0대**다(실측).
 *
 * 판정 순서(위가 우선):
 *   1. ERP 계약중을 제외한 규격값 정확 일치 → 그대로
 *   2. 이미 나간 차(출고완·판매완료·반납·폐차·말소) → 출고불가
 *   3. **배차중·운행중 = 남이 타고 있다** → 출고불가   ← 배차«대기»가 먼저 걸러진 뒤에 본다
 *   4. '불가' 포함 → 출고불가
 *   5. 지금 팔 수 있다는 표현(판매중·할인판매) → 출고가능   ← 오토플러스 87대
 *   6. 상품화 → 상품화중                                  ← "상품화 준비중"
 *   7. 외부 계약 → 출고불가 (ERP 계약중은 내부 계약금 확인의 전용 상태)
 *   8. 나머지 전부 → 출고협의  (배차대기·재렌트·"8월3일이후출고가능" 등)
 */
export function canonSheetVehicleStatus(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '출고협의'; // 상태칸이 없는 시트 — 함부로 출고가능으로 보지 않는다
  if (s === '즉시출고' || s === '출고가능' || s === '상품화중' || s === '출고협의' || s === '출고불가') return s;
  // ① '출고가능'으로 시작하면 뒤에 뭐가 붙어도 출고가능(erp3 이식).
  //    '출고가능(대차중)'·'출고가능3일이내'·'출고가능(정비중)' 이 아래 불가 regex 의 '대차'에
  //    먼저 걸려 뒤집히는 사고를 막는 순서다 — 이 줄을 아래로 내리면 안 된다.
  if (/^출고\s?가능/.test(s)) return '출고가능';
  // ② 이미 나갔거나 팔린 차 — '불가'라는 말이 없어도 상품이 아니다.
  //    실측 어휘(2026-07-31 전 공급사 시트): 출고완료 140 · 매각 14 · 매각검토 7 · 판매완료 3 · 사고대차 1 · 차량미정 1
  if (/출고완|판매완료|매각|반납|폐차|말소|회수|사고|보류|미정|대차|sold/i.test(s)) return '출고불가';
  /**
   * ★남이 타고 있는 차 — 파는 물건이 아니다.
   *   「배차«대기»」는 다음 손님을 기다리는 차라 여기 걸리면 안 된다.
   *   `대기`·`가능`·`예정`이 함께 있으면 넘긴다 — 「배차중/배차대기」 같이 붙여 쓴 칸도 있다.
   */
  if (/배차\s?중|운행\s?중|대여\s?중|임대\s?중/.test(s) && !/대기|가능|예정/.test(s)) return '출고불가';
  // ③ '불가' 계열 — 오타 포함. 실측: 출보불가 1 · 출고블가 2 · '출고 불가' 4 · 출고불 1
  if (/불\s?가|블가|보불가|^출고불$/.test(s)) return '출고불가';
  if (/판매중|할인판매|promo/i.test(s)) return '출고가능';
  if (/상품화/.test(s)) return '상품화중';
  // `계약중`은 ERP 계약금 확인 시 settlement-engine만 쓰는 상태다.
  // 공급사 시트의 계약 표기를 그대로 넣으면 내부 계약 없이 계약중 차량이 생긴다.
  if (/^계약/.test(s)) return '출고불가';
  return '출고협의';
}

/**
 * 유입에서 제외할 행 — **상태가 출고불가로 판정되는 것.**
 * 운영 규칙(2026-07-31): "출고불가가 아니면 다 올린다" = 출고불가는 올리지 않는다.
 * 판정은 canonSheetVehicleStatus 하나로 통일한다 —
 * '출고불가'·'~불가'·'출고완료'·'판매완료'·'폐차'·'말소'가 전부 여기로 모인다.
 *
 * ※ 시트에 아예 없는 차를 출고불가로 내리는 **부재처리와는 다른 이야기다**(그건 기존 매물의 상태 변경).
 */
export function isSheetExcluded(raw: unknown): boolean {
  return canonSheetVehicleStatus(raw) === '출고불가';
}

/**
 * 그 칸이 «차를 설명하는 글»인가 — 트림 추출용 신호 수집 기준.
 *
 * 트림은 시트에 열이 없다. 차명 칸이나 이름 없는 설명 칸에 문장으로 섞여 온다
 * (「2.0 가솔린 프레스티지」·「AWD 롱레인지」·「인스퍼레이션」). 한글/영문 글자가 있어야 하고,
 * 숫자만 있는 칸은 신호가 아니다.
 */
const VEHICLE_TEXT_RE = /[가-힣A-Za-z]/;

/**
 * 넣으면 안 되는 칸 — 넣으면 모델명·트림과 겹쳐 «다른 차»로 붙는다.
 * 금액(1,650,000) · 날짜 · 차번 · 기간(36개월) · 주행(3만km) · 상태말 · 지역/사람 이름.
 * 실측(2026-08-07)에서 매핑 안 된 열은 전부 이 부류였다 — 보증금·기간요금·연주행·차고지.
 */
const NON_VEHICLE_TEXT_RE = new RegExp([
  '^\\d{1,3}(,\\d{3})+$',
  '^\\d{4}[-./]\\d{1,2}([-./]\\d{1,2})?$',
  '^\\d{2,3}[가-힣]\\d{4}$',
  '^\\d+\\s*(개월|년|만?\\s*km|킬로|인승|원|만원)$',
  '^(가능|불가|유|무|없음|있음|-|—|–)$',
  '출고|판매|계약|보류|매각|재고확인|상담|문의|보증|납부|분납|위약|면책|차고지|운전자',
].join('|'), 'i');

/** 가격칸 등에 적힌 공지 문장을 차량 행으로 오인하지 않는다. 차량 식별값이 있으면 적용하지 않는다. */
const SHEET_NOTICE_ROW_RE = /수수료|공지|안내|꼭\s*확인|영업에\s*도움/i;

/** 헤더 자동매핑 — 정확일치 → 정규화일치 → 부분일치(별칭 긴 키 우선). 반환 = {표준필드: 컬럼인덱스}(첫 매칭 우선). */
/**
 * 헤더칸이 상태 컬럼명이 아니라 상태값 자체인 경우(아이카: 0번 열 헤더 = "즉시출고").
 * 이런 열은 상태값이 들어있는 상태 컬럼이므로 vehicle_status로 인식.
 * (상태 별칭 상태·판매상태·재고상태가 우선. 이건 그게 없을 때의 폴백)
 */
const STATUS_VALUE_HEADER = /^(즉시출고|출고가능|출고불가|출고협의|상품화중|계약중|배차중|배차대기|입고대기|판매중|할인판매|출고상태|배차상태|출고현황)$/;

/**
 * 판매 가능 여부를 담은 컬럼 — **정확일치·우선순위 탐색**(erp3 STATUS_COL_NAMES 이식).
 *
 * ⚠ 부분일치로 '상태'를 찾으면 안 된다. 종합시트 표준 헤더는
 *   `차량상태 | 배차상태 | 입고일자 | 구분 | 차량번호 | …` 로 상태칸이 **둘**인데,
 *   차량상태는 정상/정비중/대차중/매각검토(물리 컨디션)이고 배차상태가 출고가능/출고불가다.
 *   앞에 있는 차량상태를 잡으면 전 매물이 "정상 → 출고협의"로 뭉개진다.
 */
const STATUS_COL_PRIORITY = ['배차상태', '상태', '판매상태', '즉시출고', '재고상태', '출고상태', '출고현황'];

/** 상태 컬럼으로 **쓰면 안 되는** 헤더 — 판매 가능 여부가 아닌 다른 축. */
const NOT_STATUS_COL = /^(차량상태|정비상태|사고상태)/;

/** 접미 설명이 붙어도 판매 가능여부 축으로 확정할 수 있는 상태 헤더. */
const DECORATED_SALE_STATUS_COL = /^(배차상태|판매상태|재고상태|출고상태|출고현황)/;

export function autoMapHeaders(headers: string[]): MappingProfile {
  const map: MappingProfile = {};
  const norms = headers.map((h) => norm(String(h ?? '').trim()));
  // 1) 상태 컬럼 먼저 — 우선순위대로 정확일치. 뒤 루프의 부분일치가 못 덮게 선점한다.
  for (const name of STATUS_COL_PRIORITY) {
    const i = norms.indexOf(norm(name));
    if (i >= 0) { map.vehicle_status = i; break; }
  }
  // `차량상태(정비)`는 물리 컨디션이고 `배차상태(판매)`가 실제 상품 상태다.
  // 정확일치가 없을 때도 판매·배차·출고 축의 접미형만 허용한다.
  if (!('vehicle_status' in map)) {
    const i = norms.findIndex((header) => DECORATED_SALE_STATUS_COL.test(header));
    if (i >= 0) map.vehicle_status = i;
  }
  const aliasKeys = Object.keys(HEADER_ALIASES).sort((a, b) => b.length - a.length);
  headers.forEach((h, i) => {
    const t = String(h ?? '').trim();
    if (!t) return;
    const exactField = HEADER_ALIASES[t] || HEADER_ALIASES[norm(t)];
    let field = exactField;
    if (!field) {
      const k = aliasKeys.find((a) => norm(t).includes(norm(a)));
      if (k) field = HEADER_ALIASES[k];
    }
    // 폴백: 헤더가 상태값 자체면 상태 컬럼(아이카 (구)종합: 0번 열 헤더 = "즉시출고").
    if (!field && !('vehicle_status' in map) && STATUS_VALUE_HEADER.test(norm(t))) field = 'vehicle_status';
    if (field === 'vehicle_status' && (NOT_STATUS_COL.test(norm(t)) || (!exactField && !STATUS_VALUE_HEADER.test(norm(t))))) return;
    if (field && !(field in map)) map[field] = i;
  });
  return map;
}

export type SheetTableFetchOptions = {
  /** CSV가 감추는 Sheets 필터·숨김 행 메타데이터를 적용한다. */
  visibleRowsOnly?: boolean;
  /** privileged Sheets API 경로의 관리자 Firebase ID token. */
  authorization?: string;
  /**
   * 차량번호 → 사진 링크. 표(`string[][]`)에는 담을 수 없어 콜백으로 준다 —
   * 공급사가 사진을 열이 아니라 차번 셀 링크로 주기 때문이다(`visible=1` 경로에서만 온다).
   */
  onPhotoByPlate?: (map: Record<string, string>) => void;
};

export type SheetTableFetcher = (
  url: string,
  gid?: string,
  options?: SheetTableFetchOptions,
) => Promise<string[][]>;

/** 클라이언트: 구글시트 URL → 표(table). /api/sheet 경유(CORS 회피). 실패 시 throw(사유 포함). */
export async function fetchSheetTable(
  url: string,
  gid?: string,
  options: SheetTableFetchOptions = {},
): Promise<string[][]> {
  /**
   * ★상한이 없으면 화면이 **조용히 영구 고착**된다.
   *
   * 서버 쪽은 전부 상한이 걸려 있는데(app/api/sheet/route.ts 의 12초, google-sheet-visible 의 12·20초)
   * 정작 «브라우저 → 우리 서버» 한 홉만 무방비였다. 그 fetch 가 안 끝나면 `mapPool` 워커가 멈추고,
   * `fetchAllPartnerSheets` 가 settle 되지 않아 `validateAll` 의 finally 에 **도달조차 못 한다** —
   * reject 가 아니므로 catch 도 안 돌아 토스트도 없다. 그게 「검증 중…」이 안 풀리던 이유다.
   *
   * 상한을 걸면 reject 가 되고, 공급사 단위 try/catch 가 «✗ 공급사명 — 사유»로 흡수해
   * **어디서 멈췄는지가 화면에 찍힌다.** 값은 서버 최악 경로(visible=메타 20초 + 그리드 20초)보다
   * 커야 서버가 스스로 502 를 돌려줄 기회를 뺏지 않는다.
   */
  const timeoutMs = options.visibleRowsOnly ? 50_000 : 20_000;
  let r: Response;
  try {
    r = await fetch(`/api/sheet?url=${encodeURIComponent(url)}${gid ? `&gid=${encodeURIComponent(gid)}` : ''}${options.visibleRowsOnly ? '&visible=1' : ''}`, {
      cache: 'no-store',
      headers: options.authorization ? { Authorization: `Bearer ${options.authorization}` } : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = (error as Error)?.name;
    throw new Error(name === 'TimeoutError' || name === 'AbortError'
      ? `시트 서버 무응답 ${timeoutMs / 1000}초 초과`
      : `시트 요청 실패 — ${String((error as Error)?.message || error)}`);
  }
  const d = await r.json().catch(() => ({ ok: false, error: '응답 파싱 실패' }));
  if (!d.ok) throw new Error(d.error || `시트 로드 실패 (${r.status})`);
  // 사진 링크는 표에 담을 수 없다(열이 아니라 셀 링크다). 호출부가 원하면 콜백으로 넘긴다 —
  // 반환 타입을 string[][] 로 유지해 기존 호출부를 건드리지 않는다.
  if (options.onPhotoByPlate && d.photoByPlate && typeof d.photoByPlate === 'object') {
    options.onPhotoByPlate(d.photoByPlate as Record<string, string>);
  }
  if (Array.isArray(d.rows)) {
    return d.rows.map((row: unknown) => Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []);
  }
  return parseDelimited(String(d.csv || ''));
}

/** 서로 다른 설정 탭이 같은 응답을 돌려준 경우 gid 무시/게시 설정 오류로 보고 차단한다. */
export function assertDistinctSheetTable(
  seen: Map<string, string>,
  table: string[][],
  label: string,
): void {
  const text = JSON.stringify(table);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const fingerprint = `${text.length}:${(hash >>> 0).toString(36)}`;
  const previous = seen.get(fingerprint);
  if (previous) {
    throw new Error(`서로 다른 시트 탭 응답이 동일함 (${previous} / ${label}) — gid·게시 설정 확인`);
  }
  seen.set(fingerprint, label);
}

/** CSV/TSV 파서 — 따옴표 안 콤마·개행 처리. 빈 행 제거. */
export function parseDelimited(text: string, delim = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

/** 매핑 프로파일 = {표준필드: 컬럼인덱스}. partner.mapping_profile 에 JSON 저장 → 다음 당길 때 재사용(학습). */
export type MappingProfile = Record<string, number>;
export type MappingHeaderSignature = Record<string, string>;

const IMPORT_FIELD_KEYS = new Set(IMPORT_FIELDS.map((field) => field.key));

/** partner에 저장된 매핑은 사용자 입력이다. 허용 필드·정수 index·1:1 열만 받는다. */
export function parseMappingProfile(value: unknown): MappingProfile | undefined {
  if (value == null || (typeof value === 'string' && !value.trim())) return undefined;
  let parsed: unknown;
  try { parsed = typeof value === 'string' ? JSON.parse(value) : value; }
  catch { throw new Error('시트 매핑 설정 JSON 오류 — 다시 저장하세요'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('시트 매핑 설정 형식 오류 — 다시 저장하세요');
  }
  const mapping: MappingProfile = {};
  const usedIndexes = new Set<number>();
  for (const [field, rawIndex] of Object.entries(parsed as Record<string, unknown>)) {
    if (!IMPORT_FIELD_KEYS.has(field)) {
      throw new Error(`시트 매핑 허용외 필드 — ${field}`);
    }
    if (!Number.isInteger(rawIndex) || Number(rawIndex) < 0) {
      throw new Error(`시트 매핑 index 오류 — ${field}`);
    }
    const index = Number(rawIndex);
    if (usedIndexes.has(index)) {
      throw new Error(`시트 매핑 열 중복 — ${index + 1}번째 열`);
    }
    usedIndexes.add(index);
    mapping[field] = index;
  }
  return Object.keys(mapping).length ? mapping : undefined;
}

export function parseMappingHeaderSignature(value: unknown): MappingHeaderSignature | undefined {
  if (value == null || (typeof value === 'string' && !value.trim())) return undefined;
  let parsed: unknown;
  try { parsed = typeof value === 'string' ? JSON.parse(value) : value; }
  catch { throw new Error('시트 헤더 서명 JSON 오류 — 매핑을 다시 저장하세요'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('시트 헤더 서명 형식 오류 — 매핑을 다시 저장하세요');
  }
  const signature: MappingHeaderSignature = {};
  for (const [field, header] of Object.entries(parsed as Record<string, unknown>)) {
    if (!IMPORT_FIELD_KEYS.has(field)) throw new Error(`시트 헤더 서명 허용외 필드 — ${field}`);
    if (typeof header !== 'string' || !header.trim()) throw new Error(`시트 헤더 서명 오류 — ${field}`);
    signature[field] = header;
  }
  return Object.keys(signature).length ? signature : undefined;
}

export const normalizeSheetHeader = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');

export function buildMappingHeaderSignature(
  headers: string[],
  mapping: MappingProfile,
): MappingHeaderSignature {
  return Object.fromEntries(Object.entries(mapping).map(([field, index]) => [
    field,
    normalizeSheetHeader(headers[index]),
  ]).filter(([, header]) => !!header));
}

export type ImportResult = {
  products: EntityRecord[];
  mapping: MappingProfile;   // 사용된 매핑(자동이면 이걸 프로파일로 저장)
  total: number; imported: number; skipped: number;
  duplicateCount: number;
  invalidCount: number;
  issueSamples: string[];    // 행번호·차번·사유 샘플(운영자가 원본 시트를 고칠 근거)
  excludedCount: number;    // 시트에 '출고불가'로 적혀 있어 안 올린 대수
  noPriceCount: number;     // 대여료가 하나도 없는 행 수 — 실차번이 있으면 가격 없이도 올린다
  noPriceSkippedCount: number; // 가격도 실차번도 없어 안정적인 상품키를 만들지 못한 행(= skipped의 부분집합)
  snap: { high: number; medium: number; low: number; none: number };
};

// 수입 브랜드(v3 IMPORT_BRAND_KEYWORDS 이식) — 보증금 컬럼 없는 시트에서 배율 판정(수입3·국산2).
const IMPORT_BRANDS = ['bmw', 'benz', 'mercedes', '벤츠', 'audi', '아우디', 'volvo', '볼보', 'lexus', '렉서스',
  'porsche', '포르쉐', 'jaguar', '재규어', 'land rover', '랜드로버', 'mini', '미니', 'volkswagen', '폭스바겐', 'peugeot',
  '푸조', 'maserati', '마세라티', 'bentley', '벤틀리', 'rolls', '롤스', 'ferrari', '페라리', 'lamborghini', '람보르기니',
  'tesla', '테슬라', 'lincoln', '링컨', 'toyota', '토요타', 'honda', '혼다', 'nissan', '닛산',
  'infiniti', '인피니티', 'jeep', '지프', 'chrysler', '크라이슬러', 'ford', '포드', 'cadillac', '캐딜락',
  'polestar', '폴스타', 'citroen', '시트로엥', 'fiat', '피아트', 'alfa romeo', '알파로메오',
  'dodge', '닷지', 'gmc', 'ram'];
const DOMESTIC_BRANDS = ['현대', '기아', '제네시스', '르노코리아', '르노삼성', '르노', '쉐보레', '한국gm', 'kg모빌리티', 'kgm', '쌍용'];
export function isImportBrand(name: string): boolean {
  const nl = String(name || '').toLowerCase();
  return IMPORT_BRANDS.some((b) => nl.includes(b));
}
function brandDepositMultiplier(rec: EntityRecord): 0 | 2 | 3 {
  // 차종마스터에 스냅된 행은 origin을 SSOT로 쓴다. 제조사 키워드 목록은
  // 미스냅·레거시 행을 위한 보수적 폴백일 뿐이며, 모르는 브랜드를 국산으로 추정하지 않는다.
  const origin = String(rec.origin ?? '').trim().toLowerCase();
  const confidence = String(rec._snap_confidence ?? '');
  const trustedOrigin = confidence === 'high' || confidence === 'medium'
    || rec._deposit_origin_trusted === true;
  if (trustedOrigin && (origin === '국산' || origin === 'domestic')) return 2;
  if (trustedOrigin && (origin === '수입' || origin === 'import' || origin === 'imported')) return 3;
  // low 스냅의 maker는 마스터 후보 하나를 임의 선택한 결과일 수 있다. 이때는 스냅된
  // maker가 아니라 공급사 원문 maker만 신뢰해야 마스터 배열 순서에 따라 금액이 바뀌지 않는다.
  const rawVehicle = rec._raw_vehicle && typeof rec._raw_vehicle === 'object'
    ? rec._raw_vehicle as Record<string, unknown>
    : null;
  // AutoPlus may put the maker in the model cell (`BMW X1`) and leave maker blank.
  // Use only the original identity text, never a low-confidence snapped maker.
  const rawIdentity = rec._snapped
    ? `${rawVehicle?.maker ?? ''} ${rawVehicle?.model ?? ''} ${rawVehicle?.sub_model ?? ''}`
    : `${rec.maker ?? ''} ${rec.model ?? ''} ${rec.sub_model ?? ''}`;
  const identity = rawIdentity.trim().toLowerCase();
  if (!identity) return 0;
  if (DOMESTIC_BRANDS.some((brand) => identity.includes(brand))) return 2;
  if (IMPORT_BRANDS.some((brand) => identity.includes(brand))) return 3;
  return 0; // 미확정 브랜드를 국산으로 추정해 금액을 만들지 않는다.
}

function canonicalOrigin(value: unknown): '국산' | '수입' | '' {
  const origin = String(value ?? '').trim().toLowerCase();
  if (origin === '국산' || origin === 'domestic') return '국산';
  if (origin === '수입' || origin === 'import' || origin === 'imported') return '수입';
  return '';
}

/** low 스냅이라도 원문 모델과 정확히 맞는 모든 마스터 후보의 origin이 하나일 때만 금액 판정에 사용. */
/**
 * 마스터가 **만장일치로** 말하는 국산/수입. 갈리면 공란(fail-closed).
 * 저장 필드로 남기지 않고 «그때그때 판정»해서 금액에만 쓴다 — 이게 이 프로젝트의 규칙이고,
 * `sim-sheet-price` 의 MASTER-ORIGIN 항목이 그걸 지킨다. 감사·보수 스크립트도 같은 판정을 써야
 * «도구만 맞는» 숫자가 안 나온다. 그래서 export 한다.
 */
export function unambiguousMasterOrigin(raw: EntityRecord, entries: MasterEntry[]): '국산' | '수입' | '' {
  if (String(raw.maker ?? '').trim()) return '';
  const norm = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, '').toLowerCase();
  const sub = norm(raw.sub_model);
  const model = norm(raw.model);
  if (!sub && !model) return '';
  // 세부모델 exact가 있으면 모델명 전체 후보보다 강한 신호다. 없을 때만 모델로 넓힌다.
  const subCandidates = sub ? entries.filter((entry) => norm(entry.sub_model) === sub) : [];
  const candidates = subCandidates.length
    ? subCandidates
    : entries.filter((entry) => norm(entry.model) === model || norm(entry.sub_model) === model);
  if (!candidates.length) return '';
  const origins = new Set(candidates.map((entry) => canonicalOrigin(entry.origin)));
  return origins.size === 1 && !origins.has('') ? [...origins][0] : '';
}
/** 월 대여료 칸 — 한 개의 양수 금액만 허용한다. 설명문·음수·복수금액 결합은 0(오류) 처리. */
export function rentCell(s: unknown): number {
  const t = String(s ?? '').trim();
  if (!t) return 0;
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)\s*(원|만원)?$/.exec(t);
  if (!match) return 0;
  let value = Number(match[1].replace(/,/g, ''));
  if (!Number.isSafeInteger(value) || value <= 0) return 0;
  if (match[2] === '만원') value *= 10_000;
  // 무단위 1~9,999만 기존 시트의 만원 단위 원자로 허용한다.
  // 명시적 `원` suffix(예: 650원)를 같은 방식으로 확대하면 650만원으로 변조된다.
  const normalized = !match[2] && value < 10_000 ? value * 10_000 : value;
  if (normalized < 100_000 || normalized > 20_000_000) return 0;
  return value;
}

/**
 * 보증금 칸 — **숫자 칸일 때만** 값으로 인정한다.
 *
 * 실측(손오공·종합시트): 장기보증 칸에 금액이 아니라 규칙 문장이 들어 있다 —
 *   "12개월 : 1개월치 / 24개월 : 2개월치 / 36개월 : 3개월치 …"
 * 숫자만 긁어 합치면 1212243364485605 같은 값이 보증금으로 게시된다.
 * 그래서 콤마·공백·원/만원 정도만 붙은 순수 금액 칸만 통과시킨다.
 */
/**
 * **보증금이 0 원이라고 «밝힌»** 표기. 공백을 지운 값으로 본다.
 *   통과: 무보증 · 보증금없음 · 보증없음 · 없음 · 0 · 0원
 *   불통과: 무보증«가능» · 무보증«협의» — 될 수도 있다는 말이지 0 이 아니다.
 */
const MEANS_NO_DEPOSIT = /^(무보증|보증금없음|보증없음|없음|0|0원)$/;

function depositCell(s: unknown): number {
  const t = String(s ?? '').trim();
  if (!t) return 0;
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)\s*(원|만원)?$/.exec(t);
  if (!match) return 0;
  let value = Number(match[1].replace(/,/g, ''));
  if (!Number.isSafeInteger(value) || value <= 0) return 0;
  if (match[2] === '만원') value *= 10_000;
  // normalizeWonPair가 1~9,999를 만원 단위로 해석한다. 명시적 `원` 소액은
  // 그 경로에 보내지 말고 무효 처리해야 금액이 10,000배로 부풀지 않는다.
  if (match[2] === '원' && value < 10_000) return 0;
  return value <= 100_000_000 ? value : 0;
}
// 결정적 짧은 해시 — 번호없는 신차 임시번호(재동기화 멱등: 같은 신원 → 같은 번호).
function shortHash(s: string): string {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 4).toUpperCase().padStart(4, '0');
}

/**
 * 시트 가격 컬럼 파싱(v3 오토플러스식 이식) — 기간별 대여료(+주행 변형 24개월_3만) → price 맵.
 * 보증금: 단기/장기보증·보증금 컬럼 있으면 그 값, 없으면(오토플러스식) 대여료×배율(수입3·국산2, isImportBrand 판정).
 * 원단위 정규화·이상치는 priceList가 read-time으로 처리 → 여기선 원시 추출만.
 */
/**
 * 공급사 보증금 규칙 — 시트 보증금 칸이 비어 있을 때 무엇으로 채울지.
 *
 * 시트에 금액을 안 적고 "규칙"으로 운영하는 공급사가 있다. 손오공 구독차량이 그렇다:
 *   1년 1개월치 · 2년 2개월치 · 3년 3개월치 …  (= 대여료 × 기간/12)
 * 실제로 종합시트 장기보증 칸에 그 문장이 적혀 있고, 개별시트에선 아예 빈칸이다.
 * 검산: 375어8056 인수형 36개월 1,050,000 × 3 = 시트 보증금 3,150,000 ✓
 *
 * 규칙은 **공급사마다 다르므로 코드에 박지 않고 partner.deposit_rule 로 둔다.**
 *   'months_per_year' — 대여료 × round(기간/12)개월치 (최소 1)
 *   'rent_multiple'   — 대여료 × 수입3·국산2 (오토플러스식)
 *   미설정            — 채우지 않는다(그 기간은 게시 안 함)
 */
export type DepositRule = 'months_per_year' | 'rent_multiple' | '';

export function parseDepositRule(value: unknown): DepositRule {
  const rule = String(value ?? '').trim();
  if (rule === '' || rule === 'months_per_year' || rule === 'rent_multiple') return rule;
  throw new Error(`보증금 규칙 설정 오류 — ${rule}`);
}

function depositByRule(rule: DepositRule, rent: number, period: number, importMult: number): number {
  if (rule === 'months_per_year') return rent * Math.max(1, Math.round(period / 12));
  if (rule === 'rent_multiple') return rent * importMult;
  return 0;
}

export function parsePriceColumns(
  headers: string[],
  cells: string[],
  rec: EntityRecord,
  depositRule: DepositRule = '',
): Record<string, { rent: number; deposit: number }> | null {
  // 보증 컬럼은 **자기 뒤의 기간 컬럼들을 관할한다**(블록 스코프).
  //  실측 레이아웃이 전부 이 모양이다:
  //   아이카/우리캐피탈  단기보증 | 1·6·12개월 | 장기보증 | 24·36·48·60개월
  //   손오공/웰릭스      보증금 | 12~60개월(인수형) | 보증금 | 12~60개월(반납형)
  //  예전엔 보증 컬럼을 시트 전체에서 하나로 뭉쳐(flatDep) **뒤에 나온 게 앞을 이겼다.**
  //  그래서 손오공 인수형 요율에 반납형 빈 보증금칸이 붙고, 빈칸이라 아래 ×배율 폴백이 걸려
  //  **시트 어디에도 없는 보증금이 만들어졌다**(375어8056: 시트 3,150,000 → 저장 1,814,000).
  const cols: { key: string; period: number; idx: number; dep: number }[] = [];
  let curDep = -1;          // 지금 블록을 관할하는 보증 컬럼
  // 명시적 단기/장기 보증 컬럼은 위치와 무관하게 먼저 찾는다.
  // 관리자 화면이 내려주는 표준 CSV는 기간 열 뒤에 단기/장기보증이 오는데, 한 번에 왼쪽→오른쪽으로
  // 훑으면 기간 열을 만났을 때 보증 열을 아직 몰라 가격 전부가 사라졌다.
  const normalizedHeaders = headers.map((h) => String(h ?? '').trim().replace(/\s+/g, ''));
  let shortDep = normalizedHeaders.findIndex((h) => /단기.*보증/.test(h));
  let longDep = normalizedHeaders.findIndex((h) => /장기.*보증/.test(h));
  const genericDeps = normalizedHeaders
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => /보증/.test(header) && !/단기|장기/.test(header));
  if (shortDep < 0 && longDep < 0 && genericDeps.length === 1) {
    shortDep = genericDeps[0].index;
    longDep = genericDeps[0].index;
  }
  let anyDepCol = normalizedHeaders.some((h) => /보증/.test(h));
  /**
   * ★보증 열이 **하나뿐이면 그 하나가 전부를 관할한다.**
   *   아이카 시트는 「장기보증」 하나만 두고 단기·장기를 같이 쓴다. 예전엔 단기 기간이
   *   관할 보증 열을 못 찾아(-1) 요금이 통째로 버려졌다 — 그래서 월렌트만 있는 차가
   *   「요금 0건」으로 안 올라왔다(실측 2026-08-12 · 57호9876 제네시스 G70).
   *   공급사가 적어 둔 유일한 보증금을 쓰는 것이지 없는 값을 지어내는 게 아니다.
   */
  if (shortDep < 0 && longDep >= 0 && normalizedHeaders.filter((h) => /보증/.test(h)).length === 1) {
    shortDep = longDep;
  }
  headers.forEach((h, i) => {
    // 공백·슬래시 변형 흡수: "12개월 3만" · "12개월3만" · 오토플러스 "12/3만"
    const t = String(h ?? '').trim().replace(/\s+/g, '');
    /**
     * ★「월렌트」는 **1개월 요금**이다(사장님 2026-08-12 — 「그럼 1개월만 올리면 되잖아」).
     *   아이카는 기간 열을 36·48·60개월만 두고 짧은 건 「월렌트」 한 칸으로 적는다.
     *   그 이름을 안 읽으면 그 차는 요금이 하나도 없는 차가 된다.
     *   ⚠ 아이카의 「월렌트」 **탭**은 별개다 — 그건 취급하지 않는다(탭은 여기까지 오지 않는다).
     */
    const pm = /^월렌트$|^월세$|^월대여료?$/.test(t)
      ? { period: '1', variant: '' }
      : (() => {
          const month = /^(\d+)개월(?:([1-9]\d*만)|[（(]?(인수형|반납형)[)）]?)?$/.exec(t);
          if (month) {
            return {
              period: month[1],
              // 반납형은 영업 기본가다. 인수형만 별도 가격 변형으로 보존한다.
              variant: month[2] || (month[3] === '인수형' ? '인수형' : ''),
            };
          }
          const mileage = /^(\d+)[/／]([1-9]\d*만)$/.exec(t);
          return mileage ? { period: mileage[1], variant: mileage[2] } : null;
        })();
    if (pm) {
      const period = Number(pm.period);
      const variant = pm.variant;
      cols.push({
        key: variant ? `${period}_${variant}` : String(period),
        period, idx: i,
        dep: curDep >= 0 ? curDep : (period >= 24 ? longDep : shortDep),
      });
      return;
    }
    if (/단기.*보증/.test(t)) { shortDep = i; curDep = i; }
    else if (/장기.*보증/.test(t)) { longDep = i; curDep = i; }
    else if (/보증/.test(t)) { curDep = i; anyDepCol = true; }
  });
  if (!cols.length) return null;
  // 수입판정 = 스냅 후 maker + 원본 모델/트림 표기(시트에 제조사칸 없을 때)
  const depMult = brandDepositMultiplier(rec);
  const price: Record<string, { rent: number; deposit: number }> = {};
  // 같은 기간이 여러 블록에 있으면 **값이 있는 마지막 블록**을 쓴다.
  //  손오공·웰릭스는 인수형(왼쪽)·반납형(오른쪽) 두 벌인데, 종합시트가 실제로 게시하는 건 반납형이다
  //  (실측 375어8056: 종합 12개월 907,000 = 개별시트 반납형 값). 차마다 한쪽만 채우기도 해서
  //  "행에 값이 있는 쪽"을 골라야 한다 — 헤더만 보고 한 블록을 통째로 버리면 161허1397 처럼
  //  반납형에만 값이 있는 차가 가격 없이 올라간다.
  for (const { key, period, idx, dep } of cols) {
    const rent = rentCell(cells[idx]);
    if (!rent) continue;
    const setPrice = (deposit: number) => {
      const normalized = normalizeWonPair(rent, deposit);
      price[key] = { rent: normalized.rent, deposit: normalized.deposit };
    };
    const colDep = dep >= 0 ? depositCell(cells[dep]) : 0;
    if (colDep) { setPrice(colDep); continue; }
    /**
     * ★공급사가 **「무보증」이라고 적은 것**은 빈 칸이 아니라 «보증금 0원»이다.
     *
     * 아래 fail-closed 는 «못 읽은 칸»을 위한 것이지 «0 이라고 밝힌 칸»을 위한 게 아니다.
     * 실측(2026-08-10 · 아이카 새 시트 「장기특별이벤트」): 장기보증 칸이 전부 「무보증」이라
     * 요금이 멀쩡한 72대가 통째로 유입에서 빠졌다(imported 0 · noPriceCount 53).
     * ⚠ 「무보증**가능**」처럼 «될 수도 있다»는 말은 0 이 아니다 — 확정 표현만 통과시킨다.
     */
    if (dep >= 0 && MEANS_NO_DEPOSIT.test(String(cells[dep] ?? '').replace(/\s+/g, ''))) { setPrice(0); continue; }
    // 보증 컬럼 유무와 무관하게 **명시된 공급사 규칙만** 적용한다. 예전에는 보증 헤더가
    // 사라진 모든 generic 시트를 오토플러스식 ×2/×3으로 간주해 허위 보증금을 만들었다.
    const ruled = depositByRule(depositRule, rent, period, depMult);
    if (ruled) { setPrice(ruled); continue; }
    // 보증 컬럼 자체가 없고 규칙도 없으면 fail-closed. 무보증이라고 추정하지 않는다.
    if (!anyDepCol) continue;
    // 보증 컬럼은 있는데 이 행·이 블록만 비었다.
    // 규칙도 없으면 **숫자를 만들어내지 않는다.** 같은 기간의 앞 블록에 이미 유효한
    // 값이 있으면 그것까지 지우면 안 된다("값이 있는 마지막 블록" 규칙).
    //  deposit:0 은 화면에서 무보증을 뜻하므로(product.ts isDepositFree) 0으로도 쓰면 안 된다.
    //  예전엔 여기서 rent×배율로 채워 시트에 없는 보증금을 게시했다
    //  (375어8056: 시트 3,150,000 → 저장 1,814,000). 보증금을 말할 수 없는 기간은 빼고 간다.
    continue;
  }
  return Object.keys(price).length ? price : null;
}

/** 영업자 상품리스트의 `640,000\n1,500,000` 셀을 기간별 가격으로 되읽는다. */
export function parseCompactPriceColumns(
  headers: string[],
  cells: string[],
): Record<string, { rent: number; deposit: number }> | null {
  const price: Record<string, { rent: number; deposit: number }> = {};
  for (const [index, header] of headers.entries()) {
    const match = /^(\d+)개월$/.exec(String(header ?? '').trim().replace(/\s+/g, ''));
    if (!match) continue;
    const raw = String(cells[index] ?? '').trim();
    if (!raw) continue;
    const parts = raw.split(/\r?\n/).map((part) => part.trim()).filter(Boolean);
    if (!parts.length || parts.length > 2) continue;
    const rent = rentCell(parts[0]);
    if (!rent) continue;
    let deposit = 0;
    if (parts.length === 2) {
      const compact = parts[1].replace(/\s+/g, '');
      if (!MEANS_NO_DEPOSIT.test(compact)) {
        deposit = depositCell(parts[1]);
        if (!deposit) continue;
      }
    } else {
      // 대여료만 적은 것은 보증금 0의 명시가 아니다. 값을 지어내지 않는다.
      continue;
    }
    const normalized = normalizeWonPair(rent, deposit);
    price[match[1]] = { rent: normalized.rent, deposit: normalized.deposit };
  }
  return Object.keys(price).length ? price : null;
}

/**
 * 시트 표 → 매물 취합. delimited → 매핑 → 차종스냅 → 차번 dedup.
 *   ★ entries(마스터) 필수. 저장은 master-ingress.commitSupplierProducts.
 */
export function importSheetTable(table: string[][], opts: {
  providerCode: string; entries: MasterEntry[]; profile?: MappingProfile;
  /** 저장 당시 field→헤더 signature. 낡은 index 매핑을 차단한다. */
  profileHeaders?: MappingHeaderSignature;
  /** partner.deposit_rule — 시트 보증금 칸이 빌 때 채우는 공급사 규칙 */
  depositRule?: DepositRule;
  /** 번호미정 신차 임시번호 할당기. **저장 경로는 반드시 주입할 것**(미주입 = 미리보기용) */
  plateAllocator?: PlateAllocator;
  /** 여러 탭을 하나의 시트처럼 읽을 때 번호미정 동일스펙 순번을 공유한다. */
  pendingOccurrence?: Map<string, number>;
  /**
   * 차량번호 → 사진 링크(셀 하이퍼링크·스마트칩에서 뽑은 것).
   *
   * 공급사는 사진을 «열»로 주지 않는다. 차량번호 셀에 링크를 건다 —
   * 아이카는 상세페이지, 오플·리더스는 드라이브 폴더다. 그래서 헤더 매핑으로는 못 잡고
   * 그리드 메타데이터에서 따로 받아 여기로 넘긴다(`sheet-visible-grid.photoUrlFromCell`).
   * 행 인덱스가 아니라 «차번»으로 묶는다 — 어댑터가 헤더 앞 안내행을 잘라내면 인덱스가
   * 밀려 남의 차 사진이 붙기 때문이다.
   */
  photoByPlate?: Record<string, string>;
  /** 영업자 정본에 이미 발급된 `100신…` 식별자가 있으면 새 번호를 뽑지 않고 그대로 사용한다. */
  acceptAssignedPendingPlate?: boolean;
  /** 영업자 시트처럼 기간 셀 한 칸에 `대여료↵보증금`을 함께 적는 규격. */
  compactPriceCells?: boolean;
  /** 영업자 정본의 기존 계약중 표시는 유지하되, 신규 계약중 생성은 계획 단계에서 차단한다. */
  preserveCanonicalContractStatus?: boolean;
}): ImportResult {
  if (!opts.entries?.length) throw new Error('차종마스터 필수 — importSheetTable');
  const headers = table[0] || [];
  const dataRows = table.slice(1);
  const autoMapping = autoMapHeaders(headers);
  const savedProfile = parseMappingProfile(opts.profile);
  const savedHeaders = parseMappingHeaderSignature(opts.profileHeaders);
  const depositRule = parseDepositRule(opts.depositRule);
  const hasSavedProfile = !!savedProfile;
  /**
   * 저장 프로필이 «덮는» 게 아니라 «우선»한다 — 프로필에 없는 필드는 자동매핑으로 채운다.
   *
   * 프로필은 사람이 고친 기록이라 같은 필드에서는 이겨야 한다. 하지만 프로필에 아예 없는
   * 필드까지 막으면, 별칭을 새로 배워도 그 공급사만 영영 못 읽는다 —
   * 실측(2026-08-07): 빌린카 「모델명(트림)」 열에 트림 풀표기가 있는데 옛 프로필에 그 필드가
   * 없어 통째로 버려졌고, 별칭을 추가해도 아무 변화가 없었다(검수 16대).
   * 프로필에 있는 필드는 그대로 두므로, 사람이 «일부러 뺀» 선택은 유지된다.
   */
  const mapping = hasSavedProfile ? { ...autoMapping, ...savedProfile } : { ...autoMapping };
  // 저장 index는 과거 위치일 뿐 정본이 아니다. signature가 있으면 현재 헤더 이름을 다시 찾아
  // 새 위치로 매핑한다. 공급사가 열을 삽입·이동해도 같은 이름이면 계속 연동되고,
  // 이름이 없어지거나 중복되면 다른 열을 잘못 읽지 않도록 fail-closed한다.
  if (hasSavedProfile) {
    for (const [field, savedIndex] of Object.entries(mapping)) {
      const savedHeader = normalizeSheetHeader(savedHeaders?.[field]);
      if (savedHeader) {
        const matches = headers
          .map((header, index) => normalizeSheetHeader(header) === savedHeader ? index : -1)
          .filter((index) => index >= 0);
        if (!matches.length) {
          // 표준양식 개편으로 `배차상태`→`상태`처럼 공식 별칭 안에서 이름만 바뀐 경우다.
          // 같은 필드로 해석되는 현재 헤더가 정확히 하나일 때만 안전하게 재결합한다.
          const aliasMatches = headers
            .map((header, index) => {
              const single = autoMapHeaders([header]);
              const combinedVehicleName = field === 'model'
                && single.trim_name === 0
                && /^(차명|모델)\(?트림\)?$/.test(normalizeSheetHeader(header));
              return single[field] === 0 || combinedVehicleName ? index : -1;
            })
            .filter((index) => index >= 0);
          if (aliasMatches.length === 1) {
            mapping[field] = aliasMatches[0];
            continue;
          }
          if (aliasMatches.length > 1) throw new Error(`시트 헤더 중복 — ${field} 공식 별칭 열을 하나로 정리하세요`);
          if (field === 'partner_memo') {
            delete mapping[field];
            continue;
          }
          throw new Error(`시트 헤더 없음 — ${field}(${savedHeaders?.[field]}) 매핑을 확인하세요`);
        }
        if (matches.length > 1) throw new Error(`시트 헤더 중복 — ${field}(${savedHeaders?.[field]}) 열을 하나로 정리하세요`);
        mapping[field] = matches[0];
        continue;
      }
      // signature 없는 레거시 프로필은 알려진 별칭이 같은 index에서 재탐지될 때만
      // 허용한다. 커스텀 헤더는 현재 표를 보고 1회 재매핑해야 한다.
      if (!Number.isInteger(savedIndex) || savedIndex < 0 || savedIndex >= headers.length) {
        throw new Error(`시트 헤더 이동 감지 — ${field} 매핑을 다시 저장하세요`);
      }
      if (autoMapping[field] !== savedIndex) {
        throw new Error(`시트 헤더 검증 필요 — ${field} 매핑을 다시 저장하세요`);
      }
    }
  }
  // 번호가 비어 있는 신차도 '차량번호' 열 자체는 있어야 한다. 열이 사라진 시트를 전 행
  // 번호미정 신차로 오인해 100신 임시번호를 대량 생성하지 못하게 한다.
  if (!('car_number' in mapping) && autoMapping.car_number !== undefined) {
    mapping.car_number = autoMapping.car_number;
  }
  const carIndex = mapping.car_number;
  if (carIndex === undefined || carIndex < 0 || carIndex >= headers.length) {
    throw new Error('차량번호 열 없음 — 시트 매핑을 확인하세요');
  }
  // 저장된 프로파일에 상태열이 없으면(구버전 매핑) 상태열 자동탐지로 보강.
  // 없으면 rec.vehicle_status가 안 채워져 출고불가 제외·상태동기화가 통째로 안 걸림(아이카 "즉시출고" 헤더 케이스).
  if (!('vehicle_status' in mapping)) {
    const autoStatus = autoMapping.vehicle_status;
    if (autoStatus !== undefined) mapping.vehicle_status = autoStatus;
  }
  const products: EntityRecord[] = [];
  const seen = new Set<string>();
  const snap = { high: 0, medium: 0, low: 0, none: 0 };
  let skipped = 0;
  let duplicateCount = 0;
  let invalidCount = 0;
  let sourceRowCount = 0;
  let excludedCount = 0;
  let noPriceCount = 0;
  let noPriceSkippedCount = 0;
  const issueSamples: string[] = [];
  const addIssue = (message: string) => { if (issueSamples.length < 12) issueSamples.push(message); };
  const allocator = opts.plateAllocator || previewPlateAllocator();
  const pendingSeen = opts.pendingOccurrence || new Map<string, number>(); // 스펙서명 → 전체 탭에서 몇 번째인지
  for (const [rowOffset, cells] of dataRows.entries()) {
    const rowNo = rowOffset + 2; // prepareTable 기준 헤더 다음 행부터
    // 구글시트가 서식만 아래로 늘린 완전 빈 행은 데이터가 아니다. 무효행·원문행수에 넣으면
    // 실제 오류처럼 보이고 급감 기준선도 부풀어난다.
    if (cells.every((cell) => !String(cell ?? '').trim())) continue;
    const rec: EntityRecord = {};
    for (const [field, idx] of Object.entries(mapping)) { const v = String(cells[idx] ?? '').trim(); if (v) rec[field] = v; }
    if (rec.options) rec.options = normalizeProductOptionsText(rec.options);
    // 셀 링크에서 온 사진 — 시트에 사진 «열»이 따로 있으면 그쪽이 우선이다(공급사가 명시한 값).
    if (!String(rec.photo_link || '').trim() && opts.photoByPlate) {
      const key = String(rec.car_number || '').replace(/\s/g, '').match(/\d{2,3}[가-힣]\d{4}/)?.[0];
      const linked = key ? opts.photoByPlate[key] : '';
      if (linked) rec.photo_link = linked;
    }
    const mappedIndexes = new Set(Object.values(mapping));
    // 차종을 설명하는 글만 모은다 — 트림은 열이 없고 차명·설명 칸에 문장으로 섞여 온다.
    // 금액·날짜·차번·기간은 넣지 않는다. 모델명과 겹치는 숫자가 들어가면 오매칭이 된다.
    {
      const text: string[] = [];
      for (let i = 0; i < cells.length; i++) {
        if (mappedIndexes.has(i)) continue;
        const v = String(cells[i] ?? '').trim();
        if (!v || v.length > 60) continue;
        if (!VEHICLE_TEXT_RE.test(v)) continue;
        if (NON_VEHICLE_TEXT_RE.test(v)) continue;
        text.push(v);
      }
      if (text.length) rec._row_text = text.join(' ');
    }
    const hasRelevantCell = cells.some((cell, index) => {
      if (!String(cell ?? '').trim()) return false;
      return mappedIndexes.has(index) || /\d+\s*(?:개월|[/／])|보증/.test(String(headers[index] || ''));
    });
    // 구분 제목·섹션 라벨처럼 **매핑되지 않은 열에만** 값이 있는 행은 데이터가 아니다.
    // AutoPlus 원본의 `수리중/매각진행중/판매보류` 구간 라벨을 무효 차량으로 세지 않는다.
    if (!hasRelevantCell) continue;
    const mappedIdentity = [rec.car_number, rec.maker, rec.model, rec.sub_model, rec.trim_name, rec.year]
      .some((value) => String(value ?? '').trim());
    const rowText = cells.map((cell) => String(cell ?? '').trim()).filter(Boolean).join(' ');
    if (!mappedIdentity
      && !cells.some((cell) => isExactRealPlate(String(cell ?? '').replace(/\s/g, '')))
      && SHEET_NOTICE_ROW_RE.test(rowText)) {
      continue;
    }
    sourceRowCount++;
    let rawCar = String(rec.car_number || '').trim();
    let car = rawCar.replace(/\s/g, '');
    // 열이 밀린 시트 구제 — 지정된 차번 칸이 번호판이 아니면 **그 행에서 번호판을 찾는다.**
    //  시트마다 열 순서가 다르고, 같은 시트 안에서도 중간부터 칸이 빠져 밀리는 원본이 있다
    //  (실측 2026-08-07: 이안카 차번 칸에 「쿠퍼c5도어」·「1.6가솔린터보2WD트렌디」 같은 스펙 문자열).
    //  번호판 형식(00가0000·000가0000)은 스펙 문자열과 겹치지 않아 그 행의 차를 안전하게 집어낸다.
    //  ★첫 칸만 취한다 — 메모에 다른 차번이 적힌 행에서 뒤쪽 값을 주워 오면 남의 차가 된다.
    // 표 중간에 헤더가 한 번 더 들어간 원본이 있다(구간을 나눠 적는 시트). 그 행의 차번 칸에는
    // 「차량번호」라는 라벨이 그대로 있어 무효 차번으로 잡히고, 무효 하나가 커밋 전체를 막는다.
    // 데이터가 아니라 라벨이므로 조용히 건너뛴다 — 무효로 세면 원문에 고칠 게 없는데 계속 막힌다.
    if (/^(차량번호|차번|차번호|등록번호)$/.test(car)) { sourceRowCount--; continue; }
    if (car && !isExactRealPlate(car)) {
      const found = cells.map((cell) => String(cell ?? '').replace(/\s/g, '')).find(isExactRealPlate);
      if (found) {
        addIssue(`행 ${rowNo} 차번 칸 밀림 · ${rawCar.slice(0, 20)} → ${found}`);
        rec.car_number = found;
        rawCar = found;
        car = found;
      }
    }
    let pendingSig = '';
    const explicitPreReleased = /^(?:신차(?:\(선출고\))?|신차렌트|신차구독)$/i.test(
      String(rec.product_type || '').replace(/\s/g, ''),
    );
    const assignedPendingPlate = opts.acceptAssignedPendingPlate && /^100신\d{4,}$/i.test(car);
    // 이안카처럼 번호판 미발급 신차의 차번 칸에 차명을 적는 양식이 있다. 일반 설명문을
    // 전부 허용하지 않고, 구분이 명시적 신차이며 번호판 오타 형태도 아닐 때만 pending 처리한다.
    const looksLikeMalformedPlate = /\d{2,3}[가-힣]\d{3,5}/.test(car);
    const pendingMarker = !car
      || /^(?:-|–|—|0|미정|번호미정|차량미정|신차(?:\(선출고\))?|미등록|미발급)$/i.test(car)
      || (explicitPreReleased && !looksLikeMalformedPlate);
    // 시트 차번은 전체 셀이 정확한 번호판 형식이어야 한다. 부분일치(12가34567,
    // "차량 12가3456 확인")를 새 상품키로 만들면 기존 정상차가 부재 차단된다.
    const exactPlate = isExactRealPlate(car);
    if (assignedPendingPlate) {
      rec.is_pending_plate = true;
      rec.product_type = '신차렌트';
    } else if (car && !exactPlate) {
      if (!pendingMarker) {
        skipped++; invalidCount++;
        addIssue(`행 ${rowNo} 잘못된 차번 · ${rawCar}`);
        continue;
      }
      rec.car_number = '';
      car = '';
    }
    if (!car) {
      // 번호미정 = 신차. 버리지 않고 100신0001 순번 임시번호를 준다.
      //  ⚠ 같은 스펙 차가 여러 줄이면 **줄마다 다른 번호**여야 한다 — 예전엔 신원 해시 하나로
      //    묶어서 우리캐피탈 그랑 콜레오스 10대 중 9대가 중복제거로 사라졌다.
      //    번호 자체는 allocator 가 관리한다(부여기록을 partner 에 저장해 재사용 — pending-plate.ts).
      const ident = `${rec.maker || ''}${rec.model || ''}${rec.sub_model || ''}${rec.trim_name || ''}${rec.year || ''}`.replace(/\s/g, '');
      if (!ident) {
        skipped++; invalidCount++;
        const evidence = cells.map((cell) => String(cell ?? '').trim()).filter(Boolean).slice(0, 6).join(' | ');
        addIssue(`행 ${rowNo} 무효 · ${rawCar || '차번·차명 없음'}${evidence ? ` · ${evidence}` : ''}`);
        continue;
      }
      // 실제 올릴 수 있는 행(상태·가격 검증 통과)에만 occurrence를 소비한다. 가격없는
      // 안내행 하나가 앞에 끼었다고 기존 신차의 임시번호가 전부 밀리면 안 된다.
      pendingSig = pendingSignature(rec);
      rec.is_pending_plate = true;
      rec.product_type = '신차렌트';
    }
    // 실차번은 출고상태·가격과 무관하게 먼저 중복을 확정한다. 제외 행을 seen에
    // 넣지 않으면 같은 출고불가 차번을 반복해 sourceRowCount를 부풀리고 급감가드를
    // 우회할 수 있다. 중복이 한 건이라도 있으면 커밋 경계에서 fail-closed 한다.
    if (car) {
      if (seen.has(car)) {
        skipped++; duplicateCount++;
        addIssue(`행 ${rowNo} 중복 · ${car}`);
        continue;
      }
      seen.add(car);
    }
    // **출고불가는 올리지 않는다**. 단, 먼저 차량 신원을 검증해야 한다.
    // 차번·차명이 없는 안내행에 상태 글자만 있다고 "전 행 명시적 출고불가"로 오인하면
    // 기존 공급사 재고 전체가 차단될 수 있다.
    const canonicalContractStatus = opts.preserveCanonicalContractStatus
      && String(rec.vehicle_status || '').trim() === '계약중';
    if (!canonicalContractStatus && isSheetExcluded(rec.vehicle_status)) { excludedCount++; continue; }
    rec.provider_company_code = opts.providerCode;
    rec.partner_code = opts.providerCode;
    rec.source = 'sheet';
    rec.source_schema = opts.providerCode;                 // 공급사별 소스 태깅 → "이 렌트사만 빼기" 한방
    const rawStatus = String(rec.vehicle_status || '').trim();
    if (rawStatus) rec.status_label_raw = rawStatus;
    // 상태 컬럼이 없거나 빈 행도 canon SSOT를 거친다. 별도 기본값 분기를 두면
    // canon의 안전 기본값(출고협의)과 다시 어긋난다.
    rec.vehicle_status = canonicalContractStatus ? '계약중' : canonSheetVehicleStatus(rawStatus);
    if (canonicalContractStatus) rec._sheet_contract_status = true;
    if (!rec.product_type) rec.product_type = '중고렌트';
    // 연료칸 "가솔린1.0"·"LPG3.0" → 연료/배기 분리
    if (rec.fuel_type) {
      const fuel = fuelDisplay(rec.fuel_type);
      const cc = fuelEmbeddedCc(rec.fuel_type);
      if (fuel) rec.fuel_type = fuel;
      if (cc > 0 && !rec.engine_cc) rec.engine_cc = String(cc);
    }
    // 값 정규화 = 차종마스터 스냅 — 항상(entries 필수)
    const rawPriceIdentity: EntityRecord = {
      maker: rec.maker, model: rec.model, sub_model: rec.sub_model,
    };
    const res = snapToMaster(rec, opts.entries);
    if (res) Object.assign(rec, applySnap(rec, res, { source: 'ingress' }));
    Object.assign(rec, applyColors(rec));
    // 가격 — 기간별 대여료 컬럼 파싱(+보증금 컬럼 or 공급사 규칙). snap 후 maker 확정 시점.
    const rawMakerPresent = !!String(rawPriceIdentity.maker ?? '').trim();
    // For maker-less labels such as `K5 HEV`, use the snapped canonical path only
    // when every exact master candidate agrees on origin. Mixed-origin names still
    // fail closed, independent of master array order.
    const consensusIdentity = !rawMakerPresent && res
      // Do not use a snapped sub-model here: a low-confidence candidate can invent
      // one side of an otherwise mixed-origin model and make array order affect money.
      ? { model: res.model }
      : rawPriceIdentity;
    const consensusOrigin = !rawMakerPresent
      ? unambiguousMasterOrigin(consensusIdentity, opts.entries)
      : '';
    const priceRecord = res?.origin ? {
      ...rec,
      // 제조사 원문이 없으면 confidence와 무관하게 동일 raw model 후보들의 origin 합의가
      // 있어야 한다. 같은 모델명이 국산·수입 마스터에 함께 있으면 배열 첫 후보를 믿지 않는다.
      origin: rawMakerPresent
        ? (res.confidence === 'high' || res.confidence === 'medium' ? res.origin : '')
        : consensusOrigin,
      _deposit_origin_trusted: !!consensusOrigin,
    } : rec;
    const standardPrice = parsePriceColumns(headers, cells, priceRecord, depositRule);
    const compactPrice = opts.compactPriceCells ? parseCompactPriceColumns(headers, cells) : null;
    // 영업자용 시트는 과거의 `대여료\n보증금` 압축 셀과 현재의 보증금·대여료 분리 열을
    // 모두 받아야 한다. 행마다 두 형식이 섞여도 기간별로 합치고, 같은 기간에 둘 다 있으면
    // 셀 안에 보증금까지 명시한 압축 값을 우선한다.
    const price = compactPrice || standardPrice
      ? { ...(standardPrice || {}), ...(compactPrice || {}) }
      : null;
    /**
     * ★**요금이 없어도 올린다**(사장님 2026-08-12 — 「요금이 없어도 올리자 / 요금 안보이게끔
     *   올려서 출고가능이면 동일하게」).
     *
     *   예전엔 여기서 버렸다. 그래서 공급사 시트에는 있는데 ERP 에 없는 차가 생겼고
     *   («시트 = ERP = 엑셀»이 어긋났다 — 실측 2026-08-12: 아이카 14 · 손오공 12 · 리더스 2 · 경진카 1),
     *   영업이 「우리 목록에 없는데요」라고 말하는 사이 그 차는 공급사 시트에 멀쩡히 있었다.
     *
     *   ⚠ 올리되 **요금은 없는 채로** 둔다 — 없는 값을 지어내지 않는다.
     *     손님 카탈로그는 `isListableProduct` 가 대여료를 요구하므로 그대로 안 보인다.
     *     영업자 엑셀은 `isStockedProduct` 로 담아 요금 칸만 빈다.
     *   몇 대가 그런지는 계속 센다 — 조용히 넘기면 「다 됐다」로 보인다.
     */
    if (!price) {
      noPriceCount++;
      addIssue(`행 ${rowNo} 가격없음 · ${car || rawCar || '번호미정'}`);
      /**
       * ⚠ **가격도 차번도 없으면 올리지 않는다.**
       *   그 행은 «어느 차»라고 말할 근거가 하나도 없다. 게다가 아래 임시번호 발급기를 지나면
       *   순번을 한 칸 먹어 **기존 번호미정 차의 임시번호가 밀린다**
       *   (`sim-sheet-merge` 의 「가격없는 번호미정 행은 occurrence를 소비해…」 항목이 이걸 지킨다).
       *   차번이 있으면 위 규칙대로 가격만 비운 채 올린다.
       */
      if (!car) {
        skipped++;
        noPriceSkippedCount++;
        continue;
      }
    }
    if (!car) {
      const idx = pendingSeen.get(pendingSig) ?? 0;
      pendingSeen.set(pendingSig, idx + 1);
      car = allocator.assign(pendingSig, idx);
      rec.car_number = car;
      rec._pending_signature = pendingSig;
      if (seen.has(car)) {
        skipped++; duplicateCount++;
        addIssue(`행 ${rowNo} 중복 · ${car}`);
        continue;
      }
      seen.add(car);
    }   // 시트 내 차번(임시번호 포함) 중복 제거
    rec.sheet_source_row = rowNo;
    rec.product_code = `${opts.providerCode}_${car}`;      // 식별 = 공급사_차번(오플식)
    rec.price = price;
    if (res) snap[res.confidence]++; else snap.none++;
    products.push(rec);
  }
  return {
    products, mapping, total: sourceRowCount, imported: products.length,
    skipped, duplicateCount, invalidCount, issueSamples,
    excludedCount, noPriceCount, noPriceSkippedCount, snap,
  };
}

/**
 * 입고 직전 — 마스터 틀에 확정된 것(high·중) vs 검수 필요(검토·미매칭) 표시.
 * 공급사 기본정보는 모두 저장하되, 확정만 규격 경로·검수는 _needs_master_review.
 */
export function prepareMasterIngress(products: EntityRecord[]): {
  products: EntityRecord[];
  confirmed: number;
  review: number;
} {
  let confirmed = 0;
  let review = 0;
  const out = products.map((p) => {
    const c = String(p._snap_confidence || '');
    const ok = !!p._snapped && (c === 'high' || c === 'medium');
    if (ok) {
      confirmed++;
      return { ...p, _needs_master_review: false };
    }
    review++;
    return { ...p, _needs_master_review: true };
  });
  return { products: out, confirmed, review };
}
