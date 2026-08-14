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

/** A4 추가 운전자 표는 3자리이며 실제 등록 가능 수는 공급사 정책을 넘을 수 없다. */
export function esignAdditionalDriverLimit(policy: Record<string, unknown> | null | undefined): number {
  const raw = S(policy?.additional_driver_allowance_count);
  if (!raw || /불가|없음|미운영/.test(raw)) return 0;
  if (/무제한/.test(raw)) return 3;
  return Math.max(0, Math.min(3, Number(raw.match(/\d+/)?.[0] || 0)));
}

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
  const policyIssueGate = policy ? canIssueContract(policy) : null;
  const customerCompletesInLink = esignContractSource(row) === 'direct';
  const add = (key: string, label: string, level: EsignCheckLevel, message: string) => {
    checks.push({ key, label, level, message });
  };

  if (!S(row.provider_company_code)) add('provider', '렌터카사', 'BLOCK', '렌터카사 없음');
  else add('provider', '렌터카사', 'PASS', '렌터카사 확인');

  if (customerCompletesInLink) {
    add('customer_name', '고객명', 'PASS', '고객 링크에서 입력');
    add('customer_phone', '연락처', 'PASS', '고객 링크에서 입력');
  } else {
    if (!S(row.customer_name)) add('customer_name', '고객명', 'BLOCK', '고객명 없음');
    else add('customer_name', '고객명', 'PASS', '고객명 확인');

    const phone = S(row.customer_phone).replace(/\D/g, '');
    if (!phone) add('customer_phone', '연락처', 'BLOCK', '연락처 없음');
    else if (!/^\d{10,11}$/.test(phone)) add('customer_phone', '연락처', 'BLOCK', '연락처 형식 확인');
    else add('customer_phone', '연락처', 'PASS', '연락처 확인');
  }

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
    const issueGate = policyIssueGate!;
    if (!issueGate.ok) {
      const missing = issueGate.missing.map((field) => field.label).join(' · ');
      add('policy_readiness', '정책 완성도', 'BLOCK', missing ? `정책관리에서 확인: ${missing}` : issueGate.reason);
    }
    else add('policy_readiness', '정책 완성도', 'PASS', '전자계약 발송 조건 확인');
  }

  if (policy && policyIssueGate?.ok) {
    const ageText = S(policy.basic_driver_age);
    const age = Number(ageText.match(/\d{2}/)?.[0] || 0);
    if (age < 21) add('driver_age', '운전자 연령', 'BLOCK', '만 21세 미만은 보험 운영 대상이 아닙니다');
  }

  if (!S(row.vehicle_name_snapshot || row.model_snapshot)) add('vehicle', '차량', 'WARNING', '차량명 확인 필요');
  else add('vehicle', '차량', 'PASS', '차량 확인');

  let contractDraft: Record<string, unknown> = {};
  try {
    const raw = typeof row.contract_draft === 'string' ? JSON.parse(row.contract_draft) : row.contract_draft;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) contractDraft = raw as Record<string, unknown>;
  } catch { /* 깨진 초안은 아래 빈 값 검증으로 처리한다. */ }
  const additionalDriverText = S(row.additional_driver || contractDraft.additional_driver);
  const drivers = [1, 2, 3].map((slot) => [
    S(row[`drv${slot}_name`] || contractDraft[`drv${slot}_name`]),
    S(row[`drv${slot}_relation`] || contractDraft[`drv${slot}_relation`]),
    S(row[`drv${slot}_phone`] || contractDraft[`drv${slot}_phone`]),
  ]);
  const explicitDriverCount = Math.min(3, Number(additionalDriverText.match(/\d+/)?.[0] || 0));
  const inferredDriverCount = drivers.reduce((count, driver, index) => driver.some(Boolean) ? index + 1 : count, 0);
  const additionalDriverCount = Math.max(explicitDriverCount, inferredDriverCount);
  const additionalDriverLimit = esignAdditionalDriverLimit(policy);
  const incompleteSlot = drivers.findIndex((driver, index) => index < additionalDriverCount && !driver.every(Boolean));
  const invalidPhoneSlot = drivers.findIndex((driver, index) => index < additionalDriverCount
    && driver.every(Boolean) && !/^\d{10,11}$/.test(driver[2].replace(/\D/g, '')));
  if (additionalDriverCount > additionalDriverLimit) {
    add('additional_driver', '추가 운전자', 'BLOCK', `선택한 정책은 추가 운전자 ${additionalDriverLimit}명까지 등록할 수 있습니다`);
  } else if (incompleteSlot >= 0) {
    add('additional_driver', '추가 운전자', 'BLOCK', `추가 운전자 ${incompleteSlot + 1}의 성명·관계·연락처를 모두 입력해 주세요`);
  } else if (invalidPhoneSlot >= 0) {
    add('additional_driver', '추가 운전자', 'BLOCK', `추가 운전자 ${invalidPhoneSlot + 1}의 연락처 형식을 확인해 주세요`);
  } else if (additionalDriverCount > 0) {
    add('additional_driver', '추가 운전자', 'PASS', `추가 운전자 ${additionalDriverCount}명 등록정보 확인`);
  }

  if (!S(row.customer_address)) add('customer_address', '고객 주소', 'PASS', '고객이 서명 링크에서 입력');
  if (!S(row.car_number_snapshot)) add('car_number', '차량번호', 'WARNING', '신차·번호미정 여부 확인');

  if (S(row.provider_company_code)) {
    if (!partner) add('partner_profile', '업체 고정값', 'WARNING', '업체 고정값을 찾지 못했습니다');
    else {
      if (!S(partner.name || partner.partner_name)) add('company_name', '임대인 상호', 'BLOCK', '임대인 상호 없음');
      if (!S(partner.business_number || partner.business_no)) add('company_biz_no', '사업자등록번호', 'BLOCK', '사업자등록번호 없음');
      if (!S(partner.ceo || partner.ceo_name)) add('company_ceo', '대표자', 'BLOCK', '업체 대표자 없음');
      if (!S(partner.address)) add('company_address', '업체 주소', 'BLOCK', '업체 주소 없음');
      if (!S(partner.rental_business_no)) add('rental_business_no', '자동차대여사업 등록번호', 'BLOCK', '자동차대여사업 등록번호 없음');
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
  productCode?: string;
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
  emergencyRelation?: string;
  specialTerms?: string;
  additionalDriverCount?: number;
  additionalDriverName?: string;
  additionalDriverRelation?: string;
  additionalDriverPhone?: string;
  additionalDriver2Name?: string;
  additionalDriver2Relation?: string;
  additionalDriver2Phone?: string;
  additionalDriver3Name?: string;
  additionalDriver3Relation?: string;
  additionalDriver3Phone?: string;
};

export function esignDraftAdditionalDriverCount(form: EsignDraftInput): number {
  const explicitCount = Math.max(0, Math.min(3, Number(form.additionalDriverCount) || 0));
  const drivers = [
    [form.additionalDriverName, form.additionalDriverRelation, form.additionalDriverPhone],
    [form.additionalDriver2Name, form.additionalDriver2Relation, form.additionalDriver2Phone],
    [form.additionalDriver3Name, form.additionalDriver3Relation, form.additionalDriver3Phone],
  ];
  const inferredCount = drivers.reduce(
    (count, driver, index) => driver.some((value) => S(value)) ? index + 1 : count,
    0,
  );
  return Math.max(explicitCount, inferredCount);
}

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
    productCode: '',
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
    emergencyRelation: '',
    specialTerms: '',
    additionalDriverCount: 0,
    additionalDriverName: '',
    additionalDriverRelation: '',
    additionalDriverPhone: '',
    additionalDriver2Name: '',
    additionalDriver2Relation: '',
    additionalDriver2Phone: '',
    additionalDriver3Name: '',
    additionalDriver3Relation: '',
    additionalDriver3Phone: '',
  };
}

