import 'server-only';

import type { Database } from 'firebase-admin/database';
import type { EntityRecord } from '@/lib/intake/entities';
import type { ActiveBearer } from '@/lib/server/firebase-admin';
import {
  isFreepassDirectContract,
  verifyFreepassDirectContractCompletion,
  type FreepassDirectContractSeal,
} from '@/lib/server/freepass-esign';
import {
  contractSettlementSealMatchesContract,
  contractWithSettlementSeal,
  readContractSettlementSeal,
  type ContractSettlementSeal,
} from '@/lib/server/contract-settlement-seal';
import { isContractCancelled, isContractCompleted } from '@/lib/domain/contract';
import {
  SettlementIssuanceError,
  buildSettlementIssueRecords,
  canIssueSettlement,
  canIssueSettlementForContract,
  isSettlementContractDeleted,
} from '@/lib/domain/settlement-issuance';

type Rec = Record<string, unknown>;
const text = (value: unknown) => String(value ?? '').trim();
const asRecord = (value: unknown): Rec => value && typeof value === 'object' ? value as Rec : {};
const withoutUndefined = (record: EntityRecord): EntityRecord => Object.fromEntries(
  Object.entries(record).filter(([, value]) => value !== undefined),
) as EntityRecord;

const LEGACY_SETTLEMENT_SOURCE_FIELDS = [
  'contract_code',
  'product_code',
  'agent_uid',
  'agent_code',
  'agent_channel_code',
  'provider_company_code',
  'rent_month_snapshot',
  'rent_amount_snapshot',
  'fee_rate_snapshot',
  'payout_rate_snapshot',
] as const;

const SETTLEMENT_OPERATIONAL_OVERLAY_FIELDS = [
  '_deleted',
  'deletedAt',
  'contract_status',
  'agent_delivery_inquiry',
  'provider_delivery_response',
  'agent_docs_submitted',
  'provider_docs_review',
  'provider_agreement_done',
  'provider_agreement_sent',
  'agent_balance_paid',
  'agent_final_paid',
  'provider_balance_confirmed',
  'agent_handover_confirmed',
  'provider_release_completed',
] as const;

/**
 * 기존 v3 계약에 붙은 v4는 진행 UI용 overlay일 뿐, 정산 금액·귀속의 원장이 아니다.
 * 따라서 v3가 있으면 그 원장을 사용하고, overlay가 원장 필드를 다르게 들고 있으면
 * 조용히 병합하지 않고 발행을 중단한다. 새 v4-only 계약은 key와 contract_code가 일치해야 한다.
 */
function settlementSourceContract(legacyRaw: unknown, overlayRaw: unknown, key: string): {
  contract: EntityRecord | null;
  legacyBacked: boolean;
  legacyCompleted: boolean;
} {
  const legacy = asRecord(legacyRaw);
  const overlay = asRecord(overlayRaw);
  if (Object.keys(legacy).length) {
    const legacyCode = text(legacy.contract_code || key);
    if (legacyCode !== key) throw new SettlementIssuanceError('기존 계약 원장 키가 일치하지 않습니다. 관리자에게 확인을 요청해 주세요.');
    for (const field of LEGACY_SETTLEMENT_SOURCE_FIELDS) {
      const expected = text(legacy[field]);
      const actual = text(overlay[field]);
      if (actual && expected && actual !== expected) {
        throw new SettlementIssuanceError('계약 원장과 수정본의 정산 기준이 다릅니다. 관리자에게 확인을 요청해 주세요.');
      }
    }
    // v4에는 v3 원장에 없는 진행 단계가 기록될 수 있다. 금전·당사자 기준은 legacy로
    // 다시 고정하고, 역할별 rules로 통제되는 운영 단계만 overlay에서 합친다.
    const operational = { ...legacy };
    for (const field of SETTLEMENT_OPERATIONAL_OVERLAY_FIELDS) {
      if (Object.hasOwn(overlay, field)) operational[field] = overlay[field];
    }
    // 취소는 되돌릴 수 없는 fail-closed 상태다. v3 원장 또는 v4 overlay 어느 한쪽이라도
    // 취소이면, 다른 쪽의 "계약요청" 값으로 덮어 정산을 재개할 수 없다.
    if (isContractCancelled(legacy) || isContractCancelled(overlay)) {
      operational.contract_status = '계약취소';
    }
    return {
      contract: { ...operational, _key: key, contract_code: key } as EntityRecord,
      legacyBacked: true,
      legacyCompleted: isContractCompleted(legacy),
    };
  }
  if (!Object.keys(overlay).length) return { contract: null, legacyBacked: false, legacyCompleted: false };
  if (text(overlay.contract_code) !== key) {
    throw new SettlementIssuanceError('계약 경로와 계약번호가 일치하지 않습니다. 관리자에게 확인을 요청해 주세요.');
  }
  return { contract: { ...overlay, _key: key, contract_code: key } as EntityRecord, legacyBacked: false, legacyCompleted: false };
}

