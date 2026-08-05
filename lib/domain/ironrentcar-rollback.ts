import { createHash } from 'node:crypto';
import type { EntityRecord } from '@/lib/intake/entities';
import type { IronRentcarReconcilePlan } from '@/lib/domain/ironrentcar-reconcile';

export type StoredSnapshot = {
  exists: boolean;
  value?: EntityRecord;
};

export type StoredSnapshotMap = Record<string, StoredSnapshot>;

export type IronRentcarCounts = {
  patches: number;
  creates: number;
  absentBlocks: number;
};

export const IRONRENTCAR_ROOT_WRITE_MAX_BYTES = 14 * 1024 * 1024;

export type IronRentcarRunState = 'prepared' | 'apply_failed' | 'applied' | 'rollback_products_restored' | 'rolled_back';

export type IronRentcarSyncRun = {
  run_id: string;
  provider_code: 'RP006';
  revision: string;
  counts: IronRentcarCounts;
  actor_uid: string;
  apply_audit_id: string;
  state: IronRentcarRunState;
  affected_keys: string[];
  products_before: StoredSnapshotMap;
  products_after: StoredSnapshotMap;
  partner_before: StoredSnapshot;
  partner_after: StoredSnapshot;
  control_before: StoredSnapshot;
  control_after: StoredSnapshot;
  before_digest: string;
  after_digest: string;
  prepared_at: number;
  failed_at?: number;
  failure_code?: string;
  applied_at?: number;
  rollback_actor_uid?: string;
  rollback_reason?: string;
  rollback_audit_id?: string;
  rollback_products_restored_at?: number;
  rolled_back_at?: number;
};

type JsonObject = Record<string, unknown>;

const text = (value: unknown): string => String(value ?? '').trim();

function normalized(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalized);
  return Object.fromEntries(
    Object.entries(value as JsonObject)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalized(item)]),
  );
}

export function canonicalIronRentcarJson(value: unknown): string {
  return JSON.stringify(normalized(value));
}

export function ironRentcarRootWriteBytes(value: unknown): number {
  return Buffer.byteLength(canonicalIronRentcarJson(value), 'utf8');
}

export function ironRentcarRootWriteAllowed(
  value: unknown,
  maxBytes = IRONRENTCAR_ROOT_WRITE_MAX_BYTES,
): boolean {
  return ironRentcarRootWriteBytes(value) <= maxBytes;
}

export function ironRentcarDigest(value: unknown): string {
  return createHash('sha256').update(canonicalIronRentcarJson(value)).digest('hex');
}

export function storedSnapshot(value: unknown): StoredSnapshot {
  if (!value || typeof value !== 'object') return { exists: false };
  return { exists: true, value: normalized(value) as EntityRecord };
}

export function snapshotMatches(value: unknown, expected: StoredSnapshot): boolean {
  return canonicalIronRentcarJson(storedSnapshot(value)) === canonicalIronRentcarJson(expected);
}

export function restoreStoredSnapshot(expected: StoredSnapshot): EntityRecord | null {
  return expected.exists ? normalized(expected.value || {}) as EntityRecord : null;
}

export function ironRentcarPlanKeys(plan: IronRentcarReconcilePlan): {
  valid: boolean;
  keys: string[];
  duplicates: string[];
  expectedCount: number;
} {
  const raw = [
    ...plan.patchCandidates.map((candidate) => text(candidate.key)),
    ...plan.createCandidates.map((candidate) => text(candidate.product_code || candidate._key)),
    ...plan.absentBlockCandidates.map((candidate) => text(candidate.key)),
  ];
  const frequency = new Map<string, number>();
  for (const key of raw) frequency.set(key, (frequency.get(key) || 0) + 1);
  const duplicates = [...frequency.entries()]
    .filter(([key, count]) => !key || count > 1)
    .map(([key]) => key || '(missing)')
    .sort();
  const keys = [...new Set(raw.filter(Boolean))].sort();
  const expectedCount = plan.patchCandidates.length + plan.createCandidates.length + plan.absentBlockCandidates.length;
  return { valid: duplicates.length === 0 && keys.length === expectedCount, keys, duplicates, expectedCount };
}

export function snapshotsForKeys(products: unknown, keys: string[]): StoredSnapshotMap {
  const rows = products && typeof products === 'object' ? products as Record<string, unknown> : {};
  return Object.fromEntries(keys.map((key) => [key, storedSnapshot(rows[key])]));
}

export function affectedProductsMatch(products: unknown, expected: StoredSnapshotMap): boolean {
  const rows = products && typeof products === 'object' ? products as Record<string, unknown> : {};
  return Object.entries(expected).every(([key, snapshot]) => snapshotMatches(rows[key], snapshot));
}

export function affectedProductsHaveContractLock(products: unknown, keys: string[]): boolean {
  const rows = products && typeof products === 'object' ? products as Record<string, EntityRecord> : {};
  return keys.some((key) => {
    const row = rows[key];
    return !!row && (text(row.locked_by_contract).length > 0 || text(row.vehicle_status) === '계약중');
  });
}

export function replaceAffectedProducts(
  products: unknown,
  expectedCurrent: StoredSnapshotMap,
  replacements: StoredSnapshotMap,
): { ok: boolean; products: Record<string, EntityRecord> } {
  const current = products && typeof products === 'object'
    ? { ...(products as Record<string, EntityRecord>) }
    : {};
  if (!affectedProductsMatch(current, expectedCurrent)) return { ok: false, products: current };
  for (const [key, snapshot] of Object.entries(replacements)) {
    const restored = restoreStoredSnapshot(snapshot);
    if (restored === null) delete current[key];
    else current[key] = restored;
  }
  return { ok: true, products: current };
}

export function syncStateDigest(input: {
  products: StoredSnapshotMap;
  partner: StoredSnapshot;
  control: StoredSnapshot;
}): string {
  return ironRentcarDigest(input);
}

export function rollbackRequestMatches(input: {
  run: IronRentcarSyncRun;
  expectedRevision: string;
  expectedAfterDigest: string;
}): boolean {
  return input.run.revision === input.expectedRevision
    && input.run.after_digest === input.expectedAfterDigest;
}

export function failPreparedIronRentcarRun(
  value: unknown,
  failedAt: number,
  failureCode: string,
): IronRentcarSyncRun | null {
  const run = value && typeof value === 'object' ? value as IronRentcarSyncRun : null;
  if (!run || run.state !== 'prepared') return null;
  return {
    ...run,
    state: 'apply_failed',
    failed_at: failedAt,
    failure_code: String(failureCode || 'apply_failed').slice(0, 80),
  };
}
