import type { EntityRecord } from '@/lib/intake/entities';

export const VEHICLE_CLAIM_STEP_KEYS = ['agent_balance_paid', 'provider_balance_confirmed'] as const;
export type VehicleClaimStepKey = (typeof VEHICLE_CLAIM_STEP_KEYS)[number];

export type VehicleClaimActor = {
  uid: string;
  role: 'agent' | 'provider' | 'admin';
  rawRole: string;
  companyCode: string;
  agentChannelCode: string;
};

export type VehicleClaimRecord = {
  contract_code: string;
  product_code: string;
  identity_hash: string;
  status: 'claiming' | 'active' | 'releasing';
  updated_at: number;
  actor_uid: string;
};

const text = (value: unknown): string => String(value ?? '').trim();

export function isVehicleClaimStepKey(value: string): value is VehicleClaimStepKey {
  return (VEHICLE_CLAIM_STEP_KEYS as readonly string[]).includes(value);
}

export function canTransitionVehicleClaim(
  actor: VehicleClaimActor,
  contract: EntityRecord,
  key: VehicleClaimStepKey,
): boolean {
  if (actor.role === 'admin') return true;
  if (key === 'agent_balance_paid') {
    if (actor.role !== 'agent') return false;
    if (text(contract.agent_uid) === actor.uid) return true;
    const manager = actor.rawRole === 'agent_admin' || actor.rawRole === 'agent_manager';
    return manager && !!actor.agentChannelCode && text(contract.agent_channel_code) === actor.agentChannelCode;
  }
  return actor.role === 'provider'
    && !!actor.companyCode
    && text(contract.provider_company_code) === actor.companyCode;
}

/**
 * 중간에 죽은 선점을 회수할 수 있는 시간. 선점은 transaction('claiming') → multipath update('active')
 * 두 단계라, 그 사이에서 함수가 죽으면 'claiming' 이 그대로 남는다. 그걸 회수하지 않으면
 * **그 차는 영원히 아무도 못 판다** — 클라이언트는 v4/vehicle_claims 를 읽지도 못해
 * 「다른 계약(확인 중)이 먼저 선점했습니다」라는, 존재하지 않는 계약을 가리키는 메시지만 본다.
 *
 * 2분은 정상 in-flight 를 뺏지 않기 위한 값이다. 두 단계 사이는 정상이면 수십 ms 이고
 * 서버리스 함수 자체가 그보다 훨씬 먼저 종료된다 — 2분이 지난 'claiming' 은 살아있는 요청이 아니다.
 */
export const STALE_VEHICLE_CLAIM_MS = 2 * 60 * 1000;

/**
 * RTDB transaction callback의 순수 판정 — null은 다른 계약 소유라 commit 중단.
 *
 * 회수는 **`status !== 'active'` 인 것만** 대상이다. 'active' = 선점이 끝까지 성공한 상태이므로
 * 아무리 오래돼도 뺏지 않는다(그 차는 실제로 팔린 것이다). 회수 대상은 중간에 죽은
 * 'claiming'·'releasing' 뿐이라, 정상 선점이 시간 때문에 풀리는 일은 없다.
 */
export function reserveVehicleClaim(
  current: VehicleClaimRecord | null,
  request: Omit<VehicleClaimRecord, 'status' | 'updated_at'>,
  now: number,
): VehicleClaimRecord | null {
  if (current?.contract_code && current.contract_code !== request.contract_code) {
    const stale = current.status !== 'active'
      && now - Number(current.updated_at || 0) > STALE_VEHICLE_CLAIM_MS;
    if (!stale) return null;
  }
  return { ...request, status: 'claiming', updated_at: now };
}

export function markVehicleClaimReleasing(
  current: VehicleClaimRecord | null,
  contractCode: string,
  now: number,
): VehicleClaimRecord | null {
  if (!current) return null;
  if (current.contract_code !== contractCode) return null;
  return { ...current, status: 'releasing', updated_at: now };
}
