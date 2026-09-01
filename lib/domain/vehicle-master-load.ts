/**
 * 차종마스터 JSON 로더 — **폐기됨(2026-08-25).**
 * 정본은 원천대장 「차종마스터」시트. 로컬 이름은 `vehicle-trim-master.json`(시트에서 생성).
 */
import type { MasterEntry } from '@/lib/domain/vehicle-master-match';

const DISCARD = 'vehicle-master.json 폐기(2026-08-25). 정본=원천대장 「차종마스터」시트 · 로컬=vehicle-trim-master.json';

export function peekVehicleMaster(): MasterEntry[] | null {
  return null;
}

/** @deprecated 호출하면 바로 실패한다. 시트/트림마스터를 써라. */
export function loadVehicleMaster(): Promise<MasterEntry[]> {
  return Promise.reject(new Error(DISCARD));
}

export function clearVehicleMasterCache(): void {
  /* no-op */
}
