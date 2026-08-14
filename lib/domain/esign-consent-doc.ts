/**
 * 전자계약 — 손님이 확인·동의할 «내용»의 SSOT.
 *
 * ★왜 여기에 두나
 *   손님 화면은 착한거래가 그린다. 그런데 **무엇을 보여주고 무엇에 동의받는지**는 우리 데이터다
 *   (원자 정의 `lib/intake/entities.ts` · 값 = 계약 스냅샷 + 정책). 이 정의를 착한거래에 복제하면
 *   필드를 하나 늘릴 때마다 양쪽이 어긋난다. 그래서 **우리가 만들어 payload 로 넘기고 저쪽은 렌더러**다.
 *   (`docs/ESIGN_CHAKHANDEAL_INTEGRATION.md` §3.1)
 *
 * ★2026-08-08 사장님 결정
 *   계약서 조항 문구가 본질이 아니다. **계약 원자에 대한 동의**를 받는 것이 본질이다.
 *   그래서 손님은 긴 계약서를 스크롤하지 않고 «본인정보 → 차량정보 → 대여조건 → 보험» 을
 *   한 화면씩 확인하고 동의한다. 조항은 마지막 약관 한 페이지로 몰아 통독시킨다.
 *
 * ★표시 문자열까지 여기서 만든다
 *   금액 콤마·개월 표기를 저쪽이 다시 포맷하면 화면과 계약서의 숫자가 달라 보인다.
 *   값은 `value`(사람이 읽는 문자열)로 굳혀 보내고, 원본은 `raw` 에 남긴다.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import {
  CUSTOMER_INSURANCE_NOTE, findContractKind, showsInsuranceLimits, type InsuranceSide,
} from '@/lib/domain/esign-contract-kind';
import {
  TERMS_ACCIDENT, TERMS_PAYMENT, TERMS_SERVICE, deductibleForAge,
} from '@/lib/domain/esign-standard-terms';
import {
  AGREEMENT_SECTIONS, AGREEMENT_TITLE, AGREEMENT_VERSION,
} from '@/lib/domain/esign-agreement-text';
import { overMileageRateFor } from '@/lib/domain/policy-defaults';

type Rec = Record<string, unknown>;
const S = (v: unknown): string => String(v ?? '').trim();
const N = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function driverAgeLabel(value: unknown): string {
  const text = S(value);
  if (!text) return '';
  if (/세|제한|협의/.test(text)) return text;
  const age = Number(text.match(/\d+/)?.[0] || 0);
  return age > 0 ? `만 ${age}세 이상` : text;
}

function additionalDriverAllowanceLabel(value: unknown): string {
  const text = S(value);
  if (!text) return '';
  if (/불가|없음/.test(text) || text === '0') return '없음';
  if (/명|인/.test(text)) return text;
  const count = Number(text.match(/\d+/)?.[0] || 0);
  return count > 0 ? `${count}명까지` : text;
}

/** 1,234,000 — 계약서·화면 공통 표기. */
export const wonText = (v: unknown): string => `${N(v).toLocaleString('ko-KR')}원`;

/**
 * 「~ 가능」을 «이 계약은 이렇다»로 굳힌다.
 *
 * 정책에는 「3회 분납 가능」처럼 **선택지**가 적혀 있다. 그건 손님이 상품을 고를 때 듣는 말이지,
 * 계약이 확정된 뒤 서명 화면에 있을 말이 아니다. 계약서에는 이 계약에서 몇 회로 굳었는지만 온다.
 * 선택 횟수를 모르면 정책 문구를 그대로 내보내지 않고 **줄을 없앤다** — 빈칸을 「—」로 채우지
 * 않는 것과 같은 이유다.
 */
export function depositInstallmentText(chosen: unknown, policy: unknown): string {
  const n = N(chosen);
  if (n > 1) return `${n}회 분납`;
  if (n === 1) return '일시납';
  // 선택값이 없으면 정책의 「~ 가능」은 내보내지 않는다.
  return /가능|선택/.test(S(policy)) ? '' : S(policy);
}

