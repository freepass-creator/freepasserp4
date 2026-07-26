import { buildSettlementPrivateMigrationPlan } from '../lib/firebase/migrate-settlements-private';

const plan = buildSettlementPrivateMigrationPlan(
  {
    legacy: {
      settlement_code: 'ST-1', provider_company_code: 'P-1', agent_code: 'A-1', agent_channel_code: 'CH-1',
      fee_rate: 0.1, fee_amount: 100000, agent_payout: 40000, net_amount: 60000,
    },
  },
  { 'ST-1': { settlement_code: 'ST-1', fee_amount: 110000, net_amount: 70000 } },
  { 'ST-1': { fee_amount: 120000 } },
  {},
  {},
);
const provider = plan.updates['v4/settlements_provider_private/ST-1'] as Record<string, unknown>;
const agent = plan.updates['v4/settlements_agent_private/ST-1'] as Record<string, unknown>;
const admin = plan.updates['v4/settlements_admin_private/ST-1'] as Record<string, unknown>;
const checks: [string, boolean][] = [
  ['정산 1건 검사', plan.scanned === 1],
  ['민감 정산 1건', plan.withFinance === 1],
  ['기존 provider private 우선', provider.fee_amount === 120000],
  ['v3 영업 지급 보존', agent.agent_payout === 40000],
  ['v4 관리자 순수익 우선', admin.net_amount === 70000],
  ['v3 공급사 금액 삭제 계획', plan.updates['settlements/legacy/fee_amount'] === null],
  ['v3 영업 금액 삭제 계획', plan.updates['settlements/legacy/agent_payout'] === null],
  ['v4 공급사 금액 삭제 계획', plan.updates['v4/settlements/ST-1/fee_amount'] === null],
  ['v4 순수익 삭제 계획', plan.updates['v4/settlements/ST-1/net_amount'] === null],
  ['dry plan에 private 3종 쓰기', plan.providerWrites === 1 && plan.agentWrites === 1 && plan.adminWrites === 1],
];
let passed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? '✓' : '✗'} ${name}`); if (ok) passed++; }
console.log(`\n━━ 결과: ${passed}/${checks.length} ${passed === checks.length ? 'PASS' : 'FAIL'}`);
if (passed !== checks.length) process.exit(1);
