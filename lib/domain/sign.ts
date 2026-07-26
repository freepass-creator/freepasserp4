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
  contractToSignPublic, isContractSignActive, readContractSign, SIGN_LINK_TTL_MS, signPublicToContract, writeContractSign,
} from '@/lib/firebase/contract-sign-public';

export type SignData = {
  customer_name: string; customer_phone: string; customer_id?: string; customer_address?: string;
  driver_license_no?: string; emergency_name?: string; emergency_phone?: string;
  signature: string; consents: string[];
};

export const SIGN_CONSENT_VERSION = 'v1';
export const SIGN_REQUIRED_CONSENTS = ['rental_terms', 'privacy', 'credit', 'gps', 'cms'] as const;
export const SIGN_REQUIRED_CONSENTS_VALUE = SIGN_REQUIRED_CONSENTS.join(',');
const LEGACY_SIGN_CONSENTS_VALUE = '렌터카 대여 계약 약관,개인정보 수집·이용,신용정보 조회·제공,차량 위치(GPS) 수집,자동결제(CMS) 출금';

export function normalizeSignConsents(consents: string[]): string {
  const selected = new Set(consents);
  if (!SIGN_REQUIRED_CONSENTS.every((consent) => selected.has(consent))) {
    throw new Error('필수 약관 동의가 누락되었습니다.');
  }
  return SIGN_REQUIRED_CONSENTS_VALUE;
}

export function validateSignData(data: SignData): void {
  const name = data.customer_name.trim();
  const phone = data.customer_phone.replace(/\D/g, '');
  if (!name || name.length > 40) throw new Error('성명은 1~40자로 입력해 주세요.');
  if (phone.length < 10 || phone.length > 11) throw new Error('올바른 연락처를 입력해 주세요.');
  if (!data.signature.startsWith('data:image/png;base64,') || data.signature.length > 600000) {
    throw new Error('유효한 PNG 전자서명이 필요합니다.');
  }
  normalizeSignConsents(data.consents);
}

export function signSubmissionPatch(contract: EntityRecord): EntityRecord {
  return {
    customer_name: contract.customer_name || '',
    customer_phone: contract.customer_phone || '',
    customer_id: contract.customer_id || '',
    customer_address: contract.customer_address || '',
    driver_license_no: contract.driver_license_no || '',
    emergency_name: contract.emergency_name || '',
    emergency_phone: contract.emergency_phone || '',
    sign_signature: contract.sign_signature || '',
    sign_consents: contract.sign_consents || '',
    sign_consent_version: contract.sign_consent_version || '',
    sign_signed_at: contract.sign_signed_at || null,
  };
}

export function scrubPublicSignSubmission(): EntityRecord {
  return {
    customer_name: null,
    customer_phone: null,
    customer_id: null,
    customer_address: null,
    driver_license_no: null,
    emergency_name: null,
    emergency_phone: null,
    sign_signature: null,
    sign_consents: null,
    sign_consent_version: null,
    sign_signed_at: null,
  };
}

export function publicSignRevocationPatch(contractCode: string, expiresAt: unknown, revokedAt: number): EntityRecord {
  return {
    contract_code: contractCode,
    status: 'revoked',
    sign_status: '미발송',
    revoked_at: revokedAt,
    expires_at: Number(expiresAt || revokedAt),
  };
}

export function canApproveSign(contract?: EntityRecord | null): boolean {
  const consents = String(contract?.sign_consents || '');
  return String(contract?.sign_status || '') === '검토대기'
    && String(contract?.sign_signature || '').startsWith('data:image/png')
    && (consents === SIGN_REQUIRED_CONSENTS_VALUE || consents === LEGACY_SIGN_CONSENTS_VALUE);
}

export function canResumeApprovedSign(contract?: EntityRecord | null): boolean {
  const consents = String(contract?.sign_consents || '');
  return String(contract?.sign_status || '') === '서명완료'
    && String(contract?.provider_agreement_sent || '') !== 'yes'
    && String(contract?.sign_signature || '').startsWith('data:image/png')
    && (consents === SIGN_REQUIRED_CONSENTS_VALUE || consents === LEGACY_SIGN_CONSENTS_VALUE);
}