/**
 * 사고 누적 해지 — 각 사고 발생일을 기준으로 직전 1년간, 해당 사고를 포함해
 * 과실 50% 이상 사고가 N회면 계약이 해지될 수 있다.
 *
 * **차를 잃는 조건**이라 약관 8천 자에 묻어 두면 안 된다. 계약서에 숫자로 한 줄 세운다.
 * 사고다발 기준은 약관 제7조제1항제7호의 최근 1년 내 과실사고 3회와 맞춘다.
 * 「3회」만 적으면 무엇을 세는지 모르므로 «1년·과실 50% 이상»을 값에 붙여 쓴다.
 */
export function accidentTerminationText(_count: unknown): string {
  return '각 사고 발생일 기준 직전 1년 이내, 해당 사고 포함 과실 50% 이상 총 3회 → 계약 해지 가능';
}

/**
 * 초과 주행요금 — **약정을 넘겨 달린 거리에만** 붙는다.
 *   약정 연 30,000km · 실주행 31,000km → 초과 1,000km × 요율
 *
 * 단위를 «1km당»으로 못박아 적는다. 그냥 「200원」이라고만 두면
 * 「1만km당」인지 「1km당」인지 알 수 없어, 이 값이 500배 오해를 낳는다
 * (실제로 상향 가격표가 이 자리에 잘못 들어와 있었다).
 */
export function overMileageText(rate: unknown): string {
  const n = N(rate);
  if (n > 0) return `1km당 ${n.toLocaleString('ko-KR')}원`;
  const s = S(rate);
  if (!s) return '';
  return /km\s*당|\/\s*km/.test(s) ? s : `1km당 ${s}`;
}

/**
 * 조건부 옵션 요율 — **이 계약에서 그 조건을 선택했을 때만** 확정값으로 실린다.
 * 선택하지 않았으면 그 줄은 존재하지 않는다. 요율만 띄우면 「내야 하나?」로 읽힌다.
 */
export function optionRate(selected: unknown, rate: unknown): string {
  const on = selected === true || /^(1|y|yes|true|지정|선택|하향)/i.test(S(selected));
  return on ? S(rate) : '';
}

/** 010-1234-5678 — 하이픈 없는 저장값을 사람이 읽는 꼴로. */
export function phoneText(v: unknown): string {
  const d = S(v).replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return S(v);
}

/**
 * 계약 하나에 붙일 **상품(재고관리)·정책(정책관리)** 을 찾아 온다.
 *
 * 보험·연령·심사·주행거리는 계약에 없다 — 정책 노드에 있고, 매물엔 `policy_code` 만 있다.
 * 이걸 안 붙이면 손님 계약서의 보험 칸이 통째로 빈다.
 * 결합 규칙은 `contract-send.ts` 와 같다(상품코드 우선, 없으면 차번).
 */
export function resolveContractSources(
  contract: EntityRecord,
  products: EntityRecord[],
  policies: EntityRecord[],
): { product: EntityRecord | null; policy: EntityRecord | null } {
  const c = contract as Rec;
  const pCode = S(c.product_code);
  const car = S(c.car_number_snapshot).replace(/\s/g, '');
  const product = products.find((p) => {
    const rec = p as Rec;
    if (pCode && S(rec.product_code) === pCode) return true;
    return !!car && S(rec.car_number).replace(/\s/g, '') === car;
  }) || null;

  const polCode = S((product as Rec | null)?.policy_code) || S(c.policy_code);
  const policy = polCode
    ? policies.find((t) => S((t as Rec).policy_code) === polCode || S((t as Rec)._key) === polCode) || null
    : null;
  return { product, policy };
}

