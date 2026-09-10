import type { EntityRecord } from '@/lib/intake/entities';
import { getSession } from '@/lib/auth-session';

type Rec = Record<string, unknown>;
const PROVIDER_FIELDS = ['fee_rate', 'fee_amount'] as const;
const AGENT_FIELDS = ['agent_payout', 'payout_rate', 'agent_payout_rate_snapshot', 'payout_rate_snapshot'] as const;
const ADMIN_FIELDS = ['net_amount'] as const;

export function splitSettlementPrivate(settlement: EntityRecord): {
  publicRecord: EntityRecord;
  providerRecord: EntityRecord | null;
  agentRecord: EntityRecord | null;
  adminRecord: EntityRecord | null;
} {
  const publicRecord = { ...settlement };
  const providerRecord: EntityRecord = {};
  const agentRecord: EntityRecord = {};
  const adminRecord: EntityRecord = {};
  for (const field of PROVIDER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(settlement, field)) providerRecord[field] = settlement[field];
    delete publicRecord[field];
  }
  for (const field of AGENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(settlement, field)) agentRecord[field] = settlement[field];
    delete publicRecord[field];
  }
  for (const field of ADMIN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(settlement, field)) adminRecord[field] = settlement[field];
    delete publicRecord[field];
  }
  const common: Rec = {
    _key: settlement._key,
    settlement_code: settlement.settlement_code || settlement._key,
    // private 금액 최초 생성 Rules가 신뢰 계약의 동결 금액·율과 직접 대조할 수 있게 한다.
    // public/private는 같은 v4 multi-location update로 저장되므로 public settlement를 경유할 수 없다.
    contract_code: settlement.contract_code,
  };
  Object.assign(providerRecord, common, {
    provider_company_code: settlement.provider_company_code,
    agent_code: settlement.agent_code,
    agent_channel_code: settlement.agent_channel_code,
  });
  Object.assign(agentRecord, common, {
    agent_code: settlement.agent_code,
    agent_channel_code: settlement.agent_channel_code,
    provider_company_code: settlement.provider_company_code,
  });
  Object.assign(adminRecord, common);
  const nonEmpty = (record: EntityRecord, fields: readonly string[]) =>
    fields.some((field) => Object.prototype.hasOwnProperty.call(record, field)) ? record : null;
  return {
    publicRecord,
    providerRecord: nonEmpty(providerRecord, PROVIDER_FIELDS),
    agentRecord: nonEmpty(agentRecord, AGENT_FIELDS),
    adminRecord: nonEmpty(adminRecord, ADMIN_FIELDS),
  };
}

export function mergeSettlementPrivate(
  settlement: EntityRecord,
  providerRecord?: EntityRecord | null,
  agentRecord?: EntityRecord | null,
  adminRecord?: EntityRecord | null,
): EntityRecord {
  const publicOnly = { ...settlement };
  const legacyProvider: EntityRecord = {};
  const legacyAgent: EntityRecord = {};
  const legacyAdmin: EntityRecord = {};
  for (const field of PROVIDER_FIELDS) legacyProvider[field] = settlement[field];
  for (const field of AGENT_FIELDS) legacyAgent[field] = settlement[field];
  for (const field of ADMIN_FIELDS) legacyAdmin[field] = settlement[field];
  for (const field of [...PROVIDER_FIELDS, ...AGENT_FIELDS, ...ADMIN_FIELDS]) delete publicOnly[field];
  const role = getSession()?.role;
  if (role === 'admin') {
    const merged = { ...publicOnly, ...legacyProvider, ...legacyAgent, ...legacyAdmin, ...providerRecord, ...agentRecord, ...adminRecord };
    if (merged.net_amount == null && (merged.fee_amount != null || merged.agent_payout != null)) {
      merged.net_amount = (Number(merged.fee_amount) || 0) - (Number(merged.agent_payout) || 0);
    }
    return merged;
  }
  if (role === 'provider') return { ...publicOnly, ...legacyProvider, ...providerRecord };
  return { ...publicOnly, ...legacyAgent, ...agentRecord };
}
