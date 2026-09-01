import type { EntityRecord } from '@/lib/intake/entities';
import { parseMoneyOrRate } from './policy-money-rate';
import { canIssueContract } from '@/lib/domain/policy-tier';
import { contractDriverAgeOptions, contractMileageOptions, contractRentForTerms } from '@/lib/domain/esign-vehicle-selection';

export type EsignContractSource = 'erp' | 'excel' | 'direct';
/**
 * 계약서관리 화면의 단계 축 — 목록 뱃지·상단 스테퍼·필터 칩·이력이 전부 이 이름을 쓴다(정본 docs/ESIGN_SEND_CENTER_REDESIGN_2026-08-19.md §2-1).
 *   작성        저장 전 초안(목록엔 없음)
 *   발송 전     저장됨 · 미발송 또는 발행(고객이 아직 안 엶)
 *   고객 작성 중 열람·진행중 · 보완 요청 뒤 재작성 포함
 *   검토 대기   고객 제출 → 관리자 승인/보완 요청 대기
 *   완료        승인·봉인
 */
export type EsignCenterStage = '작성' | '발송 전' | '고객 작성 중' | '검토 대기' | '완료';
export const ESIGN_CENTER_STAGES: readonly EsignCenterStage[] = ['작성', '발송 전', '고객 작성 중', '검토 대기', '완료'];
/** 단계와 섞지 않는 플래그 — 목록엔 뱃지 옆 표시, 작업면엔 카드 하나. */
export type EsignCenterFlags = { attention: boolean; expired: boolean; revoked: boolean; rejected: boolean };
export type EsignCenterQueueFilter = 'all' | 'attention' | Exclude<EsignCenterStage, '작성'>;
export type EsignCheckLevel = 'PASS' | 'WARNING' | 'BLOCK';

export type EsignCheck = {
  key: string;
  label: string;
  level: EsignCheckLevel;
  message: string;
};

const S = (value: unknown) => String(value ?? '').trim();
const N = (value: unknown) => Number(value || 0) || 0;

function policyRate(value: unknown): number | null {
  const text = S(value).replace(/,/g, '');
  if (!text) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const raw = Number(match[0]);
  if (!Number.isFinite(raw)) return null;
  if (text.includes('%') || Math.abs(raw) > 1) return raw / 100;
  return raw;
}

function policyMoney(value: unknown): number | null {
  const text = S(value).replace(/,/g, '');
  if (!text) return null;
  const sign = text.trim().startsWith('-') ? -1 : 1;
  const unsigned = text.replace(/^-\s*/, '');
  let amount = 0;
  let matched = false;
  const eok = unsigned.match(/(\d+(?:\.\d+)?)\s*억/);
  const man = unsigned.match(/(\d+(?:\.\d+)?)\s*만/);
  if (eok) { amount += Number(eok[1]) * 100_000_000; matched = true; }
  if (man) { amount += Number(man[1]) * 10_000; matched = true; }
  if (!matched) {
    const plain = unsigned.match(/\d+(?:\.\d+)?/);
    if (!plain) return null;
    amount = Number(plain[0]);
  }
  return Number.isFinite(amount) ? sign * amount : null;
}

/** A4 추가 운전자 표는 3자리이며 실제 등록 가능 수는 공급사 정책을 넘을 수 없다. */
/**
 * 보증금 납부 방식 선택지 — **정책은 「가능 여부·최대 회차」, 계약서엔 «이 계약은 몇 회»가 굳어 나간다**(사장님 2026-08-19).
 *   불가 → 일시납만 · 「N회까지」 → 일시납 + 2~N회 분납 · 가능/협의/빈칸 → 일시납·2회·3회.
 * 보증금이 0원이면 「무보증」 하나(선택 없음).
 */
