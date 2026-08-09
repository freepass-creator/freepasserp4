/**
 * 계약서 양식 = **프리패스 표준계약서**뿐이다(2026-08-08 사장님 결정).
 *
 * 공급사별 양식은 취급하지 않는다. 공급사가 19곳인데 문서를 19벌 들면 조항 하나 고칠 때
 * 19군데를 고쳐야 하고 곧 갈라진다. 우리 표준 하나로 계약하고, 다른 것은 **축**으로 흡수한다
 * (`esign-contract-kind.ts` — 구독/렌탈 × 인수형/반납형, 구독은 보험 주체까지).
 *
 * 그래서 이 파일에는 «어느 양식을 쓸지»만 있고 조항 본문은 없다.
 * 본문과 렌더는 착한거래가 갖는다(`docs/ESIGN_CHAKHANDEAL_INTEGRATION.md` §1).
 *
 * ⚠ 아직 **샘플**이다. 프리패스 표준계약서 정본이 확정되면 `version` 을 올릴 것 —
 *   계약에 `esign_template_version` 으로 박히고, 나중에 «이 손님이 어느 판에 서명했나»를
 *   그것으로만 되짚을 수 있다.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import {
  CONTRACT_KINDS, findContractKind, type ContractKindSpec, type InsuranceSide,
} from '@/lib/domain/esign-contract-kind';

const S = (v: unknown): string => String(v ?? '').trim();

/** 표준계약서 판 — 4유형 공통. 조항을 고치면 이걸 올린다. */
export const STANDARD_VERSION = 'sample-v1';
export const STANDARD_IS_SAMPLE = true;

export type EsignTemplate = {
  /** 계약유형 키 그대로 — 양식과 유형이 1:1 이다. */
  id: string;
  label: string;
  version: string;
  isSample: boolean;
  spec: ContractKindSpec;
  note: string;
};

const noteOf = (spec: ContractKindSpec): string => [
  spec.maturityNote,
  spec.insuranceSides.length > 1 ? '보험은 회사포함·고객직접 중에서 고릅니다.' : '보험은 회사가 가입합니다.',
].join(' ');

export const ALL_TEMPLATES: EsignTemplate[] = CONTRACT_KINDS.map((spec) => ({
  id: spec.key,
  label: spec.label,
  version: STANDARD_VERSION,
  isSample: STANDARD_IS_SAMPLE,
  spec,
  note: noteOf(spec),
}));

export function findTemplate(id: string): EsignTemplate | null {
  return ALL_TEMPLATES.find((t) => t.id === S(id)) || null;
}

/**
 * 고를 수 있는 양식 — **전부**다. 공급사로 좁히지 않는다.
 * 어느 유형으로 계약할지는 상품·약정에서 정해질 일이지 공급사가 정하는 게 아니다.
 */
export function templatesForContract(_contract: EntityRecord | null | undefined): EsignTemplate[] {
  return ALL_TEMPLATES;
}

/**
 * 기본 선택 — 계약에 이미 유형이 박혀 있으면 그것, 없으면 렌탈 반납형.
 * 렌탈 반납형이 기본인 이유: 인수 약정이 없는 평범한 장기렌트가 가장 많다.
 */
export function defaultTemplateFor(contract: EntityRecord | null | undefined): EsignTemplate {
  const saved = S((contract as Record<string, unknown> | null)?.contract_kind);
  return (saved && findTemplate(saved)) || findTemplate('rent_return') || ALL_TEMPLATES[0];
}

/** 이 계약이 실제로 어느 양식으로 나갔나 — 발송 후에는 저장값이 정답이다. */
export function sentTemplateOf(contract: EntityRecord | null | undefined): EsignTemplate | null {
  const id = S((contract as Record<string, unknown> | null)?.esign_template_id);
  return id ? findTemplate(id) : null;
}

/** 발송 시 함께 고른 보험 주체. 구독에서만 갈리고, 렌탈은 늘 회사포함이다. */
export function sentInsuranceSide(contract: EntityRecord | null | undefined): InsuranceSide {
  const raw = S((contract as Record<string, unknown> | null)?.esign_insurance_side);
  return raw === '고객직접' ? '고객직접' : '회사포함';
}
