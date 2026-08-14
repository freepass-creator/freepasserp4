/**
 * 못 채우는 원자를 **어디서 모을까** — 수집 설계의 SSOT.
 *
 * `docs/CONTRACT_ATOMS.md` §11-B 에서 「담을 칸이 없다」고 남은 원자들이다.
 * 아무 데서나 받으면 안 된다. 가르는 기준은 하나다 —
 *
 *   ★★ **그 값이 월 대여료를 바꾸는가.**
 *
 * 바꾸는 값은 **약정 전에** 받아야 한다. 약정에서 기간·금액이 동결되고
 * (`freezeContractTerm`) RTDB 규칙이 재기입을 막기 때문에, 계약서 단계에서 손님이 고르면
 * 화면 금액과 계약 금액이 어긋난다. 예: 운전자범위 [개인특약] = 월 55,000원 추가.
 *
 * 안 바꾸는 값은 손님이 계약서 화면에서 직접 넣는 게 낫다 —
 * 가족 연락처·실거주지는 손님만 아는 값이고, 우리가 대신 받으면 PII 보관 면적만 는다.
 *
 * ★수집 정의도 우리가 SSOT 로 갖는다
 *   `consentGroups`(보여줄 값)와 같은 원리로 `inputRequests`(받아올 값)를 payload 에 실어 보낸다.
 *   착한거래에 폼을 복제하면 필드를 늘릴 때마다 양쪽이 어긋난다. 저쪽은 렌더러다.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import { findContractKind } from '@/lib/domain/esign-contract-kind';

const S = (v: unknown): string => String(v ?? '').trim();

/** 누가 넣나. `약정` = 금액을 바꾸므로 동결 전에 정해야 하는 값. */
export type InputStage = '약정' | '관리자' | '손님';
export type InputType = 'text' | 'tel' | 'select' | 'date' | 'money' | 'consent';

/**
 * 입력 묶음 — 손님 화면이 이 단위로 끊긴다(`consentGroups` 와 같은 원리).
 * 종이 양식을 그대로 베끼지 않는다. 「자동이체 신청서」 한 장이 아니라 «출금계좌» 묶음이다.
 */
export type InputGroupKey = 'customer' | 'business' | 'driver' | 'bank';

export type InputRequest = {
  key: string;
  label: string;
  group: InputGroupKey;
  stage: InputStage;
  type: InputType;
  required: boolean;
  /** 손님 화면에 띄울 도움말. */
  note: string;
  /** `select` 일 때 고를 값. */
  options?: string[];
  /** 이 값이 월 대여료를 바꾸는가 — true 면 `stage` 는 반드시 `약정`이다. */
  affectsPrice: boolean;
};

export const INPUT_GROUP_LABEL: Record<InputGroupKey, string> = {
  customer: '추가 정보',
  business: '사업자 정보',
  driver: '추가운전자',
  bank: '출금계좌',
};

/**
 * 금액을 바꾸는 원자 — **약정 단계에서 정한다.**
 * 계약서 화면에서는 고르는 게 아니라 «확인»만 한다.
 */
export const PRICE_AFFECTING_INPUTS: InputRequest[] = [
  {
    key: 'driver_scope',
    label: '운전자 범위',
    group: 'customer',
    stage: '약정',
    type: 'select',
    required: true,
    note: '[개인특약]을 고르면 월 55,000원이 추가됩니다.',
    options: [
      '[개인기본1] 계약자와 배우자 및 직계가족',
      '[개인기본2] 계약자 외 지정 1인',
      '[개인특약] 개인기본1 + 형제자매 외 추가 1인 (월 55,000원 추가)',
      '[개인사업자] 계약자와 사업장 임직원',
      '[법인] 법인 임직원 및 계약관계 업체 소속자',
    ],
    affectsPrice: true,
  },
  {
    key: 'additional_driver',
    label: '추가운전자 지정',
    group: 'driver',
    stage: '약정',
    type: 'select',
    required: false,
    note: '지정하면 정책의 추가운전비가 붙습니다.',
    options: ['지정 안 함', '1인 지정'],
    affectsPrice: true,
  },
];