export type ConsentRow = {
  label: string;
  value: string;
  raw?: unknown;
  /**
   * 이 값을 규율하는 약관 조항. 있으면 착한거래 렌더러가 값 옆에 배지를 띄운다.
   * 계약서는 단답, 약관은 서술이므로 «그래서 어떻게 적용되는가»를 손님이 바로 찾게 한다.
   * 없으면 값만 그린다 — 하위호환.
   */
  article?: string;
};
export type ConsentGroup = {
  key: 'identity' | 'vehicle' | 'rental' | 'payment' | 'driver' | 'insurance' | 'accident' | 'service';
  title: string;
  /** 이 묶음이 왜 있는지 — 손님에게 한 줄로. */
  note: string;
  rows: ConsentRow[];
  confirmLabel: string;
  required: true;
};

/**
 * 보험 표시 순서·라벨 — `entities.ts` policy 필드에서 가져온 그대로.
 * 여기서 라벨을 새로 지으면 ERP 화면과 계약서의 용어가 갈린다.
 */
const INSURANCE_ROWS: [string, string][] = [
  ['injury_compensation_limit', '대인 보상한도'],
  ['injury_deductible', '대인 면책금'],
  ['property_compensation_limit', '대물 보상한도'],
  ['property_deductible', '대물 면책금'],
  ['self_body_accident', '자손 보상한도'],
  ['self_body_deductible', '자손 면책금'],
  ['uninsured_damage', '무보험 보상한도'],
  ['uninsured_deductible', '무보험 면책금'],
  ['own_damage_compensation', '자차 보상'],
  ['own_damage_repair_ratio', '자차 자기부담률'],
  ['own_damage_min_deductible', '자차 최소 면책금'],
  ['own_damage_max_deductible', '자차 최대 면책금'],
  ['annual_roadside_assistance', '긴급출동'],
];

/** 값이 있는 행만 남긴다 — 빈 칸을 «—» 로 채우면 손님이 «없는 보장»을 있는 걸로 읽는다. */
const kept = (rows: ConsentRow[]): ConsentRow[] => rows
  .filter((row) => row.value !== '')
  .map((row) => {
    if (row.raw !== undefined) return row;
    const { raw: _raw, ...firebaseSafeRow } = row;
    return firebaseSafeRow;
  });

/**
 * 계약 하나 → 손님이 확인할 묶음 4개.
 * 값이 통째로 빈 묶음은 **떨어뜨리지 않고 남긴다** — 「차량정보 없음」이 화면에 보여야 사고를 잡는다.
 */
