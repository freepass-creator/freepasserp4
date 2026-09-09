import { createHash } from 'node:crypto';

export type InventoryRegistration = 'registered' | 'pending_identity';
export type NormalizationStatus = 'complete' | 'partial' | 'conflict' | 'unknown';
export type AvailabilityStatus = 'available' | 'unavailable' | 'discuss';

export type SourceSnapshotV1 = {
  schema_version: 'source_snapshot_v1';
  snapshot_id: string;
  provider_code: string;
  source_kind: string;
  source_external_id: string;
  source_url: string;
  observed_at: string;
  content_type: string;
  raw_encoding: 'utf8';
  raw_payload: string;
  raw_payload_sha256: string;
  source_revision: string;
  inventory_key: string;
  car_number: string;
  inventory_registration: InventoryRegistration;
  context: Record<string, unknown>;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Utf8(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createSourceSnapshotV1(input: {
  providerCode: string;
  sourceKind: string;
  sourceExternalId: string;
  sourceUrl: string;
  observedAt: string;
  contentType?: string;
  rawPayload: string;
  inventoryKey?: string;
  carNumber?: string;
  context?: Record<string, unknown>;
}): SourceSnapshotV1 {
  const rawPayloadSha256 = sha256Utf8(input.rawPayload);
  const carNumber = input.carNumber || '';
  const inventoryKey = input.inventoryKey || '';
  const context = input.context || {};
  const sourceRevision = sha256Utf8(canonical({
    provider_code: input.providerCode,
    source_kind: input.sourceKind,
    source_external_id: input.sourceExternalId,
    source_url: input.sourceUrl,
    raw_payload_sha256: rawPayloadSha256,
    context,
  }));
  return {
    schema_version: 'source_snapshot_v1',
    snapshot_id: `${input.providerCode}:${input.sourceExternalId}:${sourceRevision}`,
    provider_code: input.providerCode,
    source_kind: input.sourceKind,
    source_external_id: input.sourceExternalId,
    source_url: input.sourceUrl,
    observed_at: input.observedAt,
    content_type: input.contentType || 'text/html; charset=utf-8',
    raw_encoding: 'utf8',
    raw_payload: input.rawPayload,
    raw_payload_sha256: rawPayloadSha256,
    source_revision: sourceRevision,
    inventory_key: inventoryKey,
    car_number: carNumber,
    inventory_registration: carNumber ? 'registered' : 'pending_identity',
    context,
  };
}