/** 관리자가 넣는 원자 — 금액·조건에 관한 것. 손님에게 물을 값이 아니다. */
export const ADMIN_INPUTS: InputRequest[] = [
  {
    key: 'buyout_price',
    label: '만기 인수가격',
    group: 'customer',
    stage: '관리자',
    type: 'text',
    required: false,
    note: '금액 또는 「만기협의」.',
    affectsPrice: false,
  },
  {
    key: 'deposit_installment_count',
    label: '보증금 분납 회차',
    group: 'customer',
    stage: '관리자',
    type: 'select',
    required: false,
    note: '정책이 분납을 허용할 때만. 총액은 같고 납부 시점만 갈립니다.',
    options: ['일시납', '2회 분납', '3회 분납'],
    affectsPrice: false,
  },
];

/**
 * 출금계좌(CMS 자동이체) — **종이 「자동이체 신청서」를 그대로 옮기지 않는다.**
 *
 * 종이 양식엔 수납업체·수납목적·대표자·사업자등록번호·주소가 손님 기재란처럼 있는데,
 * 그건 전부 **우리 회사 정보**라 손님이 쓸 이유가 없다 — 자동으로 채운다.
 * 손님에게 받을 것은 «어느 계좌에서 언제 빠지나» 다섯 개와 동의 셋뿐이다.
 *
 * ★계약과 별개로 반드시 받아야 한다 — 계약은 됐는데 돈 빠질 계좌가 없으면 첫 달부터 연체다.
 */
export const BANK_INPUTS: InputRequest[] = [
  {
    key: 'cms_bank', label: '은행', group: 'bank', stage: '손님', type: 'text', required: true,
    note: '대여료가 빠져나갈 계좌의 은행입니다.', affectsPrice: false,
  },
  {
    key: 'cms_account_no', label: '계좌번호', group: 'bank', stage: '손님', type: 'text', required: true,
    note: '- 없이 숫자만 넣어 주세요.', affectsPrice: false,
  },
  {
    key: 'cms_holder', label: '예금주', group: 'bank', stage: '손님', type: 'text', required: true,
    note: '계약자와 달라도 됩니다.', affectsPrice: false,
  },
  {
    key: 'cms_holder_birth', label: '예금주 생년월일', group: 'bank', stage: '손님', type: 'text', required: true,
    note: '사업자 계좌면 사업자등록번호를 넣어 주세요.', affectsPrice: false,
  },
  {
    key: 'cms_holder_phone', label: '예금주 연락처', group: 'bank', stage: '손님', type: 'tel', required: true,
    note: '', affectsPrice: false,
  },
  {
    key: 'auto_debit_day', label: '자동이체일', group: 'bank', stage: '손님', type: 'select', required: true,
    note: '출고일 기준으로 고정되며 이후 변경되지 않습니다.',
    options: ['5일', '10일', '15일', '20일', '25일'],
    affectsPrice: false,
  },
];

/**
 * 동의 원자 — 「동의합니다」 한 줄로 받지 않는다.
 *
 * 개인정보 동의는 **무엇을·왜·누구에게·얼마나**가 다 있어야 유효하다(개인정보보호법 §15·§17).
 * 라벨만 두면 나중에 「무엇에 동의했느냐」를 못 댄다 — 분쟁 때 그게 전부다.
 * 그래서 항목·목적·보유기간을 각각 원자로 들고, 제3자 제공은 **받는 자**까지 적는다.
 *
 * 필수 동의는 거부하면 계약이 진행되지 않는다 — 그 사실도 손님에게 말해야 한다(`refusalNote`).
 */
export type ConsentAtom = {
  key: string;
  /** 법정 명칭 그대로. 줄여 쓰지 않는다. */
  label: string;
  group: InputGroupKey;
  required: boolean;
  /** 무엇을 — 수집·조회하는 항목. */
  items: string[];
  /** 왜 — 이용 목적. */
  purpose: string;
  /** 얼마나 — 보유·이용 기간. */
  retention: string;
  /** 누구에게 — 제3자 제공일 때만. */
  recipients?: { name: string; purpose: string; items: string[] }[];
  /** 거부하면 어떻게 되는지. 안 적으면 「거부할 수 없는 동의」가 된다. */
  refusalNote: string;
};

