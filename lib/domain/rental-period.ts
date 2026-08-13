const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function rentalPeriodText(months: unknown): string {
  const count = Number(months);
  return Number.isInteger(count) && count > 0 ? `차량 인도일로부터 ${count}개월` : '';
}

/**
 * 차량 인도일을 첫날로 포함한 N개월의 종료일.
 * 민법 제160조형 역법 계산: 대응일이 있으면 그 전일, 없으면 최종 월 말일.
 */
export function rentalPeriodEnd(start: string, months: unknown): string {
  const match = DATE_RE.exec(String(start || '').trim());
  const count = Number(months);
  if (!match || !Number.isInteger(count) || count <= 0) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const source = new Date(Date.UTC(year, month - 1, day));
  if (source.toISOString().slice(0, 10) !== `${match[1]}-${match[2]}-${match[3]}`) return '';

  const targetIndex = month - 1 + count;
  const targetYear = year + Math.floor(targetIndex / 12);
  const targetMonth = ((targetIndex % 12) + 12) % 12;
  const targetLastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const target = day <= targetLastDay
    ? new Date(Date.UTC(targetYear, targetMonth, day - 1))
    : new Date(Date.UTC(targetYear, targetMonth, targetLastDay));
  return target.toISOString().slice(0, 10);
}

export function handoverStartOf(contract: Record<string, unknown>): string {
  const handover = contract.esign_handover && typeof contract.esign_handover === 'object'
    ? contract.esign_handover as Record<string, unknown>
    : {};
  return String(
    handover.contract_start
      || handover.handover_datetime
      || contract.handover_datetime
      || contract.contract_start
      || '',
  ).trim();
}
