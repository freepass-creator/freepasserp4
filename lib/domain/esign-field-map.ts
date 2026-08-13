/**
 * erp3 계약서 템플릿(`rental-contract.html`)의 치환 필드 ↔ **우리 원자** 매핑.
 *
 * ★왜 필요한가
 *   그 템플릿에 `data-field` 가 144개 박혀 있다. 그게 계약서가 요구하는 원자의 **완전한 목록**이다.
 *   추정으로 만든 섹션이 뭘 빠뜨렸는지 여기서만 드러난다.
 *
 * ★4유형별로 갈린다
 *   구독 인수형 / 구독 반납형 / 렌탈 인수형 / 렌탈 반납형.
 *   인수형에만 필요한 칸(잔가·인수옵션)을 반납형 계약서에 넣으면 빈칸이 남고,
 *   반대로 빠뜨리면 계약이 성립 안 한다.
 *
 * ★`from` 이 이 파일의 핵심이다
 *   어느 원자에서 오는지를 못 적으면 그 칸은 영원히 빈다.
 *   `미정` 은 **아직 아무 데도 없다**는 뜻이다 — 숨기지 말고 세어야 한다(`unmappedFields`).
 */
import { CONTRACT_KINDS, type ContractKindSpec, type MaturityKind } from '@/lib/domain/esign-contract-kind';

/** 값의 출처. `고정`=계약서 인쇄문구 · `파생`=다른 원자에서 계산 · `미정`=수집 경로 없음. */
export type AtomSource = '계약' | '재고' | '정책' | '파트너' | '입력' | '본인확인' | '고정' | '파생' | '표기' | '미정';

export type FieldMap = {
  /** erp3 템플릿의 `data-field` 이름. */
  field: string;
  label: string;
  from: AtomSource;
  /** 우리 원자 키. `from` 이 고정·표기·미정이면 빈다. */
  atom?: string;
  /** 이 유형에서만 쓴다. 비면 4유형 공통. */
  onlyMaturity?: MaturityKind;
  /** 해당될 때만 쓴다(개인사업자·연대보증 등). */
  conditional?: string;
  note?: string;
};

