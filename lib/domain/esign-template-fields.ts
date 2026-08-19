/**
 * 착한거래 A4 `templateFields` 조립.
 *
 * 외부(계약·정책·파트너·재고)에서 온 값 + `contract_draft`/직접 입력 덮어쓰기
 * → 같은 data-field 키로 `POST /issue` 에 실는다.
 *
 * 틀(HTML)은 착한거래 정본. 여기서는 칸 값만 만든다.
 */
import { vehicleNameOf } from '@/lib/domain/vehicle-name';
import { businessRegistrationNumberOf } from '@/lib/domain/business-identity';
import { parseDraft, type ContractPayload } from '@/lib/domain/contract-send';
import { FIELD_MAP, type AtomSource } from '@/lib/domain/esign-field-map';
import { overMileageRateFor, policyNumber } from '@/lib/domain/policy-defaults';
import { canonProductType } from '@/lib/domain/product';
import { handoverStartOf, rentalPeriodEnd, rentalPeriodText } from '@/lib/domain/rental-period';
import { additionalDriverCostLabel } from '@/lib/domain/esign-vehicle-selection';
import { moneyOrRateText } from '@/lib/domain/policy-money-rate';

type Row = Record<string, unknown>;

const text = (value: unknown): string => String(value ?? '').trim();

function moneyCell(n: unknown): string {
  const v = Number(n) || 0;
  return v ? v.toLocaleString() : '';
}

function percentageCell(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  const parsed = Number(raw.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(parsed)) return '';
  const percent = Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
  return Number.isInteger(percent) ? String(percent) : String(Number(percent.toFixed(2)));
}

function dailyMoneyCell(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  if (/1\s*일|일당|\/\s*일/.test(raw)) return raw;
  const parsed = Number(raw.replace(/[^\d.-]/g, ''));
  if (Number.isFinite(parsed) && parsed > 0) return `1일 ${parsed.toLocaleString()}원`;
  return `1일 ${raw}`;
}

/** 보험 면책금처럼 작은 표 칸에서는 300,000원보다 30만원이 빠르게 읽힌다. */
function manwonText(value: unknown): string {
  const raw = text(value);
  if (!raw || /만원/.test(raw)) return raw;
  const won = Number(raw.replace(/[^\d.-]/g, '')) || 0;
  return won >= 10_000 && won % 10_000 === 0 ? `${(won / 10_000).toLocaleString()}만원` : raw;
}

function priceText(price: unknown): string {
  if (!price || typeof price !== 'object') return '';
  const entries = Object.entries(price as Record<string, { rent?: number }>);
  if (!entries.length) return '';
  const sorted = entries
    .map(([k, v]) => ({ m: Number(k) || Number(String(k).split('_')[0]) || 0, rent: Number(v?.rent) || 0 }))
    .filter((x) => x.m && x.rent)
    .sort((a, b) => a.m - b.m);
  if (!sorted.length) return '';
  return sorted.map((x) => `${x.m}개월 ${x.rent.toLocaleString()}`).join(' / ');
}

/** 관리자가 직접 보완할 수 있는 출처(고정·표기·본인확인 제외). */
export const DIRECT_EDIT_SOURCES: ReadonlySet<AtomSource> = new Set([
  '계약', '재고', '정책', '파트너', '입력', '파생', '미정',
]);

export function isDirectEditableField(from: AtomSource | string | null | undefined): boolean {
  return DIRECT_EDIT_SOURCES.has(String(from || '') as AtomSource);
}

/**
 * 계약·정책·파트너·(선택)상품 → data-field 맵.
 * `overrides` / `contract_draft` 가 비어 있지 않은 키로 덮어쓴다.
 */