/** 출금계좌 등록에 필요한 동의 둘. 종이 신청서의 「개인정보 활용 동의」 칸이 이것이다. */
export const BANK_CONSENTS: ConsentAtom[] = [
  {
    key: 'cms_consent_use',
    // ★조회가 빠지면 안 된다 — 예금주 실명확인이 조회다(2026-08-08 사장님 지적).
    label: '개인정보 조회·수집·이용 동의',
    group: 'bank',
    required: true,
    items: ['예금주 성명', '예금주 생년월일(또는 사업자등록번호)', '예금주 연락처', '은행명', '계좌번호'],
    purpose: '자동이체 등록, 예금주 실명확인 및 계좌 유효성 조회, 대여료 출금',
    retention: '계약 종료 후 관계 법령이 정한 기간까지',
    refusalNote: '동의하지 않으면 자동이체로 대여료를 낼 수 없어 계약을 진행할 수 없습니다.',
  },
  {
    key: 'cms_consent_third_party',
    label: '개인정보 제3자 제공 동의',
    group: 'bank',
    required: true,
    items: ['예금주 성명', '예금주 생년월일(또는 사업자등록번호)', '은행명', '계좌번호'],
    purpose: '자동이체 출금 대행',
    retention: '자동이체 해지 시까지',
    recipients: [
      { name: '금융결제원', purpose: '자동이체 등록·출금 처리', items: ['예금주 성명', '생년월일', '은행명', '계좌번호'] },
      { name: '수납대행사', purpose: '출금 대행 및 결과 통지', items: ['예금주 성명', '은행명', '계좌번호'] },
    ],
    refusalNote: '동의하지 않으면 출금 대행이 불가능해 자동이체를 등록할 수 없습니다.',
  },
];

/** 계약 자체에 필요한 동의 — 약관 동의와 별개다. */
export const CONTRACT_CONSENTS: ConsentAtom[] = [
  {
    key: 'credit_consent',
    label: '개인(신용)정보 조회·수집·이용 동의',
    group: 'customer',
    required: true,
    items: ['성명', '생년월일', '연락처', '주소', '운전면허 정보'],
    purpose: '계약 심사, 본인확인, 운전자격(면허 효력·범위) 확인',
    retention: '계약 종료 후 관계 법령이 정한 기간까지',
    // 여객자동차운수사업법 §34의2②가 회사에 운전자격 확인 의무를 지운다.
    refusalNote: '동의하지 않으면 운전자격 확인이 불가능해 계약을 진행할 수 없습니다.',
  },
];

export const ALL_CONSENTS: ConsentAtom[] = [...CONTRACT_CONSENTS, ...BANK_CONSENTS];

/** 아직 동의 안 한 것만. 동의는 «받았다»가 아니라 «언제 받았다»로 남는다. */
export function pendingConsents(contract: EntityRecord): ConsentAtom[] {
  const saved = ((contract as Record<string, unknown>).esign_consents || {}) as Record<string, unknown>;
  return ALL_CONSENTS.filter((c) => !saved[c.key]);
}

/** 손님이 계약서 화면에서 직접 넣는 원자 — 금액을 바꾸지 않는다. */
export const CUSTOMER_INPUTS: InputRequest[] = [
  {
    key: 'emergency_contact', label: '가족 연락처', group: 'customer', stage: '손님', type: 'tel', required: true,
    note: '비상시 연락할 가족의 번호입니다.', affectsPrice: false,
  },
  {
    key: 'emergency_relation', label: '가족 관계', group: 'customer', stage: '손님', type: 'text', required: true,
    note: '예: 배우자, 부, 모, 형제', affectsPrice: false,
  },
  {
    key: 'residence_address', label: '실거주지', group: 'customer', stage: '손님', type: 'text', required: false,
    note: '주소와 다를 때만 적어 주세요.', affectsPrice: false,
  },
];

/** 개인사업자일 때만 받는다 — 아닌 손님에게 물으면 화면만 길어진다. */
export const BUSINESS_INPUTS: InputRequest[] = [
  { key: 'biz_name', label: '상호', group: 'business', stage: '손님', type: 'text', required: true, note: '', affectsPrice: false },
  { key: 'biz_address', label: '사업장 소재지', group: 'business', stage: '손님', type: 'text', required: true, note: '', affectsPrice: false },
  { key: 'biz_number', label: '사업자등록번호', group: 'business', stage: '손님', type: 'text', required: true, note: '', affectsPrice: false },
];

/** 추가운전자를 지정했을 때만 받는다. 주민번호·면허번호는 **착한거래 본인확인 경로**로 받는다. */
export const ADDITIONAL_DRIVER_INPUTS: InputRequest[] = [
  { key: 'add_driver_name', label: '추가운전자 성함', group: 'driver', stage: '손님', type: 'text', required: true, note: '', affectsPrice: false },
  { key: 'add_driver_relation', label: '관계', group: 'driver', stage: '손님', type: 'text', required: true, note: '', affectsPrice: false },
  { key: 'add_driver_phone', label: '연락처', group: 'driver', stage: '손님', type: 'tel', required: true, note: '', affectsPrice: false },
];

