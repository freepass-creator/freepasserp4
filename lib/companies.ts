/**
 * 회사(테넌트) 레지스트리 — session·store 공유.
 * 단일 회사 운영. 표시명은 플랫폼 브랜드(BRAND). 멀티테넌트 seam(companyId)은 유지.
 */
import { BRAND } from '@/lib/brand';

export const COMPANIES = ['freepass'];
export const ALL_COMPANIES = '__ALL__';

export const COMPANY_LABELS: Record<string, string> = {
  freepass: BRAND,
};
export function companyLabel(id: unknown): string {
  const s = String(id || '');
  if (s === ALL_COMPANIES) return '전체';
  return COMPANY_LABELS[s] || s || '—';
}

export const COMPANY_SHORT: Record<string, string> = { freepass: BRAND };
export function companyShort(id: unknown): string {
  const s = String(id || '');
  return COMPANY_SHORT[s] || COMPANY_LABELS[s] || s;
}

// 회사별 구분 색(뱃지 톤). freepass=네이비 계열(blue), 그 외는 해시로 안정 배정.
export function companyTone(id: unknown): 'blue' | 'green' | 'purple' | 'teal' | 'orange' | 'amber' | 'gray' {
  const s = String(id || '');
  const fixed: Record<string, 'blue' | 'green' | 'purple' | 'teal'> = { freepass: 'blue' };
  if (fixed[s]) return fixed[s];
  if (!s || s === ALL_COMPANIES) return 'gray';
  const pool = ['teal', 'orange', 'amber', 'blue', 'green', 'purple'] as const;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}