export function buildConsentGroups(
  contract: EntityRecord,
  policy?: Rec | null,
  /** 보험 주체 — «고객직접»이면 우리 정책의 보험 한도를 **보여주면 안 된다**(회사가 안 든 보험이다). */
  insuranceSide: InsuranceSide = '회사포함',
): ConsentGroup[] {
  const c = contract as Rec;
  const p = (policy || {}) as Rec;
  const contractKind = findContractKind(S(c.esign_contract_kind || c.contract_kind));
  // 관리자·손님이 따로 넣은 값(만기 인수가격·분납 회차 등)은 계약 본체가 아니라 여기 모인다.
  const inputs = (c.esign_inputs || {}) as Rec;

  const vehicleName = S(c.vehicle_name_snapshot)
    || [c.maker_snapshot, c.model_snapshot, c.sub_model_snapshot].map(S).filter(Boolean).join(' ');

  return [
    {
      key: 'identity',
      title: '본인정보',
      note: '아래 정보로 계약이 작성됩니다. 다르거나 이해하기 어려운 사항은 서명 전에 담당자에게 질문·설명을 요청해 주세요.',
      rows: kept([
        { label: '성명', value: S(c.customer_name), raw: c.customer_name },
        { label: '연락처', value: phoneText(c.customer_phone), raw: c.customer_phone },
        { label: '생년월일', value: S(c.customer_birth), raw: c.customer_birth },
        { label: '주소', value: S(c.customer_address), raw: c.customer_address },
      ]),
      confirmLabel: '위 본인정보가 정확함을 확인합니다',
      required: true,
    },
    {
      key: 'vehicle',
      title: '차량정보',
      note: '실제로 인도받을 차량입니다.',
      rows: kept([
        { label: '차량번호', value: S(c.car_number_snapshot), raw: c.car_number_snapshot, article: '제12조' },
        { label: '모델명', value: vehicleName, raw: vehicleName },
      ]),
      confirmLabel: '위 차량으로 계약함을 확인합니다',
      required: true,
    },
    {
      key: 'rental',
      title: '대여조건',
      note: '매월 내실 금액과 기간입니다.',
      rows: kept([
        // 고객이 선택하지 않는다. 관리자가 확정한 3종 중 하나 + 인수/반납을 읽고 동의한다.
        { label: '계약서 종류', value: S(c.esign_standard_template_label), raw: c.esign_standard_template_label },
        { label: '만기 처리', value: contractKind?.maturityNote || '', raw: contractKind?.maturity },
        { label: '대여기간', value: N(c.rent_month_snapshot) ? `차량 인도일로부터 ${N(c.rent_month_snapshot)}개월` : '', raw: c.rent_month_snapshot, article: '제4조' },
        { label: '월 대여료', value: N(c.rent_amount_snapshot) ? wonText(c.rent_amount_snapshot) : '', raw: c.rent_amount_snapshot, article: '제6조' },
        // 보증금 0 은 «무보증»이라는 뜻이라 빈칸으로 떨어뜨리지 않는다.
        { label: '보증금', value: N(c.deposit_amount_snapshot) ? wonText(c.deposit_amount_snapshot) : '무보증', raw: c.deposit_amount_snapshot, article: '제6조' },
        { label: '약정 주행거리', value: S(p.annual_mileage), raw: p.annual_mileage, article: '제23조' },
        /*
         * ⚠ `mileage_upcharge_per_10000km`(「1만km 추가」)은 여기 오지 않는다.
         *   그건 **약정을 정할 때 쓰는 가격표**다 — 2만km면 월 65만원, 3만km면 75만원.
         *   계약이 확정되면 이미 「월 대여료」에 녹아 있어서, 또 적으면 「따로 더 내나」로 읽힌다.
         *
         * 아래가 손님이 알아야 할 값이다 — **약정을 넘겨 달린 거리에 붙는 요율.**
         *   약정 연 30,000km · 실주행 31,000km → 초과 1,000km × 요율
         * 계산·정산 방식은 약관 제23조가 서술하고, 계약서는 그 조문이 참조하는 숫자만 댄다.
         */
        // 국산·수입이 다르다 — 이 계약 차량의 제조사로 고른다. 한 칸으로 두면 수입차에 국산 요율이 찍힌다.
        {
          label: '초과주행 요금',
          value: overMileageText(overMileageRateFor(p, S(c.maker_snapshot))),
          raw: overMileageRateFor(p, S(c.maker_snapshot)),
          article: '제23조',
        },
        { label: '출고 시 주행거리', value: N(c.mileage_snapshot) ? `${N(c.mileage_snapshot).toLocaleString('ko-KR')}km` : '', raw: c.mileage_snapshot },
        { label: '만기 인수가격', value: S(inputs.buyout_price), raw: inputs.buyout_price },
        // 「3회 분납 가능」은 영업 단계의 말이다. 이 계약에서 몇 회로 굳었는지만 적는다.
        { label: '보증금 분납', value: depositInstallmentText(inputs.deposit_installment_count, p.deposit_installment), raw: p.deposit_installment },
        { label: '탁송비', value: S(p.delivery_fee), raw: p.delivery_fee },
        /*
         * 「대여지역」·「심사기준」은 뺐다(2026-08-09 정합성 점검).
         *   - 대여지역 「전국」 = 상품 안내지 이 계약의 조건이 아니다.
         *   - 심사기준 「중신용 이상」 = **내부 심사 기준이다.**
         *     우리가 이 사람을 어떻게 평가했는지를 본인 화면에 띄우는 것이라 사고다.
         */
      ]),
      confirmLabel: '위 대여조건에 동의합니다',
      required: true,
    },
    {
      key: 'payment',
      title: '결제·연체',
      note: '언제 얼마를 어떻게 내는지, 밀리면 어떻게 되는지입니다.',
      // 숫자·기한이 든 것만 남긴다. 절차 서술은 약관으로 보냈다(IN_AGREEMENT).
      rows: kept([
        { label: '대여료 결제주기', value: S(p.payment_cycle) || TERMS_PAYMENT.paymentCycle, raw: p.payment_cycle, article: '제6조' },
        { label: '대여료 납부 조건', value: S(c.payment_timing_snapshot || p.payment_timing) || '선불', raw: c.payment_timing_snapshot || p.payment_timing, article: '제6조' },
        { label: '결제 방식', value: S(p.payment_method), raw: p.payment_method, article: '제6조' },
        { label: '월 납부일', value: S(c.auto_debit_date || p.payment_due_date || p.auto_debit_day) || TERMS_PAYMENT.autoDebitFixed, raw: c.auto_debit_date || p.payment_due_date || p.auto_debit_day, article: '제6조' },
        { label: '계산서 발행', value: TERMS_PAYMENT.billing },
        { label: '연체 시', value: TERMS_PAYMENT.overdue, article: '제24조' },
        { label: '중도해지 위약금', value: S(p.penalty_condition), raw: p.penalty_condition, article: '제8조' },
        { label: '계약 승계', value: S(p.succession_allowed), raw: p.succession_allowed, article: '제8조·제10조' },
        { label: '계약 승계수수료', value: N(p.succession_fee) ? wonText(p.succession_fee) : '', raw: p.succession_fee, article: '제8조·제10조' },
        { label: '지연손해금', value: TERMS_PAYMENT.lateInterest, article: '제25조' },
        // 「1주일 안에」가 기한이다 — 약관에 묻히면 손님이 언제 돌려받는지 모른다.
        { label: '보증금 반환', value: TERMS_PAYMENT.depositReturn, article: '제6조' },
      ]),
      confirmLabel: '결제·연체 조건을 확인했습니다',
      required: true,
    },
    {
      key: 'driver',
      title: '운전자',
      note: '이 차를 몰 수 있는 사람의 범위입니다. 범위를 벗어난 사람이 몰다 사고가 나면 보험이 적용되지 않습니다.',
      rows: kept([
        { label: '운전자 연령', value: driverAgeLabel(p.basic_driver_age), raw: p.basic_driver_age, article: '제13조' },
        { label: '면허 경력요건', value: S(p.license_period), raw: p.license_period },
        { label: '운전자 범위(개인)', value: S(p.personal_driver_scope), raw: p.personal_driver_scope, article: '제13조' },
        { label: '운전자 범위(사업자)', value: S(p.business_driver_scope), raw: p.business_driver_scope, article: '제13조' },
        { label: '추가운전자 허용', value: additionalDriverAllowanceLabel(p.additional_driver_allowance_count), raw: p.additional_driver_allowance_count },
        /*
         * 「연령 하향 : 만 21세까지 하향 가능」은 **선택지**다 — 영업 단계의 말이지
         * 확정된 계약 내용이 아니다. 계약서에는 위 「운전자 연령」이 이미 굳은 값으로 있다.
         * 하향·추가운전자 «요금»은 이 계약에서 실제로 선택했을 때만 확정값으로 실린다.
         * 선택하지 않았으면 그 줄은 존재하지 않는다(2026-08-09 정합성 점검).
         */
        { label: '연령 하향 요금', value: optionRate(inputs.age_lowering_selected, p.age_lowering_cost), raw: p.age_lowering_cost },
        { label: '추가운전자 요금', value: optionRate(inputs.additional_driver, p.additional_driver_cost), raw: p.additional_driver_cost },
      ]),
      confirmLabel: '운전자 범위를 확인했습니다',
      required: true,
    },
    insuranceGroup(p, insuranceSide),
    {
      key: 'accident',
      title: '사고·면책',
      note: '사고가 났을 때 손님이 부담하는 금액과 지켜야 할 절차입니다.',
      // 자차 처리 규정·입고/대차·보험사는 뺐다 — 약관 제11조·제17조·제18조·제19조에 있다(IN_AGREEMENT).
      // 남긴 건 숫자가 박힌 것뿐이다. 「대인 30만원」이 약관 8,856자에 묻히면 손님이 못 본다.
      rows: kept([
        // 면책금은 정책 단일값이 아니라 **연령에서 파생**한다(계약서 「운전자 연령 선택시 자동입력」).
        { label: '면책금(고객부담금)', value: deductibleForAge(p.basic_driver_age), article: '제18조' },
        { label: '면허 1년 이하', value: TERMS_ACCIDENT.licenseUnder1Year, article: '제13조' },
        { label: '사고 접수', value: TERMS_ACCIDENT.caution, article: '제17조' },
        { label: '현장 이탈', value: TERMS_ACCIDENT.onSite, article: '제17조' },
        { label: '중과실 자차사고', value: TERMS_ACCIDENT.grossNegligence, article: '제18조' },
        /*
         * 「사고 다발 시」였던 것 — 라벨이 무슨 일이 벌어지는지 말하지 않았고,
         * 약관 제7조제1항제7호의 최근 1년 내 과실사고 3회 표준기준과 계약서 표시를 맞춘다.
         */
        { label: '사고 다발 시 계약해지 기준', value: accidentTerminationText(p.accident_termination_count), raw: 3, article: '제7조' },
        // 「한도 초과시 폐차」·「20%」가 조건이다.
        { label: '자차 처리 규정', value: TERMS_ACCIDENT.ownDamageRule, article: '제19조' },
        // ★보험사 이름·번호는 여기 안 박는다 — 매년 바뀐다. 어디서 확인할지만 적는다.
        { label: '보험사', value: TERMS_ACCIDENT.insurer },
      ]),
      confirmLabel: '사고 시 부담과 절차를 확인했습니다',
      required: true,
    },
    {
      key: 'service',
      title: '정비·기타',
      note: '정비·검사·과태료·특약처럼 계약 기간 내내 적용되는 조건입니다.',
      // 정비이용·엔진오일·대차·탁송료·초과운행·연락처변경·과태료·GPS특약은 뺐다 —
      // 전부 약관 제14조·제16조·제22조·제23조·제24조·제27조에 있다(IN_AGREEMENT). 12줄이 3줄로 줄었다.
      rows: kept([
        { label: '정비상품', value: S(p.maintenance_service), raw: p.maintenance_service, article: '제14조' },
        { label: '엔진오일', value: TERMS_SERVICE.engineOil, article: '제14조' },
        // 「지원 불가」는 부정조건이다 — 약관이 다르게 말하면 손님이 대차되는 줄 안다.
        { label: '대차서비스', value: TERMS_SERVICE.loanerCar, article: '제5조' },
        { label: '계약 연장·해지', value: TERMS_SERVICE.renewal, article: '제10조' },
        { label: '검사대행', value: TERMS_SERVICE.inspection, article: '제14조' },
        { label: '서비스품목', value: TERMS_SERVICE.serviceItems, article: '제14조' },
        { label: '특약사항', value: TERMS_SERVICE.special },
      ]),
      confirmLabel: '정비·기타 조건을 확인했습니다',
      required: true,
    },
  ];
}