export const ALL_INPUTS: InputRequest[] = [
  ...PRICE_AFFECTING_INPUTS, ...ADMIN_INPUTS, ...CUSTOMER_INPUTS,
  ...BUSINESS_INPUTS, ...ADDITIONAL_DRIVER_INPUTS, ...BANK_INPUTS,
];

/** 이미 값이 있으면 다시 묻지 않는다 — 계약·저장된 입력값 어느 쪽에 있어도 채워진 것으로 본다. */
export function isFilled(contract: EntityRecord, key: string): boolean {
  const c = contract as Record<string, unknown>;
  const saved = (c.esign_inputs || {}) as Record<string, unknown>;
  const alias = ({
    add_driver_name: 'drv1_name',
    add_driver_relation: 'drv1_relation',
    add_driver_phone: 'drv1_phone',
  } as Record<string, string>)[key];
  return !!S(saved[key]) || !!S(c[key]) || !!S(alias ? c[alias] : '');
}

/**
 * 손님에게 실제로 물을 것만 추린다.
 *
 * - 이미 채워진 건 뺀다.
 * - 개인사업자 아니면 사업자 항목을 뺀다.
 * - 추가운전자 미지정이면 그 항목을 뺀다.
 * - **금액을 바꾸는 항목은 절대 넣지 않는다** — 약정에서 이미 굳었다.
 */
export function customerInputsFor(contract: EntityRecord): InputRequest[] {
  const c = contract as Record<string, unknown>;
  const saved = (c.esign_inputs || {}) as Record<string, unknown>;
  const isBiz = !!S(c.customer_biz_type) || !!S(saved.biz_number) || S(c.customer_type) === '개인사업자';
  const hasAddDriver = Number(S(saved.additional_driver || c.additional_driver).match(/\d+/)?.[0] || 0) > 0;

  const pool = [
    ...CUSTOMER_INPUTS,
    ...(isBiz ? BUSINESS_INPUTS : []),
    ...(hasAddDriver ? ADDITIONAL_DRIVER_INPUTS : []),
    // 출금계좌는 늘 받는다 — 계약은 됐는데 돈 빠질 계좌가 없으면 첫 달부터 연체다.
    ...BANK_INPUTS,
  ];
  return pool.filter((f) => !f.affectsPrice && !isFilled(contract, f.key));
}

/** 손님 화면을 묶음별로 끊어 준다 — `consentGroups` 와 같은 방식. 종이 신청서 한 장으로 안 만든다. */
export function customerInputGroupsFor(contract: EntityRecord): {
  key: InputGroupKey; title: string; fields: InputRequest[]; consents: ConsentAtom[];
}[] {
  const fields = customerInputsFor(contract);
  const consents = pendingConsents(contract);
  const keys: InputGroupKey[] = ['customer', 'business', 'driver', 'bank'];
  return keys
    .map((key) => ({
      key,
      title: INPUT_GROUP_LABEL[key],
      fields: fields.filter((f) => f.group === key),
      consents: consents.filter((c) => c.group === key),
    }))
    .filter((g) => g.fields.length > 0 || g.consents.length > 0);
}

/** 관리자가 아직 안 넣은 것 — ②패널이 이걸로 입력칸을 만든다. */
export function adminInputsFor(contract: EntityRecord): InputRequest[] {
  const row = contract as Record<string, unknown>;
  const spec = findContractKind(S(row.esign_contract_kind || row.contract_kind || row.esign_template_id));
  return ADMIN_INPUTS.filter((f) => {
    // 인수형은 인수가격이 필수다 — 반납형에서는 안 물어도 된다.
    if (f.key === 'buyout_price' && spec && !spec.buyoutPriceRequired) return false;
    return !isFilled(contract, f.key);
  });
}

/**
 * 발송 전 막아야 할 것 — 필수인데 비어 있는 값.
 * 금액을 바꾸는 항목이 비어 있으면 **약정으로 되돌려야 한다**(계약서에서 못 고친다).
 */
export function missingBeforeIssue(contract: EntityRecord): { blocking: InputRequest[]; askCustomer: InputRequest[] } {
  const blocking = [...PRICE_AFFECTING_INPUTS, ...ADMIN_INPUTS]
    .filter((f) => f.required && !isFilled(contract, f.key));
  const askCustomer = customerInputsFor(contract).filter((f) => f.required);
  return { blocking, askCustomer };
}
