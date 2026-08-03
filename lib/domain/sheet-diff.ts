/**
 * 시트 유입 dry-run diff — 저장 전 미리보기용. 순수 함수(write 없음).
 * 기존 planProductUpsert / planAbsentBlocked(sheet-merge) 위에 얇게 얹어,
 * 유입 시트를 커밋하기 전에 "신규 / 상태변경 / 내용만 수정 / 재고차단 / 무변경"을 집계·상세화한다.
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
  content: number;      // 기존 차번 · 상태 외 필드만 변경(상태와 동시 변경은 status에 포함)
  absent: number;       // 시트 삭제·출고불가·가격없음 → 기존 재고 출고불가(삭제 아님)
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
  const presentPlates = new Set<string>();
  for (const rec of incoming) {
    const k = String(rec.product_code || rec._key || '');
    if (k) presentKeys.add(k);
    if (!rec.is_pending_plate) {
      const plate = String(rec.car_number || rec.car_number_snapshot || '').replace(/\s/g, '');
      if (plate) presentPlates.add(plate);
    }
  }
  const absentPlan = planAbsentBlocked({ existing, providerCode, presentKeys, presentPlates });
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

/** 상태 전이 카운트 — status kind만(부재는 별도 absent). */
export function countStatusTransitions(diff: SheetDiffSummary): {
  availToBlocked: number;   // 출고가능→출고불가
  blockedToAvail: number;   // 출고불가→출고가능
  availToContract: number;  // 출고가능→계약중
  otherStatus: number;
} {
  let availToBlocked = 0;
  let blockedToAvail = 0;
  let availToContract = 0;
  let otherStatus = 0;
  for (const it of diff.items) {
    if (it.kind !== 'status') continue;
    const from = String(it.statusFrom || '');
    const to = String(it.statusTo || '');
    if ((from === '출고가능' || from === '즉시출고') && to === '출고불가') availToBlocked++;
    else if (from === '출고불가' && (to === '출고가능' || to === '즉시출고')) blockedToAvail++;
    else if ((from === '출고가능' || from === '즉시출고') && to === '계약중') availToContract++;
    else otherStatus++;
  }
  return { availToBlocked, blockedToAvail, availToContract, otherStatus };
}

/** 공급사별 검증표에 노출할 실제 상태 전이. 합계만으로는 대량 변경 방향을 판단할 수 없다. */
export function sheetStatusTransitionCounts(diff: SheetDiffSummary): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of diff.items) {
    if (item.kind !== 'status') continue;
    const label = `${String(item.statusFrom || '미지정')}→${String(item.statusTo || '미지정')}`;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'));
}

/** 상태 외 실제 patch 필드 상위 목록. volatile 메타는 sheet-merge 단계에서 이미 제거된다. */
export function sheetChangedFieldCounts(diff: SheetDiffSummary): { field: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of diff.items) {
    if (item.kind !== 'status' && item.kind !== 'content') continue;
    for (const field of item.fields || []) counts.set(field, (counts.get(field) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));
}

/**
 * 저장 전 배너 문구.
 * 신규등록 · 출고가능→출고불가 · 출고불가→출고가능 · 출고가능→계약중 ·
 * 내용만 수정 · 재고차단 · 무변경 · (+ 재고 대수)
 */
export function formatSheetDiffBanner(diff: SheetDiffSummary, stock?: number): string {
  const t = countStatusTransitions(diff);
  const parts = [
    `신규등록 ${diff.new}`,
    `출고가능→출고불가 ${t.availToBlocked}`,
    `출고불가→출고가능 ${t.blockedToAvail}`,
    `출고가능→계약중 ${t.availToContract}`,
    `기타 상태변경 ${t.otherStatus}`,
    `내용만 수정 ${diff.content}`,
    `재고차단 ${diff.absent}`,
    `무변경 ${diff.unchanged}`,
  ];
  if (stock != null) parts.push(`재고 대수(출고가능+보류) ${stock}`);
  return parts.join(' · ');
}
