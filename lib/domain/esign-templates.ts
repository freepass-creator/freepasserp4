/**
 * 프리패스 표준계약서 = 정확히 3벌(2026-08-10 사장님 확정).
 *
 *   1. 표준 렌트계약서
 *   2. 표준 구독계약서 · 보험포함
 *   3. 표준 구독계약서 · 보험별도
 *
 * 인수/반납은 서로 다른 계약서가 아니라 위 3벌 안에서 관리자가 찍는 만기 선택이다.
 * 고객은 선택하지 않고 이미 확정된 계약을 확인·동의·서명한다.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import {
  findContractKind, type ContractKind, type ContractKindSpec, type InsuranceSide, type MaturityKind,
} from '@/lib/domain/esign-contract-kind';

const S = (value: unknown): string => String(value ?? '').trim();

/** 세 표준계약서의 공통 개정판. 개별 개정이 필요해지면 각 항목 version을 분리한다. */
export const STANDARD_VERSION = 'sample-v1';
export const STANDARD_IS_SAMPLE = true;

export type StandardTemplateKey =
  | 'freepass-rent-standard'
  | 'freepass-subscription-insurance-included'
  | 'freepass-subscription-insurance-separate';

/** 모든 파생 계약서의 모체. 배열 순서가 바뀌어도 신규 계약의 기본값은 변하지 않는다. */
export const DEFAULT_STANDARD_TEMPLATE_ID: StandardTemplateKey = 'freepass-rent-standard';

export type EsignTemplate = {
  /** 프리패스 내부의 표준계약서 ID. 착한거래 외부 ID가 아니다. */
  id: StandardTemplateKey;
  label: string;
  version: string;
  isSample: boolean;
  contractKind: ContractKind;
  insuranceSide: InsuranceSide;
  title: string;
  note: string;
};

export const STANDARD_CONTRACT_TEMPLATES: EsignTemplate[] = [
  {
    id: 'freepass-rent-standard',
    label: '프리패스 기본계약서 · 렌트·보험포함',
    version: STANDARD_VERSION,
    isSample: STANDARD_IS_SAMPLE,
    contractKind: '렌탈',
    insuranceSide: '회사포함',
    title: '자동차 장기대여 계약서',
    note: '프리패스모빌리티 기본 정본입니다. 기본은 만기 반납이며, 인수가를 적은 경우 인수옵션 조항이 적용됩니다.',
  },
  {
    id: 'freepass-subscription-insurance-included',
    label: '표준 구독계약서 · 보험포함',
    version: STANDARD_VERSION,
    isSample: STANDARD_IS_SAMPLE,
    contractKind: '구독',
    insuranceSide: '회사포함',
    title: '자동차 구독 계약서',
    note: '회사가 보험을 가입합니다. 기본은 만기 반납이며 인수조건이 있을 때만 인수옵션을 기재합니다.',
  },
  {
    id: 'freepass-subscription-insurance-separate',
    label: '표준 구독계약서 · 보험별도',
    version: STANDARD_VERSION,
    isSample: STANDARD_IS_SAMPLE,
    contractKind: '구독',
    insuranceSide: '고객직접',
    title: '자동차 구독 계약서',
    note: '고객이 보험을 별도로 가입합니다. 기본은 만기 반납이며 인수조건이 있을 때만 인수옵션을 기재합니다.',
  },
];

/** 기존 호출부 호환용 이름. 내용은 표준계약서 3벌이다. */
export const ALL_TEMPLATES = STANDARD_CONTRACT_TEMPLATES;

/** Preview에서는 샘플 검증 가능, Production은 세 벌 모두 최종본이어야 한다. */
export function isEsignTemplateAllowed(environment: string | undefined): boolean {
  return environment !== 'production' || STANDARD_CONTRACT_TEMPLATES.every((template) => !template.isSample);
}

export function findTemplate(id: unknown): EsignTemplate | null {
  return STANDARD_CONTRACT_TEMPLATES.find((template) => template.id === S(id)) || null;
}

