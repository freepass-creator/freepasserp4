import assert from 'node:assert/strict';
import {
  buildSettlementIssueRecords,
  canIssueSettlement,
  canIssueSettlementForContract,
} from '../lib/domain/settlement-issuance';

let passed = 0;
function check(name: string, condition: boolean) {
  assert.equal(condition, true, name);
  passed += 1;
}

const completed = {
  contract_code: 'C-SETTLEMENT', contract_status: '계약요청', product_code: 'VEH-1',
  agent_uid: 'agent-uid', agent_code: 'AG-1', agent_channel_code: 'CH-1', provider_company_code: 'SUP-1',
  rent_amount_snapshot: 443_000, rent_month_snapshot: 36, contract_date: '2026-08-21',
  product_type_snapshot: '중고 렌트',
  fee_rate_snapshot: 0.1, payout_rate_snapshot: 0.037,
  agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능',
  agent_docs_submitted: 'yes', provider_docs_review: '승인',
  provider_agreement_done: 'yes', provider_agreement_sent: 'yes',
  agent_balance_paid: 'yes', agent_final_paid: 'yes', provider_balance_confirmed: 'yes',
  agent_handover_confirmed: 'yes', provider_release_completed: 'yes',
};

const frozen = buildSettlementIssueRecords({
  contract: completed,
  productType: completed.product_type_snapshot,
  partner: { fee_rate: 0.2 }, partnerPrivate: { fee_rate: 0.3 },
  agentUser: { agent_payout_rate: 0.08 }, agentUserPrivate: { agent_payout_rate: 0.09 },
  issuedAt: new Date('2026-08-21T00:00:00.000Z'),
});
check('동결 공급사율 우선', frozen.providerPrivate.fee_rate === 0.1 && frozen.providerPrivate.fee_amount === 44_300);
check('동결 영업지급율 우선·반올림', frozen.agentPrivate.payout_rate === 0.037 && frozen.agentPrivate.agent_payout === 16_391);
check('관리자 순수익은 서버 조립값', frozen.adminPrivate.net_amount === 27_909);
check('민감 금액은 public record에 없음', !Object.hasOwn(frozen.publicRecord, 'fee_amount') && !Object.hasOwn(frozen.publicRecord, 'agent_payout'));

assert.throws(
  () => buildSettlementIssueRecords({
    contract: { ...completed, contract_code: 'C-LIVE', fee_rate_snapshot: '', payout_rate_snapshot: '' },
    productType: completed.product_type_snapshot, partnerPrivate: { fee_rate: 0.12 }, agentUserPrivate: { agent_payout_rate: 0.05 },
  }),
  /서버 확정 수수료율·영업지급율/,
);
check('미동결 계약은 live private rate로 정산하지 않고 차단', true);
assert.throws(
  () => buildSettlementIssueRecords({
    contract: { ...completed, contract_code: 'C-NEW', product_type_snapshot: '신차렌트', fee_rate_snapshot: '', payout_rate_snapshot: '' },
    productType: '신차렌트', partnerPrivate: { fee_rate: 0.12 }, agentUserPrivate: { agent_payout_rate: 0.05 },
  }),
  /서버 확정 수수료율·영업지급율/,
);
check('신차도 서버가 0% 요율을 동결하기 전에는 정산 차단', true);
assert.throws(
  () => buildSettlementIssueRecords({ contract: { ...completed, contract_code: 'C-NO-TYPE', product_type_snapshot: '' }, productType: '' }),
  /상품구분 동결값/,
);
check('상품구분 동결값 없으면 정산 조립 차단', true);

check('5단계 완료 전 정산 차단', !canIssueSettlementForContract({ ...completed, agent_handover_confirmed: '' }));
check('취소 계약 정산 차단', !canIssueSettlementForContract({ ...completed, contract_status: '계약취소' }));
check('5단계 완료 계약은 상태 전 전에도 정산 허용', canIssueSettlementForContract(completed));
check('본인 agent 허용', canIssueSettlement({ uid: 'agent-uid', role: 'agent', rawRole: 'agent', companyCode: '', agentChannelCode: 'CH-1' }, completed));
check('동일 채널 manager 허용', canIssueSettlement({ uid: 'manager', role: 'agent', rawRole: 'agent_manager', companyCode: '', agentChannelCode: 'CH-1' }, completed));
check('타 채널 agent 차단', !canIssueSettlement({ uid: 'other', role: 'agent', rawRole: 'agent', companyCode: '', agentChannelCode: 'CH-2' }, completed));
check('동일 공급사 허용', canIssueSettlement({ uid: 'provider', role: 'provider', rawRole: 'provider', companyCode: 'SUP-1', agentChannelCode: '' }, completed));
check('타 공급사 차단', !canIssueSettlement({ uid: 'provider', role: 'provider', rawRole: 'provider', companyCode: 'SUP-2', agentChannelCode: '' }, completed));

console.log(`settlement issuance: ${passed}/15 PASS`);
