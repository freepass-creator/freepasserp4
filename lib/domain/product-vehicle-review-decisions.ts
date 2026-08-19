/**
 * 상품 차종 검토 결정 — 사람(사장님/Claude)이 차량번호별로 내린 3축 판단의 정본 로더.
 *
 * ★범위는 모델·세부모델·세부트림 3축(사장님 2026-08-18 확정). 파일: `data/product-vehicle-review-decisions.json`.
 * - 감사기(백로그)·발행기(판매시트)·개편 계획이 같은 파일을 읽는다. 결정은 여기 한 곳에만 둔다.
 * - 코드(트림행키)는 결정이 CODE 일 때만 있고, 그때도 상품마스터 write 는 guarded writer 가 한다.
 */
import { readFileSync } from 'node:fs';

export type ProductVehicleReviewDecisionKind = 'CODE' | 'TRIPLE' | 'PARTIAL' | 'HOLD';
export type ProductVehicleReviewMasterAction = '' | 'UNBLOCK' | 'ADD_ROW' | 'PERIOD_FIX' | 'ALIAS';

export type ProductVehicleReviewDecision = {
  car_number: string;
  provider: string;
  supplier_text: string;
  maker: string;
  model: string;
  sub_model: string;
  trim: string;
  /** decision=CODE 일 때 반영할 automatic 영구키 */
  trim_row_key: string;
  /** TRIPLE 인데 같은 뜻의 blocked/manual 행이 있을 때 그 키(반영 안 함, 승격 검토용) */
  candidate_key?: string;
  /** [자동합의] TRIPLE — 3축이 같은 automatic 후보 전부(차이축은 인승·구동 등). 채택 이름을 끌어오는 데 쓴다 */
  candidate_keys?: string[];
  decision: ProductVehicleReviewDecisionKind;
  master_action: ProductVehicleReviewMasterAction;
  basis: string;
  /** 상품마스터에 코드가 있어도 세부트림이 틀린 것으로 검토됐을 때 — 표시(정규화)에서 결정 3축이 코드를 이긴다 */
  overrides_current_code?: boolean;
};

export type ProductVehicleReviewDecisionsFile = {
  version: number;
  scope: string;
  reviewed_by: string;
  reviewed_at: string;
  decisions: ProductVehicleReviewDecision[];
};

export const PRODUCT_VEHICLE_REVIEW_DECISIONS_PATH = 'data/product-vehicle-review-decisions.json';

const S = (value: unknown) => String(value ?? '').trim();
const plate = (value: unknown) => S(value).replace(/\s/g, '');

export function loadProductVehicleReviewDecisions(path = PRODUCT_VEHICLE_REVIEW_DECISIONS_PATH): ProductVehicleReviewDecisionsFile {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as ProductVehicleReviewDecisionsFile;
  if (!Array.isArray(parsed.decisions)) throw new Error('결정 파일에 decisions 배열이 없음');
  const kinds = new Set(['CODE', 'TRIPLE', 'PARTIAL', 'HOLD']);
  const seen = new Set<string>();
  for (const d of parsed.decisions) {
    d.car_number = plate(d.car_number);
    if (!d.car_number) throw new Error('결정에 차량번호 없음');
    if (seen.has(d.car_number)) throw new Error(`결정 차량번호 중복: ${d.car_number}`);
    seen.add(d.car_number);
    if (!kinds.has(d.decision)) throw new Error(`${d.car_number}: 알 수 없는 decision ${d.decision}`);
    if (d.decision === 'CODE' && !S(d.trim_row_key)) throw new Error(`${d.car_number}: CODE 결정인데 trim_row_key 없음`);
    if (d.decision !== 'CODE' && S(d.trim_row_key) && d.decision !== 'TRIPLE') {
      throw new Error(`${d.car_number}: ${d.decision} 결정에 trim_row_key 가 있음`);
    }
  }
  return parsed;
}

/** 차량번호 → 결정. 감사기·발행기가 쓴다. */
export function productVehicleReviewDecisionMap(file = loadProductVehicleReviewDecisions()): Map<string, ProductVehicleReviewDecision> {
  return new Map(file.decisions.map((d) => [d.car_number, d]));
}

/** 검수사유 한 줄 — 3축과 다음 조치를 사람이 읽게 요약한다. */
export function productVehicleReviewDecisionReason(d: ProductVehicleReviewDecision): string {
  const triple = [d.model, d.sub_model, d.trim].map((v) => v || '?').join(' › ');
  const label = d.decision === 'CODE' ? '코드확정' : d.decision === 'TRIPLE' ? '3축확정·코드대기'
    : d.decision === 'PARTIAL' ? '트림미확정' : '원천확인필요';
  const action = d.master_action ? ` · 마스터:${d.master_action}${d.candidate_key ? `(${d.candidate_key})` : ''}` : '';
  return `[3축검토:${label}] ${triple}${action} — ${d.basis}`;
}
