/** V3 영문값과 V4 한글값을 하나의 파트너 유형 표기로 정규화한다. */
export const UNCLASSIFIED_PARTNER_TYPE = '분류 필요';

export function partnerTypeLabel(value: unknown, partnerCode?: unknown): string {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');

  if (normalized === 'provider' || raw === '공급사') return '공급사';
  if (normalized === 'sales_channel' || raw === '영업채널' || raw === '채널') return '영업채널';
  if (normalized === 'operator' || raw === '운영사') return '운영사';

  const code = String(partnerCode || '').trim().toUpperCase();
  if (!raw || raw === '파트너') {
    if (code.startsWith('RP')) return '공급사';
    if (code.startsWith('SP')) return '영업채널';
    return UNCLASSIFIED_PARTNER_TYPE;
  }

  return raw || UNCLASSIFIED_PARTNER_TYPE;
}
