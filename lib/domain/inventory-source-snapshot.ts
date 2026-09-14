import { createHash } from 'node:crypto';

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
};

export type InventorySourceSnapshot = {
  schema: 'inventory_source_snapshot_v1';
  snapshot_id: string;
  source_revision: string;
  partner_code: string;
  car_number: string;
  source_url: string;
  source_location: string;
  source_record_id: string;
  raw_payload: string;
};

/** 같은 원문은 매 실행마다 새 문서가 생기지 않고 같은 불변 revision을 가리킨다. */
export function createInventorySourceSnapshot(input: {
  partnerCode: string;
  carNumber: string;
  sourceUrl: string;
  sourceLocation: string;
  sourceRecordId: string;
  raw: unknown;
}): InventorySourceSnapshot {
  const rawPayload = JSON.stringify(canonical(input.raw ?? {}));
  const bytes = Buffer.byteLength(rawPayload, 'utf8');
  if (bytes > 850_000) throw new Error(`${input.partnerCode}/${input.carNumber}: 원문 스냅샷 ${bytes} bytes로 Firestore 안전 한도 초과`);
  const revisionEnvelope = JSON.stringify(canonical({
    sourceUrl: input.sourceUrl,
    sourceLocation: input.sourceLocation,
    sourceRecordId: input.sourceRecordId,
    raw: input.raw ?? {},
  }));
  const sourceRevision = createHash('sha256').update(revisionEnvelope).digest('hex');
  const carKey = input.carNumber.replace(/[^0-9A-Za-z가-힣_-]/g, '_');
  return {
    schema: 'inventory_source_snapshot_v1',
    snapshot_id: `${input.partnerCode}_${carKey}_${sourceRevision}`,
    source_revision: sourceRevision,
    partner_code: input.partnerCode,
    car_number: input.carNumber,
    source_url: input.sourceUrl,
    source_location: input.sourceLocation,
    source_record_id: input.sourceRecordId,
    raw_payload: rawPayload,
  };
}
