/**
 * 로컬 미리보기용 샘플 — 첫 실행(product 비어있음) 시 1회 주입.
 * 실 매물은 400~500대 규모 → 밀도있는 리스트로 감안. 각 매물은 정책(_policy)을 물고 옴.
 */
import { getStore } from '@/lib/store';
import type { EntityRecord } from '@/lib/intake/entities';

// 정책 템플릿 2종(소득무관 / 소득확인) — 실제 policy.js POLICY_DEFAULTS 형태
const POL_무관 = {
  screening_criteria: '소득무관', basic_driver_age: '만 21세 이상', license_period: '제한없음', driver_age_upper_limit: '제한없음', driver_age_lowering: '만21세', age_lowering_cost: '대여료의 10%',
  personal_driver_scope: '계약자 본인+직계가족', business_driver_scope: '계약사업자 임직원 및 관계자', additional_driver_allowance_count: '1인', additional_driver_cost: '월 3만원',
  annual_mileage: '연간 2만Km', mileage_upcharge_per_10000km: '3만원', deposit_installment: '협의', deposit_card_payment: '협의', payment_method: '선불', rental_region: '전국', delivery_fee: '협의', penalty_condition: '잔여기간 기준 차등적용',
  injury_compensation_limit: '무한', property_compensation_limit: '1억원', self_body_accident: '1억원', uninsured_damage: '2억원', own_damage_compensation: '차량가액', own_damage_repair_ratio: '20%', annual_roadside_assistance: '연간 5회', maintenance_service: '포함', insurance_included: '보험료 포함',
};
const POL_확인 = { ...POL_무관, screening_criteria: '소득확인', basic_driver_age: '만 26세 이상', license_period: '1년 이상', driver_age_lowering: '불가', annual_mileage: '연간 3만Km' };

// 정책관리 페이지용 샘플 정책 엔티티(매물의 _policy 템플릿을 독립 레코드로).
export const SAMPLE_POLICIES: EntityRecord[] = [
  { policy_code: 'POL-무관', policy_name: '소득무관 표준', policy_type: '무심사', ...POL_무관 },
  { policy_code: 'POL-확인', policy_name: '소득확인 표준', policy_type: '일반', ...POL_확인 },
];

