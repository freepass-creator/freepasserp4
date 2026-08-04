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

/** RTDB transaction callback의 순수 판정 — null은 다른 계약 소유라 commit 중단. */
export function reserveVehicleClaim(
  current: VehicleClaimRecord | null,
  request: Omit<VehicleClaimRecord, 'status' | 'updated_at'>,
  now: number,
): VehicleClaimRecord | null {
  if (current?.contract_code && current.contract_code !== request.contract_code) return null;
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
