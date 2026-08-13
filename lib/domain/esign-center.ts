import type { EntityRecord } from '@/lib/intake/entities';
import { canIssueContract } from '@/lib/domain/policy-tier';

export type EsignContractSource = 'erp' | 'excel' | 'direct';
export type EsignCenterBucket = '발송대기' | '서명중' | '확인필요' | '완료';
export type EsignCheckLevel = 'PASS' | 'WARNING' | 'BLOCK';

export type EsignCheck = {
  key: string;
  label: string;
  level: EsignCheckLevel;
  message: string;
};

const S = (value: unknown) => String(value ?? '').trim();
const N = (value: unknown) => Number(value || 0) || 0;

export function esignContractSource(contract: Record<string, unknown> | null | undefined): EsignContractSource {
  const explicit = S(contract?.contract_source);
  if (explicit === 'excel' || explicit === 'direct' || explicit === 'erp') return explicit;
  const origin = S(contract?.contract_origin);
  if (/엑셀/.test(origin)) return 'excel';
  if (/계약서직접등록|전자계약직접/.test(origin)) return 'direct';
  return 'erp';
}

export function isIndependentEsignSource(contract: Record<string, unknown> | null | undefined): boolean {
  const source = esignContractSource(contract);
  return source === 'excel' || source === 'direct';
}

export function validateEsignCenterContract(
  contract: Record<string, unknown> | null | undefined,
  partner?: Record<string, unknown> | null,
  policy?: Record<string, unknown> | null,
): EsignCheck[] {
  const row = contract || {};
  const checks: EsignCheck[] = [];
  const add = (key: string, label: string, level: EsignCheckLevel, message: string) => {
    checks.push({ key, label, level, message });
  };

  if (!S(row.provider_company_code)) add('provider', '렌터카사', 'BLOCK', '렌터카사 없음');
  else add('provider', '렌터카사', 'PASS', '렌터카사 확인');

  if (!S(row.customer_name)) add('customer_name', '고객명', 'BLOCK', '고객명 없음');
  else add('customer_name', '고객명', 'PASS', '고객명 확인');

  const phone = S(row.customer_phone).replace(/\D/g, '');
  if (!phone) add('customer_phone', '연락처', 'BLOCK', '연락처 없음');
  else if (!/^\d{10,11}$/.test(phone)) add('customer_phone', '연락처', 'BLOCK', '연락처 형식 확인');
  else add('customer_phone', '연락처', 'PASS', '연락처 확인');

  if (N(row.rent_amount_snapshot) <= 0) add('rent_amount', '월 대여료', 'BLOCK', '월 대여료 없음');
  else add('rent_amount', '월 대여료', 'PASS', '월 대여료 확인');

  if (N(row.rent_month_snapshot) <= 0) add('rent_month', '계약기간', 'BLOCK', '계약기간 없음');
  else add('rent_month', '계약기간', 'PASS', '계약기간 확인');

  const paymentTiming = S(row.payment_timing_snapshot || policy?.payment_timing);
  if (!['선불', '후불'].includes(paymentTiming)) add('payment_timing', '대여료 납부 조건', 'BLOCK', '선불·후불 조건을 선택해 주세요');
  else add('payment_timing', '대여료 납부 조건', 'PASS', `${paymentTiming} 조건 확인`);

  if (!S(row.policy_code)) add('policy', '계약 정책', 'BLOCK', '보험·정비 정책 없음');
  else if (!policy) add('policy', '계약 정책', 'BLOCK', '연결된 정책을 찾을 수 없습니다');
  else if (S(policy.provider_company_code) !== S(row.provider_company_code)) add('policy', '계약 정책', 'BLOCK', '선택한 공급사의 정책이 아닙니다');
  else {
    add('policy', '계약 정책', 'PASS', '선택한 공급사의 계약 정책 확인');
    const issueGate = canIssueContract(policy);
    if (!issueGate.ok) add('policy_readiness', '정책 완성도', 'BLOCK', issueGate.reason);
    else add('policy_readiness', '정책 완성도', 'PASS', '전자계약 발송 조건 확인');
  }

  if (policy) {
    const ageText = S(policy.basic_driver_age);
    const age = Number(ageText.match(/\d{2}/)?.[0] || 0);
    if (!age) add('driver_age', '운전자 연령', 'BLOCK', '기본 운전자 연령 없음');
    else if (age < 21) add('driver_age', '운전자 연령', 'BLOCK', '만 21세 미만은 보험 운영 대상이 아닙니다');
  }

  if (!S(row.vehicle_name_snapshot || row.model_snapshot)) add('vehicle', '차량', 'WARNING', '차량명 확인 필요');
  else add('vehicle', '차량', 'PASS', '차량 확인');

  if (!S(row.customer_address)) add('customer_address', '고객 주소', 'PASS', '고객이 서명 링크에서 입력');
  if (!S(row.car_number_snapshot)) add('car_number', '차량번호', 'WARNING', '신차·번호미정 여부 확인');

  if (S(row.provider_company_code)) {
    if (!partner) add('partner_profile', '업체 고정값', 'WARNING', '업체 고정값을 찾지 못했습니다');
    else {
      if (!S(partner.ceo || partner.ceo_name)) add('company_ceo', '대표자', 'WARNING', '업체 대표자 없음');
      if (!S(partner.address)) add('company_address', '업체 주소', 'WARNING', '업체 주소 없음');
      if (!S(partner.rental_business_no)) add('rental_business_no', '자동차대여사업 등록번호', 'WARNING', '자동차대여사업 등록번호 없음');
      if (!S(partner.bank_name)) add('payment_bank', '입금은행', 'WARNING', '업체 입금은행 없음');
      if (!S(partner.bank_account)) add('payment_account_no', '입금계좌', 'WARNING', '업체 입금계좌 없음');
      if (!S(partner.bank_holder || partner.name || partner.partner_name)) add('payment_account_holder', '예금주', 'WARNING', '업체 예금주 없음');
    }
  }

  return checks;
}