export const SAMPLE_PRODUCTS: EntityRecord[] = [
  { product_code: 'FP-1001', car_number: '123가4567', maker: '기아', model: '스포티지', sub_model: '스포티지 NQ5', trim_name: '노블레스', vehicle_class: '준중형 SUV', year: '2023', fuel_type: '가솔린', mileage: 18000, ext_color: '그레이', int_color: '블랙', vehicle_status: '즉시출고', product_type: '재렌트', provider_company_code: 'SP-01', _policy: POL_무관, price: { '36': { rent: 690000, deposit: 0, fee: 69000 }, '48': { rent: 640000, deposit: 0, fee: 64000 } } },
  { product_code: 'FP-1002', car_number: '77무5678', maker: '기아', model: '셀토스', sub_model: '셀토스', trim_name: '시그니처', vehicle_class: '소형 SUV', year: '2022', fuel_type: '가솔린', mileage: 32000, ext_color: '화이트', int_color: '베이지', vehicle_status: '즉시출고', product_type: '재렌트', provider_company_code: 'SP-01', _policy: POL_무관, price: { '36': { rent: 640000, deposit: 0, fee: 64000 }, '48': { rent: 590000, deposit: 0, fee: 59000 } } },
  { product_code: 'FP-1003', car_number: '88조1234', maker: '기아', model: '모닝', sub_model: '모닝', trim_name: '프레스티지', vehicle_class: '경형', year: '2024', fuel_type: '가솔린', mileage: 5000, ext_color: '실버', int_color: '블랙', vehicle_status: '출고협의', product_type: '신차', provider_company_code: 'SP-02', _policy: POL_무관, price: { '36': { rent: 420000, deposit: 840000, fee: 42000 }, '48': { rent: 390000, deposit: 840000, fee: 39000 }, '60': { rent: 360000, deposit: 840000, fee: 36000 } } },
  { product_code: 'FP-1004', car_number: '55라9012', maker: '현대', model: '아반떼', sub_model: '아반떼 CN7', trim_name: '인스퍼레이션', vehicle_class: '준중형', year: '2023', fuel_type: '가솔린', mileage: 21000, ext_color: '블랙', int_color: '블랙', vehicle_status: '출고가능', product_type: '재렌트', provider_company_code: 'SP-03', _policy: POL_확인, price: { '24': { rent: 560000, deposit: 1120000, fee: 56000 }, '36': { rent: 520000, deposit: 1120000, fee: 52000 } } },
  { product_code: 'FP-1005', car_number: '12가3456', maker: '기아', model: '카니발', sub_model: '카니발 KA4', trim_name: '시그니처', vehicle_class: '대형 RV', year: '2023', fuel_type: '디젤', mileage: 15000, ext_color: '그레이', int_color: '브라운', vehicle_status: '출고준비', product_type: '재렌트', provider_company_code: 'SP-02', _policy: POL_확인, price: { '36': { rent: 880000, deposit: 1760000, fee: 88000 }, '48': { rent: 820000, deposit: 1760000, fee: 82000 } } },
  { product_code: 'FP-1006', car_number: '34나5678', maker: '현대', model: '그랜저', sub_model: '그랜저 GN7', trim_name: '캘리그래피', vehicle_class: '대형', year: '2023', fuel_type: '하이브리드', mileage: 12000, ext_color: '화이트', int_color: '블랙', vehicle_status: '즉시출고', product_type: '재렌트', provider_company_code: 'SP-01', _policy: POL_확인, price: { '36': { rent: 940000, deposit: 1880000, fee: 94000 }, '48': { rent: 880000, deposit: 1880000, fee: 88000 } } },
  { product_code: 'FP-1007', car_number: '90다1122', maker: '기아', model: '레이', sub_model: '레이', trim_name: '그래비티', vehicle_class: '경형', year: '2024', fuel_type: '가솔린', mileage: 3000, ext_color: '민트', int_color: '그레이', vehicle_status: '즉시출고', product_type: '신차', provider_company_code: 'SP-03', _policy: POL_무관, price: { '36': { rent: 450000, deposit: 0, fee: 45000 }, '48': { rent: 420000, deposit: 0, fee: 42000 }, '60': { rent: 390000, deposit: 0, fee: 39000 } } },
  { product_code: 'FP-1008', car_number: '66마3344', maker: '현대', model: '싼타페', sub_model: '싼타페 MX5', trim_name: '캘리그래피', vehicle_class: '중형 SUV', year: '2023', fuel_type: '하이브리드', mileage: 9000, ext_color: '블랙', int_color: '베이지', vehicle_status: '출고가능', product_type: '재렌트', provider_company_code: 'SP-02', _policy: POL_확인, price: { '36': { rent: 820000, deposit: 1640000, fee: 82000 } } },
  { product_code: 'FP-1009', car_number: '11바7788', maker: '기아', model: 'K5', sub_model: 'K5 DL3', trim_name: '시그니처', vehicle_class: '중형', year: '2022', fuel_type: '가솔린', mileage: 41000, ext_color: '그레이', int_color: '블랙', vehicle_status: '즉시출고', product_type: '재렌트', provider_company_code: 'SP-01', _policy: POL_무관, price: { '36': { rent: 590000, deposit: 0, fee: 59000 }, '48': { rent: 550000, deposit: 0, fee: 55000 } } },
  { product_code: 'FP-1010', car_number: '22사9900', maker: '제네시스', model: 'G80', sub_model: 'G80 RG3', trim_name: '프리미엄', vehicle_class: '대형', year: '2023', fuel_type: '가솔린', mileage: 22000, ext_color: '블랙', int_color: '브라운', vehicle_status: '출고협의', product_type: '재렌트', provider_company_code: 'SP-03', _policy: POL_확인, price: { '36': { rent: 1180000, deposit: 2360000, fee: 118000 }, '48': { rent: 1090000, deposit: 2360000, fee: 109000 } } },
  { product_code: 'FP-1011', car_number: '33아1234', maker: '기아', model: '봉고', sub_model: '봉고3', trim_name: '킹캡', vehicle_class: '화물', year: '2024', fuel_type: '디젤', mileage: 8000, ext_color: '화이트', int_color: '그레이', vehicle_status: '즉시출고', product_type: '신차', provider_company_code: 'SP-02', _policy: POL_무관, price: { '48': { rent: 520000, deposit: 0, fee: 52000 }, '60': { rent: 480000, deposit: 0, fee: 48000 } } },
  { product_code: 'FP-1012', car_number: '44자5678', maker: '현대', model: '아이오닉5', sub_model: '아이오닉5', trim_name: '익스클루시브', vehicle_class: '준중형 SUV', year: '2023', fuel_type: '전기', mileage: 14000, ext_color: '그레이', int_color: '그레이', vehicle_status: '출고가능', product_type: '재구독', provider_company_code: 'SP-01', _policy: POL_확인, price: { '36': { rent: 760000, deposit: 1520000, fee: 76000 } } },
];

