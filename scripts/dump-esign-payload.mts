/**
 * 착한거래로 실제로 나가는 issue payload 를 파일로 떠낸다 — 착한거래 렌더러 테스트용 fixture.
 *
 * 왜 필요한가: 착한거래 쪽에서 양식을 손으로 다시 타이핑하면 정본이 갈라진다.
 * `chakhandealIssuePayload` 는 순수 함수라 Firebase 없이 호출된다.
 *
 *   npx tsx scripts/dump-esign-payload.mts [출력경로]
 */
import { writeFileSync } from 'node:fs';
import { chakhandealIssuePayload } from '@/lib/domain/chakhandeal-esign';
import { CONTRACT_KINDS } from '@/lib/domain/esign-contract-kind';

const OUT = process.argv[2]
  || 'C:/dev/chakhandeal/lib/testForms/freepass-issue-payload.json';

/** 약정이 확정된 계약 하나 — 필드명은 buildConsentGroups 가 읽는 그대로. */
const contract = {
  id: 'test-contract-1',
  contract_code: 'TMP-260808-01',
  customer_name: '홍길동',
  customer_phone: '01012341234',
  customer_birth: '1988-03-12',
  customer_address: '서울특별시 강남구 테헤란로 123',
  car_number_snapshot: '12가1234',
  vehicle_name_snapshot: '',
  maker_snapshot: '제네시스',
  model_snapshot: 'G80',
  sub_model_snapshot: '',
  variant_snapshot: '2.5 터보',
  trim_name_snapshot: '프리미엄',
  trim_extra_snapshot: '선루프',
  year_snapshot: '2024',
  fuel_type_snapshot: '가솔린',
  rent_month_snapshot: 48,
  rent_amount_snapshot: 1000000,
  deposit_amount_snapshot: 1000000,
  mileage_snapshot: 100000,
  esign_inputs: {},
};

/** 상품 정책 — 정책에서 오는 값이 비면 그 행이 화면에서 사라지는지도 같이 본다. */
const policy = {
  annual_mileage: '연 30,000km',
  mileage_upcharge_per_10000km: '1만km당 100,000원',
  deposit_installment: '3회 분납 가능',
  rental_region: '전국',
  delivery_fee: '탁송비 별도',
  screening_criteria: '중신용 이상',
  penalty_condition: '잔여 대여료의 30%',
  basic_driver_age: '만 26세 이상',
  driver_age_lowering: '만 21세까지 하향 가능',
  age_lowering_cost: '월 55,000원',
  license_period: '면허 취득 1년 이상',
  personal_driver_scope: '계약자와 배우자 및 계약자·배우자의 직계가족',
  business_driver_scope: '계약자와 계약자 사업장의 임직원',
  additional_driver_allowance_count: '1명',
  additional_driver_cost: '월 50,000원',
  injury_compensation_limit: '무한',
  injury_deductible: '30만원',
  property_compensation_limit: '2억원',
  property_deductible: '30만원',
  self_body_accident: '1억원',
  self_body_deductible: '',
  uninsured_damage: '2억원',
  uninsured_deductible: '',
  own_damage_compensation: '가입',
  own_damage_repair_ratio: '20%',
  own_damage_min_deductible: '50만원',
  own_damage_max_deductible: '100만원',
  annual_roadside_assistance: '연 5회',
};

const kinds = Object.values(CONTRACT_KINDS as Record<string, { key: string; label: string }>);
console.log('사용 가능한 contractKind:', kinds.map((k) => `${k.key}(${k.label})`).join(' / '));

// 렌탈 인수형 기준. 다른 유형을 보려면 인자로 넘기지 말고 여기를 바꿔 다시 뜬다.
const templateId = kinds.find((k) => k.key === 'rent_buyout')?.key || kinds[0]?.key || '';

const payload = chakhandealIssuePayload(
  { memberCompany: 'freepass', templateId },
  contract as never,
  policy as never,
  '회사포함',
);

writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');

const p = payload as Record<string, unknown>;
const arr = (k: string) => (Array.isArray(p[k]) ? (p[k] as unknown[]).length : '—');
console.log(`\n→ ${OUT}`);
console.log(`consentGroups ${arr('consentGroups')} / consentPages ${arr('consentPages')} / inputRequests ${arr('inputRequests')} / inputGroups ${arr('inputGroups')} / consentAtoms ${arr('consentAtoms')} / requiredDocs ${arr('requiredDocs')}`);
console.log(`agreement.sections ${Array.isArray((p.agreement as Record<string, unknown>)?.sections) ? ((p.agreement as Record<string, unknown>).sections as unknown[]).length : '—'} / templateId ${String(p.templateId)}`);
