import { splitSettlementPrivate } from '../lib/firebase/rtdb-settlements';

const split = splitSettlementPrivate({
  _key: 'ST_C-1', settlement_code: 'ST_C-1', contract_code: 'C-1',
  provider_company_code: 'P-1', agent_code: 'A-1', agent_channel_code: 'CH-1',
  fee_rate: 0.1, fee_amount: 50000, agent_payout: 20000, net_amount: 30000,
});

const cases: [string, boolean][] = [
  ['public에 공급사 수수료 없음', split.publicRecord.fee_amount === undefined && split.publicRecord.fee_rate === undefined],
  ['public에 영업 지급 없음', split.publicRecord.agent_payout === undefined],
  ['public에 관리자 순수익 없음', split.publicRecord.net_amount === undefined],
  ['R1 private 계약코드 포함', split.providerRecord?.contract_code === 'C-1'],
  ['R2 private 계약코드 포함', split.agentRecord?.contract_code === 'C-1'],
  ['관리자 private 계약코드 포함', split.adminRecord?.contract_code === 'C-1'],
  ['R1 귀속 포함', split.providerRecord?.provider_company_code === 'P-1'],
  ['R2 귀속 포함', split.agentRecord?.agent_code === 'A-1'],
];

let passed = 0;
for (const [name, ok] of cases) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (ok) passed++;
}
console.log(`\nsettlement private atomic write: ${passed}/${cases.length} PASS`);
if (passed !== cases.length) process.exit(1);
