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

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'chips';
export type Field = { key: string; label: string; type: FieldType; required?: boolean; options?: string[]; max?: number; ocrFrom?: string; manual?: boolean; note?: string };
export type Entity = { key: string; label: string; ocrType?: string; source: string; idFrom: string; keyFields?: string[]; fields: Field[] };

/* ── enum SSOT (freepasserp3 실측) ── */
export const ROLES = ['agent', 'agent_admin', 'agent_manager', 'provider', 'admin'] as const; // 영업자/영업관리자/영업관리자(계약·정산만)/공급사/관리자
export const CONTRACT_STATES = ['계약요청', '계약대기', '계약발송', '계약완료', '계약취소'] as const; // contract-status.js
export const SETTLEMENT_STATES = ['정산대기', '정산완료', '정산보류', '환수대기', '환수결정'] as const; // settlement-status.js
// 계약금 입금(확인) 선점 → 계약중 · 계약완료 → 출고불가(상품목록 숨김). 엔진 단일 writer.
export const VEHICLE_STATES = ['즉시출고', '출고가능', '상품화중', '출고협의', '계약중', '출고불가'] as const;
/** 썸네일 이벤트 딱지 — 재고 chips · 카드 좌상 최대 2. */
export const PROMO_BADGES = ['수수료+', '첫달할인', '금주특가', '보증할인', '탁송비지원', '특별가'] as const;
export const MAX_PROMO_BADGES = 2;
/** 구표기 → 현재 뱃지 (저장·필터 호환). */
export const PROMO_BADGE_LEGACY: Record<string, string> = { 추가수수료면제: '수수료+' };
export const PRODUCT_TYPES = ['신차렌트', '중고렌트', '신차구독', '중고구독'] as const; // 렌트/구독 × 신차/중고
/** 구표기 → 캐논(필터·뱃지·저장 호환). */
export const PRODUCT_TYPE_LEGACY: Record<string, typeof PRODUCT_TYPES[number]> = {
  재렌트: '중고렌트', 중고렌트: '중고렌트',
  재구독: '중고구독', 중고구독: '중고구독',
  신차렌트: '신차렌트', 신차구독: '신차구독',
};
export const FUEL_TYPES = ['가솔린', '디젤', 'LPG', '하이브리드', '전기', '수소'] as const;
export const QUOTE_STATES = ['초안', '발송', '열람', '계약전환', '만료'] as const; // v4 신규

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
  /* ══════════════ 매물(product) — 공급사 소유, 기간별 가격맵 ══════════════ */
  product: {
    key: 'product', label: '매물', ocrType: 'vehicle_reg', source: '자동차등록증/공급사 시트', idFrom: 'product_code',
    fields: [
      { key: 'product_code', label: '상품코드', type: 'text', manual: true },
      { key: 'car_number', label: '차량번호', type: 'text', required: true, ocrFrom: 'car_number', manual: true },
      // ── 차종 5단계 ──
      { key: 'maker', label: '제조사', type: 'text' },
      { key: 'model', label: '모델', type: 'text' },
      { key: 'sub_model', label: '세부모델', type: 'text' },
      { key: 'variant', label: '파워트레인', type: 'text', note: '5단계 — 연료·배기량·구동·배터리' },
      { key: 'trim_name', label: '세부트림', type: 'text', note: '마스터 실트림만' },
      { key: 'trim_extra', label: '추가표기', type: 'text', manual: true, note: '마스터 밖 자유입력(런칭·휠·패키지 등). 규격 트림 아님' },
      { key: 'vehicle_class', label: '차종', type: 'select', options: ['경형', '소형', '소형 SUV', '준중형', '준중형 SUV', '중형', '중형 SUV', '중형 RV', '중형 픽업', '준대형', '준대형 SUV', '대형', '대형 SUV', '대형 RV', '소형화물', '승합', '수입'] },
      // ── 스펙(등록증) ──
      { key: 'year', label: '연식', type: 'text', ocrFrom: 'car_year_month' },
      { key: 'fuel_type', label: '연료', type: 'select', options: [...FUEL_TYPES], ocrFrom: 'fuel_type' },
      { key: 'mileage', label: '주행거리(km)', type: 'number', ocrFrom: 'mileage' },
      { key: 'accident_history', label: '사고여부', type: 'select', options: ['무사고', '단순수리', '사고이력', '전손이력'], manual: true, note: '차량 상태·이력' },
      { key: 'drive_type', label: '구동', type: 'select', options: ['전륜(FF)', '후륜(FR)', '4륜(AWD)', '4륜(4WD)'] },
      { key: 'seats', label: '인승', type: 'number', ocrFrom: 'seats' },
      { key: 'engine_cc', label: '배기량(cc)', type: 'number', ocrFrom: 'displacement' },
      { key: 'ext_color', label: '외부색상', type: 'select', options: [...EXT_COLORS], manual: true },
      { key: 'int_color', label: '내부색상', type: 'select', options: [...INT_COLORS], manual: true },
      { key: 'usage', label: '용도', type: 'select', options: ['자가용', '영업용', '관용'], ocrFrom: 'usage_type' },
      { key: 'first_registration_date', label: '최초등록일', type: 'date', ocrFrom: 'first_registration_date' },
      { key: 'vin', label: '차대번호', type: 'text', ocrFrom: 'vin', manual: true, note: '관리자 전용' },
      { key: 'options', label: '옵션', type: 'text', manual: true, note: '콤마/슬래시 구분' },
      // ── 마켓플레이스 상태·구분 ──
      { key: 'vehicle_status', label: '매물상태', type: 'select', options: [...VEHICLE_STATES], manual: true },
      { key: 'product_type', label: '상품구분', type: 'select', options: [...PRODUCT_TYPES], manual: true },
      // ── 관계·정책 ──
      { key: 'provider_company_code', label: '공급사코드', type: 'text', manual: true },
      { key: 'partner_code', label: '영업(파트너)코드', type: 'text', manual: true },
      { key: 'policy_code', label: '정책코드', type: 'text', manual: true, note: '정책 enrich' },
      // ── 관리자 원가 ──
      { key: 'vehicle_price', label: '차량가격(원)', type: 'number', manual: true, note: '관리자 전용 원가' },
      { key: 'location', label: '위치', type: 'text', manual: true, note: '관리자 전용' },
      // ── 사진(product-photos.js 정규화 소스) ──
      { key: 'image_urls', label: '매물사진', type: 'text', note: '배열/멀티키(images·photos·image_url)' },
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
      { key: 'event_tags', label: '이벤트 뱃지', type: 'chips', manual: true, max: MAX_PROMO_BADGES, options: [...PROMO_BADGES], note: '썸네일 좌상 최대 2 · 수수료+=추가수수료면제' },
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
      { key: 'provider_company_code', label: '공급사코드', type: 'text', manual: true, note: '비우면 공용(전 공급사 연결 가능). 채우면 해당 공급사 전용' },
      { key: 'policy_type', label: '정책유형', type: 'text', manual: true },
      { key: 'screening_criteria', label: '심사기준', type: 'text', manual: true, note: '신용무관/신용조회/저신용 → 무심사·심사필요 판정' },
      { key: 'credit_grade', label: '신용등급', type: 'text', manual: true },
      { key: 'basic_driver_age', label: '기본연령', type: 'number', manual: true },
      { key: 'driver_age_lowering', label: '연령하향', type: 'text', manual: true },
      { key: 'driver_age_upper_limit', label: '연령상한', type: 'number', manual: true },
      { key: 'license_period', label: '면허 경력요건', type: 'text', manual: true, note: '제한없음/개월 → shortExperience(경력무관 뱃지)' },
      { key: 'annual_mileage', label: '약정 주행거리', type: 'text', manual: true },
      { key: 'mileage_upcharge_per_10000km', label: '1만km 추가', type: 'text', manual: true },
      { key: 'payment_method', label: '결제방식', type: 'text', manual: true },
      { key: 'penalty_condition', label: '위약금', type: 'text', manual: true },
      { key: 'rental_region', label: '대여지역', type: 'text', manual: true },
      { key: 'delivery_fee', label: '탁송비', type: 'text', manual: true },
      { key: 'deposit_installment', label: '보증금 분납', type: 'text', manual: true },
      { key: 'deposit_card_payment', label: '보증카드', type: 'text', manual: true },
      { key: 'insurance_included', label: '보험 포함', type: 'text', manual: true },
      { key: 'personal_driver_scope', label: '개인 운전범위', type: 'text', manual: true },
      { key: 'business_driver_scope', label: '사업자 운전범위', type: 'text', manual: true },
      { key: 'additional_driver_allowance_count', label: '추가인원', type: 'number', manual: true },
      { key: 'maintenance_service', label: '정비서비스', type: 'text', manual: true },
      { key: 'commission_clawback_condition', label: '수수료 환수조건', type: 'text', manual: true },
      { key: 'age_lowering_cost', label: '연령하향 비용', type: 'text', manual: true },
      { key: 'additional_driver_cost', label: '추가운전비', type: 'text', manual: true },
      // 보험 — 항목별 보상한도 + 면책금 (v3 product-detail-rows 보험표 전수 수집)
      { key: 'injury_compensation_limit', label: '대인 보상한도', type: 'text', manual: true },
      { key: 'injury_deductible', label: '대인 면책금', type: 'text', manual: true },
      { key: 'property_compensation_limit', label: '대물 보상한도', type: 'text', manual: true },
      { key: 'property_deductible', label: '대물 면책금', type: 'text', manual: true },
      { key: 'self_body_accident', label: '자손 보상한도', type: 'text', manual: true },
      { key: 'self_body_deductible', label: '자손 면책금', type: 'text', manual: true },
      { key: 'uninsured_damage', label: '무보험 보상한도', type: 'text', manual: true },
      { key: 'uninsured_deductible', label: '무보험 면책금', type: 'text', manual: true },
      { key: 'own_damage_compensation', label: '자차 보상', type: 'text', manual: true },
      { key: 'own_damage_repair_ratio', label: '자차 자기부담률', type: 'text', manual: true },
      { key: 'own_damage_min_deductible', label: '자차 최소 면책금', type: 'text', manual: true },
      { key: 'own_damage_max_deductible', label: '자차 최대 면책금', type: 'text', manual: true },
      { key: 'annual_roadside_assistance', label: '긴급출동', type: 'text', manual: true },
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
      { key: 'model', label: '모델', type: 'text' },
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
      { key: 'vehicle_name_snapshot', label: '차량명', type: 'text' },
      { key: 'year_snapshot', label: '연식', type: 'text' },
      { key: 'fuel_type_snapshot', label: '연료', type: 'text' },
      // ── 기간·가격 snapshot (정산 fee 기준) ──
      { key: 'rent_month_snapshot', label: '대여기간(개월)', type: 'number' },
      { key: 'rent_amount_snapshot', label: '월대여료(원)', type: 'number', manual: true },
      { key: 'deposit_amount_snapshot', label: '보증금(원)', type: 'number', manual: true },
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
      { key: 'sign_status', label: '서명 상태', type: 'select', options: ['미발송', '발송', '검토대기', '서명완료'], manual: true },
      { key: 'sign_sent_at', label: '발송시각', type: 'number' },
      { key: 'sign_signed_at', label: '서명시각', type: 'number' },
      { key: 'sign_signature', label: '서명 이미지', type: 'text', note: 'data URL' },
      { key: 'sign_consents', label: '동의 항목', type: 'text', note: '콤마 구분' },
      { key: 'contract_draft', label: '계약서 초안 JSON', type: 'text', manual: true, note: '템플릿 setData 스냅샷' },
      { key: 'sign_draft_at', label: '초안 저장시각', type: 'number' },
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
      { key: 'partner_type', label: '유형', type: 'select', options: ['공급사', '영업채널'], manual: true },
      { key: 'fee_rate', label: '공급사 수수료율(0~1)', type: 'number', manual: true, note: 'R1 공급사→프리패스: 정산 fee = 월대여료×이 값. 미설정 시 기본 0.1' },
      { key: 'contact', label: '담당/연락처', type: 'text', manual: true },
      // ── 쉽게 올리고: 렌트사 자체 구글시트 연동(ERP 안 써도 자기 시트만 관리하면 매물화) ──
      { key: 'sheet_url', label: '구글시트 URL', type: 'text', manual: true, note: '공급사 고유 재고 시트' },
      { key: 'sheet_tab', label: '시트 gid', type: 'text', manual: true, note: '탭 gid(숫자). URL에 gid 있으면 생략 가능' },
      { key: 'header_row', label: '헤더 행(0부터)', type: 'number', manual: true, note: '위쪽 안내행 스킵' },
      { key: 'adapter_id', label: '시트 어댑터', type: 'select', options: ['generic', 'autoplus'], manual: true, note: '기본 generic=헤더학습. 병적 양식만 autoplus' },
      { key: 'mapping_profile', label: '컬럼 매핑 프로필', type: 'text', manual: true, note: '컬럼→표준 필드 매핑(학습)' },
      { key: 'last_synced_at', label: '최근 동기화', type: 'number' },
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
      { key: 'name', label: '이름', type: 'text', manual: true },
      { key: 'role', label: '역할', type: 'select', options: [...ROLES], manual: true },
      { key: 'agent_channel_code', label: '영업채널코드', type: 'text', manual: true },
      { key: 'company_code', label: '회사코드', type: 'text', manual: true },
      { key: 'company_name', label: '회사명', type: 'text', manual: true },
      { key: 'agent_payout_rate', label: '영업자 지급율(0~1)', type: 'number', manual: true, note: 'R2 프리패스→영업자: 지급 = 월대여료×이 값' },
      { key: 'is_team_manager', label: '팀매니저', type: 'select', options: ['예', '아니오'], manual: true },
      { key: 'is_active', label: '활성', type: 'select', options: ['예', '아니오'], manual: true },
    ],
  },

  /* ══════════════ 정산(settlement) — 계약완료 시 자동 1건 ══════════════ */
  settlement: {
    key: 'settlement', label: '정산', source: '계약완료 자동생성', idFrom: 'settlement_code',
    fields: [
      { key: 'settlement_code', label: '정산코드', type: 'text', note: 'ST_{contract_code}' },
      { key: 'contract_code', label: '계약코드', type: 'text' },
      { key: 'car_number', label: '차량번호', type: 'text' },
      { key: 'customer_name', label: '계약자', type: 'text' },
      { key: 'provider_company_code', label: '공급사코드', type: 'text' },
      { key: 'partner_code', label: '파트너코드', type: 'text' },
      { key: 'agent_code', label: '영업자코드', type: 'text' },
      { key: 'agent_channel_code', label: '영업채널코드', type: 'text' },
      { key: 'rent_amount', label: '월대여료(원)', type: 'number' },
      { key: 'fee_rate', label: '수수료율', type: 'number' },
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
      { key: 'credit_display', label: '심사표기', type: 'select', options: ['무심사', '소득확'], manual: true },
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
  for (const f of e.fields) if (f.ocrFrom && ocr[f.ocrFrom] != null && ocr[f.ocrFrom] !== '') rec[f.key] = ocr[f.ocrFrom];
  return rec;
}

export const ENTITY_LIST = Object.values(ENTITIES);