export const SAMPLE_CONTRACTS: EntityRecord[] = [
  { contract_code: 'OP-2601', contract_status: '계약발송', contract_date: '2026-06-20', product_code: 'FP-1001', car_number_snapshot: '123가4567', maker_snapshot: '기아', sub_model_snapshot: '스포티지 NQ5', rent_month_snapshot: 36, rent_amount_snapshot: 690000, deposit_amount_snapshot: 0, customer_name: '김민수', customer_phone: '010-2211-3344', agent_code: 'SP-777', agent_channel_code: 'CH-1', provider_company_code: 'SP-01', credit_grade_snapshot: '소득무관', agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능', agent_docs_submitted: 'yes', provider_docs_review: '승인', agent_balance_paid: 'yes' },
  { contract_code: 'OP-2602', contract_status: '계약요청', contract_date: '2026-07-10', product_code: 'FP-1003', car_number_snapshot: '88조1234', maker_snapshot: '기아', sub_model_snapshot: '모닝', rent_month_snapshot: 36, rent_amount_snapshot: 420000, deposit_amount_snapshot: 840000, customer_name: '박준호', customer_phone: '010-3322-1100', agent_code: 'SP-451', agent_channel_code: 'CH-2', provider_company_code: 'SP-02', credit_grade_snapshot: '소득무관', agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 협의' },
  { contract_code: 'OP-2603', contract_status: '계약완료', contract_date: '2026-05-05', product_code: 'FP-1002', car_number_snapshot: '77무5678', maker_snapshot: '기아', sub_model_snapshot: '셀토스', rent_month_snapshot: 36, rent_amount_snapshot: 640000, deposit_amount_snapshot: 0, customer_name: '최지우', customer_phone: '010-9090-1212', agent_code: 'SP-777', agent_channel_code: 'CH-1', provider_company_code: 'SP-01', credit_grade_snapshot: '소득무관', agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능', agent_docs_submitted: 'yes', provider_docs_review: '승인', agent_balance_paid: 'yes', provider_agreement_sent: 'yes', provider_agreement_done: 'yes', provider_balance_confirmed: 'yes', agent_handover_confirmed: 'yes', provider_release_completed: 'yes' },
];

export const SAMPLE_PARTNERS: EntityRecord[] = [
  { partner_code: 'SP-01', name: '제일오토렌탈', partner_type: '공급사', fee_rate: 0.1, sheet_url: 'https://docs.google.com/…(제일오토 재고시트)', mapping_profile: 'jeil-v1' },
  { partner_code: 'SP-02', name: '한빛렌트카', partner_type: '공급사', fee_rate: 0.08 },
  { partner_code: 'SP-03', name: '드림오토', partner_type: '공급사', fee_rate: 0.12 },
];

export const SAMPLE_USERS: EntityRecord[] = [
  { uid: 'u-777', user_code: 'SP-777', name: '박영업', role: 'agent', agent_channel_code: 'CH-1', agent_payout_rate: 0.04 },
  { uid: 'u-451', user_code: 'SP-451', name: '이채널', role: 'agent_admin', agent_channel_code: 'CH-2', agent_payout_rate: 0.05 },
];

// 샘플 소통(방·메시지) — 소통 3단 화면을 바로 확인하기 위한 씨앗. 방키=CH_{매물}_{영업자}(ensureRoom 규격).
export const SAMPLE_ROOMS: EntityRecord[] = [
  { _key: 'CH_FP-1001_SP-777', room_code: 'CH_FP-1001_SP-777', product_uid: 'FP-1001', product_code: 'FP-1001', car_number: '123가4567', vehicle_name: '기아 스포티지 NQ5 노블레스', agent_uid: 'u-777', agent_code: 'SP-777', agent_name: '박영업', provider_company_code: 'SP-01', last_message: '36개월 무보증으로 진행하고 싶습니다', last_message_at: 1752300000000 },
  { _key: 'CH_FP-1003_SP-777', room_code: 'CH_FP-1003_SP-777', product_uid: 'FP-1003', product_code: 'FP-1003', car_number: '88조1234', vehicle_name: '기아 모닝 프레스티지', agent_uid: 'u-777', agent_code: 'SP-777', agent_name: '박영업', provider_company_code: 'SP-02', last_message: '60개월 가능한가요?', last_message_at: 1752200000000 },
];
export const SAMPLE_MESSAGES: EntityRecord[] = [
  { _key: 'msg-1', room_id: 'CH_FP-1001_SP-777', text: '스포티지 NQ5 즉시출고 가능한가요?', sender_uid: 'u-777', sender_role: 'agent', sender_name: '박영업', created_at: 1752290000000 },
  { _key: 'msg-2', room_id: 'CH_FP-1001_SP-777', text: '네, 즉시 출고 가능합니다. 그레이 재고 있습니다.', sender_uid: 'pv-01', sender_role: 'provider', sender_name: '제일오토렌탈', created_at: 1752295000000 },
  { _key: 'msg-3', room_id: 'CH_FP-1001_SP-777', text: '36개월 무보증으로 진행하고 싶습니다', sender_uid: 'u-777', sender_role: 'agent', sender_name: '박영업', created_at: 1752300000000 },
  { _key: 'msg-4', room_id: 'CH_FP-1003_SP-777', text: '모닝 60개월 가능한가요?', sender_uid: 'u-777', sender_role: 'agent', sender_name: '박영업', created_at: 1752200000000 },
];

// 샘플 스키마(정책 필드 등)가 바뀌면 올림 → 로컬 미리보기 자동 재주입.
const SEED_VERSION = 'v4-mgmt';
export async function seedIfEmpty(companyId: string): Promise<boolean> {
  const store = getStore();
  const ver = typeof window !== 'undefined' ? window.localStorage.getItem('fp4_seed_ver') : SEED_VERSION;
  const existing = await store.list('product', companyId);
  if (existing.length > 0 && ver === SEED_VERSION) return false;
  // 버전 불일치 = 샘플 변경 → 기존 샘플 키 clear 후 재주입(로컬 전용).
  if (typeof window !== 'undefined' && ver !== SEED_VERSION) {
    for (const e of ['product', 'contract', 'partner', 'user', 'room', 'message', 'policy']) window.localStorage.removeItem(`freepasserp4:${companyId}:${e}`);
  }
  await store.save('product', companyId, SAMPLE_PRODUCTS);
  await store.save('contract', companyId, SAMPLE_CONTRACTS);
  await store.save('partner', companyId, SAMPLE_PARTNERS);
  await store.save('user', companyId, SAMPLE_USERS);
  await store.save('room', companyId, SAMPLE_ROOMS);
  await store.save('message', companyId, SAMPLE_MESSAGES);
  await store.save('policy', companyId, SAMPLE_POLICIES);
  if (typeof window !== 'undefined') window.localStorage.setItem('fp4_seed_ver', SEED_VERSION);
  return true;
}