function merged(legacy: unknown, overlay: unknown, key: string): EntityRecord | null {
  const result = { ...asRecord(legacy), ...asRecord(overlay) };
  return Object.keys(result).length ? { ...result, _key: key } as EntityRecord : null;
}

/**
 * 직접 전자계약의 돈·상품구분·당사자는 공개 v4 projection이 아니라 발행 때 만든
 * private seal을 기준으로 다시 조립한다. 진행 단계·취소·폐기만 현재 overlay 값으로
 * 가져오므로, 담당자가 공개 계약의 금액/요율을 바꿔 정산에 반영시키지 못한다.
 */
async function settlementContractForIssue(
  db: Database,
  sourceContract: EntityRecord | null,
  contractCode: string,
): Promise<{ contract: EntityRecord | null; directSeal: FreepassDirectContractSeal | null; genericSeal: ContractSettlementSeal | null }> {
  if (!sourceContract) return { contract: null, directSeal: null, genericSeal: null };
  if (!isFreepassDirectContract(sourceContract)) {
    const genericSeal = await readContractSettlementSeal(db, contractCode);
    if (!genericSeal) return { contract: sourceContract, directSeal: null, genericSeal: null };
    if (genericSeal.status !== 'sealed') {
      throw new SettlementIssuanceError('약정 기준을 서버에서 마무리하는 중입니다. 같은 약정 완료를 다시 시도하거나 관리자에게 확인을 요청해 주세요.');
    }
    if (!contractSettlementSealMatchesContract(genericSeal, sourceContract)) {
      throw new SettlementIssuanceError('현재 계약값과 서버 정산 기준 봉인값이 일치하지 않습니다. 관리자에게 확인을 요청해 주세요.');
    }
    return { contract: contractWithSettlementSeal(sourceContract, genericSeal), directSeal: null, genericSeal };
  }
  const completion = await verifyFreepassDirectContractCompletion({
    db,
    contract: sourceContract,
    contractCode,
    requireHandover: true,
  });
  if (!completion.ok || !completion.seal) {
    throw new SettlementIssuanceError(completion.reason || '직접 전자계약의 완료 증빙을 확인하지 못했습니다.');
  }
  const rate = completion.seal.settlementRateBasis;
  if (rate.status !== 'sealed' || rate.feeRate == null || rate.payoutRate == null) {
    throw new SettlementIssuanceError('서버 확정 수수료율·영업지급율이 없는 직접 전자계약은 정산을 생성할 수 없습니다. 관리자에게 요율 검토를 요청해 주세요.');
  }
  const contract: EntityRecord = {
    ...completion.seal.contract,
    _key: contractCode,
    // 공개 projection의 고객명은 영업자가 바꿀 수 있으므로 쓰지 않는다. 고객이
    // 서명 때 private submission에 제출하고 관리자가 승인한 이름만 정산에 옮긴다.
    customer_name: completion.customerName,
    fee_rate_snapshot: rate.feeRate,
    payout_rate_snapshot: rate.payoutRate,
    product_type_snapshot: rate.productType,
    settlement_rate_status: 'sealed',
  } as EntityRecord;
  for (const field of SETTLEMENT_OPERATIONAL_OVERLAY_FIELDS) {
    if (Object.hasOwn(sourceContract, field)) contract[field] = sourceContract[field];
  }
  return { contract, directSeal: completion.seal, genericSeal: null };
}

