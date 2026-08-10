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

type Row = Record<string, unknown>;

const text = (value: unknown): string => String(value ?? '').trim();

function moneyCell(n: unknown): string {
  const v = Number(n) || 0;
  return v ? v.toLocaleString() : '';
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

function addMonthsEnd(start: string, months: number): string {
  if (!start || !months) return '';
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
    companyInject.payment_bank = text(partner.bank_name);
    companyInject.payment_account_no = text(partner.bank_account);
    companyInject.payment_account_holder = text(partner.bank_holder || partner.name || partner.partner_name);
  }

  const ins = /별도|개인|고객직접/.test(text(pol.insurance_included || args.overrides?.ins))
    ? '별도'
    : '포함';
  const months = Number(contract.rent_month_snapshot) || 0;
  const start = text(contract.contract_date);
  const yr = text(contract.year_snapshot || product?.year || product?.model_year);

  const base: ContractPayload = {
    co: coKey,
    ins,
    ...companyInject,
    contract_code: text(contract.contract_code),
    contract_date: start,
    car_number: car || text(product?.car_number),
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
    customer_name: text(contract.customer_name),
    customer_phone: text(contract.customer_phone),
    customer_address: text(contract.customer_address),
    customer_birth: text(contract.customer_birth || contract.birth),
    rent_amount: moneyCell(contract.rent_amount_snapshot),
    deposit_amount: moneyCell(contract.deposit_amount_snapshot),
    rent_month: months ? `${months} 개월` : '',
    contract_start: start,
    contract_end: addMonthsEnd(start, months),
    delivery_location: text(contract.delivery_address),
    deposit_installment: text(contract.deposit_payment_type || pol.deposit_installment),
    driver_age: text(pol.basic_driver_age),
    annual_mileage: text(pol.annual_mileage),
    over_mileage_rate: text(pol.over_mileage_rate_per_km),
    accident_termination_count: text(pol.accident_termination_count),
    maintenance_product: text(pol.maintenance_service),
    coverage_liability_person: text(pol.injury_compensation_limit),
    coverage_liability_property: text(pol.property_compensation_limit),
    coverage_self_injury: text(pol.self_body_accident),
    coverage_uninsured: text(pol.uninsured_damage),
    self_damage_coverage: text(pol.own_damage_compensation),
    emergency_dispatch_limit: text(pol.annual_roadside_assistance),
    deductible_liability_person: text(pol.injury_deductible),
    deductible_liability_property: text(pol.property_deductible),
    self_damage_deductible_rate: text(pol.own_damage_repair_ratio),
    self_damage_deductible_min: text(pol.own_damage_min_deductible),
    self_damage_deductible_max: text(pol.own_damage_max_deductible),
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
    .filter((f) => isDirectEditableField(f.from))
    .map((f) => ({
      field: f.field,
      label: f.label,
      from: f.from,
      value: text(fields[f.field]),
    }));
  if (opts?.onlyEmpty) return rows.filter((r) => !r.value);
  return rows;
}
