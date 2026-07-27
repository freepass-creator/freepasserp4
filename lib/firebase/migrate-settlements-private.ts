import { get, ref, update } from 'firebase/database';
import { getRtdb } from './client';
import { splitSettlementPrivate } from './rtdb-settlements';
import type { EntityRecord } from '@/lib/intake/entities';

type Rec = Record<string, unknown>;
type Rows = Record<string, Rec>;
type Updates = Record<string, unknown>;
const PRIVATE_FIELDS = ['fee_rate', 'fee_amount', 'agent_payout', 'payout_rate', 'agent_payout_rate_snapshot', 'payout_rate_snapshot', 'net_amount'] as const;
const FORBIDDEN_KEY = /[.#$/[\]]/;

export type SettlementPrivateMigrationPlan = {
  scanned: number;
  withFinance: number;
  providerWrites: number;
  agentWrites: number;
  adminWrites: number;
  publicDeletes: number;
  skippedUnsafe: number;
  updates: Updates;
};

export type SettlementPrivateMigrationBackup = {
  version: 1;
  exportedAt: string;
  nodes: {
    settlements: Rows;
    v4Settlements: Rows;
    providerPrivate: Rows;
    agentPrivate: Rows;
    adminPrivate: Rows;
  };
};

type SettlementPrivateMigrationOptions = {
  beforeApply?: (backup: SettlementPrivateMigrationBackup) => void | Promise<void>;
};

export function buildSettlementPrivateMigrationPlan(
  v3: Rows,
  v4: Rows,
  existingProvider: Rows,
  existingAgent: Rows,
  existingAdmin: Rows,
): SettlementPrivateMigrationPlan {
  const merged = new Map<string, EntityRecord>();
  const sources = new Map<string, { path: string; record: Rec }[]>();
  let skippedUnsafe = 0;
  const collect = (rows: Rows, prefix: string) => {
    for (const [childKey, record] of Object.entries(rows)) {
      if (!record || typeof record !== 'object') { skippedUnsafe++; continue; }
      const key = String(record.settlement_code || childKey).trim();
      if (!key || FORBIDDEN_KEY.test(key) || FORBIDDEN_KEY.test(childKey)) { skippedUnsafe++; continue; }
      merged.set(key, { ...(merged.get(key) || {}), ...record, _key: key, settlement_code: key });
      const list = sources.get(key) || [];
      list.push({ path: `${prefix}/${childKey}`, record });
      sources.set(key, list);
    }
  };
  collect(v3, 'settlements');
  collect(v4, 'v4/settlements');

  const updates: Updates = {};
  let withFinance = 0, providerWrites = 0, agentWrites = 0, adminWrites = 0, publicDeletes = 0;
  for (const [key, settlement] of merged) {
    const split = splitSettlementPrivate(settlement);
    const hasFinance = PRIVATE_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(settlement, field));
    if (!hasFinance) continue;
    withFinance++;
    if (split.providerRecord) {
      updates[`v4/settlements_provider_private/${key}`] = { ...split.providerRecord, ...(existingProvider[key] || {}), migratedAt: new Date().toISOString() };
      providerWrites++;
    }
    if (split.agentRecord) {
      updates[`v4/settlements_agent_private/${key}`] = { ...split.agentRecord, ...(existingAgent[key] || {}), migratedAt: new Date().toISOString() };
      agentWrites++;
    }
    if (split.adminRecord) {
      updates[`v4/settlements_admin_private/${key}`] = { ...split.adminRecord, ...(existingAdmin[key] || {}), migratedAt: new Date().toISOString() };
      adminWrites++;
    }
    for (const source of sources.get(key) || []) {
      for (const field of PRIVATE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(source.record, field)) continue;
        updates[`${source.path}/${field}`] = null;
        publicDeletes++;
      }
    }
  }
  return { scanned: merged.size, withFinance, providerWrites, agentWrites, adminWrites, publicDeletes, skippedUnsafe, updates };
}

export async function migrateSettlementsPrivate(
  dryRun = true,
  options: SettlementPrivateMigrationOptions = {},
) {
  const db = getRtdb();
  if (!db) throw new Error('Firebase DB가 설정되지 않았습니다.');
  const snaps = await Promise.all([
    get(ref(db, 'settlements')),
    get(ref(db, 'v4/settlements')),
    get(ref(db, 'v4/settlements_provider_private')),
    get(ref(db, 'v4/settlements_agent_private')),
    get(ref(db, 'v4/settlements_admin_private')),
  ]);
  const source = {
    settlements: (snaps[0].val() as Rows | null) || {},
    v4Settlements: (snaps[1].val() as Rows | null) || {},
    providerPrivate: (snaps[2].val() as Rows | null) || {},
    agentPrivate: (snaps[3].val() as Rows | null) || {},
    adminPrivate: (snaps[4].val() as Rows | null) || {},
  };
  const plan = buildSettlementPrivateMigrationPlan(
    source.settlements,
    source.v4Settlements,
    source.providerPrivate,
    source.agentPrivate,
    source.adminPrivate,
  );
  const entries = Object.entries(plan.updates);
  if (!dryRun) {
    if (plan.skippedUnsafe) {
      throw new Error(`안전하지 않은 정산 ${plan.skippedUnsafe}건이 있어 실제 이동을 중단했습니다.`);
    }
    if (!options.beforeApply) {
      throw new Error('실제 이동 전 백업 처리가 필요합니다.');
    }
    await options.beforeApply({
      version: 1,
      exportedAt: new Date().toISOString(),
      nodes: source,
    });
    for (let index = 0; index < entries.length; index += 400) {
      await update(ref(db), Object.fromEntries(entries.slice(index, index + 400)));
    }
  }
  return {
    ...plan,
    updates: undefined,
    dryRun,
    plannedPaths: entries.length,
    plannedBatches: Math.ceil(entries.length / 400),
    appliedPaths: dryRun ? 0 : entries.length,
  };
}
