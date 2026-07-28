/**
 * 시트 유입 dry-run diff — 저장 전 미리보기용. 순수 함수(write 없음).
 * 기존 planProductUpsert / planAbsentBlocked(sheet-merge) 위에 얇게 얹어,
 * 유입 시트를 커밋하기 전에 "신규 / 상태변경 / 내용수정 / 부재(출고불가) / 무변경"을 집계·상세화한다.
 * UI(SheetSync)는 이 결과를 배너·목록으로 보여주고 사용자가 확인 후 commitSheetProducts.
 */
import { planProductUpsert, planAbsentBlocked } from './sheet-merge';
import { type EntityRecord } from '@/lib/intake/entities';

export type SheetDiffKind = 'new' | 'status' | 'content' | 'absent';

export type SheetDiffItem = {
  key: string;
  car_number: string;
  vehicle_name: string;
  kind: SheetDiffKind;
  statusFrom?: string;   // status·absent 전이
  statusTo?: string;
  fields?: string[];     // content: 바뀐 비상태 필드명
};

export type SheetDiffSummary = {
  new: number;          // 신규 차번(create)
  status: number;       // 기존 차번 · vehicle_status 변경
  content: number;      // 기존 차번 · 상태 외 필드만 변경
  absent: number;       // 시트에 없어짐 → 출고불가(삭제 아님)
  unchanged: number;    // 변경 없음
  skippedLocked: number;// 부재지만 계약락으로 출고불가 스킵
  total: number;        // 유입 총 건
  items: SheetDiffItem[];
};

const carOf = (r: EntityRecord): string => String(r.car_number || r.car_number_snapshot || '');
const nameOf = (r: EntityRecord): string => String(r.vehicle_name || r.model || r.sub_model || r.product_code || '');

/** 저장 전 미리보기 집계. providerCode = 부재 판정 스코프(그 공급사 매물만 출고불가 대상). */
export function summarizeSheetDiff(opts: {
  incoming: EntityRecord[];
  existing: EntityRecord[];
  providerCode: string;
}): SheetDiffSummary {
  const { incoming, existing, providerCode } = opts;
  const plan = planProductUpsert(incoming, existing);
  const byKey = new Map<string, EntityRecord>();
  for (const r of existing) {
    const k = String(r._key || r.product_code || '');
    if (k) byKey.set(k, r);
  }

  const items: SheetDiffItem[] = [];

  for (const rec of plan.creates) {
    items.push({
      key: String(rec.product_code || rec._key || ''),
      car_number: carOf(rec), vehicle_name: nameOf(rec),
      kind: 'new', statusTo: String(rec.vehicle_status || ''),
    });
  }

  let statusN = 0;
  let contentN = 0;
  for (const { key, patch } of plan.patches) {
    const prev = byKey.get(key) || {};
    const isStatus = patch.vehicle_status !== undefined;
    if (isStatus) statusN++; else contentN++;
    items.push({
      key, car_number: carOf(prev), vehicle_name: nameOf(prev),
      kind: isStatus ? 'status' : 'content',
      ...(isStatus ? { statusFrom: String(prev.vehicle_status || ''), statusTo: String(patch.vehicle_status || '') } : {}),
      // provider_company_code는 v3→v4 승계 스탬프라 사용자 관점 변경 아님 → 제외
      fields: Object.keys(patch).filter((k) => k !== 'vehicle_status' && k !== 'provider_company_code'),
    });
  }

  const presentKeys = new Set<string>();
  for (const rec of incoming) {
    const k = String(rec.product_code || rec._key || '');
    if (k) presentKeys.add(k);
  }
  const absentPlan = planAbsentBlocked({ existing, providerCode, presentKeys });
  for (const { key } of absentPlan.patches) {
    const prev = byKey.get(key) || {};
    items.push({
      key, car_number: carOf(prev), vehicle_name: nameOf(prev),
      kind: 'absent', statusFrom: String(prev.vehicle_status || ''), statusTo: '출고불가',
    });
  }

  return {
    new: plan.creates.length,
    status: statusN,
    content: contentN,
    absent: absentPlan.patches.length,
    unchanged: plan.unchanged,
    skippedLocked: absentPlan.skipped_locked,
    total: incoming.length,
    items,
  };
}
