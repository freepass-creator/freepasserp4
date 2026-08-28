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
const base = S(process.env.FREEPASS_ESIGN_PUBLIC_BASE_URL || 'https://freepasserp.com')
  .replace(/\/$/, '').replace(/\/sign$/, '');

const now = Date.now();
const contractCode = `CT-MOBILE-SAMPLE-${new Date(now).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
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
  provider_company_code: 'FREEPASS-MOBILE-SAMPLE',
  policy_code: 'POLICY-MOBILE-SAMPLE',
  product_code: 'PRODUCT-MOBILE-SAMPLE',
  car_number_snapshot: '12가3456',
  maker_snapshot: '프리패스',
  model_snapshot: '모바일 계약 체험 차량',
  vehicle_name_snapshot: '프리패스 모바일 계약 체험 차량',
  year_snapshot: '2026',
  fuel_type_snapshot: '가솔린',
  rent_month_snapshot: '36',
  rent_amount_snapshot: '500000',
  deposit_amount_snapshot: '0',
  annual_mileage_snapshot: '20,000km',
  driver_age_snapshot: '만 26세 이상',
  payment_timing_snapshot: '선불',
  contract_date: new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10),
  contract_kind: 'rent_return',
  esign_contract_kind: 'rent_return',
  esign_maturity: '반납형',
  esign_insurance_side: '회사포함',
  standard_template_id: 'freepass-rent-standard',
  customer_type: '개인',
};

const product: EsignRecord = {
  product_code: 'PRODUCT-MOBILE-SAMPLE',
  product_type: '렌트',
  car_number: '12가3456',
  maker: '프리패스',
  model: '모바일 계약 체험 차량',
  year: '2026',
  fuel_type: '가솔린',
  price: { 36: { rent: 500000, deposit: 0 } },
};

const policy: EsignRecord = {
  policy_code: 'POLICY-MOBILE-SAMPLE',
  insurance_included: '포함',
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
  partner_code: 'FREEPASS-MOBILE-SAMPLE',
  company_name: '프리패스모빌리티 (화면 점검용)',
  name: '프리패스모빌리티 (화면 점검용)',
};

const snapshot = buildFreepassIssueSnapshot({
  contract,
  policy,
  product,
  partner,
  standardTemplateId: 'freepass-rent-standard',
  contractKind: 'rent_return',
});
const token = makeFreepassSignToken();
const hash = hashFreepassSignToken(token);
const expiresAt = now + 24 * 60 * 60 * 1000;

console.log(`고객 모바일 화면 점검 링크 (${apply ? '생성' : 'dry-run'})`);
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
