import 'server-only';

import type { Database } from 'firebase-admin/database';
import type { EntityRecord } from '@/lib/intake/entities';
import type { ActiveBearer } from '@/lib/server/firebase-admin';
import { isContractCancelled } from '@/lib/domain/contract';
import { priceList } from '@/lib/domain/product';
import {
  isFreepassDirectContract,
  resolveFreepassSettlementRateBasis,
  validContractCode,
  type EsignRecord,
} from '@/lib/server/freepass-esign';

type Rec = Record<string, unknown>;
const text = (value: unknown) => String(value ?? '').trim();
const record = (value: unknown): Rec => value && typeof value === 'object' && !Array.isArray(value) ? value as Rec : {};
const finite = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const sameNumber = (left: unknown, right: number) => finite(left) === right;

export class ContractSettlementSealError extends Error {}

/**
 * 일반 5단계 계약의 정산 기준은 계약 패널이 아니라 이 서버 전용 node에서만 확정한다.
 * Direct Freepass 계약은 별도 esign contract seal을 사용하므로 이 형식에 넣지 않는다.
 */
export type ContractSettlementSeal = {
  /**
   * v2부터 UID뿐 아니라 서버 users 정본의 영업 코드·채널까지 함께 봉인한다.
   * v1은 이 세 당사자 귀속을 증명할 수 없으므로 새 정산 경로에서 fail-closed 한다.
   */
  version: 'contract-settlement-v2';
  /** preparing은 public 약정 write 전/재시도 중인 서버 전용 예약 상태이며 정산·차량선점에는 쓸 수 없다. */
  status: 'preparing' | 'sealed';
  contractCode: string;
  productCode: string;
  agentUid: string;
  agentCode: string;
  agentChannelCode: string;
  providerCompanyCode: string;
  rentMonth: number;
  rentAmount: number;
  depositAmount: number;
  productType: string;
  feeRate: number;
  payoutRate: number;
  preparedAt: number;
  sealedAt: number | null;
  sealedByUid: string;
};

type CanonicalAgentParty = {
  uid: string;
  code: string;
  channelCode: string;
};

function isSealedRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function parseSeal(value: unknown, contractCode: string): ContractSettlementSeal | null {
  const raw = record(value);
  if (raw.version !== 'contract-settlement-v2') return null;
  const rentMonth = finite(raw.rentMonth);
  const rentAmount = finite(raw.rentAmount);
  const depositAmount = finite(raw.depositAmount);
  const preparedAt = finite(raw.preparedAt);
  const sealedAt = raw.sealedAt == null ? null : finite(raw.sealedAt);
  const seal: ContractSettlementSeal = {
    version: 'contract-settlement-v2',
    status: raw.status === 'preparing' || raw.status === 'sealed' ? raw.status : 'preparing',
    contractCode: text(raw.contractCode),
    productCode: text(raw.productCode),
    agentUid: text(raw.agentUid),
    agentCode: text(raw.agentCode),
    agentChannelCode: text(raw.agentChannelCode),
    providerCompanyCode: text(raw.providerCompanyCode),
    rentMonth: rentMonth ?? 0,
    rentAmount: rentAmount ?? 0,
    depositAmount: depositAmount ?? -1,
    productType: text(raw.productType),
    feeRate: finite(raw.feeRate) ?? -1,
    payoutRate: finite(raw.payoutRate) ?? -1,
    preparedAt: preparedAt ?? 0,
    sealedAt,
    sealedByUid: text(raw.sealedByUid),
  };
  if (
    seal.version !== 'contract-settlement-v2'
    || (seal.status !== 'preparing' && seal.status !== 'sealed')
    || seal.contractCode !== contractCode
    || !seal.productCode
    || !seal.agentUid
    || !seal.agentCode
    || !seal.agentChannelCode
    || !seal.providerCompanyCode
    || !Number.isInteger(seal.rentMonth)
    || seal.rentMonth <= 0
    || seal.rentAmount <= 0
    || seal.depositAmount < 0
    || !seal.productType
    || !isSealedRate(seal.feeRate)
    || !isSealedRate(seal.payoutRate)
    || seal.preparedAt <= 0
    || (seal.status === 'sealed' && (seal.sealedAt == null || seal.sealedAt <= 0))
    || (seal.status === 'preparing' && seal.sealedAt != null)
    || !seal.sealedByUid
  ) return null;
  return seal;
}

