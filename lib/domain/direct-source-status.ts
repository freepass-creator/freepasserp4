import { canonSheetVehicleStatus } from './sheet-import';

/**
 * 시트의 외부 계약 표기는 출고불가로 보수적으로 해석한다.
 * 손오공 ERP API의 hasActiveContract는 화면에 표시되는 현재 재고 상태이므로 계약중을 그대로 보존한다.
 */
export function directSourceStatusBase(rawStatus: unknown, sourceKind: 'sheet' | 'iron' | 'sonokong'): string {
  const raw = String(rawStatus ?? '').trim();
  if (sourceKind === 'sonokong' && raw === '계약중') return '계약중';
  return canonSheetVehicleStatus(raw);
}
