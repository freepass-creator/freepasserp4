/**
 * 프리패스 v4 — 통합 인제스천 SSOT. (freepasserp3 실측 기반 재작성)
 *
 * freepass = 3자(영업자·공급사·관리자) 채팅형 딜 마켓플레이스. jpkerp식 데이터그리드 ERP 아님.
 * 딜 척추: 매물(product) → 소통(room·message) → 계약(contract, 5단계 2자 핸드셰이크) → 정산(settlement)
 * 손님 대면 산출물: (기존 catalog 공유링크뿐) + v4 신규 = 견적서(quote)
 *
 * 3방식(직접입력/엑셀/OCR)이 이 스키마에서 파생. field.manual = 사람 직접입력.
 * ⚠ 필드명·enum은 freepasserp3 실제 값 그대로(RTDB 호환·마이그레이션 대비). 추정 항목은 note에 표기.
 */

import { EXT_COLORS, INT_COLORS } from '@/lib/domain/color-master';
import { POLICY_VALUE_RULE_BY_NAME } from '@/lib/domain/policy-value-spec';

/**
 * ★정책 선택지의 정본은 공급사 «운영정책» 시트 규격(policy-value-spec)이다(사장님 2026-08-19 원자 확보).
 *   정책관리 드롭다운과 21곳 시트 드롭다운이 같은 목록을 쓴다 — 시트 값이 그대로 ERP 값이 되고, 계약서가 그 값을 읽는다.
 *   목록에 없는 옛 값은 화면이 앞에 끼워 보여 준다(form-grid) — 지워지지 않는다.
 *   정액/정률 겸용 칸(추가주행 금액·연령 하향 요금·추가운전 요금·승계수수료·위약금)은 글자로 담고 policy-money-rate 가 읽는다.
 */
const sheetOpts = (name: string): string[] => [...(POLICY_VALUE_RULE_BY_NAME[name]?.allowed ?? [])];

/**
 * `catalog` — 선택지가 **차종사전(신규마스터)** 에서 온다. 앞 축이 정해질수록 뒤 축이 좁아진다(캐스케이드).
 *   선택지가 코드에 박혀 있지 않고 **공급사 정제칸에 실제로 적힌 조합**에서 나오므로 시트와 갈릴 수가 없다.
 *   목록에 없는 이름도 손으로 적을 수 있다 — 새 차가 들어오는 길을 막으면 안 된다(사전은 다음 갱신 때 그 값을 흡수한다).
 */
export type FieldType = 'text' | 'number' | 'date' | 'select' | 'chips' | 'catalog';
export type CatalogAxis = 'maker' | 'model' | 'sub_model' | 'trim_name';
export type Field = {
  key: string; label: string; type: FieldType; required?: boolean;
  options?: string[]; disabledOptions?: string[];
  /** catalog 전용 — 차종사전의 어느 축인가. 앞 축의 값으로 뒤 축을 좁힌다. */
  catalogAxis?: CatalogAxis;
  /**
   * **보여주기만 한다** — 편집 모드에서도 못 고친다(사장님 2026-08-23 「오류 없게끔 그냥 보여 주는 개념으로 간다」).
   * 공급사 원문처럼 «고치면 대조할 근거가 사라지는» 칸에 쓴다. 값은 파이프라인이 넣는다.
   */
  readOnly?: boolean;
  /** chips 전용 — 최대 선택 개수. 숫자 범위는 range를 쓴다(이름 충돌 주의). */
  max?: number;
  /** number 전용 — 허용 범위 [min, max]. 벗어나면 폼이 경고한다(율 오입력 방지). */
  range?: [number, number];
  ocrFrom?: string; manual?: boolean; note?: string;
};
export type Entity = { key: string; label: string; ocrType?: string; source: string; idFrom: string; keyFields?: string[]; fields: Field[] };

/**
 * range 위반 목록 — 저장 직전 게이트. 폼은 빨간 테두리로 알려줄 뿐 막지 않으므로
 * 저장 핸들러가 이걸 불러 막는다. 잘못된 율이 들어가면 정산액이 통째로 틀어진다(QA RATE-1).
 */
export function rangeErrors(fields: Field[], record: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (!f.range) continue;
    const raw = record[f.key];
    if (raw === '' || raw == null) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < f.range[0] || n > f.range[1]) {
      out.push(`${f.label} — ${f.range[0]}~${f.range[1]} 범위로 입력하세요 (예: 10% → 0.1)`);
    }
  }
  return out;
}

/* ── enum SSOT (freepasserp3 실측) ── */
export const ROLES = ['agent', 'agent_admin', 'agent_manager', 'provider', 'provider_admin', 'admin'] as const;
/** 역할 표시 SSOT(운영 5역할 + 레거시 1). 화면마다 로컬 맵 만들지 말 것 — v4 3역할 라벨(deal.ts ROLE_LABEL)도 여기서 파생한다. */
export const ROLE_LABEL_RAW: Record<(typeof ROLES)[number], string> = {
  agent: '영업자',
  agent_admin: '영업자 · 관리자',
  agent_manager: '영업자 · 관리자(레거시)',
  provider: '공급사 직원',
  provider_admin: '공급사 직원 · 관리자',
  admin: '운영자',
};
export const CONTRACT_STATES = ['계약요청', '계약대기', '계약발송', '계약완료', '계약취소'] as const; // contract-status.js
export const SETTLEMENT_STATES = ['정산대기', '정산완료', '정산보류', '환수대기', '환수결정'] as const; // settlement-status.js
// 계약금 입금(확인) 선점 → 계약중 · 계약완료 → 출고불가(상품목록 숨김). 엔진 단일 writer.
export const VEHICLE_STATES = ['즉시출고', '출고가능', '상품화중', '출고협의', '계약중', '출고불가'] as const;
/** 썸네일 이벤트 딱지 — 재고 chips · 카드 좌상 최대 2. */
export const PROMO_BADGES_ACTIVE = ['보증할인', '탁송비지원', '특별가'] as const;
/** 운영 예정 — UI에 보이되 선택·노출 불가. */
export const PROMO_BADGES_PLANNED = ['수수료+', '첫달할인', '금주특가'] as const;
export const PROMO_BADGES = [...PROMO_BADGES_ACTIVE, ...PROMO_BADGES_PLANNED] as const;
export const MAX_PROMO_BADGES = 2;
/** 구표기 → 현재 뱃지 (저장·필터 호환). */
export const PROMO_BADGE_LEGACY: Record<string, string> = { 추가수수료면제: '수수료+' };
/**
 * 상품구분 캐논 — 렌트/구독 × 신차/중고, 그리고 **픽업구독**.
 *
 * ★**픽업구독은 중고구독이 아니다**(사장님 2026-08-28 「중고구독이 아니고 손오공 픽업구독은
 *   상품구분에 픽업구독으로 해야 한다고」). 손오공 T카 재고에서 오는 별개 갈래이고
 *   판매시트도 「픽업구독」 탭을 따로 낸다(sales-published-tabs).
 *
 * ⚠ 여기 빠져 있으면 `canonProductType` 의 마지막 그물 `s.includes('구독') → '중고구독'` 에 걸린다.
 *   실제로 매물 **338대**의 `product_type` 이 「픽업구독」으로 잘 들어와 있는데 화면에서만
 *   「중고구독」으로 바뀌어 보이고 있었다(실측 2026-08-28). 데이터가 아니라 캐논이 문제였다.
 */
export const PRODUCT_TYPES = ['신차렌트', '중고렌트', '신차구독', '중고구독', '픽업구독'] as const;
import { VEHICLE_CLASS_LABELS } from '@/lib/domain/vehicle-class-catalog';

/** 차종분류(vehicle_class) 표시·필터 순서 SSOT. 한 칸 = 세그먼트+차형(준대형 세단). */
export const VEHICLE_CLASS_VALUES = [...VEHICLE_CLASS_LABELS, '경형', '소형', '준중형', '중형', '준대형', '대형', '대형 RV', '중형 RV', '소형화물', '승합', '수입'] as const;
/** 구표기 → 캐논(필터·뱃지·저장 호환). */
export const PRODUCT_TYPE_LEGACY: Record<string, typeof PRODUCT_TYPES[number]> = {
  재렌트: '중고렌트', 중고렌트: '중고렌트',
  재구독: '중고구독', 중고구독: '중고구독',
  픽업구독: '픽업구독',
  신차렌트: '신차렌트', 신차구독: '신차구독',
};
export const FUEL_TYPES = ['가솔린', '디젤', 'LPG', '하이브리드', '전기', '수소'] as const;
/**
 * ★구동 규격 — **공급사 정제칸 「구동방식」과 같은 글자**(사장님 2026-08-23 「오류를 없게 하는 것이 관건」).
 *   재고관리 선택지가 「전륜(FF)·4륜(AWD)」처럼 다른 말이면 같은 차가 두 글자로 갈린다.
 *
 *   `4WD` 는 규격에 남긴다 — 파트타임 4륜(렉스턴 스포츠·토레스)과 상시 4륜(AWD)은
 *   손님에게 실제로 다른 값이다. 정제칸이 절반 비어 있어 아직 안 보일 뿐이다.
 */
export const DRIVE_TYPES = ['2WD', 'AWD', '4WD'] as const;
/**
 * 규격 밖 글자 → 규격. **비우지 않고 옮긴다** — 옛 차종마스터 스냅이 남긴 말이지 틀린 정보는 아니다.
 * ⚠ 여기 없는 말은 손대지 않는다. 모르는 값을 짐작해서 바꾸면 그게 다음 사고다.
 */