export async function readContractSettlementSeal(
  db: Database,
  contractCode: string,
): Promise<ContractSettlementSeal | null> {
  const code = validContractCode(contractCode);
  if (!code) return null;
  const snap = await db.ref(`v4/contract_settlement_seals/${code}`).get();
  if (!snap.exists()) return null;
  const parsed = parseSeal(snap.val(), code);
  if (!parsed) throw new ContractSettlementSealError('서버 정산 기준 봉인값이 올바르지 않습니다. 관리자에게 확인을 요청해 주세요.');
  return parsed;
}

export function contractSettlementSealMatchesContract(
  seal: ContractSettlementSeal,
  contract: EntityRecord | Rec | null | undefined,
): boolean {
  const current = record(contract);
  return text(current.contract_code || current._key) === seal.contractCode
    && text(current.product_code) === seal.productCode
    && text(current.agent_uid) === seal.agentUid
    && text(current.agent_code) === seal.agentCode
    && text(current.agent_channel_code) === seal.agentChannelCode
    && text(current.provider_company_code) === seal.providerCompanyCode
    && sameNumber(current.rent_month_snapshot, seal.rentMonth)
    && sameNumber(current.rent_amount_snapshot, seal.rentAmount)
    && sameNumber(current.deposit_amount_snapshot, seal.depositAmount)
    && text(current.product_type_snapshot) === seal.productType;
}

/**
 * 준비 중인 seal은 아직 공개 계약의 기간·금액을 쓰기 전일 수 있다. 이때도 당사자,
 * 차량, 공급사가 이미 다르면 이전 서버 예약을 재사용하지 않는다.
 */
function contractSettlementSealCoreMatchesContract(
  seal: ContractSettlementSeal,
  contract: EntityRecord | Rec | null | undefined,
): boolean {
  const current = record(contract);
  return text(current.contract_code || current._key) === seal.contractCode
    && text(current.product_code) === seal.productCode
    && text(current.agent_uid) === seal.agentUid
    && text(current.agent_code) === seal.agentCode
    && text(current.agent_channel_code) === seal.agentChannelCode
    && text(current.provider_company_code) === seal.providerCompanyCode;
}

function preparedSealCanCompleteContract(
  seal: ContractSettlementSeal,
  contract: EntityRecord | Rec | null | undefined,
): boolean {
  const current = record(contract);
  const absentOrEqual = (key: string, expected: number | string) => !Object.hasOwn(current, key)
    || current[key] == null
    || current[key] === ''
    || (typeof expected === 'number' ? sameNumber(current[key], expected) : text(current[key]) === expected);
  return contractSettlementSealCoreMatchesContract(seal, current)
    && absentOrEqual('rent_month_snapshot', seal.rentMonth)
    && absentOrEqual('rent_amount_snapshot', seal.rentAmount)
    && absentOrEqual('deposit_amount_snapshot', seal.depositAmount)
    && absentOrEqual('product_type_snapshot', seal.productType)
    // 공개 rate projection이 있으면 server-only seal의 private rate와 섞지 않는다.
    && (!Object.hasOwn(current, 'fee_rate_snapshot') || current.fee_rate_snapshot == null || current.fee_rate_snapshot === '')
    && (!Object.hasOwn(current, 'payout_rate_snapshot') || current.payout_rate_snapshot == null || current.payout_rate_snapshot === '');
}

export function contractWithSettlementSeal(
  contract: EntityRecord,
  seal: ContractSettlementSeal,
): EntityRecord {
  return {
    ...contract,
    agent_uid: seal.agentUid,
    agent_code: seal.agentCode,
    agent_channel_code: seal.agentChannelCode,
    provider_company_code: seal.providerCompanyCode,
    product_type_snapshot: seal.productType,
    rent_month_snapshot: seal.rentMonth,
    rent_amount_snapshot: seal.rentAmount,
    deposit_amount_snapshot: seal.depositAmount,
    fee_rate_snapshot: seal.feeRate,
    payout_rate_snapshot: seal.payoutRate,
    settlement_rate_status: 'sealed',
  } as EntityRecord;
}

/** API/cache에는 private 정산율을 절대 합성하거나 되돌려주지 않는다. */
function publicSettlementContractPatch(contract: EntityRecord): EntityRecord {
  const patch = { ...contract } as EntityRecord;
  delete patch.fee_rate_snapshot;
  delete patch.payout_rate_snapshot;
  return patch;
}