function userForContract(users: Rec, overlayUsers: Rec, agentUid: string, agentCode: string): { key: string; row: EntityRecord | null } {
  const direct = merged(users[agentUid], overlayUsers[agentUid], agentUid);
  if (direct) return { key: agentUid, row: direct };
  const key = [...new Set([...Object.keys(users), ...Object.keys(overlayUsers)])].find((candidate) => {
    const row = merged(users[candidate], overlayUsers[candidate], candidate);
    return text(row?.uid) === agentUid || text(row?.user_code) === agentCode;
  }) || '';
  return { key, row: key ? merged(users[key], overlayUsers[key], key) : null };
}

export type SettlementIssueResult = { code: string; reused: boolean };

/**
 * 정산 금액의 유일한 운영 writer. 브라우저는 계약코드만 보내고, 동결 계약·기준정보는
 * Admin SDK가 다시 읽어 계산한다. 같은 계약의 동시 요청은 server-only claim으로 직렬화한다.
 * 금융 write는 lease를 자동 탈취하지 않는다. 처리 중 서버가 죽어도 사람이 확인할 때까지
 * fail-closed 하는 편이, 두 요청이 서로 다른 기준으로 같은 정산을 쓰는 것보다 안전하다.
 */
export async function issueSettlementFromServer(
  db: Database,
  actor: ActiveBearer,
  contractCode: string,
): Promise<SettlementIssueResult> {
  const code = `ST_${contractCode}`;
  // Idempotent replies are still contract-scoped: do not let an unrelated actor
  // discover or reuse a settlement merely because it already exists.
  const [initialLegacyContract, initialOverlayContract] = await Promise.all([
    db.ref(`contracts/${contractCode}`).get(),
    db.ref(`v4/contracts/${contractCode}`).get(),
  ]);
  const initialSource = settlementSourceContract(initialLegacyContract.val(), initialOverlayContract.val(), contractCode);
  const initialResolved = await settlementContractForIssue(db, initialSource.contract, contractCode);
  const initialContract = initialResolved.contract;
  if (!initialContract) throw new SettlementIssuanceError('계약을 찾을 수 없습니다.');
  if (!text(initialContract.agent_uid) && actor.role !== 'admin') {
    throw new SettlementIssuanceError('담당 영업자 UID가 동결되지 않은 기존 계약은 관리자 검토 후에만 정산할 수 있습니다.');
  }
  if (!canIssueSettlement(actor, initialContract)) {
    throw new SettlementIssuanceError('이 계약의 정산을 생성할 권한이 없습니다.');
  }
  const existing = await db.ref(`v4/settlements/${code}`).get();
  if (existing.exists()) return { code, reused: true };

  const now = Date.now();
  const claimRef = db.ref(`v4/settlement_issuance/${code}`);
  let heldBy = '';
  const claim = await claimRef.transaction((raw) => {
    const current = asRecord(raw);
    heldBy = text(current.actor_uid);
    const currentAt = Number(current.updated_at || 0);
    if (current.status === 'issuing') return undefined;
    if (current.status === 'issued') return undefined;
    return { status: 'issuing', actor_uid: actor.uid, updated_at: now };
  }, undefined, false);
  if (!claim.committed) {
    const settled = await db.ref(`v4/settlements/${code}`).get();
    if (settled.exists()) return { code, reused: true };
    throw new SettlementIssuanceError(heldBy
      ? '다른 요청이 이 계약의 정산을 생성하고 있습니다. 잠시 뒤 다시 확인해 주세요.'
      : '정산 생성 상태를 확인할 수 없습니다. 다시 시도해 주세요.');
  }

  try {
    const [legacyContractSnap, overlayContractSnap] = await Promise.all([
      db.ref(`contracts/${contractCode}`).get(),
      db.ref(`v4/contracts/${contractCode}`).get(),
    ]);
    const source = settlementSourceContract(legacyContractSnap.val(), overlayContractSnap.val(), contractCode);
    const resolved = await settlementContractForIssue(db, source.contract, contractCode);
    const contract = resolved.contract;
    if (!contract) throw new SettlementIssuanceError('계약을 찾을 수 없습니다.');
    if (!text(contract.agent_uid) && actor.role !== 'admin') {
      throw new SettlementIssuanceError('담당 영업자 UID가 동결되지 않은 기존 계약은 관리자 검토 후에만 정산할 수 있습니다.');
    }
    if (!canIssueSettlement(actor, contract)) throw new SettlementIssuanceError('이 계약의 정산을 생성할 권한이 없습니다.');
    const normalReady = canIssueSettlementForContract(contract);
    const legacyRecovery = !normalReady && actor.role === 'admin'
      && !isSettlementContractDeleted(contract)
      && !isContractCancelled(contract)
      && (source.legacyCompleted || isContractCompleted(contract));
    if (!normalReady && !legacyRecovery) throw new SettlementIssuanceError('완료 처리 전 계약은 정산을 생성할 수 없습니다.');
    if (!resolved.directSeal && !resolved.genericSeal && actor.role !== 'admin') {
      throw new SettlementIssuanceError('서버 정산 기준이 동결되지 않은 계약은 정산을 생성할 수 없습니다. 관리자에게 약정 기준 확인을 요청해 주세요.');
    }

    const productCode = text(contract.product_code);
    const providerCode = text(contract.provider_company_code);
    const agentUid = text(contract.agent_uid);
    const agentCode = text(contract.agent_code);
    const [legacyProductSnap, overlayProductSnap, legacyPartnerSnap, overlayPartnerSnap, privatePartnerSnap, usersSnap, overlayUsersSnap] = await Promise.all([
      productCode ? db.ref(`products/${productCode}`).get() : Promise.resolve(null),
      productCode ? db.ref(`v4/products/${productCode}`).get() : Promise.resolve(null),
      providerCode ? db.ref(`partners/${providerCode}`).get() : Promise.resolve(null),
      providerCode ? db.ref(`v4/partners/${providerCode}`).get() : Promise.resolve(null),
      providerCode ? db.ref(`v4/partners_private/${providerCode}`).get() : Promise.resolve(null),
      db.ref('users').get(),
      db.ref('v4/users').get(),
    ]);
    const product = merged(legacyProductSnap?.val(), overlayProductSnap?.val(), productCode);
    const frozenProductType = text(contract.product_type_snapshot);
    // 신규 계약은 상품구분을 계약에 고정한다. 과거 계약에 이 값이 없으면 현재
    // 매물값으로 정산 수수료를 바꿀 수 있으므로 일반 사용자 요청은 fail-closed 한다.
    if (!frozenProductType && actor.role !== 'admin') {
      throw new SettlementIssuanceError('계약 당시 상품구분 동결값이 없어 정산을 생성할 수 없습니다. 관리자에게 확인을 요청해 주세요.');
    }
    const productType = resolved.directSeal?.settlementRateBasis.productType || frozenProductType || text(product?.product_type);
    const partner = merged(legacyPartnerSnap?.val(), overlayPartnerSnap?.val(), providerCode);
    const users = asRecord(usersSnap.val());
    const overlayUsers = asRecord(overlayUsersSnap.val());
    const agent = userForContract(users, overlayUsers, agentUid, agentCode);
    const privateAgentSnap = agent.key ? await db.ref(`v4/users_private/${agent.key}`).get() : null;
    const records = buildSettlementIssueRecords({
      contract,
      productType,
      partner,
      partnerPrivate: asRecord(privatePartnerSnap?.val()),
      agentUser: agent.row,
      agentUserPrivate: asRecord(privateAgentSnap?.val()),
      issuedAt: new Date(now),
      legacyRecovery,
      issuedByUid: actor.uid,
    });

    const current = await db.ref(`v4/settlements/${records.code}`).get();
    if (current.exists()) {
      await claimRef.set({ status: 'issued', actor_uid: actor.uid, updated_at: now });
      return { code: records.code, reused: true };
    }
    await db.ref('v4').update({
      [`settlements/${records.code}`]: withoutUndefined(records.publicRecord),
      [`settlements_provider_private/${records.code}`]: withoutUndefined(records.providerPrivate),
      [`settlements_agent_private/${records.code}`]: withoutUndefined(records.agentPrivate),
      [`settlements_admin_private/${records.code}`]: withoutUndefined(records.adminPrivate),
      [`settlement_issuance/${records.code}`]: { status: 'issued', actor_uid: actor.uid, updated_at: now },
    });
    return { code: records.code, reused: false };
  } catch (error) {
    await claimRef.set({ status: 'failed', actor_uid: actor.uid, updated_at: Date.now() }).catch(() => undefined);
    throw error;
  }
}
