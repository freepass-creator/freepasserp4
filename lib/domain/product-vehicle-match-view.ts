export const STRICT_VEHICLE_CODE_CONFIRMED = '확정 코드 정상' as const;

export const PRODUCT_VEHICLE_MATCH_STATUS_STYLES = [
  { header: '상품 운영상태', value: '운영', background: '#DCFCE7', foreground: '#166534' },
  { header: '상품 운영상태', value: '검수필요', background: '#FFEDD5', foreground: '#9A3412' },
  { header: '차량상태', value: '즉시출고', background: '#D1FAE5', foreground: '#065F46' },
  { header: '차량상태', value: '출고가능', background: '#DBEAFE', foreground: '#1E40AF' },
  { header: '차량상태', value: '상품화중', background: '#E0E7FF', foreground: '#3730A3' },
  { header: '차량상태', value: '출고협의', background: '#FEF3C7', foreground: '#92400E' },
  { header: '차량상태', value: '계약중', background: '#F3E8FF', foreground: '#6B21A8' },
  { header: '차량상태', value: '출고불가', background: '#FEE2E2', foreground: '#991B1B' },
] as const;

export const HIERARCHY_LINKED_CATEGORIES = new Set([
  '계층 단일매칭',
  '계층 기본트림 보완',
  '연식 세부모델 추정매칭',
  '등록연도 세부모델 추정매칭',
  '연식 기본트림 추정매칭',
  '등록연도 기본트림 추정매칭',
  '등록연월 기본트림 추정매칭',
  '기존 확정코드 교차연결',
]);

export type ProductVehicleCoverageRow = {
  category?: unknown;
  current_code?: unknown;
  current_axis_conflict?: unknown;
  reason?: unknown;
};

export type ProductVehicleHierarchyRow = {
  hierarchy_category?: unknown;
  resolution_bucket?: unknown;
};

/** 사람 3축 검토 결정(있으면 조회탭 상태·사유에 반영) */
export type ProductVehicleMatchReviewDecision = {
  decision?: unknown;
  model?: unknown;
  sub_model?: unknown;
  trim?: unknown;
  basis?: unknown;
};

export type ProductVehicleMatchViewClassification = {
  operatorStatus: '확정' | '확인 필요';
  codeStatus: '차종코드 확정' | '검토 필요' | '3축확정' | '트림미확정' | '원천확인';
  hierarchyStatus: '계층 후보 있음' | '계층 후보 미해결';
  strictConfirmed: boolean;
  hierarchyLinked: boolean;
  reviewReason: string;
  tripleDecisionLabel: string;
  tripleDecisionScope: string;
};

const text = (value: unknown) => String(value ?? '').trim();

const decisionLabel = (decision: string) => {
  if (decision === 'CODE' || decision === 'TRIPLE') return '3축확정';
  if (decision === 'PARTIAL') return '트림미확정';
  if (decision === 'HOLD') return '원천확인';
  return '';
};

export const classifyProductVehicleMatchView = (
  audit: ProductVehicleCoverageRow,
  hierarchy: ProductVehicleHierarchyRow,
  review?: ProductVehicleMatchReviewDecision | null,
): ProductVehicleMatchViewClassification => {
  const strictConfirmed = text(audit.category) === STRICT_VEHICLE_CODE_CONFIRMED
    && Boolean(text(audit.current_code))
    && !audit.current_axis_conflict;
  // 엄격 확정행은 current_code 자체가 영구키 계층을 가리킨다. 독립 hierarchy 감사가
  // 원문 별칭을 못 읽었더라도 현재 키의 계층 표시까지 미해결로 내리지 않는다.
  const hierarchyLinked = strictConfirmed || HIERARCHY_LINKED_CATEGORIES.has(text(hierarchy.hierarchy_category));
  const decided = decisionLabel(text(review?.decision));
  const triple = [text(review?.model), text(review?.sub_model), text(review?.trim)].filter(Boolean).join(' › ');
  const tripleDecisionScope = decided
    ? `[3축 결정(사람검토)] ${decided}${triple ? ` · ${triple}` : ''}`
    : '';
  const reviewReason = strictConfirmed && !decided ? '' : [...new Set([
    tripleDecisionScope,
    decided ? '' : text(audit.category),
    decided ? '' : text(audit.reason),
    decided ? '' : text(hierarchy.resolution_bucket),
    !decided && audit.current_axis_conflict ? '현재 차종코드와 명시 식별축 불일치' : '',
    text(review?.basis),
  ].filter(Boolean))].join(' · ');

  let codeStatus: ProductVehicleMatchViewClassification['codeStatus'] = strictConfirmed ? '차종코드 확정' : '검토 필요';
  if (!strictConfirmed && decided === '3축확정') codeStatus = '3축확정';
  if (!strictConfirmed && decided === '트림미확정') codeStatus = '트림미확정';
  if (!strictConfirmed && decided === '원천확인') codeStatus = '원천확인';

  return {
    operatorStatus: strictConfirmed ? '확정' : '확인 필요',
    codeStatus,
    hierarchyStatus: hierarchyLinked ? '계층 후보 있음' : '계층 후보 미해결',
    strictConfirmed,
    hierarchyLinked,
    reviewReason,
    tripleDecisionLabel: decided,
    tripleDecisionScope,
  };
};

export const summarizeProductVehicleMatchView = (
  rows: ProductVehicleMatchViewClassification[],
) => ({
  total: rows.length,
  strictConfirmed: rows.filter((row) => row.strictConfirmed).length,
  strictReview: rows.filter((row) => !row.strictConfirmed).length,
  hierarchyLinked: rows.filter((row) => row.hierarchyLinked).length,
  hierarchyReview: rows.filter((row) => !row.hierarchyLinked).length,
  strictConfirmedWithoutHierarchy: rows.filter((row) => row.strictConfirmed && !row.hierarchyLinked).length,
});