export const DEPOSIT_INSTALLMENT_NONE = '무보증';
export function depositInstallmentOptions(policy: Record<string, unknown> | null | undefined, depositAmount: unknown): string[] {
  if (N(depositAmount) <= 0) return [DEPOSIT_INSTALLMENT_NONE];
  const raw = S(policy?.deposit_installment);
  if (/불가|없음|미운영/.test(raw)) return ['일시납'];
  const max = Number(raw.match(/(\d+)\s*회/)?.[1] || 0);
  const upto = max >= 2 ? Math.min(max, 6) : 3;
  const options = ['일시납'];
  for (let n = 2; n <= upto; n += 1) options.push(`${n}회 분납`);
  return options;
}

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

export function esignProductAvailabilityBlocker(
  contract: Record<string, unknown> | null | undefined,
  product: Record<string, unknown> | null | undefined,
): EsignCheck | null {
  const row = contract || {};
  const productCode = S(row.product_code);
  if (!productCode) return null;
  if (!product) {
    return { key: 'vehicle_record', label: 'ERP 차량', level: 'BLOCK', message: '연결된 ERP 차량을 찾을 수 없습니다' };
  }
  if (S(product.provider_company_code) !== S(row.provider_company_code)) {
    return { key: 'vehicle_provider', label: 'ERP 차량', level: 'BLOCK', message: '선택한 공급사의 차량이 아닙니다' };
  }
  const status = S(product.vehicle_status).replace(/\s/g, '');
  const owner = S(product.locked_by_contract);
  const ownLock = !!S(row.contract_code) && owner === S(row.contract_code);
  // ★즉시출고도 출고가능과 같은 가용 재고다(`isContractAvailableVehicle` 과 같은 규칙) —
  //   차량 목록엔 뜨는데 발송 게이트가 막던 것을 2026-08-20 실측에서 잡았다(즉시출고 5대).
  if (status !== '출고가능' && status !== '즉시출고' && !ownLock) {
    return { key: 'vehicle_availability', label: 'ERP 차량', level: 'BLOCK', message: '차량이 더 이상 출고가능 상태가 아닙니다' };
  }
  return null;
}

export function isIndependentEsignSource(contract: Record<string, unknown> | null | undefined): boolean {
  const source = esignContractSource(contract);
  return source === 'excel' || source === 'direct';
}