export const DRIVE_TYPE_ALIAS: Record<string, string> = {
  FWD: '2WD', RWD: '2WD', '전륜(FF)': '2WD', '후륜(FR)': '2WD', 전륜: '2WD', 후륜: '2WD',
  xDrive: 'AWD', XDRIVE: 'AWD', 콰트로: 'AWD', '4MATIC': 'AWD', '4모션': 'AWD', 'quattro': 'AWD',
  '4륜(AWD)': 'AWD', '4륜(4WD)': '4WD', '4륜': '4WD',
};
/** 구동 글자를 규격으로 맞춘다. 규격이면 그대로, 별칭이면 옮기고, 모르는 말이면 그대로 둔다. */
export function canonDriveType(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if ((DRIVE_TYPES as readonly string[]).includes(raw)) return raw;
  const hit = DRIVE_TYPE_ALIAS[raw] || DRIVE_TYPE_ALIAS[raw.toUpperCase()];
  return hit || raw;
}
export const QUOTE_STATES = ['초안', '발송', '열람', '계약전환', '만료'] as const; // v4 신규

/* ── 정책 세 층 (docs/POLICY-LAYERS.md · lib/domain/policy-tier.ts) ── */
/** 이 공급사 계약서를 누가 쓰는가. 「프리패스가 작성」이라야 전자계약을 보낸다. */
export const CONTRACT_AUTHORING = ['공급사가 작성', '프리패스가 작성'] as const;
/**
 * 계약해지 정산 시 무엇을 청구하는가 — 약관 제7조·제8조.
 * **둘 중 하나만** 청구하고 중복하지 않는다(약관이 그렇게 못박고 있다).
 */
export const CLAIM_BASES = ['잔여 대여료', '중도해지수수료'] as const;
/** 계약서·약관에 실리는 장착 여부 표기. 「없음」도 조건이므로 빈칸으로 두지 않는다. */
export const EQUIPPED_STATES = ['장착', '미장착'] as const;
/** 대차 정책 — 「미제공」도 계약 조건이다. 비워 두면 손님이 대차되는 줄 안다. */
export const REPLACEMENT_CAR_POLICIES = ['불가', '동급 대차', '협의'] as const; // 사장님 2026-08-19 「대차 제공」 표기 — 시트와 같은 목록
/** 정비 지정 입고 — 임의 수리 시 보험 처리 제한 가능(약관 제14조·제17조). */
export const GARAGE_POLICIES = ['지정 협력 정비공장', '제조사 서비스센터', '지정 없음'] as const;

/** 계약 5단계 2자 핸드셰이크 체크 키 (contract-steps.js SSOT — key명은 레거시 그대로, actor 주석 참고) */
export const STEP_CHECK_KEYS = [
  'agent_delivery_inquiry',      // 1 출고문의 · agent
  'provider_delivery_response',  // 1 출고응답 · provider (출고가능/협의/불가)
  'agent_docs_submitted',        // 2 서류제출 · agent
  'provider_docs_review',        // 2 서류확인 · provider (승인/부결)
  'agent_balance_paid',          // 3 계약금입금 · agent
  'provider_agreement_sent',     // 3 약정발송 · provider
  'provider_agreement_done',     // 4 약정작성완료 · agent  ⚠ key명은 provider지만 actor=agent(레거시)
  'provider_balance_confirmed',  // 4 잔금확인 · provider
  'agent_handover_confirmed',    // 5 인도확인 · agent
  'provider_release_completed',  // 5 출고완료 · provider → 정산 자동
] as const;