function usableGenericContract(raw: unknown, contractCode: string): EntityRecord {
  const contract = record(raw) as EntityRecord;
  if (!Object.keys(contract).length) {
    throw new ContractSettlementSealError('현재 계약 원장을 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.');
  }
  if (text(contract.contract_code) !== contractCode) {
    throw new ContractSettlementSealError('계약 경로와 계약번호가 일치하지 않습니다. 관리자에게 확인을 요청해 주세요.');
  }
  if (isFreepassDirectContract(contract)) {
    throw new ContractSettlementSealError('직접 전자계약은 전자계약 서버에서만 약정 기준을 동결할 수 있습니다.');
  }
  if (isContractCancelled(contract) || contract._deleted === true || !!contract.deletedAt) {
    throw new ContractSettlementSealError('취소되었거나 폐기된 계약은 약정 기준을 동결할 수 없습니다.');
  }
  if (text(contract.contract_status) === '계약완료') {
    throw new ContractSettlementSealError('이미 완료된 계약에는 새 정산 기준을 동결할 수 없습니다. 과거 계약은 관리자 검토 절차로 처리해 주세요.');
  }
  return contract;
}

function activeAgentProfile(value: unknown): CanonicalAgentParty | null {
  const profile = record(value);
  const role = text(profile.role);
  if (role !== 'agent' && role !== 'agent_admin' && role !== 'agent_manager') return null;
  if (['pending', 'deleted', 'rejected'].includes(text(profile.status))) return null;
  if (profile.is_active === false || profile.is_active === '아니오') return null;
  const uid = text(profile.uid || profile._key);
  const code = text(profile.user_code);
  const channelCode = text(profile.agent_channel_code);
  if (!uid || !code || !channelCode) return null;
  return { uid, code, channelCode };
}

/**
 * 공개 contract의 agent_* 값은 역할별 목록/진행용 projection일 뿐 요율·정산 귀속의
 * 정본이 아니다. 반드시 users/{uid}의 활성 영업자 프로필과 정확히 맞아야 한다.
 */
async function canonicalAgentParty(
  db: Database,
  contract: EntityRecord,
): Promise<CanonicalAgentParty> {
  const uid = text(contract.agent_uid);
  if (!uid) throw new ContractSettlementSealError('계약 담당 영업자 UID가 없어 약정 기준을 동결할 수 없습니다.');
  const snap = await db.ref(`users/${uid}`).get();
  const party = activeAgentProfile({ ...record(snap.val()), uid });
  if (!party) throw new ContractSettlementSealError('계약 담당 영업자의 활성 코드·채널을 확인하지 못했습니다. 관리자에게 확인을 요청해 주세요.');
  if (text(contract.agent_code) !== party.code || text(contract.agent_channel_code) !== party.channelCode) {
    throw new ContractSettlementSealError('계약의 영업자 코드·채널이 서버 사용자 정본과 일치하지 않습니다. 관리자에게 확인을 요청해 주세요.');
  }
  return party;
}

function matchesCanonicalAgentParty(
  contract: EntityRecord | Rec | null | undefined,
  party: CanonicalAgentParty,
): boolean {
  const current = record(contract);
  return text(current.agent_uid) === party.uid
    && text(current.agent_code) === party.code
    && text(current.agent_channel_code) === party.channelCode;
}

/** 약정작성완료는 레거시 key 이름과 달리 영업자 단계다. */
function canCompleteGenericAgreement(actor: ActiveBearer, party: CanonicalAgentParty): boolean {
  if (actor.role === 'admin') return true;
  if (actor.role !== 'agent') return false;
  if (party.uid === actor.uid) return true;
  return (actor.rawRole === 'agent_admin' || actor.rawRole === 'agent_manager')
    && !!actor.agentChannelCode
    && party.channelCode === actor.agentChannelCode;
}

/** UI 단계 잠금과 동일한 서버 경계. API 직접호출로 서류/공급사 승인을 건너뛰지 못하게 한다. */
export function hasGenericAgreementPrerequisites(contract: EntityRecord | Rec | null | undefined): boolean {
  const current = record(contract);
  const delivery = text(current.provider_delivery_response);
  return text(current.agent_delivery_inquiry) === 'yes'
    && (delivery === '출고 가능' || delivery === '출고 협의')
    && text(current.agent_docs_submitted) === 'yes'
    && text(current.provider_docs_review) === '승인';
}