export function makeSignToken(): string {
  const bytes = new Uint8Array(24);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return `sign_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
  }
  // 구형 WebView fallback. 최신 브라우저와 Node에서는 위 CSPRNG 경로를 사용한다.
  return `sign_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

/** 계약서 발송 — 토큰 + contract 갱신 + 공개 슬롯(contract_sign) 기록.
 *  공개 슬롯 실패 시 throw — 손님 /sign 빈화면 방지(규칙 미배포 등). */
export async function createSignToken(contract: EntityRecord): Promise<string> {
  const co = getCompanyId();
  const previousToken = String(contract.sign_token || '');
  const previousPublic = previousToken ? await readContractSign(previousToken) : null;
  const reuse = previousToken && isContractSignActive(previousPublic || contract);
  const token = reuse ? previousToken : makeSignToken();
  const now = Date.now();
  const patch = {
    sign_token: token, sign_status: '발송', sign_sent_at: now,
    sign_expires_at: reuse ? Number(previousPublic?.expires_at || contract.sign_expires_at) : now + SIGN_LINK_TTL_MS,
    sign_revoked_at: null,
  };
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

export async function revokeSignLink(contract: EntityRecord): Promise<void> {
  const co = getCompanyId();
  const code = String(contract.contract_code || '');
  const token = String(contract.sign_token || '');
  const now = Date.now();
  // 보안 우선 순서: 공개 링크를 먼저 막는다. 뒤의 계약 동기화가 실패해도 외부 링크는 살아나지 않는다.
  if (token) {
    await writeContractSign(token, publicSignRevocationPatch(code, contract.sign_expires_at, now));
  }
  await getStore().update('contract', co, code, {
    sign_status: '미발송', sign_revoked_at: now,
  });
}

/** 공개 서명 페이지용 — 공개 슬롯 우선, 없으면 store(로그인 기기) fallback. */
export async function getContractByToken(token: string): Promise<EntityRecord | null> {
  const pub = await readContractSign(token);
  if (pub) return isContractSignActive(pub) ? signPublicToContract(pub) : null;
  try {
    const co = getCompanyId();
    const all = await getStore().list('contract', co);
    return all.find((c) => (
      c.sign_token
      && String(c.sign_token) === token
      && c.contract_status !== '계약취소'
      && isContractSignActive(c)
    )) || null;
  } catch {
    return null;
  }
}

/** 손님 서명 제출 — 공개 슬롯 갱신 + (가능하면) contract 동기화. */
export async function submitSign(contractCode: string, data: SignData, token?: string): Promise<void> {
  const co = getCompanyId();
  validateSignData(data);
  const normalizedConsents = normalizeSignConsents(data.consents);
  const patch: EntityRecord = {
    customer_name: data.customer_name, customer_phone: data.customer_phone,
    customer_id: data.customer_id || '', customer_address: data.customer_address || '',
    driver_license_no: data.driver_license_no || '', emergency_name: data.emergency_name || '', emergency_phone: data.emergency_phone || '',
    sign_signature: data.signature, sign_consents: normalizedConsents, sign_consent_version: SIGN_CONSENT_VERSION,
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
  const pendingApproval = canApproveSign(contract);
  if (!pendingApproval && !canResumeApprovedSign(contract)) {
    throw new Error('검토대기 상태의 서명과 필수 동의가 확인된 계약만 승인할 수 있습니다.');
  }
  const co = getCompanyId();
  const code = String(contract.contract_code);
  if (pendingApproval) {
    await getStore().update('contract', co, code, {
      ...signSubmissionPatch(contract),
      sign_status: '서명완료',
      signed_pdf_url: '전자서명 완료',
    });
  }
  const token = String(contract.sign_token || '');
  if (token) {
    await writeContractSign(token, {
      ...scrubPublicSignSubmission(),
      status: 'signed',
      sign_status: '서명완료',
      contract_code: code,
    });
  }
  const fresh = (await getStore().get('contract', co, code)) || contract;
  // 전자서명 승인(영업자/관리자가 손님 서명 검토 후)이 provider 스텝(약정발송)을 진행하는 정당 경로 — 엔진 actor 인가 우회(system).
  if (fresh.provider_agreement_sent !== 'yes') await applyStepCheck(fresh, 'provider_agreement_sent', 'yes', { system: true });
}

/** 반려(재서명 요청) — 검토대기 서명을 되돌려 손님이 다시 서명하게 한다.
 *  공개 슬롯 status='sent'(=발송)로 되돌리면 /sign 폼이 다시 열리고, 제출 서명은 클리어, 사유는 손님에게 표시.
 *  오입력(주민번호·성명) 계약을 그대로 확정하거나 방치할 수밖에 없던 막힘 해소. */
export async function rejectSign(contract: EntityRecord, reason?: string): Promise<void> {
  const co = getCompanyId();
  const code = String(contract.contract_code);
  const rj = String(reason || '').slice(0, 200);
  await getStore().update('contract', co, code, {
    sign_status: '발송', sign_signature: '', sign_consents: '',
    sign_reject_reason: rj, sign_rejected_at: Date.now(),
  });
  const token = String(contract.sign_token || '');
  if (token) {
    try {
      await writeContractSign(token, {
        contract_code: code, status: 'sent', sign_status: '발송',
        sign_signature: '', reject_reason: rj,
      });
    } catch { /* best-effort */ }
  }
}
