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

export type FieldType = 'text' | 'number' | 'date' | 'select';
export type Field = { key: string; label: string; type: FieldType; required?: boolean; options?: string[]; ocrFrom?: string; manual?: boolean; note?: string };
export type Entity = { key: string; label: string; ocrType?: string; source: string; idFrom: string; keyFields?: string[]; fields: Field[] };

/* ── enum SSOT (freepasserp3 실측) ── */
export const ROLES = ['agent', 'agent_admin', 'agent_manager', 'provider', 'admin'] as const; // 영업자/영업관리자/영업관리자(계약·정산만)/공급사/관리자
export const CONTRACT_STATES = ['계약요청', '계약대기', '계약발송', '계약완료', '계약취소'] as const; // contract-status.js
export const SETTLEMENT_STATES = ['정산대기', '정산완료', '정산보류', '환수대기', '환수결정'] as const; // settlement-status.js
export const VEHICLE_STATES = ['즉시출고', '출고가능', '출고준비', '출고협의', '출고불가'] as const; // ⚠ vehicle-status.js 최종확인 필요
export const PRODUCT_TYPES = ['신차', '중고'] as const;
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
      { key: 'car_number', label: '차량번호', type: 'text', ocrFrom: 'car_number' },
      // ── 차종 5단계 ──
      { key: 'maker', label: '제조사', type: 'text' },
      { key: 'model', label: '모델', type: 'text' },
      { key: 'sub_model', label: '세부모델', type: 'text' },
      { key: 'variant', label: '파워트레인', type: 'text', note: '5단계 — 연료·배기량·구동·배터리' },
      { key: 'trim_name', label: '세부트림', type: 'text' },
      { key: 'vehicle_class', label: '차종', type: 'text' },
      // ── 스펙(등록증) ──
      { key: 'year', label: '연식', type: 'text', ocrFrom: 'car_year_month' },
      { key: 'fuel_type', label: '연료', type: 'text', ocrFrom: 'fuel_type' },
      { key: 'mileage', label: '주행거리(km)', type: 'number', ocrFrom: 'mileage' },
      { key: 'drive_type', label: '구동', type: 'text' },
      { key: 'seats', label: '인승', type: 'number', ocrFrom: 'seats' },
      { key: 'engine_cc', label: '배기량(cc)', type: 'number', ocrFrom: 'displacement' },
      { key: 'ext_color', label: '외장색', type: 'text' },
      { key: 'int_color', label: '내장색', type: 'text' },
      { key: 'usage', label: '용도', type: 'text', ocrFrom: 'usage_type' },
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
      // ⚠ price = { [\"24\" | \"24_3만\"]: { rent, deposit, fee|commission, fee_memo } } 중첩맵 → 별도 가격에디터(FormGrid 밖)
    ],
  },

  /* ══════════════ 정책(policy) — 상품별 심사·보험·조건 ══════════════ */
  policy: {
    key: 'policy', label: '정책', source: '내부 등록', idFrom: 'policy_code',
    fields: [
      { key: 'policy_code', label: '정책코드', type: 'text', required: true, manual: true },
      { key: 'policy_name', label: '정책명', type: 'text', manual: true },
      { key: 'policy_type', label: '정책유형', type: 'text', manual: true },
      { key: 'screening_criteria', label: '심사기준', type: 'text', manual: true, note: '신용무관/신용조회/저신용 → 무심사·심사필요 판정' },
      { key: 'credit_grade', label: '신용등급', type: 'text', manual: true },
      { key: 'basic_driver_age', label: '기본연령', type: 'number', manual: true },
      { key: 'driver_age_lowering', label: '연령하향', type: 'text', manual: true },
      { key: 'driver_age_upper_limit', label: '연령상한', type: 'number', manual: true },
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
      { key: 'image_url', label: '이미지', type: 'text' },
      { key: 'file_url', label: '파일', type: 'text' },
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
      // ── 5단계 체크(개별 boolean/choice, STEP_CHECK_KEYS) — 진행 스텝. manual ──
      { key: 'agent_delivery_inquiry', label: '출고문의', type: 'select', options: ['yes'], manual: true },
      { key: 'provider_delivery_response', label: '출고응답', type: 'select', options: ['출고 가능', '출고 협의', '출고 불가'], manual: true },
      { key: 'agent_docs_submitted', label: '서류제출', type: 'select', options: ['yes'], manual: true },
      { key: 'provider_docs_review', label: '서류확인', type: 'select', options: ['승인', '부결'], manual: true },
      { key: 'agent_balance_paid', label: '계약금입금', type: 'select', options: ['yes'], manual: true },
      { key: 'provider_agreement_sent', label: '약정발송', type: 'select', options: ['yes'], manual: true },
      { key: 'provider_agreement_done', label: '약정작성완료(agent)', type: 'select', options: ['yes'], manual: true },
      { key: 'provider_balance_confirmed', label: '잔금확인', type: 'select', options: ['yes'], manual: true },
      { key: 'agent_handover_confirmed', label: '인도확인', type: 'select', options: ['yes'], manual: true },
      { key: 'provider_release_completed', label: '출고완료', type: 'select', options: ['yes'], manual: true },
      // ── 서류·서명·메모 ──
      { key: 'doc_license', label: '운전면허증', type: 'text', manual: true },
      { key: 'signed_pdf_url', label: '서명완료본', type: 'text' },
      { key: 'unsigned_pdf_url', label: '서명요청본', type: 'text' },
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
      { key: 'name', label: '상호/이름', type: 'text', required: true, manual: true },
      { key: 'partner_type', label: '유형', type: 'select', options: ['공급사', '영업채널'], manual: true },
      { key: 'fee_rate', label: '공급사 수수료율(0~1)', type: 'number', manual: true, note: 'R1 공급사→프리패스: 정산 fee = 월대여료×이 값. 미설정 시 기본 0.1' },
      { key: 'contact', label: '담당/연락처', type: 'text', manual: true },
      // ── 쉽게 올리고: 렌트사 자체 구글시트 연동(ERP 안 써도 자기 시트만 관리하면 매물화) ──
      { key: 'sheet_url', label: '구글시트 URL', type: 'text', manual: true, note: '렌트사 자체 재고 시트' },
      { key: 'sheet_tab', label: '시트 탭', type: 'text', manual: true },
      { key: 'mapping_profile', label: '컬럼 매핑 프로필', type: 'text', manual: true, note: '렌트사별 컬럼→프리패스 표준 필드 매핑(규격화)' },
      { key: 'last_synced_at', label: '최근 동기화', type: 'number' },
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
      { key: 'credit_display', label: '심사표기', type: 'select', options: ['소득무관', '소득확인'], manual: true },
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

  /* ══════════════ 감사로그(audit_log) — 전 write 자동 기록(store 훅). 누가·언제·무엇(before/after) ══════════════ */
  audit_log: {
    key: 'audit_log', label: '감사로그', source: 'store 자동', idFrom: '_key',
    fields: [
      { key: 'entity', label: '대상엔티티', type: 'text' },
      { key: 'target_key', label: '대상키', type: 'text' },
      { key: 'action', label: '동작', type: 'text' },
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
