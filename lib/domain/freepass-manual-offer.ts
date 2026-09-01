import { contractKindFor, findTemplate, type StandardTemplateKey } from '@/lib/domain/esign-templates';

export type FreepassManualOffer = {
  id: string;
  providerCompanyCode: string;
  policyCode: string;
  templateId: StandardTemplateKey;
  /** 영업 채널을 빈값으로 두면 플랫폼 관리자만 사용할 수 있다. */
  agentChannelCode: string;
  productType: string;
  /** 현재 공통 렌더러가 지원하는 계약자 프로필. 고객 UI가 이 sealed 값으로 표기를 바꾼다. */
  customerType: '개인' | '개인사업자' | '법인';
  rentMonths: number;
  rentAmount: number;
  depositAmount: number;
  annualMileage: string;
  driverAge: string;
  paymentTiming: '선불' | '후불';
  depositInstallment: string;
  maturity: '반납형' | '인수형';
  buyoutPrice: number | null;
  specialTerms: string;
};

const S = (value: unknown) => String(value ?? '').trim();
const safeId = (value: unknown) => /^[A-Za-z0-9_-]{3,100}$/.test(S(value)) ? S(value) : '';
const amount = (value: unknown, allowZero = false) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && (allowZero ? number >= 0 : number > 0) && number <= 1_000_000_000 ? number : null;
};

/**
 * `v4/esign_manual_offers/{id}` 는 관리자 워크플로가 만든 승인 오퍼만 둔다.
 * 공개·브라우저 값을 여기로 승격하지 않으며, 생성 API는 이 함수가 통과한 값만 봉인한다.
 */
export function approvedFreepassManualOffer(id: unknown, value: unknown): FreepassManualOffer | null {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const offerId = safeId(id);
  if (!row || !offerId || S(row.status) !== 'approved') return null;
  const providerCompanyCode = safeId(row.provider_company_code);
  const policyCode = safeId(row.policy_code);
  const template = findTemplate(row.standard_template_id);
  const rentMonths = Number(row.rent_months);
  const rentAmount = amount(row.rent_amount);
  const depositAmount = amount(row.deposit_amount, true);
  const maturity = S(row.maturity);
  const buyoutPrice = S(row.buyout_price) ? amount(row.buyout_price, true) : null;
  const paymentTiming = S(row.payment_timing);
  const annualMileage = S(row.annual_mileage);
  const driverAge = S(row.driver_age);
  const productType = S(row.product_type);
  const rawCustomerType = S(row.customer_type) || '개인';
  const customerType = rawCustomerType === '법인' ? '법인'
    : rawCustomerType === '개인사업자' ? '개인사업자'
      : rawCustomerType === '개인' ? '개인' : null;
  if (!providerCompanyCode || !policyCode || !template || !productType || !customerType
    || !Number.isInteger(rentMonths) || rentMonths < 1 || rentMonths > 120
    || rentAmount == null || depositAmount == null || !annualMileage || annualMileage.length > 100
    || !driverAge || driverAge.length > 100 || (paymentTiming !== '선불' && paymentTiming !== '후불')
    || (maturity !== '반납형' && maturity !== '인수형')) return null;
  const kind = contractKindFor(template, maturity);
  if (kind.buyoutPriceRequired && buyoutPrice == null) return null;
  return {
    id: offerId, providerCompanyCode, policyCode, templateId: template.id,
    agentChannelCode: safeId(row.agent_channel_code), productType, customerType,
    rentMonths, rentAmount, depositAmount, annualMileage, driverAge,
    paymentTiming, depositInstallment: S(row.deposit_installment) || '일시납',
    maturity, buyoutPrice, specialTerms: S(row.special_terms) || '없음',
  };
}