export function validateEsignCenterContract(
  contract: Record<string, unknown> | null | undefined,
  partner?: Record<string, unknown> | null,
  policy?: Record<string, unknown> | null,
  product?: Record<string, unknown> | null,
): EsignCheck[] {
  const row = contract || {};
  const checks: EsignCheck[] = [];
  const policyIssueGate = policy ? canIssueContract(policy, partner) : null;
  const customerCompletesInLink = esignContractSource(row) === 'direct';
  let contractDraft: Record<string, unknown> = {};
  try {
    const raw = typeof row.contract_draft === 'string' ? JSON.parse(row.contract_draft) : row.contract_draft;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) contractDraft = raw as Record<string, unknown>;
  } catch { /* 깨진 초안은 아래 빈 값 검증으로 처리한다. */ }
  const add = (key: string, label: string, level: EsignCheckLevel, message: string) => {
    checks.push({ key, label, level, message });
  };

  const vehicleAvailability = esignProductAvailabilityBlocker(row, product);
  if (vehicleAvailability) checks.push(vehicleAvailability);

  const hasGuarantor = [
    'guarantor_name', 'guarantor_rrn', 'guarantor_phone', 'guarantor_address',
    'guarantor_relation', 'guarantor_occupation', 'guarantee_limit', 'guarantee_period',
  ].some((key) => S(row[key] || contractDraft[key]));
  if (hasGuarantor) {
    add(
      'guarantor_separate',
      '연대보증',
      'BLOCK',
      '연대보증은 주계약 전자서명에 포함하지 않고 별도 연대보증 약정으로 체결해 주세요',
    );
  }

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

  const rentAmount = Number(row.rent_amount_snapshot);
  if (!Number.isFinite(rentAmount) || rentAmount <= 0) add('rent_amount', '월 대여료', 'BLOCK', '월 대여료 없음');
  else add('rent_amount', '월 대여료', 'PASS', '월 대여료 확인');

  const rentMonths = Number(row.rent_month_snapshot);
  if (!Number.isInteger(rentMonths) || rentMonths <= 0 || rentMonths > 120) {
    add('rent_month', '계약기간', 'BLOCK', '계약기간은 1~120개월의 정수로 입력해 주세요');
  }
  else add('rent_month', '계약기간', 'PASS', '계약기간 확인');

  const depositChoice = S(contractDraft.deposit_installment);
  /*
   * ★빈칸을 0 으로 삼키지 않는다(사장님 2026-08-21 「없으면 없는 걸로 입력해야 함」).
   *   빈칸은 «직원이 안 채웠다»로 읽히고, 0원은 «그렇게 합의했다»로 읽힌다.
   *   예전엔 `rawDeposit === '' ? 0` 이라 안 적어도 PASS 였고, 보증금 얘기가 없는 계약서가 나갔다.
   */
  const rawDeposit = row.deposit_amount_snapshot;
  if (rawDeposit == null || S(rawDeposit) === '') {
    add('deposit_amount', '보증금', 'BLOCK', '보증금을 입력해 주세요 — 없으면 0 이라고 적어 주세요');
  } else {
    const depositAmount = Number(rawDeposit);
    if (!Number.isFinite(depositAmount) || depositAmount < 0) {
      add('deposit_amount', '보증금', 'BLOCK', '보증금은 0원 이상으로 입력해 주세요');
    } else add('deposit_amount', '보증금', 'PASS', '보증금 확인');
  }
  if (isIndependentEsignSource(row)) {
    // 정책의 「N회까지」는 영업 말이다. 계약서엔 «이 계약은 일시납/N회»가 굳어야 한다 — 비면 빈칸 계약서가 나간다.
    if (N(rawDeposit) > 0 && !depositChoice) add('deposit_installment', '보증금 납부', 'BLOCK', '일시납 또는 분납 회차를 선택해 주세요');
    else if (N(rawDeposit) > 0 && !depositInstallmentOptions(policy, rawDeposit).includes(depositChoice)) {
      add('deposit_installment', '보증금 납부', 'BLOCK', `선택한 정책은 「${S(policy?.deposit_installment) || '분납 불가'}」입니다 — 회차를 다시 선택해 주세요`);
    } else add('deposit_installment', '보증금 납부', 'PASS', depositChoice || DEPOSIT_INSTALLMENT_NONE);
  }

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

  if (policy && S(policy.provider_company_code) === S(row.provider_company_code)) {
    // 사장님 2026-08-19 — 위약금은 정률(「30%」)·개월분(「월 대여료 2개월분」)·정액 겸용. 정률이면 0% 초과 100% 이하, 못 읽는 글자는 막는다.
    const penaltyBad = [policy.early_termination_rate_under1y, policy.early_termination_rate_over1y].some((v) => {
      const p = parseMoneyOrRate(v, { legacy: 'rate' });
      return p.kind === 'text' || (p.kind === 'rate' && (p.rate <= 0 || p.rate > 1));
    });
    if (penaltyBad) {
      add('early_termination_rate', '중도해지 위약금', 'BLOCK', '중도해지 위약금은 「30%」(잔여 대여료의) · 「월 대여료 2개월분」 · 「100만원」 중 하나로 적어 주세요');
    }
    const lateFee = policyRate(policy.late_fee_rate);
    if (lateFee != null && (lateFee <= 0 || lateFee > 1)) {
      add('late_fee_rate', '지연손해금율', 'BLOCK', '지연손해금율은 0% 초과 100% 이하로 입력해 주세요');
    }
    const companyInsurance = !/별도|개인/.test(S(policy.insurance_included));
    const ownDamageCovered = companyInsurance && !/미가입|없음/.test(S(policy.own_damage_compensation));
    if (ownDamageCovered) {
      const ratio = policyRate(policy.own_damage_repair_ratio);
      if (ratio != null && (ratio <= 0 || ratio > 1)) {
        add('own_damage_ratio', '자차 자기부담률', 'BLOCK', '자차 자기부담률은 0% 초과 100% 이하로 입력해 주세요');
      }
      const min = policyMoney(policy.own_damage_min_deductible);
      const max = policyMoney(policy.own_damage_max_deductible);
      if (min != null && max != null && (min < 0 || max < 0 || max < min)) {
        add('own_damage_deductible', '자차 면책금', 'BLOCK', '자차 최소·최대 면책금의 금액과 순서를 확인해 주세요');
      }
    }
  }

  // 기본 운전자 연령 자체가 정책 완성도에서 BLOCK이면, 계약에 남은 과거 연령값을
  // 다시 대조해 같은 원인을 두 번 경고하지 않는다. 정책을 보완하면 아래 대조가
  // 자동으로 다시 켜져 가격·면책 기준을 검증한다.
  const policyMissingBasicDriverAge = policyIssueGate?.missing.some((field) => field.key === 'basic_driver_age') === true;
  if (policy && !policyMissingBasicDriverAge) {
    const ageText = S(row.driver_age_snapshot || contractDraft.driver_age || policy.basic_driver_age);
    if (ageText) {
      const age = Number(ageText.match(/\d{2}/)?.[0] || 0);
      if (age < 21) add('driver_age', '운전자 연령', 'BLOCK', '만 21세 미만은 보험 운영 대상이 아닙니다');
      else if (!contractDriverAgeOptions(policy as EntityRecord).some((option) => option.age === age)) {
        add('driver_age', '운전자 연령', 'BLOCK', '선택한 운전자 연령이 이 정책의 허용 범위와 다릅니다');
      } else add('driver_age', '운전자 연령', 'PASS', ageText);
    }
  }

  // 독립 작성 계약은 가격근거 v1이 있어야 한다. 이 값이 없으면 RTDB를 직접 호출해
  // 임의의 월대여료를 넣은 뒤 발행 서버의 요율만 적용하는 우회가 가능하다.
  if (isIndependentEsignSource(row) && S(row.pricing_snapshot_version) !== 'v1') {
    add('pricing_snapshot_version', '대여료 산정', 'BLOCK', '기간·약정주행거리·연령 기준 가격근거가 없는 계약은 발행할 수 없습니다');
  }

  // v1 직접 전자계약은 기간·약정주행·연령이 금액을 결정한다. 생성 화면 밖에서
  // 숫자만 바꾼 계약이 봉인 PDF로 나가지 않도록 발행 전 같은 계산을 한 번 더 대조한다.
  if (S(row.pricing_snapshot_version) === 'v1') {
    const months = Number(row.rent_month_snapshot);
    const age = Number(S(row.driver_age_snapshot).match(/(\d{2})/)?.[1] || 0);
    // v1은 계약 레코드의 불변 snapshot만 정본이다. 수정 가능한 contract_draft를
    // fallback으로 쓰면 발행 직전에 조건을 바꿔도 봉인값처럼 보일 수 있다.
    const annualMileage = S(row.annual_mileage_snapshot);
    const priceVariantKey = S(row.price_variant_snapshot);
    const option = contractMileageOptions(product as EntityRecord | null, months, policy as EntityRecord | null)
      .find((item) => item.label === annualMileage && item.priceVariantKey === priceVariantKey);
    const calculated = contractRentForTerms(product as EntityRecord | null, months, policy as EntityRecord | null, age, option);
    if (!option || !calculated) {
      add('pricing_snapshot', '대여료 산정', 'BLOCK', '기간·약정주행거리의 가격근거를 다시 선택해 주세요');
    } else if (
      calculated.rent !== Number(row.rent_amount_snapshot)
      || calculated.deposit !== Number(row.deposit_amount_snapshot)
      || calculated.mileageSurcharge !== Number(row.mileage_surcharge_snapshot)
      || calculated.ageSurcharge !== Number(row.age_surcharge_snapshot)
    ) {
      add('pricing_snapshot', '대여료 산정', 'BLOCK', '기간·약정주행거리·연령 조건과 최종 대여료가 일치하지 않습니다');
    } else add('pricing_snapshot', '대여료 산정', 'PASS', '기간·주행거리·연령 기준 금액 확인');
    const specialTermsChoice = S(row.special_terms_choice_snapshot);
    const specialTerms = S(row.special_terms_snapshot);
    if (!['없음', '있음'].includes(specialTermsChoice)) {
      add('special_terms_choice', '특약 확인', 'BLOCK', '특약사항 없음 또는 있음 여부를 확인해 주세요');
    } else if (specialTermsChoice === '있음' && (!specialTerms || specialTerms === '없음')) {
      add('special_terms', '특약사항', 'BLOCK', '특약이 있다고 선택했으면 내용을 입력해 주세요');
    } else add('special_terms_choice', '특약 확인', 'PASS', specialTermsChoice);
  }

  const vehicleName = S(
    row.vehicle_name_snapshot || row.model_snapshot
    || product?.vehicle_name || product?.sub_model || product?.model || product?.car_name,
  );
  if (!vehicleName) add('vehicle', '차량', 'BLOCK', '차량명을 확인해 주세요');
  else add('vehicle', '차량', 'PASS', '차량 확인');
  /* 차량번호도 필수다. 다만 신차는 차량번호 없이 계약하므로 빈칸 대신 「미정」이라고
     적으면 통과시킨다 — 안 그러면 신차 계약을 아예 못 보낸다. */
  const plate = S(row.car_number_snapshot || row.car_number);
  if (!plate) add('car_number', '차량번호', 'BLOCK', '차량번호를 입력해 주세요 — 신차라 아직 없으면 「미정」이라고 적어 주세요');
  else add('car_number', '차량번호', 'PASS', '차량번호 확인');

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
  // 추가운전 요금 — 정액(「5만원」)·정률(「대여료의 5%」)·무료 중 하나로 굳어 있어야 계약서에 실린다. 협의·빈칸·못 읽는 글자는 막는다.
  const additionalDriverKind = parseMoneyOrRate(policy?.additional_driver_cost, { legacy: 'won' }).kind;
  if (additionalDriverLimit > 0 && (additionalDriverKind === 'empty' || additionalDriverKind === 'consult' || additionalDriverKind === 'text')) {
    add('additional_driver_cost', '추가 운전자 요금', 'BLOCK', '추가 운전자 1인당 월 요금을 「5만원」·「대여료의 5%」·무료 중 하나로 확정해 주세요');
  }
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

  if (S(row.provider_company_code)) for (const check of esignPartnerChecks(partner)) checks.push(check);

  return checks;
}

