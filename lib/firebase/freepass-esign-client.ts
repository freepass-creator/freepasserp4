'use client';

import { getAuthClient } from '@/lib/firebase/client';

export type CreateFreepassDirectContractInput = {
  requestId: string;
  productCode: string;
  policyCode: string;
  contractDate: string;
  rentMonths: number;
  annualMileage: string;
  priceVariantKey: string;
  driverAge: number;
  maturity: '반납형' | '인수형';
  depositInstallment: string;
  paymentTiming: '선불' | '후불';
  specialTermsChoice: '없음' | '있음';
  specialTerms?: string;
  buyoutPrice?: string;
  driverScope?: string;
  maintenanceProduct?: string;
};

/**
 * 직접 전자계약은 브라우저가 RTDB 계약을 만들지 않는다. 서버가 상품·정책·가격·요율을
 * 재계산해 공개 계약 projection과 private seal을 한 번에 만든다.
 */
export async function createFreepassDirectContract(input: CreateFreepassDirectContractInput): Promise<string> {
  const user = getAuthClient()?.currentUser;
  if (!user) throw new Error('계약서 생성에는 로그인이 필요합니다.');
  const request = async (forceRefresh = false) => fetch('/api/freepass-esign/contracts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await user.getIdToken(forceRefresh)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
  let response = await request(false);
  if (response.status === 401) response = await request(true);
  const payload = await response.json().catch(() => ({})) as { error?: string; contractCode?: unknown };
  if (!response.ok) throw new Error(payload.error || `계약서 생성 실패 (${response.status})`);
  const contractCode = String(payload.contractCode || '').trim();
  if (!contractCode) throw new Error('계약서 생성 응답에 계약번호가 없습니다.');
  return contractCode;
}
