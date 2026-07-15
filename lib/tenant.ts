/**
 * 테넌트 컨텍스트 — 현재 회사(companyId). 멀티테넌트 격리 기준.
 * 프리패스 v4는 단일 회사(freepass) 기본. 추후 인증 세션(로그인 계정의 회사)에서 파생.
 */
const KEY = 'freepasserp4_company';
const DEFAULT_CO = 'freepass';

export function getCompanyId(): string {
  if (typeof window === 'undefined') return DEFAULT_CO;
  return localStorage.getItem(KEY) || DEFAULT_CO;
}

export function setCompanyId(id: string): void {
  if (typeof window !== 'undefined') localStorage.setItem(KEY, id);
}
