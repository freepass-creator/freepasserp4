import { SETTLEMENT_STATES, type EntityRecord } from '@/lib/intake/entities';
import { companyAlias, providerNameMap } from '@/lib/domain/identity';
import { isOpaqueIdentity, isSafeBusinessCode } from '@/lib/domain/work-identity';
import { contractVehicleLabel } from '@/lib/domain/vehicle-label';

export const UNKNOWN_SETTLEMENT_STATUS = '상태 확인' as const;
export const SETTLEMENT_DISPLAY_STATUSES = [
  ...SETTLEMENT_STATES,
  UNKNOWN_SETTLEMENT_STATUS,
] as const;

/**
 * 가나다순이 아닌 실제 정산 업무 흐름 순서.
 * 보류는 대기에서 갈라지는 검토 단계이고, 환수는 정산 완료 뒤의 후속 단계다.
 */
export const SETTLEMENT_WORKFLOW_STATUSES = [
  '정산대기',
  '정산보류',
  '정산완료',
  '환수대기',
  '환수결정',
  UNKNOWN_SETTLEMENT_STATUS,
] as const satisfies readonly SettlementDisplayStatus[];

export type KnownSettlementStatus = (typeof SETTLEMENT_STATES)[number];
export type SettlementDisplayStatus = (typeof SETTLEMENT_DISPLAY_STATUSES)[number];
export type SettlementDisplayTone = 'gray' | 'green' | 'red' | 'amber';
export type SettlementNetTone = 'brand' | 'danger' | 'mute';

export const SETTLEMENT_RENT_WARNING = '월대여료 확인' as const;
export const SETTLEMENT_RATE_WARNING = '공급사율 확인' as const;

export type SettlementWarning = {
  invalidRent: boolean;
  unresolvedRate: boolean;
};

/** 목록·상세가 같은 이상금액 판정과 같은 문구를 쓰게 하는 표시 전용 경계. */
export function settlementWarning(settlement: EntityRecord): SettlementWarning {
  const rent = Number(settlement.rent_amount);
  const invalidRent = !Number.isFinite(rent) || rent <= 0;
  return {
    invalidRent,
    unresolvedRate: !invalidRent && String(settlement.fee_rate_unresolved || '') === 'yes',
  };
}

const KNOWN_STATUSES = new Set<string>(SETTLEMENT_STATES);

/**
 * 정산 목록·필터·상세가 함께 쓰는 상태 정규화 경계.
 * 누락값을 임의로 `정산대기`로 만들지 않는다. 운영자가 원본 상태를 확인해야 한다.
 */
export function normalizeSettlementDisplayStatus(value: unknown): SettlementDisplayStatus {
  const status = String(value ?? '').trim();
  return KNOWN_STATUSES.has(status)
    ? status as KnownSettlementStatus
    : UNKNOWN_SETTLEMENT_STATUS;
}

const SETTLEMENT_WORKFLOW_RANK = new Map<string, number>(
  SETTLEMENT_WORKFLOW_STATUSES.map((status, index) => [status, index]),
);

/** 목록의 `정산상태순`이 한글 가나다순으로 흐트러지지 않게 하는 표시 전용 비교자. */
export function compareSettlementDisplayStatus(left: unknown, right: unknown): number {
  return (SETTLEMENT_WORKFLOW_RANK.get(normalizeSettlementDisplayStatus(left)) ?? Number.MAX_SAFE_INTEGER)
    - (SETTLEMENT_WORKFLOW_RANK.get(normalizeSettlementDisplayStatus(right)) ?? Number.MAX_SAFE_INTEGER);
}

/** 순수익 부호에 따른 공통 표시 의미. 금액 계산이나 저장값에는 관여하지 않는다. */
export function settlementNetTone(value: unknown): SettlementNetTone {
  const net = Number(value);
  if (!Number.isFinite(net) || net === 0) return 'mute';
  return net < 0 ? 'danger' : 'brand';
}