function sealRecord(input: {
  contract: EntityRecord;
  product: EntityRecord;
  agent: CanonicalAgentParty;
  rentMonth: number;
  rentAmount: number;
  depositAmount: number;
  productType: string;
  feeRate: number;
  payoutRate: number;
  actor: ActiveBearer;
  now: number;
}): ContractSettlementSeal {
  return {
    version: 'contract-settlement-v2',
    status: 'preparing',
    contractCode: text(input.contract.contract_code),
    productCode: text(input.product.product_code),
    agentUid: input.agent.uid,
    agentCode: input.agent.code,
    agentChannelCode: input.agent.channelCode,
    providerCompanyCode: text(input.contract.provider_company_code),
    rentMonth: input.rentMonth,
    rentAmount: input.rentAmount,
    depositAmount: input.depositAmount,
    productType: input.productType,
    feeRate: input.feeRate,
    payoutRate: input.payoutRate,
    preparedAt: input.now,
    sealedAt: null,
    sealedByUid: input.actor.uid,
  };
}

function sameCoreSeal(left: ContractSettlementSeal, right: ContractSettlementSeal): boolean {
  return left.contractCode === right.contractCode
    && left.productCode === right.productCode
    && left.agentUid === right.agentUid
    && left.agentCode === right.agentCode
    && left.agentChannelCode === right.agentChannelCode
    && left.providerCompanyCode === right.providerCompanyCode
    && left.rentMonth === right.rentMonth
    && left.rentAmount === right.rentAmount
    && left.depositAmount === right.depositAmount
    && left.productType === right.productType
    && left.feeRate === right.feeRate
    && left.payoutRate === right.payoutRate;
}

/**
 * private rate snapshot은 public agreement write보다 먼저 준비한다. 이후 public write가
 * 네트워크 오류로 실패해도 계약이 완료된 것처럼 보이지 않으며, 같은 서버 예약을 재시도해
 * 마무리할 수 있다. sealed 상태만 차량 선점·정산에서 인정된다.
 */
async function finalizeSettlementSeal(
  db: Database,
  contractCode: string,
  expected: ContractSettlementSeal,
): Promise<ContractSettlementSeal> {
  const sealRef = db.ref(`v4/contract_settlement_seals/${contractCode}`);
  let conflict = false;
  const result = await sealRef.transaction((raw) => {
    // Admin SDK transaction도 빈 로컬 캐시에서는 원격 preparing record가 있어도
    // 먼저 null callback을 줄 수 있다. 여기서 conflict로 abort하면 정상 재시도가
    // 영구히 막힌다. null proposal은 원격 snapshot을 받은 뒤 다시 평가된다.
    if (raw == null) return null;
    const current = parseSeal(raw, contractCode);
    if (!current || !sameCoreSeal(current, expected)) {
      conflict = true;
      return undefined;
    }
    if (current.status === 'sealed') return undefined;
    return { ...current, status: 'sealed', sealedAt: Date.now() };
  }, undefined, false);
  const sealed = parseSeal(result.snapshot.val(), contractCode)
    || await readContractSettlementSeal(db, contractCode);
  if (!sealed || conflict || !sameCoreSeal(sealed, expected) || sealed.status !== 'sealed') {
    throw new ContractSettlementSealError('서버 정산 기준 봉인값을 완료하지 못했습니다. 같은 약정 완료를 다시 시도해 주세요.');
  }
  return sealed;
}

/**
 * 일반 계약 패널의 약정완료 시점 서버 경계.
 * 기간만 브라우저에서 받고, 차량 가격·상품구분·공급사/영업자 private 요율은 서버가 다시 읽는다.
 */