export function buildTemplateFieldsFromRecords(args: {
  contract: Row;
  policy?: Row | null;
  partner?: Row | null;
  product?: Row | null;
  /** 요청·화면에서 온 직접 입력 */
  overrides?: Record<string, string> | null;
}): { fields: ContractPayload; state: { co?: string; ins?: string } } {
  const contract = args.contract || {};
  const product = args.product || null;
  const pol = args.policy || {};
  const partner = args.partner || null;

  const car = text(contract.car_number_snapshot || contract.car_number);
  const provName = text(partner?.name || partner?.partner_name);
  let coKey = 'sonogong';
  const companyInject: ContractPayload = {};
  if (/손오공/.test(provName)) coKey = 'sonogong';
  else if (/스위치/.test(provName)) coKey = 'switchplan';
  else if (partner) {
    coKey = 'auto';
    companyInject.company_name = text(partner.name || partner.partner_name || partner.company_name || provName);
    companyInject.company_ceo = text(partner.ceo || partner.ceo_name);
    companyInject.company_ceo_title = '대표';
    companyInject.company_biz_no = businessRegistrationNumberOf(partner, 'partner');
    companyInject.company_phone = text(partner.phone || partner.tel);
    companyInject.company_address = text(partner.address || partner.company_address || partner.business_address);
    companyInject.rental_business_no = text(partner.rental_business_no || partner.rental_registration_no);
    companyInject.payment_bank = text(partner.bank_name);
    companyInject.payment_account_no = text(partner.bank_account);
    companyInject.payment_account_holder = text(partner.bank_holder || partner.name || partner.partner_name);
  }

  const ins = /별도|개인|고객직접/.test(text(pol.insurance_included || args.overrides?.ins))
    ? '별도'
    : '포함';
  const months = Number(contract.rent_month_snapshot) || 0;
  const contractDate = text(contract.contract_date);
  const start = handoverStartOf(contract);
  const yr = text(contract.year_snapshot || product?.year || product?.model_year);
  const maker = text(contract.maker_snapshot || product?.maker || product?.manufacturer);
  const overMileageRate = overMileageRateFor(pol, maker);

  const base: ContractPayload = {
    co: coKey,
    ins,
    ...companyInject,
    // 계약서에 보이는 번호와 내부 RTDB 키를 분리한다. 기존 계약은 contract_code로 호환.
    contract_code: text(contract.contract_number || contract.contract_code),
    contract_date: contractDate,
    car_number: car || text(product?.car_number) || '차량번호 미정',
    vehicle_name: vehicleNameOf(
      { kind: 'contract', contract: contract as never, product: product as never },
      { tier: 'full', fallback: 'none' },
    ),
    fuel: text(contract.fuel_type_snapshot || product?.fuel_type),
    model_year: yr ? (/년식/.test(yr) ? yr : `${yr}년식`) : '',
    options: Array.isArray(product?.options)
      ? (product!.options as string[]).join(', ')
      : text(product?.options),
    vehicle_price: product ? priceText(product.price) : '',
    vin: text(product?.vin),
    color_exterior: text(product?.ext_color),
    color_interior: text(product?.int_color),
    odometer_delivery: text(product?.mileage),
    vehicle_classification: canonProductType(product?.product_type),
    customer_name: text(contract.customer_name),
    customer_phone: text(contract.customer_phone),
    customer_address: text(contract.customer_address),
    customer_birth: text(contract.customer_birth || contract.birth),
    rent_amount: moneyCell(contract.rent_amount_snapshot),
    deposit_amount: moneyCell(contract.deposit_amount_snapshot),
    rent_month: rentalPeriodText(months),
    contract_start: start || '차량 인도 시 확정',
    contract_end: start ? rentalPeriodEnd(start, months) : '차량 인도일 기준 산정',
    delivery_location: text(contract.delivery_address),
    deposit_installment: text(contract.deposit_payment_type || pol.deposit_installment),
    payment_cycle: text(pol.payment_cycle) || '월납',
    payment_timing: text(contract.payment_timing_snapshot || pol.payment_timing) || '선불',
    payment_method: text(pol.payment_method) || 'CMS 자동이체',
    auto_debit_date: text(contract.auto_debit_day || pol.payment_due_date || pol.auto_debit_day),
    invoice_type: text(pol.invoice_type) || '세금계산서',
    invoice_cycle: text(pol.invoice_cycle) || '월 1회',
    driver_scope: text(contract.driver_scope || pol.personal_driver_scope || pol.driver_scope),
    driver_age: text(contract.driver_age_snapshot || pol.basic_driver_age),
    additional_driver_cost: additionalDriverCostLabel(pol.additional_driver_cost),
    annual_mileage: text(pol.annual_mileage),
    over_mileage_rate: overMileageRate ? `1km당 ${overMileageRate.toLocaleString()}원` : '',
    accident_termination_count: text(pol.accident_termination_count),
    maintenance_product: text(pol.maintenance_service),
    maintenance_replacement: text(pol.replacement_car_policy) || '미제공',
    designated_garage: text(pol.designated_garage) || '회사 지정 또는 사전 승인 정비공장',
    replacement_car_policy: text(pol.replacement_car_policy) || '미제공',
    coverage_liability_person: text(pol.injury_compensation_limit),
    coverage_liability_property: text(pol.property_compensation_limit),
    coverage_self_injury: text(pol.self_body_accident),
    coverage_uninsured: text(pol.uninsured_damage),
    self_damage_coverage: text(pol.own_damage_compensation),
    emergency_dispatch_limit: text(pol.annual_roadside_assistance),
    deductible_liability_person: manwonText(pol.injury_deductible),
    deductible_liability_property: manwonText(pol.property_deductible),
    self_damage_deductible_rate: text(pol.own_damage_repair_ratio),
    self_damage_deductible_min: text(pol.own_damage_min_deductible),
    self_damage_deductible_max: text(pol.own_damage_max_deductible),
    late_fee_rate: Number(pol.late_fee_rate) > 0
      ? `연 ${(Number(pol.late_fee_rate) * (Number(pol.late_fee_rate) <= 1 ? 100 : 1)).toLocaleString()}%`
      : '',
    succession_allowed: text(pol.succession_allowed),
    // 사장님 2026-08-19 — 정액·정률·개월분 겸용. 「30%」→「잔여 대여료의 30%」 · 「월 대여료 2개월분」 · 「100만원」 · 옛 0.3/1000000 도 읽는다.
    succession_fee: moneyOrRateText(pol.succession_fee, { legacy: 'won', wonStyle: 'comma', naText: '승계 불가', noneText: '없음' }),
    early_termination_rate_y1: moneyOrRateText(pol.early_termination_rate_under1y, { legacy: 'rate', rateBase: '잔여 대여료의', wonStyle: 'comma' }),
    early_termination_rate_y2: moneyOrRateText(pol.early_termination_rate_over1y, { legacy: 'rate', rateBase: '잔여 대여료의', wonStyle: 'comma' }),
    // 시트 규격 글자(「7일」「3일」「10일」)에서 숫자만 — 계약서 문장이 「연체 3일째」로 이어진다.
    deposit_return_term: (policyNumber(pol.deposit_return_days) ?? 0) > 0
      ? `반납·정산 후 ${(policyNumber(pol.deposit_return_days) as number).toLocaleString()}일 이내`
      : '',
    engine_control_overdue_days: policyNumber(pol.engine_control_overdue_days) != null ? String(policyNumber(pol.engine_control_overdue_days)) : text(pol.engine_control_overdue_days),
    auto_terminate_overdue_days: policyNumber(pol.auto_terminate_overdue_days) != null ? String(policyNumber(pol.auto_terminate_overdue_days)) : text(pol.auto_terminate_overdue_days),
    deposit_overdue_rounds: text(pol.deposit_overdue_rounds),
    claim_basis: text(pol.claim_basis),
    impound_keep_term: Number(pol.impound_keep_days) > 0
      ? `반환 통지 후 ${Number(pol.impound_keep_days).toLocaleString()}일`
      : '',
    impound_fee: dailyMoneyCell(pol.impound_fee ?? pol.impound_fee_per_day),
    gps_installed: text(pol.gps_installed),
    buyback_price: moneyCell(contract.buyout_price),
    insurance_condition: ins === '포함' ? '회사 포함' : '고객 별도',
  };

  const draft = parseDraft(contract.contract_draft);
  const overrides: ContractPayload = {};
  for (const [k, v] of Object.entries(args.overrides || {})) {
    if (v != null && String(v).trim() !== '') overrides[k] = String(v).trim();
  }

  const fields: ContractPayload = {
    ...base,
    ...draft,
    ...overrides,
    // 식별 정본은 계약 레코드가 이긴다(초안이 되돌리지 못함).
    contract_code: base.contract_code || draft.contract_code || overrides.contract_code || '',
    car_number: base.car_number || draft.car_number || overrides.car_number || '',
    rent_month: base.rent_month,
    contract_start: base.contract_start,
    contract_end: base.contract_end,
  };
  if (overrides.car_number) fields.car_number = overrides.car_number;
  if (overrides.vehicle_name) fields.vehicle_name = overrides.vehicle_name;
  if (overrides.fuel) fields.fuel = overrides.fuel;
  if (overrides.model_year) fields.model_year = overrides.model_year;

  return {
    fields,
    state: {
      co: fields.co || coKey,
      ins: fields.ins || ins,
    },
  };
}

/** 직접 입력 UI용 — 라벨·출처와 현재 값. */
export function templateFieldRowsForEdit(
  fields: ContractPayload,
  opts?: { onlyEmpty?: boolean },
): { field: string; label: string; from: AtomSource; value: string }[] {
  const rows = FIELD_MAP
    .filter((f) => isDirectEditableField(f.from) && !['rent_month', 'contract_start', 'contract_end'].includes(f.field))
    .map((f) => ({
      field: f.field,
      label: f.label,
      from: f.from,
      value: text(fields[f.field]),
    }));
  if (opts?.onlyEmpty) return rows.filter((r) => !r.value);
  return rows;
}
