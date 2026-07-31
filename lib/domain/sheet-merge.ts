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

const plateOf = (r: EntityRecord): string =>
  String(r.car_number || r.car_number_snapshot || '').replace(/\s/g, '');

/**
 * 유입 매물 vs 기존 → create / soft-merge patch / unchanged.
 *
 * 1차 키 = product_code(_key). **2차 키 = 공급사+차량번호.**
 * 키 규약이 한 가지가 아니다 — v3 이관분은 `02하9002_RP006`(차번_공급사), 시트 유입은
 * `RP006_02하9002`(공급사_차번)로 만든다. 키만 보면 같은 실물 차가 신규로 하나 더 생기고,
 * 뒤이어 부재처리가 옛 레코드를 출고불가로 내린다. 계약이 걸려 있으면 그것도 못 해서
 * **같은 차가 계약중 하나 · 출고가능 하나로 동시에 남는다**(트윈 중복판매).
 * 실측(2026-07-31): 403대 중 23대가 이 경우 — 오플 6 · 아이언 5 · 우리캐피탈 4 · 손오공 3 · 웰릭스 2 · 스타 2 · 리더스 1.
 * 차번이 같으면 같은 차다. 기존 키를 그대로 쓰고 patch 로 간다.
 */
export function planProductUpsert(incoming: EntityRecord[], existing: EntityRecord[]): UpsertPlan {
  const byKey = new Map<string, EntityRecord>();
  const byPlate = new Map<string, EntityRecord>();
  for (const r of existing) {
    const k = String(r._key || r.product_code || '');
    if (k) byKey.set(k, r);
    const plate = plateOf(r);
    if (!plate || r._deleted) continue;
    const pk = `${String(r.provider_company_code || '')}|${plate}`;
    // 같은 차가 여러 레코드면 먼저 만난 쪽(=운영에서 쓰던 것)을 남긴다.
    if (!byPlate.has(pk)) byPlate.set(pk, r);
  }
  const creates: EntityRecord[] = [];
  const patches: { key: string; patch: EntityRecord }[] = [];
  let unchanged = 0;
  for (const rec of incoming) {
    let key = String(rec.product_code || rec._key || '');
    if (!key) continue;
    let prev = byKey.get(key);
    if (!prev) {
      // 키가 안 맞으면 공급사+차번으로 한 번 더 본다.
      //  임시번호(100신…)는 실물 차번이 아니므로 이 경로를 태우면 안 된다 — 서로 다른 신차가 물린다.
      const plate = plateOf(rec);
      if (plate && !rec.is_pending_plate) {
        const alt = byPlate.get(`${String(rec.provider_company_code || '')}|${plate}`);
        if (alt) { prev = alt; key = String(alt._key || alt.product_code || key); }
      }
    }
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

export type AbsentPlan = {
  patches: { key: string; patch: EntityRecord }[];
  skipped_locked: number;
  already_blocked: number;
};

/**
 * 시트에 이번 유입에 없는 같은 공급사 매물 → 출고불가 patch (삭제 금지).
 * locked_by_contract 있으면 스킵. 이미 출고불가면 집계만.
 */
export function planAbsentBlocked(opts: {
  existing: EntityRecord[];
  providerCode: string;
  presentKeys: Set<string>;
  /** 이번 유입에 있던 차량번호. 키 규약이 달라도 **차번이 같으면 시트에 있는 차다.** */
  presentPlates?: Set<string>;
}): AbsentPlan {
  const provider = opts.providerCode;
  let skipped_locked = 0;
  let already_blocked = 0;
  const patches: { key: string; patch: EntityRecord }[] = [];
  for (const r of opts.existing) {
    if (r._deleted) continue;
    const key = String(r._key || r.product_code || '');
    if (!key) continue;
    const pc = String(r.provider_company_code || '');
    if (pc !== provider && !key.startsWith(`${provider}_`)) continue;
    const pcode = String(r.product_code || '');
    if (opts.presentKeys.has(key) || (pcode && opts.presentKeys.has(pcode))) continue;
    // 키가 옛 규약(`차번_공급사`)이라 못 맞은 것뿐인데 출고불가로 내리면
    //  멀쩡한 매물이 죽고, 새 키 레코드와 함께 같은 차가 둘이 된다.
    const plate = plateOf(r);
    if (plate && opts.presentPlates?.has(plate)) continue;
    if (String(r.vehicle_status || '') === '출고불가') {
      already_blocked++;
      continue;
    }
    if (!isBlank(r.locked_by_contract)) {
      skipped_locked++;
      continue;
    }
    patches.push({
      key,
      patch: {
        vehicle_status: '출고불가',
        // v3-only 첫 오버레이 permission — 소유 공급사 코드 승계
        provider_company_code: pc || provider,
      },
    });
  }
  return { patches, skipped_locked, already_blocked };
}

/** fetch 성공·건수 가드. 빈 유입·급감(사고)이면 부재→출고불가 금지. */
export function shouldReconcileAbsent(
  imported: number,
  previousCount: number,
): { ok: boolean; reason?: 'imported_empty' | 'collapse' } {
  if (imported <= 0) return { ok: false, reason: 'imported_empty' };
  if (previousCount >= 10 && imported < previousCount * 0.5) {
    return { ok: false, reason: 'collapse' };
  }
  return { ok: true };
}

/** 부재 매물 출고불가 적용. 일괄 연동(sync-all) 전용 — 부분 붙여넣기 경로에서 호출 금지. */
export async function applyAbsentBlocked(
  companyId: string,
  providerCode: string,
  presentKeys: Set<string>,
  presentPlates?: Set<string>,
): Promise<{ absent_blocked: number; skipped_locked: number; already_blocked: number }> {
  const store = getStore();
  const existing = await store.list('product', companyId);
  const plan = planAbsentBlocked({ existing, providerCode, presentKeys, presentPlates });
  let absent_blocked = 0;
  if (plan.patches.length) {
    absent_blocked = await store.bulkPatch('product', companyId, plan.patches);
  }
  return {
    absent_blocked,
    skipped_locked: plan.skipped_locked,
    already_blocked: plan.already_blocked,
  };
}
