import 'server-only';

import { buildAtomRefs } from '@/lib/domain/atom-projection';
import { joinPolicy } from '@/lib/domain/atom-health';
import { autoPolicyCode } from '@/lib/domain/supplier-policy-link';

type Rec = Record<string, any>;
export type PublicPolicyResolution = {
  policy: Rec | null;
  /** 외부 정책 원자면 기존 표준 pack 보충을 허용하고, 상품 내장 fallback은 원문만 보낸다. */
  applyDefaults: boolean;
};

function embeddedPolicy(product: Rec): Rec | null {
  const policy = product._policy;
  return policy && typeof policy === 'object' && !Array.isArray(policy) ? policy as Rec : null;
}

/**
 * 공개 목록·상세가 같은 정책 해소 규칙을 쓴다.
 *
 * 1. 기존 원자 SSOT가 해소한 실제 policy 원자를 우선한다(문서 ID·업무코드·_S/_P 보정 포함).
 * 2. 유효 정책코드가 고아면 fail-closed 한다. 오래된 파생 `_policy`로 현재 정책을 대체하지 않는다.
 * 3. 정책코드 자체가 없는 경우에만 상품에 이미 저장된 정책 객체를 통째로 보존한다.
 * 4. 둘 다 없거나 공급사 내 연결이 모호하면 null이다. 기본 보험을 만들어 내지 않는다.
 */
export function createPublicPolicyResolver(policies: Rec[]): (product: Rec) => PublicPolicyResolution {
  const refs = buildAtomRefs(policies);
  return (product: Rec) => {
    const code = autoPolicyCode(product, refs.byProvider);
    const linked = code ? joinPolicy(refs.policyByCode, code) : null;
    if (linked) return { policy: linked as Rec, applyDefaults: true };
    if (code) return { policy: null, applyDefaults: false };
    return { policy: embeddedPolicy(product), applyDefaults: false };
  };
}
