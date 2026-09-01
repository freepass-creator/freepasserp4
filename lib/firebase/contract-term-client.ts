'use client';

import { getAuthClient } from '@/lib/firebase/client';
import { patchListCache } from '@/lib/store';
import type { EntityRecord } from '@/lib/intake/entities';

export async function completeContractAgreementFromClient(
  companyId: string,
  contractCode: string,
  rentMonth: number,
  customerName: string,
  customerPhone: string,
): Promise<void> {
  const code = String(contractCode || '').trim();
  const user = getAuthClient()?.currentUser;
  if (!user) throw new Error('약정 완료에는 로그인이 필요합니다.');
  const response = await fetch(`/api/contracts/${encodeURIComponent(code)}/term-freeze`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ rentMonth, customerName, customerPhone, completeAgreement: true }),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({})) as { error?: unknown; contractPatch?: EntityRecord };
  if (!response.ok) throw new Error(String(payload.error || `약정 완료 실패 (${response.status})`));
  if (payload.contractPatch && typeof payload.contractPatch === 'object') {
    patchListCache('contract', companyId, code, payload.contractPatch);
  }
}