/**
 * 공급사(임대인) 정보만 따로 본다 — **계약을 만들기 전에도** 물어볼 수 있어야 한다(사장님 2026-08-20
 * 「전자계약 돌릴 거면 거기서 뭐 없어서 안 된다 이런 표시 해주지?」). 회사만 골라도 이 값들은 이미 정해져 있다.
 * ⚠ 계약 검증(validateEsignCenterContract)도 이 함수를 쓴다 — 같은 이유를 두 곳에 적지 않는다.
 */
export function esignPartnerChecks(partner?: Record<string, unknown> | null): EsignCheck[] {
  const out: EsignCheck[] = [];
  const put = (key: string, label: string, level: EsignCheckLevel, message: string) => out.push({ key, label, level, message });
  if (!partner) { put('partner_profile', '업체 고정값', 'WARNING', '업체 고정값을 찾지 못했습니다'); return out; }
  if (!S(partner.name || partner.partner_name)) put('company_name', '임대인 상호', 'BLOCK', '임대인 상호 없음');
  if (!S(partner.business_number || partner.business_no)) put('company_biz_no', '사업자등록번호', 'BLOCK', '사업자등록번호 없음');
  if (!S(partner.ceo || partner.ceo_name)) put('company_ceo', '대표자', 'BLOCK', '업체 대표자 없음');
  if (!S(partner.address)) put('company_address', '업체 주소', 'BLOCK', '업체 주소 없음');
  // 자동차대여사업 등록번호는 묻지 않는다(사장님 2026-08-19 「대여사업등록정보까지는 필요없을 거 같음」) — 있으면 계약서에 싣고, 없어도 막지 않는다.
  if (!S(partner.bank_name)) put('payment_bank', '입금은행', 'WARNING', '업체 입금은행 없음');
  if (!S(partner.bank_account)) put('payment_account_no', '입금계좌', 'WARNING', '업체 입금계좌 없음');
  if (!S(partner.bank_holder || partner.name || partner.partner_name)) put('payment_account_holder', '예금주', 'WARNING', '업체 예금주 없음');
  return out;
}

