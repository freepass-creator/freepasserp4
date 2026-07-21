/**
 * 전자서명 파이프라인 — 계약서 발송 → 손님 서명(공개 링크) → 검토대기 → 관리자 승인 → 계약 진행.
 * 공개 열람/제출 = RTDB contract_sign/{token} (규칙상 비로그인 읽기·존재 후 쓰기).
 * 상태: 미발송 → 발송 → 검토대기 → 서명완료.
 */
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord } from '@/lib/intake/entities';
import { applyStepCheck } from '@/lib/domain/settlement-engine';
import {
  contractToSignPublic, readContractSign, signPublicToContract, writeContractSign,
} from '@/lib/firebase/contract-sign-public';

export type SignData = {
  customer_name: string; customer_phone: string; customer_id?: string; customer_address?: string;
  driver_license_no?: string; emergency_name?: string; emergency_phone?: string;
  signature: string; consents: string[];
};

export function makeSignToken(): string { return `sign_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

/** 계약서 발송 — 토큰 + contract 갱신 + 공개 슬롯(contract_sign) 기록.
 *  공개 슬롯 실패 시 throw — 손님 /sign 빈화면 방지(규칙 미배포 등). */
export async function createSignToken(contract: EntityRecord): Promise<string> {
  const co = getCompanyId();
  const token = String(contract.sign_token || '') || makeSignToken();
  const patch = { sign_token: token, sign_status: '발송', sign_sent_at: Date.now() };
  await getStore().update('contract', co, String(contract.contract_code), patch);
  try {
    await writeContractSign(token, contractToSignPublic({ ...contract, ...patch }, token, 'sent'));
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    console.warn('[sign] 공개 슬롯 기록 실패(규칙 배포 확인):', msg);
    throw new Error(`서명 공개 슬롯 저장 실패 — database rules 배포를 확인하세요. (${msg})`);
  }
  return token;
}

/** 공개 서명 페이지용 — 공개 슬롯 우선, 없으면 store(로그인 기기) fallback. */
export async function getContractByToken(token: string): Promise<EntityRecord | null> {
  const pub = await readContractSign(token);
  if (pub) return signPublicToContract(pub);
  try {
    const co = getCompanyId();
    const all = await getStore().list('contract', co);
    return all.find((c) => c.sign_token && String(c.sign_token) === token && c.contract_status !== '계약취소') || null;
  } catch {
    return null;
  }
}

/** 손님 서명 제출 — 공개 슬롯 갱신 + (가능하면) contract 동기화. */
export async function submitSign(contractCode: string, data: SignData, token?: string): Promise<void> {
  const co = getCompanyId();
  const patch: EntityRecord = {
    customer_name: data.customer_name, customer_phone: data.customer_phone,
    customer_id: data.customer_id || '', customer_address: data.customer_address || '',
    driver_license_no: data.driver_license_no || '', emergency_name: data.emergency_name || '', emergency_phone: data.emergency_phone || '',
    sign_signature: data.signature, sign_consents: data.consents.join(','),
    sign_status: '검토대기', sign_signed_at: Date.now(),
  };
  if (token) {
    await writeContractSign(token, {
      ...patch,
      contract_code: contractCode,
      status: 'pending_review',
      sign_status: '검토대기',
    });
  }
  try {
    await getStore().update('contract', co, contractCode, patch);
  } catch (e) {
    // 손님 비로그인: contract 쓰기 실패해도 공개 슬롯만으로 검토대기 유지.
    if (!token) throw e;
    console.warn('[sign] contract 동기화 스킵(공개 제출):', (e as Error).message);
  }
}

/** 관리자 승인 — 서명완료 + 약정발송 단계. 공개 슬롯도 signed. */
export async function approveSign(contract: EntityRecord): Promise<void> {
  const co = getCompanyId();
  const code = String(contract.contract_code);
  await getStore().update('contract', co, code, { sign_status: '서명완료', signed_pdf_url: '전자서명 완료' });
  const token = String(contract.sign_token || '');
  if (token) {
    try { await writeContractSign(token, { status: 'signed', sign_status: '서명완료', contract_code: code }); } catch { /* best-effort */ }
  }
  const fresh = (await getStore().get('contract', co, code)) || contract;
  if (fresh.provider_agreement_sent !== 'yes') await applyStepCheck(fresh, 'provider_agreement_sent', 'yes');
}
