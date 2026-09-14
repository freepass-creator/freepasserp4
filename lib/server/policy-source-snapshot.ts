import { createHash } from 'node:crypto';
import type { SheetSourceGrid } from './google-sheets';

export type PolicySourceSnapshotV1 = {
  schema_version: 'policy_source_snapshot_v1';
  snapshot_id: string;
  provider_codes: string[];
  source_kind: 'google_sheet';
  spreadsheet_id: string;
  tab: string;
  sheet_id: number;
  range: string;
  observed_at: string;
  raw_payload: string;
  raw_payload_sha256: string;
};

/** 읽은 셀 원문 전체를 해시와 함께 고정한다. observed_at은 내용 해시에서 제외한다. */
export function createPolicySourceSnapshot(providerCodes: string[], grid: SheetSourceGrid): PolicySourceSnapshotV1 {
  const rawPayload = JSON.stringify({
    spreadsheet_id: grid.spreadsheet_id,
    tab: grid.tab,
    sheet_id: grid.sheet_id,
    range: grid.range,
    rows: grid.rows,
  });
  const hash = createHash('sha256').update(rawPayload, 'utf8').digest('hex');
  return {
    schema_version: 'policy_source_snapshot_v1',
    snapshot_id: `polsrc_${hash}`,
    provider_codes: [...new Set(providerCodes)].sort(),
    source_kind: 'google_sheet',
    spreadsheet_id: grid.spreadsheet_id,
    tab: grid.tab,
    sheet_id: grid.sheet_id,
    range: grid.range,
    observed_at: grid.read_at,
    raw_payload: rawPayload,
    raw_payload_sha256: hash,
  };
}