export async function freezeContractSettlementTerms(input: {
  db: Database;
  actor: ActiveBearer;
  contractCode: string;
  rentMonth: number;
  customerName?: string;
  customerPhone?: string;
  completeAgreement?: boolean;
}): Promise<{ seal: ContractSettlementSeal; contractPatch: EntityRecord; reused: boolean }> {
  const contractCode = validContractCode(input.contractCode);
  const rentMonth = Number(input.rentMonth);
  if (!contractCode || !Number.isInteger(rentMonth) || rentMonth <= 0 || rentMonth > 120) {
    throw new ContractSettlementSealError('약정 기간 또는 계약번호가 올바르지 않습니다.');
  }
  // 이 seal은 "약정작성완료"의 결과다. 기간만 먼저 확정하는 공개 API를 두면
  // 손님정보·약정확인 없이 차량 선점/정산으로 이어질 수 있으므로 허용하지 않는다.
  if (input.completeAgreement !== true) {
    throw new ContractSettlementSealError('일반 계약의 정산 기준은 손님 정보까지 입력한 약정작성완료에서만 확정할 수 있습니다.');
  }
  const completeAgreement = true;
  const customerName = text(input.customerName);
  const customerPhone = text(input.customerPhone);
  if (completeAgreement && (!customerName || !customerPhone || customerName.length > 120 || customerPhone.length > 60)) {
    throw new ContractSettlementSealError('약정 완료에 필요한 손님명·연락처를 확인해 주세요.');
  }

  const contractRef = input.db.ref(`v4/contracts/${contractCode}`);
  const [initialContractSnap, legacyContractSnap, existingSeal] = await Promise.all([
    contractRef.get(),
    // v3 원장은 금전/당사자 SSOT다. 부분 v4 overlay에 현재 요율을 붙이면 issuer가
    // legacy 원장과 다시 대조할 때 drift가 생긴다. 별도 관리자 복구 전에는 fail-closed.
    input.db.ref(`contracts/${contractCode}`).get(),
    readContractSettlementSeal(input.db, contractCode),
  ]);
  if (legacyContractSnap.exists()) {
    throw new ContractSettlementSealError('기존 원장 계약은 서버 정산 기준을 자동 확정할 수 없습니다. 관리자 검토 절차로 처리해 주세요.');
  }
  const initialContract = usableGenericContract(initialContractSnap.val(), contractCode);
  const initialAgent = await canonicalAgentParty(input.db, initialContract);
  if (!canCompleteGenericAgreement(input.actor, initialAgent)) {
    throw new ContractSettlementSealError('이 계약의 약정 기준을 동결할 권한이 없습니다.');
  }
  if (!hasGenericAgreementPrerequisites(initialContract)) {
    throw new ContractSettlementSealError('출고 문의·공급사 출고응답·서류 승인까지 완료한 뒤 약정을 작성할 수 있습니다.');
  }

  /**
   * Two-phase 서버 전이:
   * 1) private preparing seal을 먼저 예약하고 2) public 약정을 반영한 뒤
   * 3) sealed로 승격한다. 중간 장애는 재시도로만 회복되며 미봉인 상태가 차량/정산을
   * 통과하지 못한다. public 약정 완료를 먼저 써서 영구히 막히는 순서를 피한다.
   */
  const completePublicAgreementForSeal = async (prepared: ContractSettlementSeal): Promise<{
    seal: ContractSettlementSeal;
    contractPatch: EntityRecord;
    reused: boolean;
  }> => {
    const compatibleInitial = prepared.status === 'sealed'
      ? contractSettlementSealMatchesContract(prepared, initialContract)
      : preparedSealCanCompleteContract(prepared, initialContract);
    if (!compatibleInitial) {
      throw new ContractSettlementSealError('현재 계약값과 서버 정산 기준 봉인값이 일치하지 않습니다. 관리자에게 확인을 요청해 주세요.');
    }
    if (prepared.rentMonth !== rentMonth) {
      throw new ContractSettlementSealError('이미 다른 약정 기간으로 확정된 계약입니다.');
    }

    let agreementConflict = '';
    const agreementWrite = await contractRef.transaction((raw) => {
      // RTDB transaction은 로컬 캐시가 비어 있으면 실제 서버값이 있어도 먼저 null로
      // callback을 부른다. null을 undefined로 abort하면 원격값을 다시 받지 못한다.
      // null 삭제 proposal은 원격값이 있으면 재시도되고, 실제로 없어도 계약을 만들지 않는다.
      if (raw == null) return null;
      let current: EntityRecord;
      try { current = usableGenericContract(raw, contractCode); }
      catch (error) {
        agreementConflict = error instanceof Error ? error.message : '현재 계약 원장을 확인하지 못했습니다.';
        return undefined;
      }
      const compatible = prepared.status === 'sealed'
        ? contractSettlementSealMatchesContract(prepared, current)
        : preparedSealCanCompleteContract(prepared, current);
      if (!matchesCanonicalAgentParty(current, initialAgent)
        || !canCompleteGenericAgreement(input.actor, initialAgent)
        || !hasGenericAgreementPrerequisites(current)
        || !compatible) {
        agreementConflict = '현재 계약값과 서버 정산 기준 봉인값이 일치하지 않습니다. 관리자에게 확인을 요청해 주세요.';
        return undefined;
      }
      return {
        ...current,
        product_type_snapshot: prepared.productType,
        rent_month_snapshot: prepared.rentMonth,
        rent_amount_snapshot: prepared.rentAmount,
        deposit_amount_snapshot: prepared.depositAmount,
        customer_name: customerName,
        customer_phone: customerPhone,
        provider_agreement_done: 'yes',
      };
    }, undefined, false);
    const current = usableGenericContract((await contractRef.get()).val(), contractCode);
    if (!agreementWrite.committed && (!contractSettlementSealMatchesContract(prepared, current) || text(current.provider_agreement_done) !== 'yes')) {
      throw new ContractSettlementSealError(agreementConflict || '약정 완료 처리 중 계약값이 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
    }
    if (!contractSettlementSealMatchesContract(prepared, current) || text(current.provider_agreement_done) !== 'yes') {
      throw new ContractSettlementSealError('계약값과 서버 정산 기준 봉인값이 일치하지 않습니다. 관리자에게 확인을 요청해 주세요.');
    }
    const sealed = await finalizeSettlementSeal(input.db, contractCode, prepared);
    return {
      seal: sealed,
      // fee/payout은 서버 전용 seal에만 둔다. 응답 캐시에도 합성하지 않는다.
      contractPatch: publicSettlementContractPatch(current),
      reused: !agreementWrite.committed || prepared.status === 'sealed',
    };
  };

  if (existingSeal) return completePublicAgreementForSeal(existingSeal);

  const productCode = text(initialContract.product_code);
  if (!productCode) throw new ContractSettlementSealError('계약 차량을 확인하지 못했습니다.');
  const productSnap = await input.db.ref(`v4/products/${productCode}`).get();
  const product = record(productSnap.val()) as EntityRecord;
  if (!Object.keys(product).length || text(product.product_code) !== productCode) {
    throw new ContractSettlementSealError('현재 차량 원장을 확인하지 못했습니다.');
  }
  if (text(product.provider_company_code) !== text(initialContract.provider_company_code)) {
    throw new ContractSettlementSealError('계약 공급사와 차량 공급사가 일치하지 않습니다.');
  }
  const price = priceList(product).find((entry) => entry.m === rentMonth);
  if (!price || !Number.isFinite(price.rent) || price.rent <= 0 || !Number.isFinite(price.deposit) || price.deposit < 0) {
    throw new ContractSettlementSealError('선택한 기간의 차량 가격을 확인하지 못했습니다.');
  }
  const basis = await resolveFreepassSettlementRateBasis({
    db: input.db,
    contract: initialContract as EsignRecord,
    product: product as EsignRecord,
  });
  if (basis.status !== 'sealed' || basis.feeRate == null || basis.payoutRate == null) {
    throw new ContractSettlementSealError('공급사 수수료율 또는 영업 지급율이 확정되지 않아 약정할 수 없습니다. 관리자에게 요율 확인을 요청해 주세요.');
  }
  const now = Date.now();
  const expected = sealRecord({
    contract: initialContract,
    product,
    agent: initialAgent,
    rentMonth,
    rentAmount: price.rent,
    depositAmount: price.deposit,
    productType: basis.productType,
    feeRate: basis.feeRate,
    payoutRate: basis.payoutRate,
    actor: input.actor,
    now,
  });

  let existingConflict = false;
  const sealRef = input.db.ref(`v4/contract_settlement_seals/${contractCode}`);
  const reservation = await sealRef.transaction((raw) => {
    if (raw == null) return expected;
    const current = parseSeal(raw, contractCode);
    if (current && sameCoreSeal(current, expected)) return undefined;
    existingConflict = true;
    return undefined;
  }, undefined, false);
  const prepared = parseSeal(reservation.snapshot.val(), contractCode)
    || await readContractSettlementSeal(input.db, contractCode);
  if (!prepared || existingConflict || !sameCoreSeal(prepared, expected)) {
    throw new ContractSettlementSealError('서버 정산 기준 봉인값이 충돌했습니다. 관리자에게 확인을 요청해 주세요.');
  }
  return completePublicAgreementForSeal(prepared);
}