export function draftInputRecord(form: EsignDraftInput): EntityRecord {
  const additionalDriverCount = esignDraftAdditionalDriverCount(form);
  return {
    contract_source: form.source,
    provider_company_code: form.providerCompanyCode,
    policy_code: form.policyCode,
    customer_name: form.customerName,
    customer_phone: form.customerPhone,
    customer_address: form.customerAddress,
    product_code: form.productCode,
    driver_age_snapshot: form.driverAge,
    vehicle_name_snapshot: form.vehicleName,
    car_number_snapshot: form.carNumber,
    rent_month_snapshot: N(form.rentMonths),
    rent_amount_snapshot: N(form.rentAmount),
    deposit_amount_snapshot: N(form.depositAmount),
    payment_timing_snapshot: form.paymentTiming,
    auto_debit_date: form.paymentDueDate,
    emergency_contact: form.emergencyContact,
    emergency_relation: form.emergencyRelation,
    additional_driver: additionalDriverCount ? `${additionalDriverCount}인 지정` : '없음',
    drv1_name: form.additionalDriverName,
    drv1_relation: form.additionalDriverRelation,
    drv1_phone: form.additionalDriverPhone,
    drv2_name: form.additionalDriver2Name,
    drv2_relation: form.additionalDriver2Relation,
    drv2_phone: form.additionalDriver2Phone,
    drv3_name: form.additionalDriver3Name,
    drv3_relation: form.additionalDriver3Relation,
    drv3_phone: form.additionalDriver3Phone,
  };
}

export function draftTemplateFields(form: EsignDraftInput): Record<string, string> {
  const additionalDriverCount = esignDraftAdditionalDriverCount(form);
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
    emergency_contact: [S(form.emergencyRelation), S(form.emergencyContact)].filter(Boolean).join(' · '),
    emergency_relation: S(form.emergencyRelation),
    special_terms: S(form.specialTerms),
    additional_driver: additionalDriverCount ? `${additionalDriverCount}인 지정` : '없음',
    drv1_name: S(form.additionalDriverName),
    drv1_relation: S(form.additionalDriverRelation),
    drv1_phone: S(form.additionalDriverPhone),
    drv2_name: S(form.additionalDriver2Name),
    drv2_relation: S(form.additionalDriver2Relation),
    drv2_phone: S(form.additionalDriver2Phone),
    drv3_name: S(form.additionalDriver3Name),
    drv3_relation: S(form.additionalDriver3Relation),
    drv3_phone: S(form.additionalDriver3Phone),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value));
}