export function esignBlockingChecks(
  contract: Record<string, unknown> | null | undefined,
  partner?: Record<string, unknown> | null,
  policy?: Record<string, unknown> | null,
  product?: Record<string, unknown> | null,
): EsignCheck[] {
  return validateEsignCenterContract(contract, partner, policy, product).filter((check) => check.level === 'BLOCK');
}

/** 서버 발송 게이트도 화면과 같은 판정기를 사용한다. ERP만 기존 약정 단계가 선행조건이다. */
export function esignIssueBlockers(
  contract: Record<string, unknown> | null | undefined,
  partner?: Record<string, unknown> | null,
  policy?: Record<string, unknown> | null,
  product?: Record<string, unknown> | null,
): EsignCheck[] {
  const row = contract || {};
  const blocked = esignBlockingChecks(row, partner, policy, product);
  if (isIndependentEsignSource(row)) return blocked;
  if (S(row.provider_agreement_done) !== 'yes') {
    blocked.push({ key: 'erp_agreement', label: 'ERP 약정', level: 'BLOCK', message: '계약 진행중에서 약정 작성을 먼저 완료해 주세요.' });
  }
  return blocked;
}

/** 단계 판정 — 서버 상태(sign_status·세션 status)와 1:1. 끝난 것부터 본다. */
export function esignCenterStage(contract: Record<string, unknown> | null | undefined, sessionStatus = ''): EsignCenterStage {
  const row = contract || {};
  const status = S(row.sign_status);
  if (status === '서명완료' || sessionStatus === 'signed') return '완료';
  if (status === '검토대기' || ['pending_review', 'approving', 'rejecting'].includes(sessionStatus)) return '검토 대기';
  if (['열람', '진행중', '반려'].includes(status) || sessionStatus === 'opened') return '고객 작성 중';
  return '발송 전';
}