export const ENTITIES: Record<string, Entity> = {
  /* ══════════════ 상품(product) — 공급사 소유, 기간별 가격맵 ══════════════ */
  product: {
    key: 'product', label: '상품', ocrType: 'vehicle_reg', source: '자동차등록증/공급사 시트', idFrom: 'product_code',
    fields: [
      { key: 'product_code', label: '상품코드', type: 'text', manual: true, note: '내부 ID — 화면 비노출' },
      { key: 'car_number', label: '차량번호', type: 'text', required: true, ocrFrom: 'car_number', manual: true },
      /**
       * ── 차명 축 넷 ── (사장님 2026-08-23 「차종마스터 관련 싹 다 걷어내고 정제칸을 정확히 반영한다 ·
       *   기존 재고관리 상품등록은 신규마스터를 반영해서 입력값을 만든다」)
       *
       * **신규마스터 = 정제칸**이다. 옛 차종마스터(원천대장·mf- 코드·프로젝트 코드 박힌 이름)는 참조하지 않는다.
       * 여기 선택지는 `public/data/vehicle-catalog.json` — 공급사 정제칸에 **실제로 적혀 있는 조합**에서 파생한다.
       * 그래서 시트와 ERP 가 갈릴 수가 없다(따로 관리하는 대장이 없으니 어긋날 대상이 없다).
       *
       * ⚠ 「파워트레인(variant)」·「추가표기(trim_extra)」 칸은 **폐지했다**(2026-08-23).
       *   엔진 이야기는 「연료」·「배기량」이 들고, 이름에 섞으면 전 화면이 지저분해진다.
       */
      { key: 'maker', label: '제조사', type: 'catalog', catalogAxis: 'maker' },
      // ★필수는 둘뿐 — 차량번호·모델명(사장님 2026-08-23 「필수입력은 차량번호야 모델명인 거지」).
      //   나머지는 없는 게 정상인 차가 있다. 필수를 늘리면 등록이 막히고, 막히면 사람이 아무 값이나 적는다.
      { key: 'model', label: '모델명', type: 'catalog', catalogAxis: 'model', required: true },
      { key: 'sub_model', label: '세부모델', type: 'catalog', catalogAxis: 'sub_model' },
      { key: 'trim_name', label: '세부트림', type: 'catalog', catalogAxis: 'trim_name' },
      { key: 'vehicle_class', label: '차종분류', type: 'select', options: [...VEHICLE_CLASS_VALUES], note: '세그먼트[ 차형] — 예: 중형 SUV. 구표기 차급' },
      // ── 스펙(등록증) ──
      { key: 'year', label: '연식', type: 'text', ocrFrom: 'car_year_month' },
      { key: 'fuel_type', label: '연료', type: 'select', options: [...FUEL_TYPES], ocrFrom: 'fuel_type' },
      { key: 'mileage', label: '주행거리(km)', type: 'number', ocrFrom: 'mileage' },
      { key: 'accident_history', label: '사고여부', type: 'select', options: ['무사고', '단순수리', '사고이력', '전손이력'], manual: true, note: '차량 상태·이력' },
      /**
       * ★구동 — **정제칸 「구동방식」과 같은 글자만**(2026-08-23).
       *   전에는 「전륜(FF)·후륜(FR)·4륜(AWD)·4륜(4WD)」였는데 정제칸은 `2WD`·`AWD` 두 값이라,
       *   재고관리에서 고친 값과 시트에서 온 값이 **같은 차에서 다른 글자**가 됐다.
       *   ERP 에 남아 있던 `xDrive`·`콰트로`·`4MATIC`·`FWD` 는 옛 차종마스터 스냅 잔재다.
       */
      { key: 'drive_type', label: '구동', type: 'select', options: [...DRIVE_TYPES], note: '정제칸 「구동방식」과 같은 글자' },
      { key: 'seats', label: '인승', type: 'number', ocrFrom: 'seats' },
      /**
       * ★원산지 — 국산/수입. **보증금 배율(국산 ×2 · 수입 ×3)의 근거**라 표시값이 아니라 돈이 걸린 값이다.
       *   차종마스터 참조를 끊은 뒤로(2026-08-22) 공급사 정제칸 「원산지」 → 판매시트 → 여기가 유일한 길이다.
       */
      { key: 'origin', label: '원산지', type: 'select', options: ['국산', '수입'] },
      { key: 'engine_cc', label: '배기량(cc)', type: 'number', ocrFrom: 'displacement' },
      /**
       * ★배터리용량 — **전기차의 배기량 자리**(사장님 2026-08-23 「배터리용량 등등 쓸 수 있는 거 쭈욱 쓰는 거야」).
       *   전기차는 `engine_cc` 가 비는 게 정상이라 차를 가르는 값이 하나 모자랐다(판매가능 474대 중 전기차 33대).
       * ⚠ 정제칸 「배터리용량(정제)」에서 온다. 값이 하나로 모일 때만 채운다. 내연은 빈칸이 정상.
       */
      { key: 'battery_capacity', label: '배터리용량(kWh)', type: 'number', note: '전기차만 · 정제칸 「배터리용량」' },
      { key: 'ext_color', label: '외부색상', type: 'select', options: [...EXT_COLORS], manual: true },
      { key: 'int_color', label: '내부색상', type: 'select', options: [...INT_COLORS], manual: true },
      { key: 'usage', label: '용도', type: 'select', options: ['자가용', '영업용', '관용'], ocrFrom: 'usage_type' },
      { key: 'first_registration_date', label: '최초등록일', type: 'date', ocrFrom: 'first_registration_date' },
      /**
       * ★차대번호(VIN) — **ERP 전용 부가입력**(사장님 2026-08-22 「차대번호는 상품리스트에 안 올라가」·
       *   2026-08-23 「차대번호는 부가입력으로만 살려 두고 ERP 전용으로」).
       *   판매시트 열은 없다(SALES_RETIRED_COLUMNS). 번호판 나오기 전 신차를 같은 차로 잇는 데 쓴다
       *   (product.vehicleIdentity: 실번호 → VIN → 임시번호). 영업자가 손님 앞에서 볼 값이 아니다.
       */
      { key: 'vin', label: '차대번호', type: 'text', ocrFrom: 'vin', manual: true, note: 'ERP 전용 · 상품리스트엔 안 올라감' },
      { key: 'options', label: '선택옵션', type: 'text', manual: true, note: '정제칸 「선택옵션」 · 구분은 , 또는 /' },
      /**
       * ★**공급사 원문 두 칸 — 「2중 보관」**(사장님 2026-08-23 「차명이랑 옵션 … 별도로 수집해서 보관한다 2중 보관이지」).
       *   위 정제값과 달리 **공급사가 적은 글자 그대로**다.
       * ⚠ **보여주기만 한다**(사장님 「오류 없게끔 그냥 보여 주는 개념으로 간다」) — 고치면 대조할 근거가 사라지고,
       *   고쳐 봐야 다음 동기가 판매시트 값으로 도로 덮는다. 고칠 곳은 공급사 시트다.
       */
      { key: 'supplier_vehicle_name', label: '공급사 차명(원문)', type: 'text', readOnly: true, note: '공급사가 적은 그대로 · 보기 전용' },
      { key: 'supplier_options', label: '공급사 옵션(원문)', type: 'text', readOnly: true, note: '공급사가 적은 그대로 · 보기 전용' },
      // ── 마켓플레이스 상태·구분 ──
      { key: 'vehicle_status', label: '상품상태', type: 'select', options: [...VEHICLE_STATES], manual: true },
      { key: 'product_type', label: '상품구분', type: 'select', options: [...PRODUCT_TYPES], manual: true },
      // ── 관계·정책 ──
      { key: 'provider_company_code', label: '공급사코드', type: 'text', manual: true },
      { key: 'partner_code', label: '영업(파트너)코드', type: 'text', manual: true },
      { key: 'policy_code', label: '정책코드', type: 'text', manual: true, note: '정책 enrich' },
      // ── 관리자 원가 ──
      { key: 'vehicle_price', label: '차량가격(원)', type: 'number', manual: true, note: '관리자 전용 원가' },
      { key: 'location', label: '위치', type: 'text', manual: true, note: '관리자 전용' },
      // ── 사진(product-photos.js 정규화 소스) ──
      { key: 'image_urls', label: '상품사진', type: 'text', note: '배열/멀티키(images·photos·image_url)' },
      { key: 'photos', label: '업로드 사진', type: 'text', note: '배열 · [0]=대표' },
      { key: 'interior_photo', label: '실내사진 URL', type: 'text', note: 'photos 중 실내로 지정한 URL' },
      { key: 'photo_link', label: '사진 링크', type: 'text', manual: true, note: '외부 링크(Drive/스크래핑)' },
      { key: 'doc_images', label: '서류사진', type: 'text', manual: true, note: '관리자 · 등록증' },
      // ── 차종마스터 · 표준옵션 ──
      { key: 'catalog_id', label: '차종 카탈로그 id', type: 'text', note: '트림·옵션풀 매칭·자동보정' },
      { key: 'fp_options', label: '표준옵션 ID', type: 'text', note: 'FP 마스터 · 옵션 AND 필터' },
      { key: 'provider_name', label: '공급사명', type: 'text', note: '엑셀·검색 표기' },
      // ── 심사 표기 파생 ──
      { key: 'review_status', label: '심사여부(원본)', type: 'text', note: 'screening_criteria로 통합표기·검색' },
      { key: 'deposit_free', label: '무보증 가능', type: 'select', options: ['예', '아니오'], manual: true, note: '혜택 MetaIcon' },
      { key: 'event_tags', label: '이벤트 뱃지', type: 'chips', manual: true, max: MAX_PROMO_BADGES, options: [...PROMO_BADGES], disabledOptions: [...PROMO_BADGES_PLANNED], note: '운영 최대 2 · 수수료+/첫달할인/금주특가=운영예정' },
      // ── 등록증 상세(관리자) ──
      { key: 'transmission', label: '변속기', type: 'select', options: ['자동', '수동', 'CVT', 'DCT', '세미오토'] },
      { key: 'vehicle_age_expiry_date', label: '차령만료일', type: 'date', manual: true, note: '관리자 전용' },
      { key: 'cert_car_name', label: '등록증 차명', type: 'text', note: '관리자' },
      { key: 'type_number', label: '형식번호', type: 'text', note: '관리자' },
      { key: 'engine_type', label: '원동기형식', type: 'text', note: '관리자' },
      { key: 'partner_memo', label: '메모', type: 'text', manual: true, note: '공급사/관리자 비고' },
      // ⚠ price = { [\"24\" | \"24_3만\"]: { rent, deposit, fee|commission, fee_memo } } 중첩맵 → 별도 가격에디터(FormGrid 밖)
    ],
  },

  /* ══════════════ 정책(policy) — 상품별 심사·보험·조건 ══════════════ */
  policy: {
    key: 'policy', label: '정책', source: '내부 등록', idFrom: 'policy_code',
    fields: [
      { key: 'policy_code', label: '정책코드', type: 'text', required: true, manual: true },
      { key: 'policy_name', label: '정책명', type: 'text', manual: true },
      { key: 'provider_company_code', label: '계약회사', type: 'select', manual: true, note: '회사를 선택하면 전자계약에서 이 회사 정책만 표시' },
      { key: 'policy_type', label: '정책유형', type: 'select', options: [...PRODUCT_TYPES], manual: true, note: '신차렌트·중고구독 등' },
      // 사장님 2026-08-19 — 심사조건은 3개(무심사·소득확인·신용조회). 옛 값(신용무관·중신용 이상…)은 creditDisplay 가 셋으로 접어 읽는다.
      { key: 'screening_criteria', label: '심사조건', type: 'select', options: sheetOpts('심사조건'), manual: true, note: '⚠ 내부용 · 손님에게 안 나감 · 시트 「심사조건」' },
      { key: 'disqualification_conditions', label: '불가조건', type: 'text', manual: true, note: '⚠ 내부용 · 계약이 안 되는 조건 — 「3년 이내 음주이력」 · 시트 「불가조건」' },
      { key: 'sales_notes', label: '특이사항(영업)', type: 'text', manual: true, note: '⚠ 내부용 · 영업자가 알아야 할 조건 — 「21,23세 대여는 법인/사업자만」 · 시트 「특이사항」' },
      // 사장님 2026-08-20 — 표에 없는 계약조건. 특이사항(영업용)과 달리 **계약서 특약 칸에 실린다** · 시트 「기타사항 1~4」
      { key: 'policy_extra_terms', label: '기타사항(계약서)', type: 'text', manual: true, note: '위 항목에 없는 계약조건 · 계약서 특약 칸에 그대로 실림 · 시트 「기타사항 1~4」' },
      { key: 'credit_grade', label: '신용등급', type: 'select', options: ['무관', '1~3등급', '4~6등급', '7등급 이하'], manual: true, note: '⚠ 내부용' },
      { key: 'basic_driver_age', label: '기본운전자연령', type: 'select', options: sheetOpts('기본운전자연령'), manual: true, note: '「만 26세 이상」 · 면책금 산정 기준 · 시트 「기본운전자연령」' },
      { key: 'driver_age_lowering', label: '연령하향', type: 'select', options: sheetOpts('연령인하'), manual: true, note: '선택지 · 계약서엔 확정 나이만 · 시트 「연령인하」' },
      { key: 'driver_age_upper_limit', label: '최대연령', type: 'select', options: sheetOpts('최대연령'), manual: true, note: '「만 70세 이하」 · 넘으면 계약 불가 · 시트 「최대연령」' },
      { key: 'license_period', label: '면허 경력요건', type: 'select', options: sheetOpts('면허기간'), manual: true, note: '약관 제13조 · 시트 「면허기간」' },
      { key: 'annual_mileage', label: '약정 주행거리', type: 'select', options: sheetOpts('기본주행'), manual: true, note: '초과분은 초과 주행요금 · 시트 「기본주행」' },
      {
        key: 'mileage_upcharge_per_10000km', label: '추가주행 금액(1만km당)', type: 'select', options: sheetOpts('추가주행 금액'), manual: true,
        // 약정을 «정할 때»의 가격표(2만km 월 65만 / 3만km 월 75만). 계약이 굳으면 월 대여료에 녹는다.
        // 계약서·손님 화면에는 오지 않는다 — 아래 초과 요율과 혼동 금지.
        note: '가격표 · 계약서엔 안 실림',
      },
      /*
       * 초과 주행요금 — 약정을 **넘겨 달린 거리에만** 부과한다.
       *   약정 연 30,000km · 실주행 31,000km → 초과 1,000km × 요율
       * 위 「1만km 추가」와 전혀 다른 값이다. 섞으면 계약서에
       * 「초과 주행요금 : 1만km당 100,000원」이 찍혀 손님이 «1만km 넘으면 10만원»으로 읽는다.
       *
       * **국산·수입이 다르다**(프리패스 표준: 국산 200원 / 수입 400원).
       * 한 칸으로 두면 수입차 계약에 국산 요율이 찍히므로 제조사로 갈라 쓴다(`overMileageRateFor()`).
       */
      { key: 'over_mileage_rate_domestic', label: '초과주행 국산(1km당)', type: 'select', options: sheetOpts('초과주행 국산(1km당)'), manual: true, note: '약관 제23조 · 「200원」 · 시트 규격 글자(숫자로 읽음)' },
      { key: 'over_mileage_rate_imported', label: '초과주행 수입(1km당)', type: 'select', options: sheetOpts('초과주행 수입(1km당)'), manual: true, note: '약관 제23조 · 「400원」 · 시트 규격 글자' },
      { key: 'payment_method', label: '결제방식', type: 'select', options: sheetOpts('결제방식'), manual: true, note: '시트 「결제방식」' },
      { key: 'payment_timing', label: '대여료 납부 조건', type: 'select', options: sheetOpts('납부조건'), manual: true, note: '월 대여료를 사용월 전에(선불) · 후에(후불) · 시트 「납부조건」' },
      { key: 'payment_due_date', label: '월 납부일', type: 'select', options: sheetOpts('월 납부일'), manual: true, note: '「5일 단위 인도일 기준」·「인도일 기준」·「매월 25일」 · 계약서 제6조 · 시트 「월 납부일」' },
      /*
       * 중도해지 위약금 — **잔여기간 대여료에 비례**한다(프리패스 표준: 1년 미만 30% / 1년 이상 20%).
       * 경과 기간이 길수록 낮아진다. 한 값으로 두면 어느 구간인지 알 수 없어 계약서가 거짓말을 한다.
       */
      /**
       * 승계수수료 — **계약을 다른 사람에게 넘길 때** 받는 돈(사장님 2026-08-12).
       * 중도해지와 다른 길이다. 해지는 위약금을 물고 끝내는 것이고, 승계는 남은 기간을
       * 새 임차인이 이어받는 것이라 손님이 낼 돈이 전혀 다르다. 한 칸으로 뭉치면
       * 「해지하면 얼마, 넘기면 얼마」를 상담에서 못 답한다.
       * 공급사마다 갈리는 값이라 정책에 둔다 — 우리가 정할 수 없다.
       */
      { key: 'succession_allowed', label: '승계 가능여부', type: 'select', options: sheetOpts('승계 가능여부'), manual: true, note: '약관 제8조·제10조 · 회사별 승인정책 · 프리패스 기본 가능(2026-08-19) · 시트 「승계 가능여부」' },
      { key: 'succession_fee', label: '승계수수료', type: 'select', options: sheetOpts('승계수수료'), manual: true, note: '약관 제8조·제10조 · 불가 / 50~500만원 · 옛 숫자(1000000)도 읽음 · 시트 「승계수수료」' },
      { key: 'early_termination_rate_under1y', label: '중도해지 위약금 · 1년 미만', type: 'select', options: sheetOpts('중도해지 위약금 1년미만'), manual: true, note: '약관 제8조 · 「30%」=잔여 대여료의 30% / 「월 대여료 2개월분」 · 옛 0.3도 읽음' },
      { key: 'early_termination_rate_over1y', label: '중도해지 위약금 · 1년 이상', type: 'select', options: sheetOpts('중도해지 위약금 1년이상'), manual: true, note: '약관 제8조 · 「20%」 / 「월 대여료 1개월분」 · 옛 0.2도 읽음' },
      {
        key: 'accident_termination_count', label: '사고 다발 해지기준', type: 'select', options: sheetOpts('사고 다발 해지기준'), manual: true,
        /*
         * 프리패스 표준은 각 사고 발생일 기준 직전 1년 이내에 해당 사고를 포함하여
         * 임차인 또는 등록 운전자의 과실 50% 이상 사고가 총 3회인 경우다(약관 제7조제1항제7호).
         * 상대방 100% 과실 사고까지 세면 손님이 억울한 해지를 당하므로 과실 50% 이상만 센다.
         */
        range: [3, 3],
        note: '약관 제7조 · 사고일 기준 직전 1년, 해당 사고 포함 과실 50% 이상 총 3회',
      },
      { key: 'rental_region', label: '대여지역', type: 'select', options: sheetOpts('대여지역'), manual: true, note: '안내용 · 계약서엔 안 실림 · 제주는 항상 탁송 제외 · 시트 「대여지역」' },
      { key: 'delivery_fee', label: '탁송비', type: 'select', options: sheetOpts('탁송비'), manual: true, note: '전액지원 / 일부지원 / 고객부담(사장님 2026-08-19) · 시트 「탁송비」' },
      { key: 'deposit_installment', label: '보증금 분납', type: 'select', options: sheetOpts('보증금분납'), manual: true, note: '정책은 가능 여부·최대 회차 · 실제 회차는 계약서 만들 때 고른다 · 시트 「보증금분납」' },
      { key: 'deposit_card_payment', label: '보증카드', type: 'select', options: sheetOpts('보증금카드결제'), manual: true, note: '카드 수납 여부 · 시트 「보증금카드결제」' },
      { key: 'insurance_included', label: '보험 포함', type: 'select', options: sheetOpts('보험료'), manual: true, note: '보험료 포함=회사 가입 / 보험료 별도=손님 직접 · 시트 「보험료」' },
      { key: 'personal_driver_scope', label: '개인 운전범위', type: 'select', options: sheetOpts('개인운전자범위'), manual: true, note: '약관 제13조 · 시트 「개인운전자범위」' },
      { key: 'business_driver_scope', label: '사업자 운전범위', type: 'select', options: sheetOpts('법인운전자범위'), manual: true, note: '약관 제13조 · 시트 「법인운전자범위」' },
      { key: 'additional_driver_allowance_count', label: '추가운전 인원', type: 'select', options: sheetOpts('추가운전 인원'), manual: true, note: '불가 / 1~5인까지 / 제한없음 · 고객 링크의 추가운전자 칸 수 · 시트 「추가운전 인원」' },
      { key: 'maintenance_service', label: '정비', type: 'select', options: sheetOpts('정비'), manual: true, note: '포함 / 불포함 / 협의 · 「불포함」도 조건 · 비우지 말 것 · 시트 「정비」' },
      { key: 'commission_clawback_condition', label: '수수료 환수조건', type: 'select', options: ['없음', '6개월 이내 해지 시', '12개월 이내 해지 시', '별도 약정'], manual: true, note: '⚠ 내부용 · 손님과 무관' },
      { key: 'age_lowering_cost', label: '연령 하향 요금(월)', type: 'select', options: sheetOpts('연령 하향 요금'), manual: true, note: '「10만원」 / 「대여료의 10%」 · 하향한 계약에만 실림 · 시트 「연령 하향 요금」' },
      { key: 'additional_driver_cost', label: '추가운전 요금(1인당 월)', type: 'select', options: sheetOpts('추가운전 요금'), manual: true, note: '불가 / 무료 / 「5만원」 / 「대여료의 5%」 · 지정한 계약에만 실림 · 시트 「추가운전 요금」' },
      // 보험 — 계약회사별 필수 설정. 선택한 회사의 연동 정책만 계약서에 적용한다.
      { key: 'injury_compensation_limit', label: '[계약회사별] 대인 보상한도', type: 'select', options: sheetOpts('대인보상한도'), manual: true, note: '계약회사 보험정책 · 약관 제11조' },
      { key: 'injury_deductible', label: '[계약회사별] 대인 면책금', type: 'select', options: sheetOpts('대인면책금'), manual: true, note: '계약회사 보험정책 · 없으면 「없음」을 선택' },
      { key: 'property_compensation_limit', label: '[계약회사별] 대물 보상한도', type: 'select', options: sheetOpts('대물보상한도'), manual: true, note: '계약회사 보험정책 · 초과분은 손님 부담' },
      { key: 'property_deductible', label: '[계약회사별] 대물 면책금', type: 'select', options: sheetOpts('대물면책금'), manual: true, note: '계약회사 보험정책 · 없으면 「없음」을 선택' },
      { key: 'self_body_accident', label: '[계약회사별] 자손 보상한도', type: 'select', options: sheetOpts('자손보상'), manual: true, note: '계약회사 보험정책 · 미가입도 명시' },
      { key: 'self_body_deductible', label: '[계약회사별] 자손 면책금', type: 'select', options: sheetOpts('자손면책금'), manual: true, note: '계약회사 보험정책 · 없으면 「없음」을 선택' },
      { key: 'uninsured_damage', label: '[계약회사별] 무보험 보상한도', type: 'select', options: sheetOpts('무보험보상'), manual: true, note: '계약회사 보험정책 · 상대가 무보험일 때' },
      { key: 'uninsured_deductible', label: '[계약회사별] 무보험 면책금', type: 'select', options: sheetOpts('무보험면책금'), manual: true, note: '계약회사 보험정책 · 없으면 「없음」을 선택' },
      { key: 'own_damage_compensation', label: '[계약회사별] 자차 보상한도', type: 'select', options: sheetOpts('자차보상한도'), manual: true, note: '계약회사 보험정책 · 한도 초과 시 처리 기준' },
      { key: 'own_damage_repair_ratio', label: '[계약회사별] 자차 자기부담률', type: 'select', options: sheetOpts('자차수리비율'), manual: true, note: '계약회사 보험정책 · 수리비 중 손님 비율' },
      { key: 'own_damage_min_deductible', label: '[계약회사별] 자차 최소 면책금', type: 'select', options: sheetOpts('자차최소면책금'), manual: true, note: '계약회사 보험정책 · 자차 부담 하한' },
      { key: 'own_damage_max_deductible', label: '[계약회사별] 자차 최대 면책금', type: 'select', options: sheetOpts('자차최대면책금'), manual: true, note: '계약회사 보험정책 · 자차 부담 상한' },
      { key: 'annual_roadside_assistance', label: '[계약회사별] 긴급출동', type: 'select', options: sheetOpts('긴급출동'), manual: true, note: '계약회사 보험정책 · 연간 무상 횟수' },

      /* ── 전자계약 (층3) ──────────────────────────────────────────────
       * **전자계약서를 우리가 쓰는 공급사만** 채운다. 상품만 공급하는 곳은 비워 둔다.
       *
       * 이 목록은 임의로 정한 것이 아니라 **약관이 「계약서에 정한 ○○」이라고 참조하는 자리**다.
       * 비면 그 조문이 아무것도 정하지 못한다 — 분쟁에서 「기준이 없었다」가 된다.
       * 지금까지는 코드·서식에 박혀 있어 공급사마다 다르게 둘 수 없었다.
       * 설계 근거: `docs/POLICY-LAYERS.md` · SSOT: `lib/domain/policy-tier.ts`
       */
      // 「계약」이어야 전자계약을 보낼 수 있다. 비면 상품 층으로 본다 — 안 정해진 곳에 계약을 태우지 않는다.
      {
        key: 'contract_authoring', label: '계약서 작성', type: 'select', options: [...CONTRACT_AUTHORING], manual: true,
        note: '「프리패스가 작성」이라야 전자계약 발송',
      },
      {
        key: 'esign_required_documents', label: '고객 추가 제출서류', type: 'text', manual: true,
        note: '공급사 정책별 서류 묶음 · 정책관리 전자계약 패널에서 편집',
      },
      // 돈 — 날짜·횟수는 range 로 오입력을 막는다. 잘못 들어가면 정산액이 통째로 틀어진다.
      { key: 'late_fee_rate', label: '지연손해금율(0~1)', type: 'number', range: [0, 0.24], manual: true, note: '약관 제25조 · 연 24% → 0.24 (관계 법령상 허용 한도 내)' },
      { key: 'deposit_return_days', label: '보증금 반환기한', type: 'select', options: sheetOpts('보증금 반환기한'), manual: true, note: '약관 제6조 · 「7일」 · 시트 규격 글자(숫자로 읽음)' },
      { key: 'impound_keep_days', label: '물품 보관기간(일)', type: 'number', manual: true, note: '약관 제22조 · 이후 관계 법령이 허용하는 방법으로 처리' },
      { key: 'impound_fee', label: '물품 보관료(일)', type: 'number', manual: true, note: '약관 제22조 · 실제 보관비용 범위' },
      /* ── 미납 제재 ──
       * 약관 제13·14조는 **두 기준일을 따로** 부른다. 하나로 뭉치면 조문이 못 걸린다.
       *   ①    「계약서에 정한 **운행제한 기준일**」까지 미지급 → 운행제한·시동제어
       *   ②1호 「계약서에 정한 **차량회수 기준일**」까지 미이행 → 해지·회수
       * 보증금 분납도 대상 회차를 따로 정하되, 연체일은 해당 회차 납부기한 다음 날부터 센다.
       * 라벨을 약관 용어에 맞춰 둔다 — 손님이 계약서에서 조문을 바로 찾을 수 있어야 한다. */
      { key: 'engine_control_overdue_days', label: '시동제어 기준일', type: 'select', options: sheetOpts('시동제어 기준일'), manual: true, note: '약관 제24조 · 「3일」 · 납부기한 다음 날부터 N일째 미납 시' },
      { key: 'auto_terminate_overdue_days', label: '차량회수 기준일', type: 'select', options: sheetOpts('차량회수 기준일'), manual: true, note: '약관 제7조·제24조 · 「10일」 · N일째 미납 시 최고 후 해지·회수' },
      {
        key: 'deposit_overdue_rounds', label: '보증금 미납 시동제어(회차)', type: 'number', manual: true,
        // 대상 회차는 정책으로 정하고, 실제 연체일은 그 회차의 납부기한 다음 날부터 센다.
        note: '약관 제6조·제24조 · N회차 납부기한 경과 후 적용',
      },
      {
        key: 'claim_basis', label: '청구 기준', type: 'select', options: [...CLAIM_BASES], manual: true,
        note: '약관 제7조 및 제8조 · 둘 중 하나만',
      },
      // 만기 — 실권이 걸린 기한
      { key: 'renewal_notice_days', label: '연장 사전통지기한(일)', type: 'number', manual: true, note: '약관 제10조 · 넘기면 연장 불가' },
      { key: 'buyout_notice_days', label: '인수 사전통지기한(일)', type: 'number', manual: true, note: '약관 제26조 · 넘기면 인수 불가' },
      // 계약서에 실명이 박히는 것 — 회사 이름·번호는 자유 입력, 정책 선택지는 드롭다운
      { key: 'insurer_name', label: '가입 보험사·공제조합', type: 'text', manual: true, note: '계약 체결일 현재 가입처 · 사고 접수처' },
      {
        key: 'designated_garage', label: '지정 정비점', type: 'select', options: [...GARAGE_POLICIES], manual: true,
        note: '약관 제14조 및 제17조 · 임의 수리 시 보험 제한 가능',
      },
      // 선택지는 계약서 04항에 인쇄되던 문구 그대로 — 임의로 만든 목록이 아니다.
      { key: 'self_damage_exclusions', label: '자차 처리 제외', type: 'chips', options: ['단독사고', '가해자 불명', '휠·타이어 단독 손상', '전손', '고의·관리 소홀', '침수', '음주·무면허', '한도초과'], manual: true, note: '약관 제18조 · 공제·보험별 상이' },
      {
        key: 'replacement_car_policy', label: '대차 제공', type: 'select', options: sheetOpts('대차 제공'), manual: true,
        note: '약관 제5조·제20조 · 「미제공」도 조건',
      },
      {
        key: 'gps_installed', label: 'GPS 장착', type: 'select', options: [...EQUIPPED_STATES], manual: true,
        note: '약관 제24조 · 위치 수집 고지',
      },
    ],
  },

  /* ══════════════ 방(room) — 매물별 영업자↔공급사 딜 채팅 ══════════════ */
  room: {
    key: 'room', label: '소통방', source: '앱 생성(ensureRoom)', idFrom: '_key', keyFields: ['product_uid', 'agent_uid'],
    fields: [
      { key: 'product_uid', label: '매물UID', type: 'text' },
      { key: 'product_code', label: '상품코드', type: 'text' },
      { key: 'vehicle_number', label: '차량번호', type: 'text' },
      { key: 'maker', label: '제조사', type: 'text' },
      { key: 'model', label: '모델명', type: 'text' },
      { key: 'sub_model', label: '세부모델', type: 'text' },
      { key: 'agent_uid', label: '영업자UID', type: 'text' },
      { key: 'agent_code', label: '영업자코드', type: 'text' },
      { key: 'agent_channel_code', label: '영업채널코드', type: 'text' },
      { key: 'provider_uid', label: '공급사UID', type: 'text' },
      { key: 'provider_company_code', label: '공급사코드', type: 'text' },
      { key: 'unread_for_agent', label: '영업자 안읽음', type: 'number' },
      { key: 'unread_for_provider', label: '공급사 안읽음', type: 'number' },
      { key: 'unread_for_admin', label: '관리자 안읽음', type: 'number' },
      { key: 'last_read_at_agent', label: '영업자 열람시각', type: 'number' },
      { key: 'last_read_at_provider', label: '공급사 열람시각', type: 'number' },
      { key: 'last_read_at_admin', label: '관리자 열람시각', type: 'number' },
      { key: 'last_message', label: '마지막메시지', type: 'text' },
      { key: 'last_message_at', label: '마지막시각', type: 'number' },
      { key: 'last_sender_role', label: '마지막발신 역할', type: 'text' },
      { key: 'last_sender_code', label: '마지막발신 코드', type: 'text' },
      { key: 'linked_contract', label: '연결 계약코드', type: 'text' },
      { key: 'is_admin_chat', label: '관리자 소통방', type: 'select', options: ['예', '아니오'] },
    ],
  },

  /* ══════════════ 메시지(message) — messages/{roomId} ══════════════ */
  message: {
    key: 'message', label: '메시지', source: '채팅', idFrom: '_key', keyFields: ['created_at', 'sender_uid'],
    fields: [
      { key: 'text', label: '내용', type: 'text' },
      { key: 'sender_uid', label: '발신UID', type: 'text' },
      { key: 'sender_role', label: '발신역할', type: 'text' },
      { key: 'sender_code', label: '발신코드', type: 'text' },
      { key: 'sender_name', label: '발신자', type: 'text' },
      { key: 'created_at', label: '발신시각', type: 'number' },
      { key: 'room_id', label: '방ID', type: 'text' },
      { key: 'image_url', label: '이미지', type: 'text' },
      { key: 'file_url', label: '파일', type: 'text' },
      { key: 'file_name', label: '파일명', type: 'text' },
      { key: 'batch_id', label: '첨부묶음', type: 'text', note: '한 번에 올린 사진들의 공통 키 — 같은 값이면 앨범 말풍선으로 묶어 표시. 낱장은 빈 값' },
      { key: 'channel', label: '채널', type: 'select', options: ['간단', '정식'], note: '간단=상세 간단문의 섹션 / 정식=계약문의 채팅. 간단은 양쪽 노출, 정식은 계약문의만' },
    ],
  },

  /* ══════════════ 계약(contract) — 방/매물에서 생성, 전부 *_snapshot ══════════════ */
  contract: {
    key: 'contract', label: '계약', ocrType: 'rental_contract', source: '계약생성(방·매물)', idFrom: 'contract_code',
    fields: [
      { key: 'contract_code', label: '계약코드', type: 'text', manual: true },
      { key: 'contract_status', label: '계약상태', type: 'select', options: [...CONTRACT_STATES], manual: true },
      { key: 'contract_date', label: '계약일', type: 'date' },
      { key: 'is_draft', label: '초안', type: 'select', options: ['예', '아니오'], manual: true },
      { key: 'product_uid', label: '매물UID', type: 'text' },
      { key: 'product_code', label: '상품코드', type: 'text' },
      // ── 차량 snapshot ──
      { key: 'car_number_snapshot', label: '차량번호', type: 'text', ocrFrom: 'car_number' },
      { key: 'maker_snapshot', label: '제조사', type: 'text' },
      { key: 'model_snapshot', label: '모델', type: 'text' },
      { key: 'sub_model_snapshot', label: '세부모델', type: 'text' },
      { key: 'variant_snapshot', label: '파워트레인', type: 'text' },
      { key: 'trim_name_snapshot', label: '세부트림', type: 'text' },
      { key: 'trim_extra_snapshot', label: '추가표기', type: 'text' },
      { key: 'vehicle_name_snapshot', label: '차량명', type: 'text' },
      { key: 'year_snapshot', label: '연식', type: 'text' },
      { key: 'fuel_type_snapshot', label: '연료', type: 'text' },
      // ── 기간·가격 snapshot (정산 fee 기준) ──
      { key: 'rent_month_snapshot', label: '대여기간(개월)', type: 'number' },
      { key: 'rent_amount_snapshot', label: '월대여료(원)', type: 'number', manual: true },
      { key: 'deposit_amount_snapshot', label: '보증금(원)', type: 'number', manual: true },
      { key: 'annual_mileage_snapshot', label: '약정주행거리', type: 'text', manual: true },
      { key: 'price_variant_snapshot', label: '가격표 기준', type: 'text', manual: true },
      { key: 'mileage_surcharge_snapshot', label: '주행거리 가산(월)', type: 'number', manual: true },
      { key: 'age_surcharge_snapshot', label: '연령 가산(월)', type: 'number', manual: true },
      { key: 'special_terms_choice_snapshot', label: '특약 확인', type: 'select', options: ['없음', '있음'], manual: true },
      { key: 'special_terms_snapshot', label: '특약사항', type: 'text', manual: true },
      // ── 고객 snapshot ──
      { key: 'customer_uid', label: '고객UID', type: 'text' },
      { key: 'customer_name', label: '계약자명', type: 'text', required: true, ocrFrom: 'holder_name' },
      { key: 'customer_birth', label: '생년월일(YYMMDD)', type: 'text', ocrFrom: 'birth_date' },
      { key: 'customer_phone', label: '연락처', type: 'text', manual: true },
      { key: 'customer_is_business', label: '사업자', type: 'select', options: ['예', '아니오'], manual: true },
      { key: 'customer_business_number', label: '사업자등록번호', type: 'text', manual: true },
      { key: 'customer_company_name', label: '법인/상호', type: 'text', manual: true },
      { key: 'delivery_region', label: '인도지역', type: 'text', manual: true },
      // ── 본인확인(계약서 폼 바인딩) — 면허증 업로드/OCR 소스. ⚠ 주민번호=민감정보: 보관·마스킹 정책은 번외(보류), 수집 스키마만 선언 ──
      { key: 'customer_id', label: '주민등록번호', type: 'text', manual: true, note: '⚠ 민감정보 · 보관/마스킹 정책 보류' },
      { key: 'driver_license_no', label: '면허번호', type: 'text', manual: true, ocrFrom: 'license_no' },
      { key: 'customer_address', label: '주소', type: 'text', manual: true, ocrFrom: 'address' },
      { key: 'residence_type', label: '거주형태', type: 'text', manual: true },
      { key: 'customer_email', label: '이메일', type: 'text', manual: true },
      { key: 'emergency_name', label: '비상연락 성명', type: 'text', manual: true },
      { key: 'emergency_relation', label: '비상연락 관계', type: 'text', manual: true },
      { key: 'emergency_phone', label: '비상연락처', type: 'text', manual: true },
      // ── 관계자 ──
      { key: 'agent_uid', label: '영업자UID', type: 'text' },
      { key: 'agent_code', label: '영업자코드', type: 'text' },
      { key: 'agent_name', label: '영업자명', type: 'text' },
      { key: 'agent_channel_code', label: '영업채널코드', type: 'text' },
      { key: 'provider_uid', label: '공급사UID', type: 'text' },
      { key: 'provider_company_code', label: '공급사코드', type: 'text' },
      // ── 정책 snapshot ──
      { key: 'policy_code', label: '정책코드', type: 'text' },
      { key: 'policy_name_snapshot', label: '정책명', type: 'text' },
      { key: 'credit_grade_snapshot', label: '심사기준', type: 'text' },
      { key: 'fee_rate_snapshot', label: '공급사수수료율(동결)', type: 'number' },
      { key: 'payout_rate_snapshot', label: '영업지급율(동결)', type: 'number' },
      // ── 5단계 체크(개별 boolean/choice, STEP_CHECK_KEYS) — 진행 스텝. manual ──
      { key: 'agent_delivery_inquiry', label: '출고문의', type: 'select', options: ['yes'], manual: true },
      { key: 'provider_delivery_response', label: '출고응답', type: 'select', options: ['출고 가능', '출고 협의', '출고 불가'], manual: true },
      { key: 'agent_docs_submitted', label: '서류제출', type: 'select', options: ['yes'], manual: true },
      { key: 'provider_docs_review', label: '서류확인', type: 'select', options: ['승인', '부결'], manual: true },
      { key: 'agent_balance_paid', label: '계약금입금', type: 'select', options: ['yes'], manual: true },
      { key: 'agent_final_paid', label: '잔금입금', type: 'select', options: ['yes'], manual: true },
      { key: 'provider_agreement_sent', label: '약정발송', type: 'select', options: ['yes'], manual: true },
      { key: 'provider_agreement_done', label: '약정작성완료(agent)', type: 'select', options: ['yes'], manual: true },
      { key: 'provider_balance_confirmed', label: '잔금확인', type: 'select', options: ['yes'], manual: true },
      { key: 'agent_handover_confirmed', label: '인도확인', type: 'select', options: ['yes'], manual: true },
      { key: 'provider_release_completed', label: '출고완료', type: 'select', options: ['yes'], manual: true },
      // ── 서류·서명·메모 ──
      { key: 'doc_license', label: '운전면허증', type: 'text', manual: true },
      { key: 'signed_pdf_url', label: '서명완료본', type: 'text' },
      { key: 'unsigned_pdf_url', label: '서명요청본', type: 'text' },
      // ── 전자서명 파이프라인(발송→손님서명→검토→승인) ──
      { key: 'sign_token', label: '서명 토큰', type: 'text' },
      { key: 'sign_status', label: '서명 상태', type: 'select', options: ['미발송', '발행', '열람', '진행중', '검토대기', '서명완료', '반려', '만료'], manual: true },
      { key: 'sign_sent_at', label: '발송시각', type: 'number' },
      { key: 'sign_signed_at', label: '서명시각', type: 'number' },
      { key: 'sign_signature', label: '서명 이미지', type: 'text', note: 'data URL' },
      { key: 'sign_consents', label: '동의 항목', type: 'text', note: '콤마 구분' },
      { key: 'contract_source', label: '전자계약 생성경로', type: 'select', options: ['erp', 'excel', 'direct'], note: 'ERP 계약과 독립 작성의 발송 게이트를 구분' },
      { key: 'esign_import_template_id', label: '엑셀 입력양식 ID', type: 'text', note: '입력 Adapter 양식 추적용' },
      { key: 'esign_import_adapter_id', label: '엑셀 Adapter ID', type: 'text', note: '원본 파일은 저장하지 않음' },
      { key: 'contract_draft', label: '계약서 초안 JSON', type: 'text', manual: true, note: '템플릿 setData 스냅샷' },
      { key: 'sign_draft_at', label: '초안 저장시각', type: 'number' },
      // ── 전자계약(프리패스 자체 + 기존 착한거래 읽기 호환) ──
      //  2026-08-10 이후 신규 발송은 self. 기존 chakhandeal 발행분은 진행·완료 조회 호환으로 보존한다. **필드를 예약한 이유**는
      //  출시 후보 Rules 가 계약 하위키를 `!data.parent().exists() || newData.val() === data.val()`
      //  로 잠그기 때문이다 — 규칙 게시 뒤에 새 필드를 기존 계약에 넣으려 하면 거부된다.
      //  전환 시점에 값만 채우면 되도록 스키마 자리를 먼저 잡아 둔다.
      { key: 'esign_provider', label: '전자계약 제공자', type: 'select', options: ['freepass', 'chakhandeal'], note: '신규=freepass, 기존 외부 발행분=chakhandeal' },
      { key: 'esign_revision', label: '전자계약 회차', type: 'number', note: '발행할 때마다 증가하며 기존 Snapshot은 보존' },
      { key: 'esign_id', label: '외부 서명ID', type: 'text', note: '착한거래 signId' },
      { key: 'esign_session_hash', label: '프리패스 서명 세션 해시', type: 'text', note: '원문 토큰을 저장하지 않는 서버 조회키' },
      { key: 'esign_sign_url', label: '손님 서명 링크', type: 'text', note: '관리자가 복사해 직접 전달' },
      { key: 'esign_verify_url', label: '검증 링크', type: 'text', note: '착한거래 /v?id= — 파일이 아니라 사실을 증명하는 링크' },
      { key: 'esign_seal_hash', label: '문서 봉인 해시', type: 'text', note: '착한거래가 반환한 문서 봉인 해시' },
      { key: 'esign_document_sha256', label: 'PDF SHA-256', type: 'text', note: '서명 완료 PDF 무결성 검증값' },
      { key: 'esign_submitted_at', label: '고객 제출시각', type: 'number' },
      { key: 'memo_agent', label: '영업자메모', type: 'text', manual: true },
      { key: 'memo_provider', label: '공급사메모', type: 'text', manual: true },
      { key: 'memo_admin', label: '관리자메모', type: 'text', manual: true },
      { key: 'cancelled_at', label: '취소시각', type: 'number' },
    ],
  },

  /* ══════════════ 고객(customer) — 면허 OCR ══════════════ */
  customer: {
    key: 'customer', label: '고객', ocrType: 'license', source: '운전면허증', idFrom: 'phone',
    fields: [
      { key: 'name', label: '성명', type: 'text', required: true, ocrFrom: 'holder_name' },
      { key: 'phone', label: '연락처', type: 'text', manual: true },
      { key: 'birth', label: '생년월일(YYMMDD)', type: 'text', ocrFrom: 'birth_date' },
      { key: 'license_no', label: '면허번호', type: 'text', ocrFrom: 'license_no' },
      { key: 'address', label: '주소', type: 'text', ocrFrom: 'address' },
      { key: 'is_business', label: '사업자', type: 'select', options: ['예', '아니오'], manual: true },
      { key: 'business_no', label: '사업자등록번호', type: 'text', manual: true },
      { key: 'business_name', label: '상호', type: 'text', manual: true },
    ],
  },

  /* ══════════════ 파트너(partner) — 공급사/영업채널, 수수료율 보유 ══════════════ */
  partner: {
    key: 'partner', label: '파트너', source: '내부 등록', idFrom: 'partner_code',
    fields: [
      { key: 'partner_code', label: '파트너코드', type: 'text', required: true, manual: true, note: '공급사=provider_company_code와 매칭' },
      { key: 'name', label: '상호/이름', type: 'text', required: true, manual: true, note: '정식 상호(풀네임)' },
      { key: 'alias', label: '별칭', type: 'text', manual: true, note: 'UI 표기. 비우면 주식회사·렌트카·렌터카·모빌리티 자동 제거' },
      { key: 'partner_type', label: '유형', type: 'select', options: ['공급사', '영업채널'], required: true, manual: true },
      // 가입 매칭의 열쇠 — 신규 회원이 이 번호로 소속을 찾는다(auth.ts resolveIdentity · login-helpers matchBizNo).
      //  ⚠ 필드명은 `business_number` 다. 회원(users)은 `business_no` 를 쓰지만 파트너는 다르고,
      //    매칭 로직도 파트너 쪽은 business_number 를 본다. 여기서 이름을 맞추지 않으면
      //    입력해도 매칭이 안 되어 신규 공급사가 영원히 SP999(임시소속)에 머문다(QA AUTH-5).
      { key: 'business_number', label: '사업자등록번호', type: 'text', manual: true, note: '가입 시 소속 매칭 기준. 숫자만 저장' },
      // 전자계약 임대인 표시값 — 표준계약서 한 벌에 공급사별 법정 정보를 주입한다.
      // 계약 조항·외부 템플릿 ID는 여기서 편집하지 않는다(공급사 자기 레코드 write 가능).
      { key: 'ceo', label: '대표자', type: 'text', manual: true, note: '전자계약 임대인 표시' },
      { key: 'phone', label: '대표번호', type: 'text', manual: true, note: '전자계약 임대인 표시' },
      { key: 'address', label: '사업장 주소', type: 'text', manual: true, note: '전자계약 임대인 표시' },
      { key: 'rental_business_no', label: '자동차대여사업 등록번호', type: 'text', manual: true, note: '전자계약 임대인 표시. 회사별 등록증 기준' },
      // 사장님 2026-08-19 — 공급사 제공시트 「회사정보」 탭이 묻는 것(company-info-sheet). 시트 → 파트너는 audit-policy-sheet-vs-erp --apply 로 들여온다.
      { key: 'corporate_registration_no', label: '법인등록번호', type: 'text', manual: true, note: '법인이면 13자리 · 시트 「회사정보」' },
      { key: 'biz_category', label: '업태 · 종목', type: 'text', manual: true, note: '참고(계약서엔 안 실림) · 시트 「회사정보」' },
      { key: 'contact_name', label: '담당자 이름', type: 'text', manual: true, note: '프리패스가 연락할 사람 · 시트 「회사정보」' },
      { key: 'contact_phone', label: '담당자 연락처', type: 'text', manual: true, note: '휴대전화 · 시트 「회사정보」' },
      { key: 'contact_email', label: '담당자 이메일', type: 'text', manual: true, note: '계약서·정산 자료 전달 · 시트 「회사정보」' },
      { key: 'bank_name', label: '입금은행', type: 'text', manual: true, note: '전자계약 대여료 입금계좌' },
      { key: 'bank_account', label: '입금계좌번호', type: 'text', manual: true, note: '전자계약 대여료 입금계좌' },
      { key: 'bank_holder', label: '예금주', type: 'text', manual: true, note: '비우면 파트너 상호 사용' },
      { key: 'esign_contract_enabled', label: '프리패스 전자계약', type: 'select', options: ['사용', '미사용'], manual: true, note: '사용인 공급사만 계약작성 회사 선택에 표시. 기존 미설정 데이터는 연결 정책 기준으로 호환' },
      { key: 'fee_rate', label: '공급사 수수료율(0~1)', type: 'number', manual: true, range: [0, 1], note: 'R1 공급사→프리패스: 정산 fee = 월대여료×이 값. 미설정 시 기본 0.1' },
      { key: 'contact', label: '담당/연락처', type: 'text', manual: true },
      // ── 쉽게 올리고: 렌트사 자체 구글시트 연동(ERP 안 써도 자기 시트만 관리하면 매물화) ──
      { key: 'sheet_url', label: '구글시트 URL', type: 'text', manual: true, note: '공급사 고유 재고 시트' },
      // 사장님 2026-08-19 — 파트너사관리엔 시트 주소·홈페이지 주소만 적는다. 연동(탭 gid·헤더 행·어댑터·보증금 규칙)은 프리패스가 스크립트로 맞춘다.
      { key: 'website', label: '홈페이지 주소', type: 'text', manual: true, note: '공급사 홈페이지(재고·가격 확인용)' },
      { key: 'sheet_tab', label: '시트 gid', type: 'text', manual: true, note: '탭 gid(숫자). URL에 gid 있으면 생략 가능' },
      { key: 'header_row', label: '헤더 행(0부터)', type: 'number', manual: true, note: '위쪽 안내행 스킵' },
      { key: 'adapter_id', label: '시트 어댑터', type: 'select', options: ['generic', 'autoplus'], manual: true, note: '기본 generic=헤더학습. 병적 양식만 autoplus' },
      { key: 'deposit_rule', label: '보증금 계산규칙', type: 'select', options: ['months_per_year', 'rent_multiple'], manual: true, note: '시트에 보증금이 없을 때만 적용. 미설정이면 가격을 임의 생성하지 않음' },
      { key: 'mapping_profile', label: '컬럼 매핑 프로필', type: 'text', manual: true, note: '컬럼→표준 필드 매핑(학습)' },
      { key: 'last_synced_at', label: '최근 동기화', type: 'number' },
      { key: 'last_sheet_rows', label: '최근 시트 행수', type: 'number', note: '올린 것 + 출고불가로 걸러낸 것. 급감가드 기준' },
      { key: 'last_sheet_imported', label: '최근 유입 대수', type: 'number', note: '실제로 올라간 매물 수' },
    ],
  },

  /* ══════════════ 제보(report) — 영업자가 이상매물 신고 → 공급사·관리자 확인 ══════════════ */
  report: {
    key: 'report', label: '제보', source: '영업자 신고', idFrom: 'report_code',
    fields: [
      { key: 'report_code', label: '제보코드', type: 'text' },
      { key: 'product_code', label: '매물코드', type: 'text' },
      { key: 'car_number', label: '차량번호', type: 'text' },
      { key: 'provider_company_code', label: '공급사', type: 'text' },
      { key: 'reason', label: '사유', type: 'select', options: ['사진 이상', '차종/정보 오류', '가격 이상', '중복 매물', '기타'] },
      { key: 'memo', label: '메모', type: 'text', manual: true },
      { key: 'reporter_uid', label: '제보자 UID', type: 'text' },
      { key: 'reporter_name', label: '제보자', type: 'text' },
      { key: 'status', label: '상태', type: 'select', options: ['접수', '확인', '처리완료'] },
      { key: 'at', label: '제보시각', type: 'number' },
    ],
  },

  /* ══════════════ 사용자(user) — 역할·채널 ══════════════ */
  user: {
    key: 'user', label: '사용자', source: '가입/관리자 등록', idFrom: 'uid',
    fields: [
      { key: 'uid', label: 'UID', type: 'text' },
      { key: 'user_code', label: '유저코드', type: 'text', manual: true, note: 'RP…/SP… 등' },
      { key: 'name', label: '이름', type: 'text', required: true, manual: true },
      { key: 'role', label: '회원 권한', type: 'select', options: [...ROLES], manual: true },
      { key: 'agent_channel_code', label: '소속 영업채널코드', type: 'text', manual: true },
      { key: 'company_code', label: '소속코드', type: 'text', manual: true },
      { key: 'company_name', label: '소속명', type: 'text', manual: true },
      { key: 'agent_payout_rate', label: '영업자 지급율(0~1)', type: 'number', manual: true, range: [0, 1], note: 'R2 프리패스→영업자: 지급 = 월대여료×이 값' },
      { key: 'is_team_manager', label: '팀매니저', type: 'select', options: ['예', '아니오'], manual: true },
      { key: 'is_active', label: '활성', type: 'select', options: ['예', '아니오'], manual: true },
      // 이용 상태 — is_active(운영상 on/off)와 별개다.
      //  active  = 자가가입 개인 영업자 또는 관리자 확인 완료 계정
      //  pending = 관리자가 명시적으로 보류한 계정 → 앱 사용 불가
      //  값 없음 = 이 필드 도입 이전 회원 → 정상 사용(기존 회원을 잠그지 않는다)
      { key: 'status', label: '가입승인', type: 'select', options: ['active', 'pending'], manual: true },
    ],
  },

  /* ══════════════ 정산(settlement) — 계약완료 시 자동 1건 ══════════════ */
  settlement: {
    key: 'settlement', label: '정산', source: '계약완료 자동생성', idFrom: 'settlement_code',
    fields: [
      { key: 'settlement_code', label: '정산코드', type: 'text', note: '신규 stl_ 코드, 기존 ST_{contract_code}도 조회 호환' },
      { key: 'contract_code', label: '계약코드', type: 'text' },
      { key: 'car_number', label: '차량번호', type: 'text' },
      { key: 'customer_name', label: '계약자', type: 'text' },
      { key: 'provider_company_code', label: '공급사코드', type: 'text' },
      { key: 'partner_code', label: '파트너코드', type: 'text' },
      { key: 'agent_code', label: '영업자코드', type: 'text' },
      { key: 'agent_channel_code', label: '영업채널코드', type: 'text' },
      { key: 'rent_amount', label: '월대여료(원)', type: 'number' },
      { key: 'fee_rate', label: '수수료율', type: 'number' },
      // 공급사 요율이 미정이라 기본 0.1 로 만든 정산 — 요율 확정 후 관리자가 재계산해야 한다.
      //  계약의 fee_rate_snapshot 은 규칙상 못 고치지만 정산 금액은 고칠 수 있다(여기가 복구 지점).
      { key: 'fee_rate_unresolved', label: '요율 미확정', type: 'text', note: 'yes = 공급사 수수료율 미입력 상태로 생성됨. 요율 확정 후 재계산 필요' },
      { key: 'fee_amount', label: '공급사수수료(원)', type: 'number', note: 'R1 = 월대여료×공급사율. 프리패스 수취' },
      { key: 'agent_payout', label: '영업자지급(원)', type: 'number', note: 'R2 = 월대여료×영업자지급율. 프리패스→영업자' },
      { key: 'net_amount', label: '프리패스 순수익(원)', type: 'number', note: 'R1 − R2' },
      { key: 'clawback_amount', label: '환수액(원)', type: 'number', note: '중도해지 경과비례' },
      { key: 'settlement_status', label: '정산상태', type: 'select', options: [...SETTLEMENT_STATES], manual: true },
      { key: 'contract_date', label: '계약일', type: 'date' },
    ],
  },

  /* ══════════════ 견적서(quote) — v4 신규: 영업자→손님 격식 산출물 ══════════════ */
  quote: {
    key: 'quote', label: '견적서', source: '영업자 생성(매물 기반)', idFrom: 'quote_code',
    fields: [
      { key: 'quote_code', label: '견적코드', type: 'text' },
      { key: 'status', label: '상태', type: 'select', options: [...QUOTE_STATES], manual: true },
      { key: 'agent_code', label: '영업자코드', type: 'text' },
      { key: 'agent_name', label: '영업자명', type: 'text' },
      { key: 'agent_channel_code', label: '영업채널코드', type: 'text' },
      { key: 'product_uid', label: '매물UID', type: 'text' },
      { key: 'product_code', label: '상품코드', type: 'text' },
      { key: 'car_number', label: '차량번호', type: 'text' },
      { key: 'vehicle_name', label: '차량명', type: 'text', note: '제조사 세부모델 트림' },
      { key: 'rent_month', label: '대여기간(개월)', type: 'number' },
      { key: 'rent_amount', label: '월대여료(원)', type: 'number', manual: true },
      { key: 'deposit_amount', label: '보증금(원)', type: 'number', manual: true },
      { key: 'credit_display', label: '심사표기', type: 'select', options: ['무심사', '소득확인'], manual: true },
      { key: 'driver_age', label: '가능연령', type: 'text' },
      { key: 'annual_mileage', label: '약정주행', type: 'text' },
      { key: 'insurance_summary', label: '보험요약', type: 'text' },
      { key: 'customer_name', label: '손님명', type: 'text', manual: true, note: '선택' },
      { key: 'customer_phone', label: '손님연락처', type: 'text', manual: true, note: '선택' },
      { key: 'delivery_region', label: '인도지역', type: 'text', manual: true },
      { key: 'valid_until', label: '유효기한', type: 'date', manual: true },
      { key: 'view_url', label: '손님열람 링크', type: 'text' },
      { key: 'sent_channel', label: '발송채널', type: 'select', options: ['링크', '카카오알림톡', 'PDF'], manual: true },
      { key: 'sent_at', label: '발송시각', type: 'number' },
    ],
  },

  /* ══════════════ 관리자 월정산서(admin_settlement) — VAT·청구/지급. 건별 settlement와 분리 ══════════════ */
  admin_settlement: {
    key: 'admin_settlement', label: '월정산서', source: '관리자 작성', idFrom: 'admin_settlement_code',
    fields: [
      { key: 'admin_settlement_code', label: '정산서코드', type: 'text', required: true },
      { key: 'settle_month', label: '정산월', type: 'text', manual: true },
      { key: 'contract_code', label: '계약번호', type: 'text', manual: true },
      { key: 'settle_status', label: '상태', type: 'select', options: ['계약완료', '정산완료', '진행', '보류', '취소', '환수'], manual: true },
      { key: 'provider_name', label: '공급사', type: 'text', manual: true },
      { key: 'car_number', label: '차량번호', type: 'text', manual: true },
      { key: 'customer_name', label: '고객명', type: 'text', manual: true },
      { key: 'sale_fee', label: '판매수수료', type: 'number', manual: true },
      { key: 'provider_incentive', label: '공급 인센티브', type: 'number', manual: true },
      { key: 'provider_bill', label: '청구금액', type: 'number', manual: true },
      { key: 'delivery_fee', label: '출고수수료', type: 'number', manual: true },
      { key: 'agency_incentive', label: '에이전시 인센티브', type: 'number', manual: true },
      { key: 'doc_agency_fee', label: '대행료', type: 'number', manual: true },
      { key: 'agency_pay', label: '지급액', type: 'number', manual: true },
      { key: 'monthly_profit', label: '당월수익', type: 'number' },
      { key: 'source_settlement_code', label: '원천 정산코드', type: 'text' },
    ],
  },

  /* ══════════════ 감사로그(audit_log) — 전 write 자동 기록(store 훅). 누가·언제·무엇(before/after) ══════════════ */
  audit_log: {
    key: 'audit_log', label: '감사로그', source: 'store 자동', idFrom: '_key',
    fields: [
      { key: 'entity', label: '대상엔티티', type: 'text' },
      { key: 'target_key', label: '대상키', type: 'text' },
      { key: 'action', label: '동작', type: 'text' },
      { key: 'summary', label: '요약', type: 'text' },
      { key: 'room_id', label: '채팅방', type: 'text' },
      { key: 'actor_role', label: '역할', type: 'text' },
      { key: 'actor_name', label: '행위자', type: 'text' },
      { key: 'at', label: '시각', type: 'number' },
    ],
  },
};

export type EntityRecord = Record<string, unknown>;

/** OCR 추출 → 표준 엔티티 매핑 */
export function mapOcrToEntity(entityKey: string, ocr: Record<string, unknown>): EntityRecord {
  const e = ENTITIES[entityKey];
  const rec: EntityRecord = {};
  if (!e) return rec;
  for (const f of e.fields) {
    if (!f.ocrFrom) continue;
    // OCR 엔진이 canonical key(year/engine_cc/usage)를 바로 반환하는 현재 규격과
    // 과거 source key(car_year_month/displacement/usage_type)를 모두 입력 경계에서 흡수한다.
    // 엔티티에 OCR 대상으로 선언되지 않은 임의 키는 폼에 넣지 않는다.
    const direct = ocr[f.key];
    const legacy = ocr[f.ocrFrom];
    const value = direct != null && direct !== '' ? direct : legacy;
    if (value != null && value !== '') rec[f.key] = value;
  }
  return rec;
}

export const ENTITY_LIST = Object.values(ENTITIES);
