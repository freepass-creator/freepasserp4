/**
 * 회사(테넌트) 레지스트리 — session·store 공유.
 * 프리패스 v4는 지금 단일 회사(freepass)로 운영. 멀티테넌트 seam(companyId 스코프)은 유지 →
 * 추후 제품화(다른 렌터카 업체 입점) 시 회사만 추가하면 store/ui가 그대로 격리·구분.
 */
export const COMPANIES = ['freepass'];
export const ALL_COMPANIES = '__ALL__';

export const COMPANY_LABELS: Record<string, string> = {
  freepass: '프리패스모빌리티',
};
export function companyLabel(id: unknown): string {
  const s = String(id || '');
  if (s === ALL_COMPANIES) return '전체';
  return COMPANY_LABELS[s] || s || '—';
}

export const COMPANY_SHORT: Record<string, string> = { freepass: '프리패스' };
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
