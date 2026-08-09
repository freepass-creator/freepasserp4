import 'server-only';

import { firebaseAdminDatabase } from '@/lib/server/firebase-admin';
import { toV4Record } from '@/lib/firebase/rtdb-records';
import type { EntityRecord } from '@/lib/intake/entities';

/**
 * 시트 검증용 재고 스냅샷 — **서버 투영**.
 *
 * 브라우저가 `v4/products` 전량(실측 6,128건 · 약 8MB)을 직접 읽던 자리를 대체한다.
 * RTDB 클라이언트 `get()` 에는 타임아웃이 없어서, 한 번 늦어지면 `validateAll` 이 영영
 * settle 되지 않고 화면은 「검증 중…」에 고착됐다(실측 2026-08-07).
 * erp3 는 애초에 이 대조를 브라우저에서 하지 않았다 — 서버가 읽고 결과만 내려줬다.
 *
 * strict 안전성(«불완전 조회를 승인하지 않는다»)은 그대로다. 부분 실패는 throw 하고
 * 이 모듈은 **절대 부분 결과를 반환하지 않는다**. 그래야 시트에 있는 차가 「ERP 에 없음」으로
 * 오판돼 멀쩡한 재고가 대량 출고불가가 되는 사고를 막는다.
 *
 * ⚠ **읽기 전용 검증 경로 전용이다.**
 *   CAS(`expected`)로 쓰이는 자리 — 톰스톤 되살림(`commitSheetProducts`)·`applyAbsentBlocked` —
 *   에는 이 투영을 넘기면 안 된다. 필드가 빠지면 `productPatchPreconditionMatches` 가
 *   전건 실패해 되살림이 통째로 죽는다. 그쪽은 계속 완전 레코드를 읽는다.
 */

/**
 * 활성 레코드 화이트리스트.
 *
 * 근거가 두 갈래다. 둘 중 하나만 보면 반드시 사고가 난다:
 *
 * (A) **시트 유입이 가질 수 있는 필드면 전부.**
 *     `softMergeProduct`·`changedPatch` 는 «incoming 키»를 돌며 prev 와 값을 비교한다
 *     (sheet-merge.ts:104-158). prev 에서 필드를 빼면 `same(undefined, v)` 가 false 라
 *     전 건이 «내용수정»으로 부풀고, 커밋 사후검증(sheet-sync-all.ts:1057-1073)이
 *     영구히 «동기화 사후검증 실패»로 떨어진다.
 *
 * (B) **충돌·리포트·가드가 기존 레코드에서 읽는 필드 전부.**
 *     sheet-sync-all(충돌 탐지) · sheet-merge(부재·수기보호) · sheet-conflict-report ·
 *     sheet-conflict-resolution · sheet-identity-conflict-review · sheet-diff.
 *
 * `_snap_at`·`_snap_history` 는 PROTECTED 라 soft-merge/diff 양쪽이 건너뛴다 — 빼도 안전하고
 * 이력 배열이라 크기 절감이 크다. 반대로 `vin` 은 시트 매핑 대상이라 빼면 전건 유령 diff 가 된다.
 */
export const SHEET_RECONCILE_ACTIVE_FIELDS = [
  // 키·식별
  '_key', 'product_code', '_rtdb_key', 'product_uid',
  'car_number', 'car_number_snapshot', 'is_pending_plate', '_pending_signature',
  // 소유·출처
  'provider_company_code', 'partner_code', 'source', 'source_schema',
  // 상태·락·시트소유 표식
  'vehicle_status', 'status', 'status_label', 'status_label_raw', 'locked_by_contract',
  'sheet_status_owner', 'sheet_block_reason', 'sheet_blocked_at', 'allow_sheet_reactivate',
  '_sheet_manual_fields', '_merged_into',
  // 톰스톤·CAS 가드필드
  '_deleted', 'deletedAt', 'deletedReason', 'updatedAt', 'updated_at',
  // 금액
  'price',
  // 시트가 쓰는 내용필드 = incoming 필드면
  'vin', 'maker', 'model', 'sub_model', 'trim_name', 'trim_extra', 'year',
  'first_registration_date', 'fuel_type', 'engine_cc', 'mileage',
  'ext_color', 'int_color', 'seats', 'transmission', 'vehicle_class',
  'product_type', 'photo_link', 'options', 'partner_memo', '_row_text',
  // 차종마스터 스냅 산출
  '_raw_vehicle', '_snapped', '_snap_confidence', '_snap_defaults', '_snap_issues', 'catalog_id',
  'gen_year_start', 'gen_year_end', 'variant', 'drive_type', '_needs_master_review',
  // 색상 스냅 산출
  '_raw_ext_color', '_raw_int_color',
  // 표시
  'vehicle_name',
] as const;