/**
 * 보험 묶음 — **주체에 따라 내용이 통째로 바뀐다.**
 *
 * 「고객직접」인데 우리 정책의 한도를 그대로 보여주면 **회사가 안 든 보험을 든 것처럼 읽힌다.**
 * 값이 비어서 안 보이는 것보다 위험하다 — 손님이 보상받을 수 있다고 믿고 서명한다.
 */
function insuranceGroup(p: Rec, side: InsuranceSide): ConsentGroup {
  if (!showsInsuranceLimits(side)) {
    return {
      key: 'insurance',
      title: '보험',
      note: '이 상품의 보험은 손님이 직접 가입합니다.',
      rows: [
        { label: '가입 주체', value: '고객 직접 가입', article: '제11조' },
        { label: '안내', value: CUSTOMER_INSURANCE_NOTE, article: '제11조' },
        // 운전자 연령은 운전자 묶음에만 둔다 — 여기 또 두면 두 값이 갈라질 수 있다.
      ],
      confirmLabel: '보험을 직접 가입해야 함을 확인했습니다',
      required: true,
    };
  }
  return {
    key: 'insurance',
    title: '보험',
    note: '사고가 났을 때 어디까지 보상되는지입니다. 면책금은 손님이 부담하는 금액입니다.',
    rows: kept([
      { label: '가입 주체', value: '회사 가입(영업용)', article: '제11조' },
      ...INSURANCE_ROWS.map(([key, label]) => ({ label, value: S(p[key]), raw: p[key], article: '제11조' })),
      /*
       * 「기본 운전자 연령」·「추가운전자」를 여기서 뺐다 — 운전자 묶음에 같은 값이 이미 있다.
       * 두 번 보이면 손님은 «다른 조건인가»를 의심하고, 한쪽만 고치면 두 값이 갈라진다.
       * 운전자 범위는 제13조가 규율하므로 운전자 묶음이 제자리다(2026-08-11 V10 정합성 점검).
       */
    ]),
    confirmLabel: '위 보험 조건을 확인했습니다',
    required: true,
  };
}

