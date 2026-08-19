import type { VehicleTrimMasterArtifact, VehicleTrimMasterRecord } from '@/lib/domain/vehicle-trim-master';

let cached: VehicleTrimMasterArtifact | null = null;
let inflight: Promise<VehicleTrimMasterArtifact> | null = null;

export function peekVehicleTrimMaster(): VehicleTrimMasterArtifact | null {
  return cached;
}

/** Load the row-level trim master. Callers must respect each record's usage_tier. */
export function loadVehicleTrimMaster(): Promise<VehicleTrimMasterArtifact> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = fetch('/data/vehicle-trim-master.json')
    .then((response) => {
      if (!response.ok) throw new Error(`트림마스터 HTTP ${response.status}`);
      return response.json() as Promise<VehicleTrimMasterArtifact>;
    })
    .then((artifact) => {
      if (artifact.schema_version !== 1 || !Array.isArray(artifact.records) || !artifact.records.length) {
        throw new Error('트림마스터 형식 또는 records가 잘못되었습니다.');
      }
      cached = artifact;
      return artifact;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

export const indexVehicleTrimMaster = (artifact: VehicleTrimMasterArtifact): Map<string, VehicleTrimMasterRecord> =>
  new Map(artifact.records.map((record) => [record.trim_row_key, record]));

export function clearVehicleTrimMasterCache(): void {
  cached = null;
  inflight = null;
}

