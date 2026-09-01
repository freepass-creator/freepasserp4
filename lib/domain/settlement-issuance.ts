import type { EntityRecord } from '@/lib/intake/entities';
import { getProgress, isContractCancelled } from '@/lib/domain/contract';
import { displayNumber, settlementIdForContract, settlementStorageKeyForContract } from '@/lib/domain/ids';

type Rec = Record<string, unknown>;

const text = (value: unknown) => String(value ?? '').trim();

export type SettlementIssueActor = {
  uid: string;
  role: 'agent' | 'provider' | 'admin';
  rawRole: string;
  companyCode: string;
  agentChannelCode: string;
};

export class SettlementIssuanceError extends Error {}

/** v4 overlay tombstone은 v3 원장이 남아 있어도 계약을 폐기한 최종 의사표시다. */
export function isSettlementContractDeleted(contract: EntityRecord | null | undefined): boolean {
  return !!contract && (contract._deleted === true || !!contract.deletedAt);
}

/** 완료된 계약의 정산은 계약 당사자 또는 관리자만 서버에서 발행한다. */
export function canIssueSettlement(actor: SettlementIssueActor, contract: EntityRecord): boolean {
  if (actor.role === 'admin') return true;
  if (actor.role === 'provider') {
    return !!actor.companyCode && text(contract.provider_company_code) === actor.companyCode;
  }
  if (text(contract.agent_uid) === actor.uid) return true;
  const managesChannel = actor.rawRole === 'agent_admin' || actor.rawRole === 'agent_manager';
  return managesChannel
    && !!actor.agentChannelCode
    && text(contract.agent_channel_code) === actor.agentChannelCode;
}

/** 계약완료 또는 5단계가 모두 끝난 복구 대상만 정산을 만들 수 있다. */
export function canIssueSettlementForContract(contract: EntityRecord): boolean {
  // v3 원장 위의 v4는 soft-delete tombstone으로 숨긴다. 금액 원장은 v3에
  // 남아 있더라도, overlay에서 폐기된 계약을 정산 대상으로 되살리면 안 된다.
  if (isSettlementContractDeleted(contract)) return false;
  if (isContractCancelled(contract)) return false;
  const progress = getProgress(contract);
  return progress.done === progress.total;
}

function frozenRate(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

export type SettlementIssueRecords = {
  code: string;
  publicRecord: EntityRecord;
  providerPrivate: EntityRecord;
  agentPrivate: EntityRecord;
  adminPrivate: EntityRecord;
};

/**
 * 금액을 브라우저 입력값이 아니라 서버가 확정한 계약 동결값으로 한 번만 조립한다.
 * live 공급사·영업자 요율을 완료 시점에 다시 읽으면 당사자가 사후에 금액을 바꾸는
 * 기준이 되므로, 동결 요율이 없는 계약은 관리자 검토·이관 전에는 fail-closed 한다.
 */
export function buildSettlementIssueRecords(input: {
  contract: EntityRecord;
  /** 계약 생성 시 동결한 상품구분. live 상품을 다시 읽어 수수료를 바꾸지 않는다. */
  productType: string;
  partner?: EntityRecord | null;
  partnerPrivate?: Rec | null;
  agentUser?: EntityRecord | null;
  agentUserPrivate?: Rec | null;
  issuedAt?: Date;
  legacyRecovery?: boolean;
  issuedByUid?: string;
}): SettlementIssueRecords {
  const { contract } = input;
  const contractCode = text(contract.contract_code);
  const code = settlementStorageKeyForContract(contractCode);
  const canonicalCode = settlementIdForContract(contractCode);
  const rent = Number(contract.rent_amount_snapshot);
  if (!code || !canonicalCode || !Number.isFinite(rent) || rent <= 0) {
    throw new SettlementIssuanceError('정산 생성에 필요한 계약번호 또는 월 대여료가 없습니다.');
  }

  const feeSnapshot = frozenRate(contract.fee_rate_snapshot);
  const payoutSnapshot = frozenRate(contract.payout_rate_snapshot);
  const productType = text(input.productType);
  if (!productType) {
    throw new SettlementIssuanceError('계약 당시 상품구분 동결값이 없어 정산을 생성할 수 없습니다. 관리자에게 확인을 요청해 주세요.');
  }
  if (feeSnapshot == null || payoutSnapshot == null) {
    throw new SettlementIssuanceError('서버 확정 수수료율·영업지급율이 없는 계약은 정산을 생성할 수 없습니다. 관리자에게 요율 검토를 요청해 주세요.');
  }
  const feeRate = feeSnapshot;
  const payoutRate = payoutSnapshot;
  const feeAmount = Math.round(rent * feeRate);
  const agentPayout = Math.round(rent * payoutRate);
  const issuedAt = input.issuedAt || new Date();
  const createdAt = issuedAt.toISOString();
  const common: Rec = {
    _key: code,
    settlement_code: code,
    contract_code: contractCode,
  };

  return {
    code,
    publicRecord: {
      ...common,
      ...(canonicalCode !== code ? { canonical_code: canonicalCode, legacy_settlement_code: code } : {}),
      settlement_number: displayNumber('settlement', canonicalCode, text(contract.contract_date) || issuedAt),
      car_number: contract.car_number_snapshot,
      customer_name: contract.customer_name,
      provider_company_code: contract.provider_company_code,
      partner_code: contract.provider_company_code,
      agent_code: contract.agent_code,
      agent_channel_code: contract.agent_channel_code,
      rent_amount: rent,
      clawback_amount: 0,
      ...(input.legacyRecovery ? { settlement_legacy_recovery: 'yes' } : {}),
      settlement_status: '정산대기',
      contract_date: contract.contract_date,
      rent_month_snapshot: contract.rent_month_snapshot,
      product_type_snapshot: productType,
      sub_model_snapshot: contract.sub_model_snapshot,
      createdAt,
      createdBy: 'server-settlement-issuance',
      issued_by_uid: input.issuedByUid || '',
    },
    providerPrivate: {
      ...common,
      provider_company_code: contract.provider_company_code,
      agent_code: contract.agent_code,
      agent_channel_code: contract.agent_channel_code,
      fee_rate: feeRate,
      fee_amount: feeAmount,
      createdAt,
      createdBy: 'server-settlement-issuance',
    },
    agentPrivate: {
      ...common,
      provider_company_code: contract.provider_company_code,
      agent_code: contract.agent_code,
      agent_channel_code: contract.agent_channel_code,
      payout_rate: payoutRate,
      agent_payout: agentPayout,
      createdAt,
      createdBy: 'server-settlement-issuance',
    },
    adminPrivate: {
      ...common,
      net_amount: feeAmount - agentPayout,
      createdAt,
      createdBy: 'server-settlement-issuance',
    },
  };
}
