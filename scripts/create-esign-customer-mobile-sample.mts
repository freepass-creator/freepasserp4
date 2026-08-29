/**
 * 기존 고객 모바일 화면(`/sign/[token]`)만 점검하기 위한 무해한 테스트 세션을 만든다.
 * 별도 테스트 UI·실차·실고객·실정산은 전혀 만들지 않는다.
 *
 *   npx tsx scripts/create-esign-customer-mobile-sample.mts --apply
 */
import {
  buildFreepassIssueSnapshot,
  hashFreepassSignToken,
  makeFreepassSignToken,
  type EsignRecord,
} from '@/lib/server/freepass-esign';
import { firebaseAdminDatabase } from '@/lib/server/firebase-admin';

const S = (value: unknown) => String(value ?? '').trim();
const apply = process.argv.includes('--apply');
const corporate = process.argv.includes('--corporate');
const sonogongSubscription = process.argv.includes('--sonogong-subscription');
const insuranceSeparate = sonogongSubscription && process.argv.includes('--insurance-separate');
const templateId = sonogongSubscription
  ? (insuranceSeparate ? 'sonogong-subscription-insurance-separate' : 'sonogong-subscription-insurance-included')
  : 'freepass-rent-standard';
const insuranceSide = insuranceSeparate ? '고객직접' : '회사포함';
const base = S(process.env.FREEPASS_ESIGN_PUBLIC_BASE_URL || 'https://freepasserp.com')
  .replace(/\/$/, '').replace(/\/sign$/, '');

const now = Date.now();
const contractCode = `${corporate ? 'CT-CORPORATE-SAMPLE' : sonogongSubscription ? 'CT-SONOGONG-SAMPLE' : 'CT-MOBILE-SAMPLE'}-${new Date(now).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
const contract: EsignRecord = {
  contract_code: contractCode,
  contract_number: contractCode,
  is_test: true,
  test_only: true,
  contract_origin: '고객 모바일 화면 점검',
  contract_status: '계약요청',
  sign_status: '발행',
  created_at: now,
  created_by: 'script:create-esign-customer-mobile-sample',
  provider_company_code: sonogongSubscription ? 'SONOGONG-MOBILE-SAMPLE' : 'FREEPASS-MOBILE-SAMPLE',
  policy_code: sonogongSubscription ? 'POLICY-SONOGONG-MOBILE-SAMPLE' : 'POLICY-MOBILE-SAMPLE',
  product_code: sonogongSubscription ? 'PRODUCT-SONOGONG-MOBILE-SAMPLE' : 'PRODUCT-MOBILE-SAMPLE',
  car_number_snapshot: '12가3456',
  maker_snapshot: sonogongSubscription ? '손오공' : '프리패스',
  model_snapshot: sonogongSubscription ? '구독 약정 체험 차량' : '모바일 계약 체험 차량',
  vehicle_name_snapshot: sonogongSubscription ? '손오공 구독 약정 체험 차량' : '프리패스 모바일 계약 체험 차량',
  year_snapshot: '2026',
  fuel_type_snapshot: '가솔린',
  rent_month_snapshot: '36',
  rent_amount_snapshot: '500000',
  deposit_amount_snapshot: '0',
  annual_mileage_snapshot: '20,000km',
  driver_age_snapshot: '만 26세 이상',
  payment_timing_snapshot: '선불',
  contract_date: new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10),
  contract_kind: sonogongSubscription ? 'sub_return' : 'rent_return',
  esign_contract_kind: sonogongSubscription ? 'sub_return' : 'rent_return',
  esign_maturity: '반납형',
  esign_insurance_side: insuranceSide,
  standard_template_id: templateId,
  customer_type: corporate ? '법인' : '개인',
};

const product: EsignRecord = {
  product_code: sonogongSubscription ? 'PRODUCT-SONOGONG-MOBILE-SAMPLE' : 'PRODUCT-MOBILE-SAMPLE',
  product_type: sonogongSubscription ? '구독' : '렌트',
  car_number: '12가3456',
  maker: sonogongSubscription ? '손오공' : '프리패스',
  model: sonogongSubscription ? '구독 약정 체험 차량' : '모바일 계약 체험 차량',
  year: '2026',
  fuel_type: '가솔린',
  price: { 36: { rent: 500000, deposit: 0 } },
};

const policy: EsignRecord = {
  policy_code: sonogongSubscription ? 'POLICY-SONOGONG-MOBILE-SAMPLE' : 'POLICY-MOBILE-SAMPLE',
  insurance_included: insuranceSeparate ? '별도' : '포함',
  insurer_name: '테스트 손해보험',
  gps_installed: '미장착',
  screening_criteria: '무심사',
  payment_method: '계좌이체',
  payment_timing: '선불',
  basic_driver_age: '만 26세 이상',
  annual_mileage: '20,000km',
  personal_driver_scope: '계약자 본인',
};

const partner: EsignRecord = {
  partner_code: sonogongSubscription ? 'SONOGONG-MOBILE-SAMPLE' : 'FREEPASS-MOBILE-SAMPLE',
  company_name: sonogongSubscription ? '주식회사 손오공렌터카 (화면 점검용)' : '프리패스모빌리티 (화면 점검용)',
  name: sonogongSubscription ? '주식회사 손오공렌터카 (화면 점검용)' : '프리패스모빌리티 (화면 점검용)',
};

const snapshot = buildFreepassIssueSnapshot({
  contract,
  policy,
  product,
  partner,
  standardTemplateId: templateId,
  contractKind: sonogongSubscription ? 'sub_return' : 'rent_return',
});
const token = makeFreepassSignToken();
const hash = hashFreepassSignToken(token);
const expiresAt = now + 24 * 60 * 60 * 1000;

console.log(`${corporate ? '법인 고객 모바일' : sonogongSubscription ? '손오공 구독' : '고객 모바일'} 화면 점검 링크 (${apply ? '생성' : 'dry-run'})`);
console.log(`${base}/sign/${token}`);
console.log(`만료: ${new Date(expiresAt).toLocaleString('ko-KR')}`);
if (!apply) process.exit(0);

const db = firebaseAdminDatabase();
const existing = await db.ref(`v4/contracts/${contractCode}`).get();
if (existing.exists()) throw new Error(`같은 시각의 점검 계약이 이미 있습니다: ${contractCode}`);
await db.ref('v4').update({
  [`contracts/${contractCode}`]: { ...contract, esign_session_hash: hash, sign_expires_at: expiresAt },
  [`esign_sessions/${hash}`]: {
    provider: 'freepass',
    contractCode,
    status: 'sent',
    issuedAt: now,
    expiresAt,
    issuedBy: 'script:create-esign-customer-mobile-sample',
    revision: 1,
    snapshot,
    is_test: true,
  },
});
console.log('생성 완료 — 이 링크는 고객 모바일 화면만 열며, 운영 승인·PDF·인도 처리에는 사용할 수 없습니다.');