export function esignBlockingChecks(
  contract: Record<string, unknown> | null | undefined,
  partner?: Record<string, unknown> | null,
  policy?: Record<string, unknown> | null,
): EsignCheck[] {
  return validateEsignCenterContract(contract, partner, policy).filter((check) => check.level === 'BLOCK');
}

/** 서버 발송 게이트도 화면과 같은 판정기를 사용한다. ERP만 기존 약정 단계가 선행조건이다. */
export function esignIssueBlockers(
  contract: Record<string, unknown> | null | undefined,
  partner?: Record<string, unknown> | null,
  policy?: Record<string, unknown> | null,
): EsignCheck[] {
  const row = contract || {};
  if (isIndependentEsignSource(row)) return esignBlockingChecks(row, partner, policy);
  const blocked: EsignCheck[] = [];
  if (S(row.provider_agreement_done) !== 'yes') {
    blocked.push({ key: 'erp_agreement', label: 'ERP 약정', level: 'BLOCK', message: '계약 진행중에서 약정 작성을 먼저 완료해 주세요.' });
  }
  if (!S(row.customer_name) || !S(row.customer_phone)) {
    blocked.push({ key: 'erp_customer', label: '고객', level: 'BLOCK', message: '고객명과 연락처를 먼저 확정해 주세요.' });
  }
  return blocked;
}

export function esignCenterBucket(contract: Record<string, unknown>, checks: EsignCheck[] = []): EsignCenterBucket {
  const status = S(contract.sign_status);
  if (status === '서명완료') return '완료';
  if (checks.some((check) => check.level === 'BLOCK') || ['반려', '만료'].includes(status)) return '확인필요';
  if (S(contract.esign_id) || ['발행', '열람', '진행중', '검토대기'].includes(status)) return '서명중';
  return '발송대기';
}

