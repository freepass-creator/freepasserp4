/**
 * 차종마스터 JSON 단일 로더 — 페이지·픽커·SheetSync가 각각 fetch 하던 중복 제거.
 */
import type { MasterEntry } from '@/lib/domain/vehicle-master-match';

let cached: MasterEntry[] | null = null;
let inflight: Promise<MasterEntry[]> | null = null;

export function peekVehicleMaster(): MasterEntry[] | null {
  return cached;
}

/** 메모리 캐시 히트 시 즉시. 미스면 한 번만 fetch(동시 호출 coalesce). */
export function loadVehicleMaster(): Promise<MasterEntry[]> {
  if (cached?.length) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = fetch('/data/vehicle-master.json')
    .then((r) => {
      if (!r.ok) throw new Error(`마스터 HTTP ${r.status}`);
      return r.json();
    })
    .then((d) => {
      const entries = (d.entries || d) as MasterEntry[];
      if (!Array.isArray(entries) || !entries.length) throw new Error('마스터 entries 비어 있음');
      cached = entries;
      return entries;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

export function clearVehicleMasterCache(): void {
  cached = null;
  inflight = null;
}
