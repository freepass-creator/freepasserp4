export const SOURCE_EXIT_REASON = '원천 이탈(직접수집)';

export function sourceExitPatch(at: number): Record<string, unknown> {
  return {
    listable: false,
    vehicle_status: '출고불가',
    status: '출고불가',
    status_kind: '불가',
    status_reason: SOURCE_EXIT_REASON,
    _direct_ingest_at: at,
  };
}

export function sourceSnapshotSafeToRetire(sourceCount: number, currentlyListable: number): boolean {
  return currentlyListable === 0 || sourceCount >= currentlyListable * 0.5;
}

export function isContractLocked(value: Record<string, unknown>): boolean {
  const text = (item: unknown) => String(item ?? '').trim();
  return text(value.status) === '계약중'
    || text(value.status_kind) === '선점'
    || Boolean(text(value.locked_by_contract))
    || text(value.vehicle_status) === '계약중';
}
