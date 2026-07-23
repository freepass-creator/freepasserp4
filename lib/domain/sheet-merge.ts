/**
 * 시트 재동기화 soft-merge — 빈값으로 수기보정 덮어쓰기 금지.
 * 신규 = create, 기존 = blank-skip merge 후 변경분만 patch.
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { getStore, type SaveResult } from '@/lib/store';

/** 시트 유입이 건드리면 안 되는 시스템/식별 필드 */
const PROTECTED = new Set([
  '_key', 'companyId', 'createdAt', 'createdBy', 'deletedAt', 'deletedReason', '_deleted',
  'updatedAt',
]);

function isBlank(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

/** existing ← incoming. 빈 incoming 필드는 existing 유지. price는 기간키 병합.
 *  _raw_vehicle = 최초 원본 유지. _snap_history = 이어붙이기(최근 10). */
export function softMergeProduct(existing: EntityRecord, incoming: EntityRecord): EntityRecord {
  const out: EntityRecord = { ...existing };
  const engineLocked = !isBlank(existing.locked_by_contract); // 계약이 선점한 매물 = 락 주인 각인됨
  for (const [k, v] of Object.entries(incoming)) {
    if (PROTECTED.has(k)) continue;
    if (isBlank(v)) continue;
    // 엔진 락(계약중·출고불가)의 상태는 settlement-engine 소관 — 시트 재동기화가 덮으면 재고가 통째로 풀린다.
    // 락 주인이 없는 매물(공급사 수기 출고불가 등)은 그대로 시트가 갱신하도록 둔다.
    if (k === 'vehicle_status' && engineLocked) continue;
    if (k === '_raw_vehicle') {
      if (existing._raw_vehicle && typeof existing._raw_vehicle === 'object') continue;
      out._raw_vehicle = v;
      continue;
    }
    if (k === '_snap_history' && Array.isArray(v)) {
      const prev = Array.isArray(existing._snap_history) ? (existing._snap_history as unknown[]) : [];
      out._snap_history = [...prev, ...v].slice(-10);
      continue;
    }
    if (k === 'price' && v && typeof v === 'object' && existing.price && typeof existing.price === 'object') {
      out.price = { ...(existing.price as Record<string, unknown>), ...(v as Record<string, unknown>) };
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** soft-merge 결과에서 실제 바뀐 키만 patch로. */
export function changedPatch(before: EntityRecord, after: EntityRecord): EntityRecord | null {
  const patch: EntityRecord = {};
  for (const k of Object.keys(after)) {
    if (PROTECTED.has(k)) continue;
    if (!same(before[k], after[k])) patch[k] = after[k];
  }
  return Object.keys(patch).length ? patch : null;
}

export type UpsertPlan = {
  creates: EntityRecord[];
  patches: { key: string; patch: EntityRecord }[];
  unchanged: number;
};

/** 유입 매물 vs 기존 → create / soft-merge patch / unchanged. 키 = product_code(_key). */
export function planProductUpsert(incoming: EntityRecord[], existing: EntityRecord[]): UpsertPlan {
  const byKey = new Map<string, EntityRecord>();
  for (const r of existing) {
    const k = String(r._key || r.product_code || '');
    if (k) byKey.set(k, r);
  }
  const creates: EntityRecord[] = [];
  const patches: { key: string; patch: EntityRecord }[] = [];
  let unchanged = 0;
  for (const rec of incoming) {
    const key = String(rec.product_code || rec._key || '');
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      creates.push(rec);
      continue;
    }
    const merged = softMergeProduct(prev, rec);
    const patch = changedPatch(prev, merged);
    if (patch) {
      // v4 매물 write 규칙 = newData.provider_company_code === 내 회사. 변경필드만 담는 patch가 v3전용 매물의
      //  첫 오버레이면 회사코드 누락 → provider permission_denied. 기존 소유코드 승계 스탬프(자기기술형·admin 무해).
      if (patch.provider_company_code === undefined && prev.provider_company_code != null && prev.provider_company_code !== '') {
        patch.provider_company_code = prev.provider_company_code;
      }
      patches.push({ key, patch });
    } else unchanged++;
  }
  return { creates, patches, unchanged };
}

export type CommitSheetResult = {
  created: number;
  updated: number;
  unchanged: number;
  duplicates: number;
  backend: string;
};

/**
 * soft-merge 저장 엔진(빈칸→수기 덮지 않음).
 * ★ 외부 시트/엑셀 입고는 직접 호출하지 말 것 — master-ingress.commitSupplierProducts.
 */
export async function commitSheetProducts(companyId: string, products: EntityRecord[]): Promise<CommitSheetResult> {
  const store = getStore();
  const existing = await store.list('product', companyId);
  const plan = planProductUpsert(products, existing);
  let created = 0;
  let duplicates = 0;
  let updated = 0;
  if (plan.creates.length) {
    const r: SaveResult = await store.save('product', companyId, plan.creates);
    created = r.saved;
    duplicates = r.duplicates;
  }
  if (plan.patches.length) {
    updated = await store.bulkPatch('product', companyId, plan.patches);
  }
  return { created, updated, unchanged: plan.unchanged, duplicates, backend: store.backend };
}
