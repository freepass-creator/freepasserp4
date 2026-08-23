'use client';

import { getAuthClient } from '@/lib/firebase/client';

/** 운영 RTDB 정산은 금액을 받지 않는 서버 발행 API로만 생성한다. */
export async function issueSettlementFromClient(contractCode: string): Promise<string> {
  const code = String(contractCode || '').trim();
  const user = getAuthClient()?.currentUser;
  if (!user) throw new Error('정산 생성에는 로그인이 필요합니다.');
  const response = await fetch(`/api/contracts/${encodeURIComponent(code)}/settlement`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({})) as { error?: string; code?: unknown };
  if (!response.ok) throw new Error(payload.error || `정산 생성 실패 (${response.status})`);
  const issuedCode = String(payload.code || '').trim();
  if (!issuedCode) throw new Error('정산 생성 응답에 정산번호가 없습니다.');
  return issuedCode;
}