export function isEsignCenterContract(contract: EntityRecord): boolean {
  if (S(contract.is_test) === 'yes' || contract.is_test === true) return false;
  if (S(contract.contract_status) === '계약취소') return false;
  const erpReady = esignContractSource(contract) === 'erp'
    && S(contract.provider_agreement_done) === 'yes'
    && N(contract.rent_month_snapshot) > 0
    && N(contract.rent_amount_snapshot) > 0;
  return isIndependentEsignSource(contract) || erpReady || !!S(contract.esign_id) || !!S(contract.esign_sign_url);
}

export type EsignDraftInput = {
  source: 'excel' | 'direct';
  importTemplateId?: string;
  providerCompanyCode: string;
  policyCode: string;
  standardTemplateId: string;
  maturity: '반납형' | '인수형';
  contractDate: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  customerIsBusiness?: string;
  customerCompanyName?: string;
  customerBusinessNumber?: string;
  vehicleName: string;
  carNumber?: string;
  modelYear?: string;
  fuel?: string;
  options?: string;
  colorExterior?: string;
  currentMileage?: string;
  rentMonths: string;
  rentAmount: string;
  depositAmount: string;
  paymentTiming: '선불' | '후불' | '';
  paymentDueDate?: string;
  depositInstallment?: string;
  annualMileage?: string;
  buyoutPrice?: string;
  driverAge?: string;
  driverScope?: string;
  maintenanceProduct?: string;
  emergencyContact?: string;
  specialTerms?: string;
};

export function emptyEsignDraftInput(source: 'excel' | 'direct', date: string): EsignDraftInput {
  return {
    source,
    providerCompanyCode: '',
    policyCode: '',
    standardTemplateId: 'freepass-rent-standard',
    maturity: '반납형',
    contractDate: date,
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    customerIsBusiness: '아니오',
    customerCompanyName: '',
    customerBusinessNumber: '',
    vehicleName: '',
    carNumber: '',
    modelYear: '',
    fuel: '',
    options: '',
    colorExterior: '',
    currentMileage: '',
    rentMonths: '',
    rentAmount: '',
    depositAmount: '0',
    paymentTiming: '',
    paymentDueDate: '',
    depositInstallment: '',
    annualMileage: '',
    buyoutPrice: '',
    driverAge: '',
    driverScope: '',
    maintenanceProduct: '',
    emergencyContact: '',
    specialTerms: '',
  };
}

export function draftInputRecord(form: EsignDraftInput): EntityRecord {
  return {
    contract_source: form.source,
    provider_company_code: form.providerCompanyCode,
    policy_code: form.policyCode,
    customer_name: form.customerName,
    customer_phone: form.customerPhone,
    customer_address: form.customerAddress,
    vehicle_name_snapshot: form.vehicleName,
    car_number_snapshot: form.carNumber,
    rent_month_snapshot: N(form.rentMonths),
    rent_amount_snapshot: N(form.rentAmount),
    deposit_amount_snapshot: N(form.depositAmount),
    payment_timing_snapshot: form.paymentTiming,
    auto_debit_date: form.paymentDueDate,
  };
}

export function draftTemplateFields(form: EsignDraftInput): Record<string, string> {
  const fields: Record<string, string> = {
    customer_address: S(form.customerAddress),
    tax_biz_name: S(form.customerCompanyName),
    tax_biz_no: S(form.customerBusinessNumber),
    fuel: S(form.fuel),
    model_year: S(form.modelYear),
    options: S(form.options),
    color_exterior: S(form.colorExterior),
    odometer_delivery: S(form.currentMileage),
    auto_debit_date: S(form.paymentDueDate),
    payment_timing: S(form.paymentTiming),
    deposit_installment: S(form.depositInstallment),
    annual_mileage: S(form.annualMileage),
    buyback_price: S(form.buyoutPrice),
    driver_age: S(form.driverAge),
    driver_scope: S(form.driverScope),
    maintenance_product: S(form.maintenanceProduct),
    emergency_contact: S(form.emergencyContact),
    special_terms: S(form.specialTerms),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value));
}