/**
 * 삭제 레코드 화이트리스트.
 *
 * 삭제분은 «재등장·신원 판정»에만 쓰인다 — 가격·주행·옵션·사진 같은 내용면은 아무도 안 읽는다.
 * 다만 `planSheetIdentityConflictReview` 가 신원 원자와 `_raw_vehicle`(서명 기준)까지 보므로
 * 차번·키·공급사만으로는 부족하다(sheet-identity-conflict-review.ts:63-122).
 */
export const SHEET_RECONCILE_DELETED_FIELDS = [
  '_key', 'product_code', '_rtdb_key', 'product_uid',
  'car_number', 'car_number_snapshot', 'is_pending_plate', '_pending_signature',
  'provider_company_code', 'partner_code', 'source', 'source_schema',
  'vehicle_status', 'status', 'locked_by_contract',
  '_deleted', 'deletedAt', 'deletedReason', 'updatedAt', '_merged_into',
  'maker', 'model', 'sub_model', 'trim_name', 'ext_color', 'int_color',
  'first_registration_date', 'year', 'fuel_type', '_raw_vehicle',
] as const;

export type SheetReconcileStatePayload = {
  active: EntityRecord[];
  deleted: EntityRecord[];
  /** 부분 실패를 «완전»으로 위장하지 않기 위한 명시 신호. 항상 true 로만 응답한다. */
  complete: true;
  counts: { active: number; deleted: number };
};

/** 안정 직렬화 — 키 순서가 흔들리면 지문이 매번 달라진다. */
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

/** FNV-1a 32bit — 짧고 충돌이 드물다. 암호용이 아니라 «변했나»만 본다. */
function digest(value: unknown): string {
  const text = JSON.stringify(stableValue(value));
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function project(record: EntityRecord, fields: readonly string[]): EntityRecord {
  const source = record as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = source[field];
    if (value !== undefined) out[field] = value;
  }
  /**
   * 투영 «전» 완전 레코드의 지문.
   *
   * `sheetReconcileStateRevision` 은 레코드 전 필드를 해시해 «검증 후 누가 건드렸나»를 잡는다.
   * 투영만 내려보내면 화이트리스트 밖 필드(사진·메모·정책)의 변경을 커밋 경계가 놓친다.
   * 지문 한 필드를 실어 감지력을 원상 복구한다 — 행당 20여 바이트다.
   * 쓰기 경로로는 새지 않는다: before/after 가 같은 값이라 `changedPatch` 가 patch 에 안 넣는다.
   */
  out._full_digest = digest(record);
  return out as EntityRecord;
}

const isDead = (record: Record<string, unknown>): boolean => (
  record._deleted === true
  || Boolean(record.deletedAt)
  || String(record.status ?? '') === 'deleted'
);

/**
 * v4/products 를 읽어 검증용으로 투영한다.
 *
 * product 는 v3 브리지가 영구 차단돼 있다(rtdb-adapter.ts:65-72 — 초기화한 낡은 재고가
 * 되살아나는 걸 막으려고 환경변수로도 못 연다). 그래서 서버도 v4 단독으로 읽어야
 * 브라우저와 같은 집합이 된다.
 */
export async function readSheetReconcileState(companyId: string): Promise<SheetReconcileStatePayload> {
  const snapshot = await firebaseAdminDatabase().ref('v4/products').get();
  const raw = (snapshot.val() || {}) as Record<string, Record<string, unknown>>;

  const active: EntityRecord[] = [];
  const deleted: EntityRecord[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const record = toV4Record('product', key, value as never, companyId) as EntityRecord;
    if (isDead(record as Record<string, unknown>)) {
      deleted.push(project(record, SHEET_RECONCILE_DELETED_FIELDS));
    } else {
      active.push(project(record, SHEET_RECONCILE_ACTIVE_FIELDS));
    }
  }

  return { active, deleted, complete: true, counts: { active: active.length, deleted: deleted.length } };
}