/**
 * 손님 화면을 **어떻게 끊을지** — 모바일 기준 규격.
 *
 * ★**한 화면 = 한 섹션**(2026-08-08 사장님 지정)
 *   손님은 섹션 하나를 위에서 아래로 쭉 읽고 → 확인 → 다음 섹션으로 넘어간다.
 *   그래서 섹션을 **쪼개지 않는다.** 행이 12개든 15개든 한 화면 안에서 스크롤한다.
 *   쪼개면 「사고·면책」 같은 섹션이 두 동강 나서 앞장만 읽고 넘어간다.
 *
 * ★대신 통독을 강제한다
 *   섹션이 길수록 아래를 안 읽고 동의부터 누른다. 그래서 `requireReadThrough` 를 켜서
 *   **스크롤 끝에 닿기 전에는 확인 버튼이 안 눌리게** 한다 — 약관과 같은 방식이다.
 *   행이 많은 섹션일수록 이게 중요하다.
 *
 * ★약관도 같다
 *   약관은 맨 마지막에 전문을 한 화면으로 넣고 통독시킨다. 조문이 길어도 나누지 않는다.
 */
/** 이 행 수를 넘으면 「길다」고 보고 통독을 강제한다. 쪼개는 기준이 아니다. */
export const READ_THROUGH_ROWS = 6;

