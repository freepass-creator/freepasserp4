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
import { findContractKind } from '@/lib/domain/esign-contract-kind';
import { isExactRealPlate, TEMP_PLATE_RE } from '@/lib/domain/product';

type Row = Record<string, unknown>;

/** HTML의 상품·보험·당사자 상태는 계약 본문과 같은 봉인값이어야 한다. */
export const TEMPLATE_SEMANTIC_STATE_KEYS = ['co', 'pd', 'ins', 'ct', 'car', 'tax'] as const;
export type TemplateSemanticStateKey = typeof TEMPLATE_SEMANTIC_STATE_KEYS[number];
export type FrozenTemplateState = {
  co: 'auto';
  pd: '구독인수형' | '구독선택형' | '렌트인수형' | '렌트선택형';
  ins: '포함' | '별도';
  ct: '개인' | '법인';
  car: '신차' | '등록완료';
  tax: '개인' | '사업자';
};

export function isFrozenTemplateState(value: unknown): value is FrozenTemplateState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return state.co === 'auto'
    && ['구독인수형', '구독선택형', '렌트인수형', '렌트선택형'].includes(String(state.pd))
    && ['포함', '별도'].includes(String(state.ins))
    && ['개인', '법인'].includes(String(state.ct))
    && ['신차', '등록완료'].includes(String(state.car))
    && ['개인', '사업자'].includes(String(state.tax));
}

const text = (value: unknown): string => String(value ?? '').trim();

/**
 * 사고 누적 해지 횟수는 숫자만 두면 “두 번이면 해지인가?”처럼 읽히기 쉽다.
 * 계약서 표에는 현재 사고를 포함한 최근 1년의 총 횟수를 문장으로 고정해 보여 준다.
 */
function accidentTerminationText(value: unknown): string {
  const raw = text(value);
  if (!raw || raw === '없음') return raw || '해당 없음';
  const count = raw.match(/\d+/)?.[0];
  return count
    ? `각 사고 발생일 기준 직전 1년 내 과실 50% 이상 사고 총 ${count}회 (현재 사고 포함)`
    : raw;
}

function productStateOf(contract: Row, product: Row | null | undefined): FrozenTemplateState['pd'] {
  const spec = findContractKind(text(contract.esign_contract_kind || contract.contract_kind));
  if (spec) {
    if (spec.kind === '구독') return spec.maturity === '인수형' ? '구독인수형' : '구독선택형';
    return spec.maturity === '인수형' ? '렌트인수형' : '렌트선택형';
  }
  return /구독/.test(text(product?.product_type || contract.product_type)) ? '구독선택형' : '렌트선택형';
}

function customerStateOf(contract: Row): Pick<FrozenTemplateState, 'ct' | 'tax'> {
  // customer_is_business만으로는 개인사업자와 법인을 구분할 수 없다. 정본 customer_type만 사용한다.
  const type = text(contract.customer_type || contract.contract_customer_type || contract.customer_type_snapshot);
  if (type === '법인') return { ct: '법인', tax: '개인' };
  if (type === '개인사업자') return { ct: '개인', tax: '사업자' };
  return { ct: '개인', tax: '개인' };
}

/** 발행 스냅샷에만 쓰는 상태. templateFields/초안 입력은 이 값을 바꿀 수 없다. */
export function frozenTemplateStateFromRecords(args: {
  contract: Row;
  product?: Row | null;
  insuranceSide?: '회사포함' | '고객직접';
}): FrozenTemplateState {
  const contract = args.contract || {};
  const product = args.product || null;
  const plate = text(contract.car_number_snapshot || contract.car_number || product?.car_number);
  const pending = contract.is_pending_plate === true || product?.is_pending_plate === true || TEMP_PLATE_RE.test(plate);
  const insuranceSide = args.insuranceSide || text(contract.esign_insurance_side) as '회사포함' | '고객직접';
  return {
    co: 'auto',
    pd: productStateOf(contract, product),
    ins: insuranceSide === '고객직접' ? '별도' : '포함',
    ...customerStateOf(contract),
    car: pending ? '신차' : '등록완료',
  };
}