export function settlementDisplayTone(value: unknown): SettlementDisplayTone {
  switch (normalizeSettlementDisplayStatus(value)) {
    case '정산완료': return 'green';
    case '정산대기': return 'amber';
    case '정산보류': return 'gray';
    case '환수대기':
    case '환수결정':
    case UNKNOWN_SETTLEMENT_STATUS:
      return 'red';
  }
}

/** 기존 대기 카운트에 원본 상태 확인이 필요한 행을 포함한다. */
export function settlementNeedsAttention(settlement: EntityRecord): boolean {
  const status = normalizeSettlementDisplayStatus(settlement.settlement_status);
  return status === '정산대기'
    || status === '환수대기'
    || status === UNKNOWN_SETTLEMENT_STATUS;
}

export function matchesSettlementDisplayStatus(
  settlement: EntityRecord,
  filter: string,
): boolean {
  return filter === 'all'
    || normalizeSettlementDisplayStatus(settlement.settlement_status) === filter;
}

export type SettlementDisplayIndex = {
  contractByCode: ReadonlyMap<string, EntityRecord>;
  partnerNameByCode: ReadonlyMap<string, string>;
  userNameByCode: ReadonlyMap<string, string>;
};

function recordKeys(record: EntityRecord, fields: string[]): string[] {
  return fields
    .map((field) => String(record[field] ?? '').trim())
    .filter(Boolean);
}

/** 페이지에서 한 번 읽은 계약·업체·사용자 목록을 표시 전용 인덱스로 만든다. */
export function buildSettlementDisplayIndex(
  contracts: EntityRecord[],
  partners: EntityRecord[],
  users: EntityRecord[],
): SettlementDisplayIndex {
  const contractByCode = new Map<string, EntityRecord>();
  for (const contract of contracts) {
    for (const key of recordKeys(contract, ['contract_code', '_key'])) contractByCode.set(key, contract);
  }

  // partner 엔티티는 공급사와 영업채널을 함께 담는다. 같은 표시명 인덱스를 두 조직에 공용한다.
  const partnerNameByCode = new Map(Object.entries(providerNameMap(partners)));
  const userNameByCode = new Map<string, string>();
  for (const user of users) {
    const name = String(user.name || '').replace(/\s+/g, ' ').trim();
    if (!name || isOpaqueIdentity(name)) continue;
    for (const key of recordKeys(user, ['uid', 'user_code', 'agent_code', '_key'])) {
      userNameByCode.set(key, name);
    }
  }

  return { contractByCode, partnerNameByCode, userNameByCode };
}

function readableName(candidates: unknown[], identities: unknown[]): string {
  const ids = new Set(identities.map((value) => String(value ?? '').trim()).filter(Boolean));
  for (const candidate of candidates) {
    const name = String(candidate ?? '').replace(/\s+/g, ' ').trim();
    if (name && !ids.has(name) && !isOpaqueIdentity(name)) return name;
  }
  return '';
}

function isCodeLikeIdentity(value: string): boolean {
  return isSafeBusinessCode(value)
    || isOpaqueIdentity(value)
    // 운영 레거시 영업자코드(S0035 등)처럼 공통 allow-list 밖의 짧은 코드도 숨긴다.
    || /^[A-Za-z]{1,12}[-_]?\d{1,12}$/.test(value);
}

/**
 * 레거시 정산 엑셀이 명칭을 *_code 칼럼에 저장한 경우에만 쓰는 표시 fallback.
 * 실제 업무코드나 UID는 이름으로 노출하지 않으며 권한·저장 규격에는 관여하지 않는다.
 */
function readableLegacyCodeField(candidates: unknown[]): string {
  for (const candidate of candidates) {
    const name = String(candidate ?? '').replace(/\s+/g, ' ').trim();
    if (name && !isCodeLikeIdentity(name)) return name;
  }
  return '';
}