export type ConsentPage = {
  key: ConsentGroup['key'];
  title: string;
  /** 「3 / 8」 — 손님이 몇 단계 중 몇 번째인지 안다. */
  stepLabel: string;
  step: number;
  totalSteps: number;
  note: string;
  rows: ConsentRow[];
  confirmLabel: string;
  /** 스크롤 끝에 닿기 전에는 확인 버튼을 잠근다. 행이 많은 섹션일수록 필요하다. */
  requireReadThrough: boolean;
};

/**
 * 섹션 배열 → 손님 화면 배열. **1섹션 = 1화면**, 쪼개지 않는다.
 * 값이 하나도 없는 섹션은 화면을 만들지 않는다 — 빈 화면에서 「확인」을 누르게 하면 안 된다.
 */
export function paginateForMobile(groups: ConsentGroup[]): ConsentPage[] {
  const shown = groups.filter((g) => g.rows.length > 0);
  return shown.map((g, i) => ({
    key: g.key,
    title: g.title,
    step: i + 1,
    totalSteps: shown.length,
    stepLabel: `${i + 1} / ${shown.length}`,
    note: g.note,
    rows: g.rows,
    confirmLabel: g.confirmLabel,
    requireReadThrough: g.rows.length > READ_THROUGH_ROWS,
  }));
}