/** 플래그 판정 — 단계가 아니다. 완료된 계약엔 붙지 않는다. */
export function esignCenterFlags(
  contract: Record<string, unknown> | null | undefined,
  checks: EsignCheck[] = [],
  now = Date.now(),
  sessionExpiresAt = 0,
): EsignCenterFlags {
  const row = contract || {};
  const status = S(row.sign_status);
  const done = status === '서명완료';
  const revoked = !done && N(row.sign_revoked_at) > 0;
  const expiresAt = sessionExpiresAt || N(row.sign_expires_at);
  const expired = !done && !revoked
    && ['발행', '열람', '진행중', '반려'].includes(status)
    && expiresAt > 0 && expiresAt <= now;
  return {
    // 완료된 계약엔 붙지 않는다 — 봉인 뒤 차량 상태가 바뀌어도 그 계약의 문제가 아니다.
    attention: !done && checks.some((check) => check.level === 'BLOCK'),
    expired,
    revoked,
    rejected: !done && status === '반려',
  };
}

export function esignCenterFlagLabel(flags: EsignCenterFlags): string {
  if (flags.revoked) return '해지';
  if (flags.expired) return '만료';
  if (flags.rejected) return '보완 요청됨';
  if (flags.attention) return '확인 필요';
  return '';
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
  /** 계약서 02 「차량가액」 — 재고의 vehicle_price(관리자 전용 원가)와 다른 값이다.
   *  신차는 출고가, 중고는 취득가액. 지금은 영업이 직접 넣고, 신차견적기와 붙으면 그때 자동으로 받는다. */
  vehiclePrice?: string;
  /** 계약서 02 「비고」 — 차에만 붙는 특이사항 한 줄. */
  vehicleRemark?: string;
  colorExterior?: string;
  currentMileage?: string;
  rentMonths: string;
  rentAmount: string;
  depositAmount: string;
  paymentTiming: '선불' | '후불' | '';
  paymentDueDate?: string;
  depositInstallment?: string;
  annualMileage?: string;
  priceVariantKey?: string;
  mileageSurcharge?: number;
  ageSurcharge?: number;
  buyoutPrice?: string;
  driverAge?: string;
  driverScope?: string;
  maintenanceProduct?: string;
  maintenanceExclusions?: string;
  insuranceDeductible?: string;
  insuranceCoverage?: string;
  overMileageRate?: string;
  earlyTerminationTerms?: string;
  returnDeliveryFee?: string;
  serviceItems?: string;
  emergencyContact?: string;
  emergencyRelation?: string;
  specialTerms?: string;
  specialTermsChoice?: '없음' | '있음' | '';
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
    vehiclePrice: '',
    vehicleRemark: '',
    colorExterior: '',
    currentMileage: '',
    rentMonths: '',
    rentAmount: '',
    depositAmount: '0',
    paymentTiming: '',
    paymentDueDate: '',
    depositInstallment: '',
    annualMileage: '',
    priceVariantKey: '',
    mileageSurcharge: 0,
    ageSurcharge: 0,
    buyoutPrice: '',
    driverAge: '',
    driverScope: '',
    maintenanceProduct: '',
    maintenanceExclusions: '',
    insuranceDeductible: '',
    insuranceCoverage: '',
    overMileageRate: '',
    earlyTerminationTerms: '',
    returnDeliveryFee: '',
    serviceItems: '',
    emergencyContact: '',
    emergencyRelation: '',
    specialTerms: '',
    specialTermsChoice: '',
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
    annual_mileage_snapshot: S(form.annualMileage),
    price_variant_snapshot: S(form.priceVariantKey),
    mileage_surcharge_snapshot: Number(form.mileageSurcharge) || 0,
    age_surcharge_snapshot: Number(form.ageSurcharge) || 0,
    pricing_snapshot_version: 'v1',
    special_terms_choice_snapshot: S(form.specialTermsChoice),
    special_terms_snapshot: form.specialTermsChoice === '없음' ? '없음' : S(form.specialTerms),
    payment_timing_snapshot: form.paymentTiming,
    auto_debit_date: form.paymentDueDate,
    emergency_contact: form.emergencyContact,
    emergency_relation: form.emergencyRelation,
    additional_driver: additionalDriverCount ? `${additionalDriverCount}인 지정` : '없음',
    /**
     * ★검증기는 «이 계약에서 고른 값»을 계약 레코드와 같은 자리(contract_draft)에서 읽는다.
     *   저장 전 초안에도 저장 때와 **같은 모양**으로 실어 준다 — 안 그러면 화면에서 고른 보증금 납부 회차를
     *   검증기가 못 봐서 보증금 있는 계약이 영원히 「일시납 또는 분납 회차를 선택해 주세요」로 막힌다(2026-08-20 실측).
     */
    contract_draft: JSON.stringify(draftTemplateFields(form)),
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
    contract_vehicle_price: S(form.vehiclePrice),
    vehicle_remark: S(form.vehicleRemark),
    color_exterior: S(form.colorExterior),
    odometer_delivery: S(form.currentMileage),
    auto_debit_date: S(form.paymentDueDate),
    payment_timing: S(form.paymentTiming),
    deposit_installment: S(form.depositInstallment),
    annual_mileage: S(form.annualMileage),
    price_variant_snapshot: S(form.priceVariantKey),
    mileage_surcharge_snapshot: String(Number(form.mileageSurcharge) || 0),
    age_surcharge_snapshot: String(Number(form.ageSurcharge) || 0),
    buyback_price: S(form.buyoutPrice),
    driver_age: S(form.driverAge),
    driver_scope: S(form.driverScope),
    maintenance_product: S(form.maintenanceProduct),
    emergency_contact: [S(form.emergencyRelation), S(form.emergencyContact)].filter(Boolean).join(' · '),
    emergency_relation: S(form.emergencyRelation),
    special_terms: form.specialTermsChoice === '없음' ? '없음' : S(form.specialTerms),
    special_terms_choice: S(form.specialTermsChoice),
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
