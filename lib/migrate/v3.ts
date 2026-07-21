/**
 * v3 → v4 연동·이관(ETL) 골격. 아키텍처 = "v4 완전 새집 + v3 읽기전용".
 *   · v4 저장 = Firestore(FirestoreAdapter, companyId 격리). v3 노드는 절대 write 안 함 → 구데이터 100% 보존.
 *   · 흐름: V3Reader.read(노드) → V4Mapper(스키마 매핑) → newId 발급 + xref 기록 → getStore().save(v4).
 *   · v3 RTDB 리더 구현(read-only)은 v3 연동 담당(다른 도구)이 V3Reader로 주입. 여기선 v4쪽(매핑·xref·오케스트레이션)만.
 *   · 나중엔 v3 전량을 이 경로로 새집(v4)에 옮겨온다. v3는 그동안 그대로 운영.
 */
import { getStore } from '@/lib/store';
import { newId, type IdKind } from '@/lib/domain/ids';
import { type EntityRecord } from '@/lib/intake/entities';

/** v3코드 ↔ v4id 교차참조. v4 네임스페이스('xref' 엔티티)에만 저장 → 재이관·추적 시 동일 id 유지. */
export type XRef = { v3_code: string; v4_id: string; kind: IdKind; entity: string };

/** v3 노드 리더(읽기전용). 구현 = v3 연동 담당. write 메서드는 의도적으로 없음(구데이터 보존). */
export interface V3Reader {
  read(node: string): Promise<Record<string, EntityRecord>>; // v3 RTDB 노드 → { v3key: record }
}

/** v3 레코드 → v4 레코드 매핑. resolveRef(v3코드)=이미 이관된 참조의 v4id(없으면 null). 실제 필드매핑은 v3 스키마 확정 후 채움. */
export type V4Mapper = (v3rec: EntityRecord, v3key: string, resolveRef: (v3code: string) => string | null) => EntityRecord;

export type MigratePlanItem = { node: string; entity: string; kind: IdKind; map: V4Mapper };
export type MigrateResult = { entity: string; read: number; written: number }[];

/**
 * 이관 오케스트레이션 — 노드별로 v3 읽기 → 매핑 → id발급+xref → v4 저장. v3는 안 건드림.
 * plan 순서 = 참조 의존 순서(예: partner·policy 먼저 → product → contract). resolveRef로 앞서 이관된 v4id를 잇는다.
 */
export async function importFromV3(co: string, reader: V3Reader, plan: MigratePlanItem[]): Promise<MigrateResult> {
  const store = getStore();
  const xref = new Map<string, string>(); // v3_code → v4_id (전 노드 누적)
  const xrefRows: EntityRecord[] = [];
  const resolveRef = (v3code: string) => xref.get(String(v3code)) || null;
  const out: MigrateResult = [];

  for (const { node, entity, kind, map } of plan) {
    const raw = await reader.read(node);
    const keys = Object.keys(raw || {});
    const records: EntityRecord[] = [];
    for (const k of keys) {
      const v3rec = raw[k];
      if (!v3rec || (v3rec as { _deleted?: boolean })._deleted) continue;
      const v4id = xref.get(k) || newId(kind);   // 재이관 시 기존 v4id 재사용(멱등)
      xref.set(k, v4id);
      xrefRows.push({ v3_code: k, v4_id: v4id, kind, entity });
      records.push(map(v3rec, k, resolveRef));
    }
    const res = records.length ? await store.save(entity, co, records) : { saved: 0 };
    out.push({ entity, read: keys.length, written: res.saved });
  }
  if (xrefRows.length) await store.save('xref', co, xrefRows);
  return out;
}
