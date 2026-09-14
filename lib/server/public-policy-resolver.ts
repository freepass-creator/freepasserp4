import 'server-only';

import { createPolicyResolver, type ResolvedPolicy } from '@/lib/domain/policy-resolution';

type Rec = Record<string, any>;
export type PublicPolicyResolution = {
  policy: Rec | null;
  /** 정책값은 Firestore 원장에 저장된 값 그대로만 공개한다. */
  applyDefaults: false;
  resolution: ResolvedPolicy;
};

/**
 * 공개 목록·상세가 같은 정책 해소 규칙을 쓴다.
 *
 * 공통 정책 SSOT 해석기를 그대로 쓴다. 상품 내장 `_policy`와 읽기 시점 기본값은
 * 모두 금지한다. 원장이 없거나 모호하면 공개 화면도 정책을 약속하지 않는다.
 */
export function createPublicPolicyResolver(policies: Rec[]): (product: Rec) => PublicPolicyResolution {
  const resolve = createPolicyResolver(policies);
  return (product: Rec) => {
    const resolution = resolve(product);
    return { policy: resolution.policy, applyDefaults: false, resolution };
  };
}
