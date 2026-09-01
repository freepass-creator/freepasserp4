/**
 * 원본 → 정제시트 → 판매시트 → ERP 상태 흐름을 판정하는 순수 규칙.
 *
 * 실제 값의 정규화와 각 층의 읽기는 호출자가 맡는다. 여기서는 읽기 실패를
 * 빈 값으로 오인하지 않고, 계약 잠금·ERP 단독 출고불가를 자동 오류로 단정하지 않는다.
 */
export type StatusLayerName = 'origin' | 'refined' | 'sales' | 'erp';
export type StatusVerdict = 'normal' | 'drift' | 'review' | 'unknown';

export type StatusObservation = {
  /** 이 차량에 대해 이 층을 신뢰성 있게 읽었는가. */
  known: boolean;
  /** 층에 차량 행/레코드가 존재하는가. */
  present: boolean;
  /** 유입 규칙으로 정규화한 상태. */
  status?: string;
  /** ERP 계약 잠금처럼 상류 상태와 달라도 정상일 수 있는 보호 상태. */
  locked?: boolean;
};

export type StatusBoundary = {
  from: StatusLayerName;
  to: StatusLayerName;
  verdict: StatusVerdict;
  reason: string;
};

export type StatusAssessment = {
  boundaries: StatusBoundary[];
  driftCount: number;
  reviewCount: number;
  unknownCount: number;
};

const LABEL: Record<StatusLayerName, string> = {
  origin: '원본',
  refined: '정제시트',
  sales: '판매시트',
  erp: 'ERP',
};

const blocked = (status: string | undefined) => status === '출고불가';

function assessBoundary(
  from: StatusLayerName,
  to: StatusLayerName,
  left: StatusObservation,
  right: StatusObservation,
): StatusBoundary {
  const route = LABEL[from] + ' → ' + LABEL[to];
  if (!left.known || !right.known) {
    return { from, to, verdict: 'unknown', reason: route + ' 판독 불완전 — 부재나 원인을 판정하지 않음' };
  }
  if (!left.present && !right.present) {
    return { from, to, verdict: 'normal', reason: route + ' 모두 없음' };
  }
  if (!left.present) {
    if (right.present && blocked(right.status)) {
      return { from, to, verdict: 'normal', reason: route + ' 상류 부재를 하류 출고불가 이력으로 보존' };
    }
    return { from, to, verdict: 'drift', reason: route + ' ' + LABEL[from] + '에는 없는데 하류에 ' + (right.status || '상태 없음') + '으로 남음' };
  }
  if (!right.present) {
    if (blocked(left.status)) {
      return { from, to, verdict: 'normal', reason: route + ' 상류 출고불가라 하류에서 제외됨' };
    }
    return { from, to, verdict: 'drift', reason: route + ' 상류 ' + (left.status || '상태 없음') + '인데 하류에 없음' };
  }

  const fromStatus = left.status || '';
  const toStatus = right.status || '';
  if (fromStatus === toStatus) {
    return { from, to, verdict: 'normal', reason: route + ' 상태 일치' };
  }
  if (to === 'erp' && (right.locked || toStatus === '계약중')) {
    return {
      from,
      to,
      verdict: 'review',
      reason: route + ' ' + fromStatus + ' → ' + toStatus + ' (계약 잠금 — ERP 보호 상태를 사람 검토)',
    };
  }
  if (to === 'erp' && toStatus === '출고불가' && fromStatus !== '출고불가') {
    return {
      from,
      to,
      verdict: 'review',
      reason: route + ' ' + fromStatus + ' → 출고불가 (수기 보류·원본 부재·상태 변경 이력을 사람 검토)',
    };
  }
  return {
    from,
    to,
    verdict: 'drift',
    reason: route + ' 상태 갈림: ' + fromStatus + ' → ' + toStatus,
  };
}

export function assessStatusPipeline(input: Record<StatusLayerName, StatusObservation>): StatusAssessment {
  const boundaries = [
    assessBoundary('origin', 'refined', input.origin, input.refined),
    assessBoundary('refined', 'sales', input.refined, input.sales),
    assessBoundary('sales', 'erp', input.sales, input.erp),
  ];
  return {
    boundaries,
    driftCount: boundaries.filter((item) => item.verdict === 'drift').length,
    reviewCount: boundaries.filter((item) => item.verdict === 'review').length,
    unknownCount: boundaries.filter((item) => item.verdict === 'unknown').length,
  };
}