export function defaultStandardTemplate(): EsignTemplate {
  const template = findTemplate(DEFAULT_STANDARD_TEMPLATE_ID);
  if (!template) throw new Error('프리패스 기본계약서 설정을 찾지 못했습니다.');
  return template;
}

export function templatesForContract(_contract: EntityRecord | null | undefined): EsignTemplate[] {
  return STANDARD_CONTRACT_TEMPLATES;
}

/** 표준계약서 3벌 중 하나 + 인수/반납 선택을 기존 ContractKindSpec으로 펼친다. */
export function contractKindFor(template: EsignTemplate, maturity: MaturityKind): ContractKindSpec {
  const prefix = template.contractKind === '렌탈' ? 'rent' : 'sub';
  const suffix = maturity === '인수형' ? 'buyout' : 'return';
  const spec = findContractKind(`${prefix}_${suffix}`);
  if (!spec) throw new Error('표준계약서와 만기 선택 조합이 올바르지 않습니다.');
  return spec;
}

export function templateForKindAndInsurance(kind: ContractKind, insuranceSide: InsuranceSide): EsignTemplate {
  if (kind === '렌탈') return STANDARD_CONTRACT_TEMPLATES[0];
  return insuranceSide === '고객직접' ? STANDARD_CONTRACT_TEMPLATES[2] : STANDARD_CONTRACT_TEMPLATES[1];
}

export function insuranceSideFromPolicy(policy: Record<string, unknown> | null | undefined): InsuranceSide | null {
  const raw = S(policy?.insurance_included);
  if (!raw) return null;
  return /별도|개인/.test(raw) ? '고객직접' : '회사포함';
}

/** 표준계약서 3종 + 인수/반납 + 정책 보험조건의 공통 게이트. */
export function standardTemplateSelectionError(
  template: EsignTemplate,
  spec: ContractKindSpec,
  policy: Record<string, unknown> | null | undefined,
): string {
  if (spec.kind !== template.contractKind) return '계약서 종류와 인수/반납 선택 조합이 올바르지 않습니다.';
  const policySide = insuranceSideFromPolicy(policy);
  if (!policySide) return '파트너사 관리의 보험 포함 여부를 확인해 주세요.';
  if (template.insuranceSide !== policySide) {
    return `선택한 계약서는 ${template.insuranceSide === '고객직접' ? '보험별도' : '보험포함'}인데 파트너사 관리의 보험 조건과 다릅니다.`;
  }
  return '';
}

/** 기발행·기존 계약에서 사용한 표준계약서를 복원한다. */
export function sentTemplateOf(contract: EntityRecord | null | undefined): EsignTemplate | null {
  const row = contract as Record<string, unknown> | null;
  if (!row) return null;
  const direct = findTemplate(row.esign_template_base_id || row.esign_standard_template_id || row.standard_template_id);
  if (direct) return direct;
  const spec = findContractKind(S(row.esign_contract_kind || row.contract_kind || row.esign_template_id));
  return spec ? templateForKindAndInsurance(spec.kind, sentInsuranceSide(contract)) : null;
}

/** 발행 시 함께 확정한 보험 주체. */
export function sentInsuranceSide(contract: EntityRecord | null | undefined): InsuranceSide {
  const row = contract as Record<string, unknown> | null;
  const direct = findTemplate(row?.esign_template_base_id || row?.esign_standard_template_id || row?.standard_template_id);
  if (direct) return direct.insuranceSide;
  const raw = S(row?.esign_insurance_side);
  return raw === '고객직접' ? '고객직접' : '회사포함';
}

export function maturityOf(contract: EntityRecord | null | undefined): MaturityKind | null {
  const row = contract as Record<string, unknown> | null;
  const saved = S(row?.esign_maturity);
  if (saved === '인수형' || saved === '반납형') return saved;
  return findContractKind(S(row?.esign_contract_kind || row?.contract_kind || row?.esign_template_id))?.maturity || null;
}