/** 완성본에서 상태키가 fields로 다시 덮이지 않게 발행 경계에서 제거한다. */
export function omitTemplateSemanticStateFields(fields: ContractPayload): ContractPayload {
  const next = { ...fields };
  for (const key of TEMPLATE_SEMANTIC_STATE_KEYS) delete next[key];
  return next;
}

/** 실차번호도 임시번호도 아닌 차량은 계약서에 신차/등록완료 중 어느 쪽으로도 단정할 수 없다. */
export function freepassVehicleStateIssueError(contract: Row, product?: Row | null): string {
  const source = product || null;
  const plate = text(contract.car_number_snapshot || contract.car_number || source?.car_number);
  const pending = contract.is_pending_plate === true || source?.is_pending_plate === true || TEMP_PLATE_RE.test(plate);
  if (pending || isExactRealPlate(plate)) return '';
  return '차량번호가 실차번호 또는 신차 임시번호인지 확인한 뒤 전자계약을 발행해 주세요.';
}

function moneyCell(n: unknown): string {
  const v = Number(n) || 0;
  return v ? v.toLocaleString() : '';
}

/** 재고 원값만 계약서 표기로 다듬는다. 1.6L처럼 cc가 확정되지 않은 값은 추정하지 않는다. */
function engineCcCell(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  const matched = raw.match(/^([\d,]+)\s*(?:cc|㏄)?$/i);
  if (!matched) return raw;
  const cc = Number(matched[1].replace(/,/g, ''));
  return Number.isFinite(cc) && cc > 0 ? `${cc.toLocaleString('ko-KR')}cc` : '';
}

