import { buildAtomRefs } from '@/lib/domain/atom-projection';
import { joinPolicy } from '@/lib/domain/atom-health';
import { autoPolicyCode } from '@/lib/domain/supplier-policy-link';

type Rec = Record<string, any>;

/**
 * 정책 값 SSOT 규정.
 *
 * - Firestore `policy` 원자만 정책 값의 원장이다.
 * - 상품의 `policy_code`는 원장을 가리키는 연결키일 뿐 값의 대체물이 아니다.
 * - `_policy`는 과거 파생본이므로 소비자가 계약·가격·보험 조건을 판단하는 근거가 될 수 없다.
 * - 기본팩은 정책을 작성할 때 명시적으로 저장하는 템플릿이고, 읽는 곳에서 빈 값을 채우지 않는다.
 */
export const POLICY_VALUE_SSOT = 'firestore-policy-record-v1' as const;

export type PolicyResolutionStatus =
  | 'resolved-explicit'
  | 'resolved-auto-unambiguous'
  | 'hold-orphan-code'
  | 'hold-ambiguous-or-missing';

export type ResolvedPolicy = {
  status: PolicyResolutionStatus;
  policy: Rec | null;
  /** 실제 Firestore 원자에서 확인한 업무 정책코드. */
  policyCode: string | null;
  /** 실제 Firestore 문서 키. */
  policyKey: string | null;
  /** 자동 연결은 공급사 안에서 하나로 결정될 때만 허용한다. */
  linkage: 'explicit' | 'auto-unambiguous' | null;
};

const S = (value: unknown) => String(value ?? '').trim();

/**
 * 모든 소비처가 공유해야 하는 상품→정책 연결 해석기.
 * 정책값을 보충하거나 `_policy` fallback을 읽지 않는다. 연결되지 않으면 HOLD다.
 */
export function createPolicyResolver(policies: Rec[]): (product: Rec) => ResolvedPolicy {
  const refs = buildAtomRefs(policies);
  return (product: Rec) => {
    const explicit = S(product.policy_code);
    const code = autoPolicyCode(product, refs.byProvider);
    const policy = code ? joinPolicy(refs.policyByCode, code) as Rec | null : null;
    if (policy) {
      return {
        status: explicit ? 'resolved-explicit' : 'resolved-auto-unambiguous',
        policy,
        policyCode: S(policy.policy_code || code) || null,
        policyKey: S(policy._key) || null,
        linkage: explicit ? 'explicit' : 'auto-unambiguous',
      };
    }
    return {
      status: explicit ? 'hold-orphan-code' : 'hold-ambiguous-or-missing',
      policy: null,
      policyCode: explicit || null,
      policyKey: null,
      linkage: null,
    };
  };
}

/** 계약은 자동 연결·상품 내장 파생본을 허용하지 않는다. 명시 정책 원자만 봉인할 수 있다. */
export function resolveExplicitContractPolicy(policies: Rec[], policyCode: unknown): ResolvedPolicy {
  const code = S(policyCode);
  if (!code) {
    return { status: 'hold-ambiguous-or-missing', policy: null, policyCode: null, policyKey: null, linkage: null };
  }
  const refs = buildAtomRefs(policies);
  const policy = joinPolicy(refs.policyByCode, code) as Rec | null;
  if (!policy) return { status: 'hold-orphan-code', policy: null, policyCode: code, policyKey: null, linkage: null };
  return {
    status: 'resolved-explicit', policy, policyCode: S(policy.policy_code || code) || code,
    policyKey: S(policy._key) || null, linkage: 'explicit',
  };
}
