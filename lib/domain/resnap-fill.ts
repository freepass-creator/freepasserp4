/**
 * 저장된 차종을 **지금 매처로 다시 물려 빈 칸만 채운다** — 규칙 SSOT.
 *
 * 일일 동기화(새 차가 들어온 직후)·CLI 가 이 함수 하나를 쓴다.
 * 각자 구현하면 «어떤 칸을 어떤 조건에 채우는가»가 갈리고, 그때 화면과 시트가 다른 말을 한다.
 *
 * ★규칙 하나 — **빈 칸만 채운다.**
 *   이미 값이 있으면 손대지 않는다. 재매칭이 못 잡았다고 지우면
 *   «공급사가 적어 준 트림이 마스터에 아직 없을 뿐»인 경우까지 날아간다
 *   (실측 2026-08-09: 그렇게 12대가 사라질 뻔했다).
 *   덮어쓰기도 삭제도 하지 않는다 — 그래서 몇 번을 돌려도 안전하다.
 */
import { snapToMaster, applySnap } from '@/lib/domain/vehicle-master-match';
import type { MasterEntry } from '@/lib/domain/vehicle-master-types';
import type { EntityRecord } from '@/lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();

/**
 * 채울 칸 — 차종 5단계와 그 아래 제원.
 * 가격·상태·계약은 스냅 대상이 아니다(각자 주인이 따로 있다).
 */
export const SNAP_FILL_FIELDS = [
  'maker', 'model', 'sub_model', 'variant', 'trim_name',
  'fuel_type', 'engine_cc', 'drive_type', 'seats', 'year',
] as const;

export type ResnapFill = { key: string; plate: string; patch: Record<string, string> };

/**
 * 재매칭 결과에서 **빈 칸만** 추린다. 쓰지는 않는다 — 부르는 쪽이 저장한다.
 * `_raw_vehicle` 이 없으면 근거가 없으므로 건너뛴다.
 */
export function planResnapFill(
  products: Array<EntityRecord & { _key?: string }>,
  master: MasterEntry[],
): ResnapFill[] {
  if (!master.length) return [];
  const out: ResnapFill[] = [];
  for (const p of products) {
    if (!p._raw_vehicle) continue;
    let next: EntityRecord | null = null;
    try {
      const snap = snapToMaster(p, master);
      next = snap ? (applySnap(p, snap) as EntityRecord) : null;
    } catch {
      // 한 대가 매칭에서 터져도 나머지는 채운다.
      next = null;
    }
    if (!next) continue;

    const patch: Record<string, string> = {};
    for (const f of SNAP_FILL_FIELDS) {
      const before = S((p as Rec)[f]);
      const after = S((next as Rec)[f]);
      if (before || !after) continue;   // ★있으면 손대지 않는다
      patch[f] = after;
    }
    if (Object.keys(patch).length) {
      out.push({ key: S(p._key), plate: S((p as Rec).car_number) || '(무번호)', patch });
    }
  }
  return out;
}

/** 어느 칸이 몇 대나 채워지는가 — 보고용. */
export function summarizeResnapFill(fills: ResnapFill[]): Record<string, number> {
  const by: Record<string, number> = {};
  for (const f of fills) for (const k of Object.keys(f.patch)) by[k] = (by[k] || 0) + 1;
  return by;
}
