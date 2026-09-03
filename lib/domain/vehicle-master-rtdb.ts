/**
 * 차종마스터 «단일정본» = RTDB `vehicle_master`. 파일 사본(vehicle-master.json 등)의 드리프트를 없앤다.
 *
 * ★비용: 마스터는 작다(~2천 세부모델). «차 한 대마다 부르지 않는다» — 통째로 «한 번」 읽어 캐시하고
 *   메모리에서 대조한다. 그러면 RTDB egress 는 실행당 한 번뿐이라 거의 0이다.
 *
 * 노드 모양 = { [sanitizedId]: MasterEntry }. 발행 = scripts/publish-master-to-rtdb.mts.
 */
import type { MasterEntry } from '@/lib/domain/vehicle-master-types';

/** RTDB `vehicle_master` 노드 값 → MasterEntry[]. 순수 변환(부수효과 없음). */
export function masterEntriesFromRtdbValue(val: unknown): MasterEntry[] {
  if (!val || typeof val !== 'object') return [];
  return Object.values(val as Record<string, MasterEntry>).filter((e) => !!e && typeof e === 'object' && !!(e as MasterEntry).model);
}

let cache: { entries: MasterEntry[]; at: number } | null = null;
/**
 * 마스터를 «한 번만» 읽어 캐시한다. `read` 는 `vehicle_master` 노드 값을 주는 함수
 * (스크립트=Admin SDK, 앱=클라 SDK — 호출부가 주입). TTL 기본 10분.
 */
export async function loadVehicleMasterCached(read: () => Promise<unknown>, ttlMs = 600_000): Promise<MasterEntry[]> {
  const now = Date.now();
  if (cache && now - cache.at < ttlMs) return cache.entries;
  const entries = masterEntriesFromRtdbValue(await read());
  cache = { entries, at: now };
  return entries;
}

export function clearVehicleMasterRtdbCache(): void { cache = null; }