/** 손님이 찍어 올릴 서류. `required` 는 이것 없이 서명 못 넘어간다는 뜻. */
export type RequiredDoc = { key: string; label: string; note: string; required: boolean };
export const REQUIRED_DOCS: RequiredDoc[] = [
  { key: 'family_register', label: '가족관계증명서', note: '주민번호 뒷자리는 가려서 촬영해 주세요.', required: true },
  { key: 'resident_register', label: '주민등록등본', note: '최근 3개월 이내 발급본.', required: true },
  { key: 'bank_book', label: '통장 사본', note: '자동이체 계좌.', required: false },
];

/**
 * 약관 — **정본**(erp3 `rental-contract.html` 추출 → `esign-agreement-text.ts`).
 *
 * 더 이상 샘플이 아니다. `esign-agreement-text.ts` 가 추출 원문을 그대로 들고 있고
 * 여기서는 포장만 한다. 문구를 고칠 일이 생기면 HTML 템플릿을 고치고 다시 뽑는다 —
 * 두 벌로 갈라지면 어느 게 정본인지 모른다.
 *
 * `version` 은 계약에 `sign_consent_version` 으로 박힌다.
 * 「이 손님이 어느 판에 동의했나」를 그것으로만 되짚을 수 있으므로, 문구를 바꾸면 반드시 올린다.
 *
 * ─── 오픈·종합검토 CROSS-CHECK (Cursor 2026-08-10) ───
 * 착한거래 쪽 오픈 게이트에서 말한 «약관» = **이 렌탈 약관**(플랫폼 이용약관 아님).
 * 손님이 `/consent?c=` 마지막에 스크롤·체크하는 본문이 곧 `SAMPLE_AGREEMENT` →
 * `chakhandealIssuePayload().agreement` 로 나간다.
 *
 * 종합 검토 시 반드시 맞출 것:
 * 1) `public/contract-template/rental-contract.html` (인쇄·PDF 정본)
 * 2) `lib/domain/esign-agreement-text.ts` (전송 조문 SSOT, version=`AGREEMENT_VERSION`)
 * 3) 이 상수 `isSample` — 실발송 전 **false** 인지(지금은 정본 의도)
 * 4) 착한거래가 받은 `agreement.sections`·`version` 이 위와 동일인지
 *    (`C:\dev\chakhandeal` · 회귀: freepass `scripts/sim-esign-agreement.mts`)
 * 5) `docs/CONTRACT_REPLACEMENT_REVIEW_2026-08-10.md` Claude/사람 go·no-go
 *    (제14조 등 법률·금전 효력 후보 문구)
 *
 * `isSample:true` 로 나가면 손님 화면에 «샘플» 배지가 뜨고 실계약으로 쓰면 사고다.
 */
export const SAMPLE_AGREEMENT = {
  version: AGREEMENT_VERSION,
  title: AGREEMENT_TITLE,
  /** 정본이므로 false. 관리 화면의 «샘플» 경고가 이 값으로 뜬다. */
  isSample: false,
  sections: AGREEMENT_SECTIONS,
} as const;

export const AGREEMENT_CONFIRM_LABEL = '위 약관을 모두 읽고 이해했으며 이에 동의합니다';