export const FIELD_MAP: FieldMap[] = [
  /* ── 문서 표기 ── */
  { field: 'doc_title', label: '문서 제목', from: '표기', note: 'contractKind.title' },
  { field: 'doc_kicker', label: '문서 머리말', from: '표기' },
  { field: 'terms_title', label: '약관 제목', from: '표기', atom: 'AGREEMENT_TITLE' },
  { field: 'product_label', label: '상품 표기', from: '표기', note: 'contractKind.label' },
  { field: 'contract_type_label', label: '계약 유형 표기', from: '표기', note: 'contractKind.label' },
  { field: 'label_name', label: '성명 라벨', from: '표기' },
  { field: 'label_id', label: '식별번호 라벨', from: '표기', note: '개인=주민번호 / 사업자=사업자번호' },
  { field: 'label_driver', label: '운전자 라벨', from: '표기' },
  { field: 'label_emergency', label: '비상연락처 라벨', from: '표기' },

  /* ── 우리 회사(임대인) ── */
  { field: 'company_name', label: '회사명', from: '파트너', atom: 'partner.name' },
  { field: 'company_ceo', label: '대표자', from: '파트너', atom: 'partner.ceo' },
  { field: 'company_ceo_title', label: '대표자 직함', from: '고정' },
  { field: 'company_biz_no', label: '사업자등록번호', from: '파트너', atom: 'partner.biz_no' },
  { field: 'company_phone', label: '대표번호', from: '파트너', atom: 'partner.phone' },
  { field: 'company_address', label: '임대인 주소', from: '파트너', atom: 'partner.address' },
  { field: 'rental_business_no', label: '자동차대여사업 등록번호', from: '파트너', atom: 'partner.rental_business_no' },
  { field: 'company_logo', label: '로고', from: '고정' },

  /* ── 계약 식별 ── */
  { field: 'contract_code', label: '계약번호', from: '계약', atom: 'contract_code' },
  { field: 'contract_date', label: '계약일', from: '계약', atom: 'contract_date' },
  { field: 'contract_place', label: '계약 장소', from: '미정' },
  { field: 'contract_start', label: '차량 인도일', from: '파생', note: '실제 차량 인도 시 확정' },
  { field: 'contract_end', label: '대여 종료일', from: '파생', note: '차량 인도일 + 대여기간(개월)' },

  /* ── 손님 ── */
  { field: 'customer_name', label: '성명', from: '계약', atom: 'customer_name' },
  { field: 'customer_phone', label: '전화번호', from: '계약', atom: 'customer_phone' },
  { field: 'customer_address', label: '주소', from: '계약', atom: 'customer_address' },
  { field: 'customer_birth', label: '생년월일', from: '계약', atom: 'customer_birth' },
  { field: 'customer_email', label: '이메일', from: '미정' },
  { field: 'customer_id', label: '주민등록번호', from: '본인확인', note: '계약·세금계산서 발행에 필요한 범위에서 확인' },
  { field: 'driver_license_no', label: '면허번호', from: '본인확인', note: '면허증 첨부자료에서 확인' },
  { field: 'driver_or_biz_no', label: '주민/사업자번호', from: '본인확인' },
  { field: 'emergency_contact', label: '비상연락처', from: '입력', atom: 'emergency_contact' },

  /* ── 개인사업자 ── */
  { field: 'tax_biz_name', label: '상호', from: '입력', atom: 'biz_name', conditional: '개인사업자' },
  { field: 'tax_biz_no', label: '사업자등록번호', from: '입력', atom: 'biz_number', conditional: '개인사업자' },
  { field: 'tax_biz_address', label: '사업장 소재지', from: '입력', atom: 'biz_address', conditional: '개인사업자' },
  { field: 'tax_ceo', label: '대표자', from: '미정', conditional: '개인사업자' },
  { field: 'tax_email', label: '계산서 이메일', from: '미정', conditional: '개인사업자' },
  { field: 'tax_biz_type_item', label: '업태·종목', from: '미정', conditional: '개인사업자' },
  { field: 'tax_issue_type', label: '계산서 발행구분', from: '고정' },
  { field: 'invoice_type', label: '계산서 종류', from: '고정' },
  { field: 'invoice_cycle', label: '계산서 발행주기', from: '고정', note: '익월 10일 이내' },

  /* ── 차량 ── */
  { field: 'vehicle_name', label: '차종', from: '계약', atom: 'vehicle_name_snapshot' },
  { field: 'car_number', label: '차량번호', from: '계약', atom: 'car_number_snapshot' },
  { field: 'vin', label: '차대번호', from: '재고', atom: 'vin' },
  { field: 'model_year', label: '연식', from: '계약', atom: 'year_snapshot' },
  { field: 'fuel', label: '유종', from: '계약', atom: 'fuel_type_snapshot' },
  { field: 'options', label: '옵션', from: '재고', atom: 'options' },
  { field: 'color_exterior', label: '외부 색상', from: '재고', atom: 'ext_color' },
  { field: 'color_interior', label: '내부 색상', from: '재고', atom: 'int_color' },

  /* ── 금액·기간 ── */
  { field: 'rent_amount', label: '월 대여료', from: '계약', atom: 'rent_amount_snapshot' },
  { field: 'rent_month', label: '대여기간', from: '계약', atom: 'rent_month_snapshot' },
  { field: 'deposit_amount', label: '보증금', from: '계약', atom: 'deposit_amount_snapshot' },
  { field: 'deposit_total', label: '보증금 총액', from: '파생' },
  { field: 'deposit_installment', label: '보증금 분납 여부', from: '입력', atom: 'deposit_installment_count' },
  { field: 'deposit_round_1', label: '보증금 1회차', from: '입력', conditional: '분납' },
  { field: 'deposit_round_2', label: '보증금 2회차', from: '입력', conditional: '분납' },
  { field: 'deposit_round_3', label: '보증금 3회차', from: '입력', conditional: '분납' },
  { field: 'deposit_return_term', label: '보증금 반환 조건', from: '고정' },
  { field: 'payment_cycle', label: '대여료 결제주기', from: '고정' },
  { field: 'payment_timing', label: '대여료 납부 조건', from: '계약', atom: 'payment_timing_snapshot' },
  { field: 'payment_method', label: '결제 방식', from: '정책', atom: 'payment_method' },
  { field: 'payment_bank', label: '입금 은행', from: '파트너' },
  { field: 'payment_account_no', label: '입금 계좌번호', from: '파트너' },
  { field: 'payment_account_holder', label: '입금 예금주', from: '파트너' },
  { field: 'late_fee_rate', label: '지연손해금율', from: '고정', note: '5% / 12%' },
  { field: 'succession_allowed', label: '승계 가능여부', from: '정책', atom: 'succession_allowed' },
  { field: 'succession_fee', label: '승계수수료', from: '정책', atom: 'succession_fee' },
  { field: 'claim_basis', label: '청구 기준', from: '고정' },
  /**
   * 연체 제재 — 약관 제7조·제24조가 「계약서에 정한 기준일」이라고 부르는 자리다.
   * 계약서에는 칸이 있는데 매핑이 없어 값이 흐르지 않았다(실측 2026-08-12).
   * HTML 의 3·10·2 는 값이 안 왔을 때 보이는 기본 표시이고, 정책값이 오면 그것이 이긴다.
   * 보증금 미납은 «회차»로 센다 — 대여료 연체(날짜)와 계산 축이 다르다.
   */
  { field: 'engine_control_overdue_days', label: '운행제한(시동제어) 기준일', from: '정책', atom: 'engine_control_overdue_days' },
  { field: 'auto_terminate_overdue_days', label: '차량회수·해지 기준일', from: '정책', atom: 'auto_terminate_overdue_days' },
  { field: 'deposit_overdue_rounds', label: '보증금 미납 시동제어(회차)', from: '정책', atom: 'deposit_overdue_rounds' },

  /* ── 만기 처리 — 유형이 갈리는 지점 ── */
  { field: 'buyback_price', label: '만기 인수가격', from: '입력', atom: 'buyout_price', onlyMaturity: '인수형' },
  { field: 'buyback_option', label: '인수 옵션', from: '입력', onlyMaturity: '반납형', note: '반납형은 «인수 선택»' },
  { field: 'early_termination_rate_y1', label: '중도해지율(1년 미만)', from: '파생', note: 'PENALTY_RATES' },
  { field: 'early_termination_rate_y2', label: '중도해지율(1년 이상)', from: '파생', note: '인수형 10% / 반납형 20%' },

  /* ── 주행 ── */
  { field: 'annual_mileage', label: '약정 주행거리', from: '정책', atom: 'annual_mileage' },
  /**
   * ⚠ 이 칸에 `mileage_upcharge_per_10000km` 를 대면 안 된다(2026-08-09 정합성 점검에서 발견).
   *
   *   `mileage_upcharge_per_10000km`(「1만km 추가」)은 **약정 주행거리를 정할 때의 가격표**다.
   *   2만km면 월 65만원, 3만km면 75만원 — 계약이 확정되면 이미 월 대여료에 녹아 있다.
   *   이 칸은 **약정을 넘겨 달린 거리에 부과**하는 값이다(약정 3만km · 실주행 3.1만km → 초과 1천km).
   *   잘못 대면 계약서에 「초과 주행요금 : 1만km당 100,000원」이 찍혀
   *   손님은 «1만km 넘으면 10만원»으로 읽는다.
   *
   *   약관 제23조가 **「계약서에 정한 1km당 초과주행 요금」을 그대로 참조**하므로,
   *   이 칸이 비면 그 조문이 공중에 뜬다. 계산 방식은 약관이 말하고 계약서는 숫자만 댄다.
   */
  { field: 'over_mileage_rate', label: '초과주행 요금', from: '정책', atom: 'over_mileage_rate_per_km', note: '약관 제23조가 참조하는 1km당 금액' },
  // 약관 제7조제1항제7호의 최근 1년 내 과실사고 3회 기준을 계약서에도 표시한다.
  { field: 'accident_termination_count', label: '사고 다발 시 계약해지 기준', from: '정책', atom: 'accident_termination_count', note: '현재 사고 발생일 기준 직전 1년 내 기존 2회 + 현재 1회 = 총 3회 시 해지 가능' },

  /* ── 운전자 ── */
  { field: 'driver_age', label: '운전자 연령', from: '정책', atom: 'basic_driver_age' },
  { field: 'driver_scope', label: '운전자 범위', from: '입력', atom: 'driver_scope' },
  { field: 'drv1_name', label: '추가운전자1 성함', from: '입력', atom: 'add_driver_name', conditional: '추가운전자' },
  { field: 'drv1_relation', label: '추가운전자1 관계', from: '입력', atom: 'add_driver_relation', conditional: '추가운전자' },
  { field: 'drv1_phone', label: '추가운전자1 연락처', from: '입력', atom: 'add_driver_phone', conditional: '추가운전자' },
  { field: 'drv1_rrn', label: '추가운전자1 주민번호', from: '본인확인', conditional: '추가운전자' },
  { field: 'drv1_license', label: '추가운전자1 면허번호', from: '본인확인', conditional: '추가운전자' },
  { field: 'drv2_name', label: '추가운전자2 성함', from: '미정', conditional: '추가운전자2' },
  { field: 'drv2_relation', label: '추가운전자2 관계', from: '미정', conditional: '추가운전자2' },
  { field: 'drv2_phone', label: '추가운전자2 연락처', from: '미정', conditional: '추가운전자2' },
  { field: 'drv2_rrn', label: '추가운전자2 주민번호', from: '본인확인', conditional: '추가운전자2' },
  { field: 'drv2_license', label: '추가운전자2 면허번호', from: '본인확인', conditional: '추가운전자2' },
  { field: 'drv3_name', label: '추가운전자3 성함', from: '미정', conditional: '추가운전자3' },
  { field: 'drv3_relation', label: '추가운전자3 관계', from: '미정', conditional: '추가운전자3' },
  { field: 'drv3_phone', label: '추가운전자3 연락처', from: '미정', conditional: '추가운전자3' },
  { field: 'drv3_rrn', label: '추가운전자3 주민번호', from: '본인확인', conditional: '추가운전자3' },
  { field: 'drv3_license', label: '추가운전자3 면허번호', from: '본인확인', conditional: '추가운전자3' },

  /* ── 보험 — 「회사포함」일 때만 채운다 ── */
  { field: 'insurance_condition', label: '보험 가입 조건', from: '파생', note: 'insuranceSide' },
  { field: 'coverage_liability_person', label: '대인배상', from: '정책', atom: 'injury_compensation_limit' },
  { field: 'coverage_liability_property', label: '대물배상', from: '정책', atom: 'property_compensation_limit' },
  { field: 'coverage_self_injury', label: '자기신체사고', from: '정책', atom: 'self_body_accident' },
  { field: 'coverage_uninsured', label: '무보험차상해', from: '정책', atom: 'uninsured_damage' },
  { field: 'emergency_dispatch_limit', label: '긴급출동', from: '정책', atom: 'annual_roadside_assistance' },
  { field: 'deductible_liability_person', label: '대인 면책금', from: '파생', note: '연령 파생(DEDUCTIBLE_BY_AGE)' },
  { field: 'deductible_liability_property', label: '대물 면책금', from: '파생', note: '연령 파생' },
  { field: 'self_damage_coverage', label: '자차 보상', from: '정책', atom: 'own_damage_compensation' },
  { field: 'self_damage_deductible_rate', label: '자차 자기부담률', from: '정책', atom: 'own_damage_repair_ratio' },
  { field: 'self_damage_deductible_min', label: '자차 최소 면책금', from: '파생', note: '연령 파생' },
  { field: 'self_damage_deductible_max', label: '자차 최대 면책금', from: '파생', note: '연령 파생' },
  { field: 'self_damage_exclusions', label: '자차 면책 제외', from: '고정', note: '중과실 12대' },
  { field: 'extra_deductibles', label: '추가 면책금', from: '고정', note: '면허 1년 이하' },
  { field: 'insurer_name', label: '가입 보험사·공제조합', from: '정책' },

  /* ── 정비·서비스 ── */
  { field: 'maintenance_product', label: '정비상품', from: '정책', atom: 'maintenance_service' },
  { field: 'maintenance_replacement', label: '정비 대차 서비스', from: '고정' },
  { field: 'designated_garage', label: '지정 정비점', from: '고정' },
  { field: 'replacement_car_policy', label: '대차 정책', from: '고정', note: '대차 불가' },
  { field: 'other_items', label: '기타 항목', from: '고정' },
  { field: 'special_terms', label: '특약사항', from: '고정', note: 'GPS·키 1개' },

  /* ── 장비·부속 ── */
  { field: 'gps_installed', label: 'GPS 장착', from: '고정' },
  { field: 'blackbox_included', label: '블랙박스', from: '미정' },
  { field: 'hipass_included', label: '하이패스', from: '미정' },
  { field: 'smartkey_count', label: '스마트키 개수', from: '미정' },
  { field: 'spare_key_count', label: '스페어키 개수', from: '미정' },
  { field: 'subkey_count', label: '서브키 개수', from: '미정' },

  /* ── 인도·반납 실사 ── */
  { field: 'handover_datetime', label: '인도 일시', from: '미정' },
  { field: 'handover_location', label: '인도 장소', from: '미정' },
  { field: 'handover_agent_name', label: '인도 담당자', from: '미정' },
  { field: 'odometer_delivery', label: '출고 시 주행거리', from: '재고', atom: 'mileage' },
  { field: 'vehicle_classification', label: '차량 구분', from: '재고', atom: 'product_type' },
  { field: 'fuel_gauge_delivery', label: '인도 시 연료량', from: '미정' },
  { field: 'damage_delivery', label: '인도 시 손상', from: '미정' },
  { field: 'return_datetime', label: '반납 일시', from: '미정', onlyMaturity: '반납형' },
  { field: 'odometer_return', label: '반납 시 주행거리', from: '미정', onlyMaturity: '반납형' },
  { field: 'fuel_gauge_return', label: '반납 시 연료량', from: '미정', onlyMaturity: '반납형' },
  { field: 'damage_return', label: '반납 시 손상', from: '미정', onlyMaturity: '반납형' },
  { field: 'impound_fee', label: '보관료', from: '미정' },
  { field: 'impound_keep_term', label: '보관 기간', from: '고정' },

  /* ── 자동이체(CMS) ── */
  { field: 'cms_bank', label: '출금 은행', from: '입력', atom: 'cms_bank' },
  { field: 'cms_account_no', label: '출금 계좌번호', from: '입력', atom: 'cms_account_no' },
  { field: 'cms_agency', label: '수납대행사', from: '고정' },
  { field: 'cms_start_month', label: '출금 시작월', from: '파생' },
  { field: 'auto_debit_date', label: '월 납부일', from: '입력', atom: 'auto_debit_day' },

  /* ── 연대보증 — 해당될 때만 ── */
  { field: 'guarantor_name', label: '연대보증인 성명', from: '미정', conditional: '연대보증' },
  { field: 'guarantor_rrn', label: '연대보증인 주민번호', from: '본인확인', conditional: '연대보증' },
  { field: 'guarantor_phone', label: '연대보증인 연락처', from: '미정', conditional: '연대보증' },
  { field: 'guarantor_address', label: '연대보증인 주소', from: '미정', conditional: '연대보증' },
  { field: 'guarantor_relation', label: '연대보증인 관계', from: '미정', conditional: '연대보증' },
  { field: 'guarantor_occupation', label: '연대보증인 직업', from: '미정', conditional: '연대보증' },
  { field: 'guarantee_limit', label: '보증 한도(최고액)', from: '미정', conditional: '연대보증' },
  { field: 'guarantee_period', label: '보증 기간', from: '파생', conditional: '연대보증' },
];

