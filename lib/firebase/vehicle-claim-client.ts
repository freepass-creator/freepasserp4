'use client';

import { getAuthClient } from '@/lib/firebase/client';
import { patchListCache } from '@/lib/store';
import type { EntityRecord } from '@/lib/intake/entities';
import type { VehicleClaimStepKey } from '@/lib/domain/vehicle-claim';

type TransitionResult = {
  contractCode: string;
  productCode: string;
  contractPatch: EntityRecord;
  productPatch: EntityRecord;
};

export function atomicVehicleClaimsEnabled(backend: string): boolean {
  return backend.startsWith('rtdb') && process.env.NEXT_PUBLIC_ATOMIC_VEHICLE_CLAIMS === 'true';
}

async function callVehicleClaim(body: Record<string, unknown>): Promise<TransitionResult | null> {
  const user = getAuthClient()?.currentUser;
  if (!user) throw new Error('차량 선점에는 로그인이 필요합니다.');
  const response = await fetch('/api/contracts/vehicle-claim', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; result?: TransitionResult | null };
  if (!response.ok) throw new Error(payload.error || `차량 선점 처리 실패 (${response.status})`);
  return payload.result || null;
}

function applyCache(companyId: string, result: TransitionResult | null) {
  if (!result) return;
  if (result.contractPatch && Object.keys(result.contractPatch).length) {
    patchListCache('contract', companyId, result.contractCode, result.contractPatch);
  }
  if (result.productPatch && Object.keys(result.productPatch).length) {
    patchListCache('product', companyId, result.productCode, result.productPatch);
  }
}

export async function transitionVehicleClaimFromClient(
  companyId: string,
  contractCode: string,
  key: VehicleClaimStepKey,
  value: string,
): Promise<void> {
  applyCache(companyId, await callVehicleClaim({ contractCode, key, value }));
}

export async function releaseCancelledVehicleClaimFromClient(companyId: string, contractCode: string): Promise<void> {
  applyCache(companyId, await callVehicleClaim({ action: 'release_cancelled', contractCode }));
}