function settlementSnapshot(settlement: EntityRecord): EntityRecord {
  return {
    maker_snapshot: settlement.maker_snapshot || settlement.maker,
    model_snapshot: settlement.model_snapshot || settlement.model,
    sub_model_snapshot: settlement.sub_model_snapshot || settlement.sub_model,
    variant_snapshot: settlement.variant_snapshot || settlement.variant,
    trim_name_snapshot: settlement.trim_name_snapshot || settlement.trim_name,
    trim_extra_snapshot: settlement.trim_extra_snapshot || settlement.trim_extra,
    vehicle_name_snapshot: settlement.vehicle_name_snapshot || settlement.vehicle_name,
    car_number_snapshot: settlement.car_number_snapshot || settlement.car_number,
  };
}

export type SettlementListDisplay = {
  status: SettlementDisplayStatus;
  tone: SettlementDisplayTone;
  contract: EntityRecord | null;
  vehicleName: string;
  plate: string;
  contractDate: string;
  customerName: string;
  providerName: string;
  agentName: string;
  channelName: string;
};

/** 정산 목록 3줄과 선택 상세가 공유하는 표시값. 권한 판정이나 writer에는 사용하지 않는다. */
export function settlementListDisplay(
  settlement: EntityRecord,
  index: SettlementDisplayIndex,
): SettlementListDisplay {
  const contractCode = String(settlement.contract_code || '').trim();
  const contract = (contractCode && index.contractByCode.get(contractCode)) || null;
  const providerCode = String(
    settlement.provider_company_code
      || settlement.partner_code
      || contract?.provider_company_code
      || contract?.partner_code
      || '',
  ).trim();
  const agentIds = [
    settlement.agent_uid,
    settlement.agent_code,
    contract?.agent_uid,
    contract?.agent_code,
  ];
  const channelCode = String(
    settlement.agent_channel_code
      || contract?.agent_channel_code
      || '',
  ).trim();
  const channelIds = [
    settlement.agent_channel_code,
    contract?.agent_channel_code,
  ];
  const providerIds = [
    settlement.provider_uid,
    settlement.provider_company_code,
    settlement.partner_code,
    contract?.provider_uid,
    contract?.provider_company_code,
    contract?.partner_code,
  ];

  const vehicleName = contractVehicleLabel(contract || undefined)
    || contractVehicleLabel(settlementSnapshot(settlement))
    || '차량명 미확인';
  const providerName = readableName([
    settlement.provider_name,
    settlement.provider_company_name,
    settlement.partner_name,
    contract?.provider_name,
    contract?.provider_company_name,
    contract?.partner_name,
    providerCode ? index.partnerNameByCode.get(providerCode) : '',
  ], providerIds) || readableLegacyCodeField([
    settlement.provider_company_code,
    settlement.partner_code,
    contract?.provider_company_code,
    contract?.partner_code,
  ]);
  const agentName = readableName([
    settlement.agent_name,
    contract?.agent_name,
    ...agentIds.map((id) => index.userNameByCode.get(String(id || '').trim())),
  ], agentIds) || readableLegacyCodeField([
    settlement.agent_code,
    contract?.agent_code,
  ]);
  const channelName = readableName([
    settlement.agent_channel_name,
    settlement.channel_name,
    contract?.agent_channel_name,
    contract?.channel_name,
    channelCode ? index.partnerNameByCode.get(channelCode) : '',
  ], channelIds) || readableLegacyCodeField([
    settlement.agent_channel_code,
    contract?.agent_channel_code,
  ]);
  const status = normalizeSettlementDisplayStatus(settlement.settlement_status);

  return {
    status,
    tone: settlementDisplayTone(status),
    contract,
    vehicleName,
    plate: String(contract?.car_number_snapshot || settlement.car_number_snapshot || settlement.car_number || '').trim(),
    contractDate: String(settlement.contract_date || contract?.contract_date || '').trim(),
    customerName: readableName([settlement.customer_name, contract?.customer_name], []),
    providerName: providerName ? companyAlias(providerName) : '',
    agentName,
    channelName,
  };
}