/** 이 유형에 필요한 필드만. 인수형 전용 칸을 반납형 계약서에 넣으면 빈칸이 남는다. */
export function fieldsForKind(spec: ContractKindSpec): FieldMap[] {
  return FIELD_MAP.filter((f) => !f.onlyMaturity || f.onlyMaturity === spec.maturity);
}

/** 아직 채울 방법이 없는 칸 — 숨기지 말고 센다. */
export function unmappedFields(spec?: ContractKindSpec): FieldMap[] {
  return (spec ? fieldsForKind(spec) : FIELD_MAP).filter((f) => f.from === '미정');
}

/** 출처별 집계 — 어디를 더 채워야 하는지 한눈에. */
export function coverageBySource(spec?: ContractKindSpec): Record<AtomSource, number> {
  const out = {} as Record<AtomSource, number>;
  for (const f of spec ? fieldsForKind(spec) : FIELD_MAP) out[f.from] = (out[f.from] || 0) + 1;
  return out;
}

/** 4유형 전부에 대한 커버리지 요약. */
export function coverageByKind(): { kind: string; total: number; mapped: number; unmapped: number }[] {
  return CONTRACT_KINDS.map((spec) => {
    const fields = fieldsForKind(spec);
    const unmapped = fields.filter((f) => f.from === '미정').length;
    return { kind: spec.label, total: fields.length, mapped: fields.length - unmapped, unmapped };
  });
}