/** 재고 주행거리는 계약서에서 천 단위와 km 단위를 빠뜨리지 않는다. */
function mileageCell(value: unknown): string {
  const raw = text(value);
  if (!raw) return '';
  if (/km\b/i.test(raw)) return raw;
  const numeric = raw.replace(/[\s,]/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(numeric)) return raw;
  return `${Number(numeric).toLocaleString('ko-KR')}km`;
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

// 고객/영업 화면의 초안과 issue body는 신뢰 경계 밖이다. 계약 금액·차량·보험·임대인·정책
// 원자를 여기서 다시 덮으면 RTDB에 직접 만든 초안 한 건으로 봉인 PDF의 사실관계가 바뀐다.
// 아래는 본 계약에 적어도 무방한 계약별 입력만 허용하고, 나머지는 authoritative record에서만 만든다.
const ISSUE_INPUT_FIELDS = new Set([
  'deposit_installment',
  'contract_vehicle_price', 'vehicle_remark',
  'auto_debit_date', 'buyback_option', 'buyback_price', 'driver_scope', 'maintenance_product',
  'special_terms', 'special_terms_choice',
  'additional_driver',
  'drv1_name', 'drv1_relation', 'drv1_phone',
  'drv2_name', 'drv2_relation', 'drv2_phone',
  'drv3_name', 'drv3_relation', 'drv3_phone',
  'emergency_contact', 'emergency_relation',
]);

function issueInputFields(value: Record<string, string> | null | undefined): ContractPayload {
  const out: ContractPayload = {};
  for (const [key, raw] of Object.entries(value || {})) {
    const field = text(key);
    const input = text(raw);
    if (ISSUE_INPUT_FIELDS.has(field) && input) out[field] = input;
  }
  return out;
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
}): { fields: ContractPayload; state: { co: string; pd: FrozenTemplateState['pd']; ins: FrozenTemplateState['ins']; ct: FrozenTemplateState['ct']; car: FrozenTemplateState['car']; tax: FrozenTemplateState['tax'] } } {
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
    engine_cc: engineCcCell(product?.engine_cc),
    model_year: yr ? (/년식/.test(yr) ? yr : `${yr}년식`) : '',
    options: Array.isArray(product?.options)
      ? (product!.options as string[]).join(', ')
      : text(product?.options),
    vehicle_price: product ? priceText(product.price) : '',
    vin: text(product?.vin),
    color_exterior: text(product?.ext_color),
    color_interior: text(product?.int_color),
    odometer_delivery: mileageCell(product?.mileage),
    /*
     * 상품구분 칸은 「신차 · 렌터카」처럼 두 값을 나란히 적는다.
     * product_type 이 이미 둘을 붙여 갖고 있으므로(신차렌트·중고구독·픽업구독…) 거기서 가른다.
     * 픽업구독은 «중고구독이 아닌» 별도 상품이지만, 차의 상태는 중고차이고 빌리는 방식은 구독이다.
     */
    vehicle_condition_type: /신차/.test(canonProductType(product?.product_type)) ? '신차' : '중고차',
    vehicle_classification: /구독/.test(canonProductType(product?.product_type)) ? '구독서비스' : '렌터카',
    drive_type: text(product?.drive_type),
    seats: product?.seats ? `${product.seats}인승` : '',
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
    annual_mileage: text(contract.annual_mileage_snapshot || pol.annual_mileage),
    over_mileage_rate: overMileageRate ? `1km당 ${overMileageRate.toLocaleString()}원` : '',
    accident_termination_count: accidentTerminationText(pol.accident_termination_count),
    accident_termination_total_count: text(pol.accident_termination_count),
    maintenance_product: text(pol.maintenance_service),
    maintenance_replacement: text(pol.replacement_car_policy) || '미제공',
    designated_garage: text(pol.designated_garage) || '회사 지정 또는 사전 승인 정비공장',
    replacement_car_policy: text(pol.replacement_car_policy) || '미제공',
    coverage_liability_person: text(pol.injury_compensation_limit),
    coverage_liability_property: text(pol.property_compensation_limit),
    coverage_self_injury: text(pol.self_body_accident),
    coverage_uninsured: text(pol.uninsured_damage),
    insurer_name: text(pol.insurer_name),
    self_damage_coverage: text(pol.own_damage_compensation),
    emergency_dispatch_limit: text(pol.annual_roadside_assistance),
    deductible_liability_person: manwonText(pol.injury_deductible),
    deductible_liability_property: manwonText(pol.property_deductible),
    self_damage_deductible_rate: text(pol.own_damage_repair_ratio),
    self_damage_deductible_min: text(pol.own_damage_min_deductible),
    self_damage_deductible_max: text(pol.own_damage_max_deductible),
    self_damage_exclusions: text(pol.self_damage_exclusions),
    extra_deductibles: text(pol.extra_deductibles),
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

  const draft = issueInputFields(parseDraft(contract.contract_draft));
  const overrides = issueInputFields(args.overrides);

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
  /**
   * ★특약 사항 = «정책의 기타사항» + «이 계약의 특약»(사장님 2026-08-20 「없는 내용을 별도로 적되, 계약서에 들어가는 항목」).
   *   정책에서 온 줄을 먼저 싣는다 — 그 공급사 조건이 먼저고, 이 계약만의 합의가 뒤다. 둘 다 없으면 계약서가 「없음」으로 적는다.
   */
  const policyExtraTerms = text(pol.policy_extra_terms);
  const rawOwnSpecialTerms = text(contract.special_terms_snapshot || fields.special_terms || draft.special_terms || contract.special_terms);
  // 「없음」은 UI에서 특약 유무를 확인했다는 sentinel이지 정책 기타사항 뒤에 붙일 계약별 특약이 아니다.
  const ownSpecialTerms = rawOwnSpecialTerms === '없음' ? '' : rawOwnSpecialTerms;
  const mergedSpecialTerms = [policyExtraTerms, ownSpecialTerms].filter(Boolean).join('\n');
  // 초안/templateFields에 남은 과거 문구가 봉인 PDF를 덮지 못하도록 항상 합성 결과만 쓴다.
  fields.special_terms = mergedSpecialTerms || '없음';

  const frozenState = frozenTemplateStateFromRecords({
    contract,
    product,
    insuranceSide: ins === '별도' ? '고객직접' : '회사포함',
  });
  return {
    fields,
    state: {
      co: fields.co || coKey,
      pd: frozenState.pd,
      // 서식 편집기는 fields.ins를 사용할 수 있지만, 발행 스냅샷은 별도의 frozen state를 쓴다.
      ins: frozenState.ins,
      ct: frozenState.ct,
      car: frozenState.car,
      tax: frozenState.tax,
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
