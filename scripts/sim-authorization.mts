import assert from 'node:assert/strict';
import {
  accessScope,
  canAccessOwnedRecord,
  canFinalizeSettlement,
  canManageOrganization,
  isAgentOrgAdmin,
  isProviderMember,
  isProviderOrgAdmin,
  organizationRole,
} from '../lib/domain/authorization';
import { mapRole, setSession, type Session } from '../lib/auth-session';
import { mergeSettlementPrivate, splitSettlementPrivate } from '../lib/firebase/rtdb-settlements';
import fs from 'node:fs';
import path from 'node:path';

const session = (rawRole: string, extra: Partial<Session> = {}): Session => ({
  uid: 'user-1',
  email: 'user@example.com',
  role: mapRole(rawRole),
  rawRole,
  name: '사용자',
  code: rawRole.startsWith('provider') ? 'P-100' : 'AG-1',
  company_code: rawRole.startsWith('provider') ? 'P-100' : '',
  agent_channel_code: rawRole.startsWith('agent') ? 'CH-100' : '',
  user_code: 'AG-1',
  ...extra,
});

let passed = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected, name);
  passed += 1;
};

const admin = session('admin');
const agentAdmin = session('agent_admin');
const legacyManager = session('agent_manager');
const agent = session('agent');
const providerAdmin = session('provider_admin');
const provider = session('provider');

check('platform admin role', organizationRole(admin), 'admin');
check('agent admin role', organizationRole(agentAdmin), 'agent_admin');
check('legacy agent manager maps to channel admin', organizationRole(legacyManager), 'agent_admin');
check('provider admin keeps provider UI role', providerAdmin.role, 'provider');
check('provider admin detail role', organizationRole(providerAdmin), 'provider_admin');
check('agent admin recognized', isAgentOrgAdmin(agentAdmin), true);
check('ordinary agent is not org admin', isAgentOrgAdmin(agent), false);
check('provider admin recognized', isProviderOrgAdmin(providerAdmin), true);
check('provider staff is provider member', isProviderMember(provider), true);
check('provider admin is provider member', isProviderMember(providerAdmin), true);
check('agent scope is self', accessScope(agent).kind, 'agent_self');
check('agent admin scope is channel', accessScope(agentAdmin).kind, 'agent_channel');
check('provider scope is company', accessScope(provider).kind, 'provider_company');
check('admin scope is platform', accessScope(admin).kind, 'platform');

const own = { agent_uid: 'user-1', agent_code: 'AG-1', agent_channel_code: 'CH-100', provider_company_code: 'P-100' };
const teammate = { agent_uid: 'user-2', agent_code: 'AG-2', agent_channel_code: 'CH-100', provider_company_code: 'P-100' };
const other = { agent_uid: 'user-3', agent_code: 'AG-3', agent_channel_code: 'CH-200', provider_company_code: 'P-200' };
check('agent sees own record', canAccessOwnedRecord(agent, own), true);
check('agent cannot see teammate record', canAccessOwnedRecord(agent, teammate), false);
check('channel admin sees teammate record', canAccessOwnedRecord(agentAdmin, teammate), true);
check('channel admin cannot see other channel', canAccessOwnedRecord(agentAdmin, other), false);
check('provider staff sees company-wide record', canAccessOwnedRecord(provider, teammate), true);
check('provider staff cannot see other company', canAccessOwnedRecord(provider, other), false);
check('provider admin sees company-wide record', canAccessOwnedRecord(providerAdmin, teammate), true);
check('platform admin sees all records', canAccessOwnedRecord(admin, other), true);
check('legacy settlement without uid uses agent code', canAccessOwnedRecord(agent, { agent_code: 'AG-1' }), true);
check('organization admins manage organization', [admin, agentAdmin, providerAdmin].every(canManageOrganization), true);
check('ordinary staff cannot manage organization', [agent, provider].every((s) => !canManageOrganization(s)), true);
check('only platform admin finalizes settlement', [canFinalizeSettlement(admin), canFinalizeSettlement(agentAdmin), canFinalizeSettlement(providerAdmin)], [true, false, false]);

const rules = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'database.rules.json'), 'utf8')).rules;
const v3RoomsRead = String(rules.rooms['.read']);
const v4RoomsRead = String(rules.v4.rooms['.read']);
const v4ContractsRead = String(rules.v4.contracts['.read']);
const v4ContractsWrite = String(rules.v4.contracts.$contract_id['.write']);
const v4SettlementsRead = String(rules.v4.settlements['.read']);
const v4SettlementStatus = String(rules.v4.settlements.$sid.settlement_status['.validate']);
check('v3 rooms recognize provider admin', v3RoomsRead.includes("role').val() === 'provider_admin'"), true);
check('v4 rooms recognize provider admin', v4RoomsRead.includes("role').val() === 'provider_admin'"), true);
check('room channel query names agent admin', v4RoomsRead.includes("role').val() === 'agent_admin'"), true);
check('room channel query names legacy manager', v4RoomsRead.includes("role').val() === 'agent_manager'"), true);
check('ordinary agent branch is uid-scoped', v4RoomsRead.includes("role').val() === 'agent'") && v4RoomsRead.includes("query.orderByChild === 'agent_uid'"), true);
check('contract reads recognize five-role organization scopes', v4ContractsRead.includes("'provider_admin'") && v4ContractsRead.includes("'agent_admin'"), true);
check('contract writes recognize provider admin', v4ContractsWrite.includes("'provider_admin'"), true);
check('settlement reads distinguish channel and company', v4SettlementsRead.includes("'agent_admin'") && v4SettlementsRead.includes("'provider_admin'"), true);
check('only platform admin changes settlement status', v4SettlementStatus.includes("role').val() === 'admin'"), true);

const finance = {
  _key: 'ST-1', settlement_code: 'ST-1', provider_company_code: 'P-100',
  agent_code: 'AG-1', agent_channel_code: 'CH-100',
  fee_rate: 0.1, fee_amount: 100000, agent_payout: 40000, net_amount: 60000,
};
const split = splitSettlementPrivate(finance);
check('public settlement excludes provider finance', split.publicRecord.fee_amount, undefined);
check('public settlement excludes agent finance', split.publicRecord.agent_payout, undefined);
check('provider private keeps company ownership', split.providerRecord?.provider_company_code, 'P-100');
check('agent private keeps channel ownership', split.agentRecord?.agent_channel_code, 'CH-100');
setSession(provider);
const providerView = mergeSettlementPrivate(split.publicRecord, split.providerRecord, split.agentRecord, split.adminRecord);
check('provider view has R1', providerView.fee_amount, 100000);
check('provider view hides R2', providerView.agent_payout, undefined);
setSession(agent);
const agentView = mergeSettlementPrivate(split.publicRecord, split.providerRecord, split.agentRecord, split.adminRecord);
check('agent view has R2', agentView.agent_payout, 40000);
check('agent view hides R1', agentView.fee_amount, undefined);
setSession(admin);
const adminView = mergeSettlementPrivate(split.publicRecord, split.providerRecord, split.agentRecord, split.adminRecord);
check('admin view has derived net', adminView.net_amount, 60000);
setSession(null);

const authSrc = fs.readFileSync(path.join(process.cwd(), 'lib/firebase/auth.ts'), 'utf8');
check('unregistered bizNo is not blocked', authSrc.includes('미등록 사업자번호입니다'), false);
check('unmatched identity defaults to personal agent', authSrc.includes("company_code = 'SP999'"), true);
check('default approve assigns personal agent', authSrc.includes('바로 승인 = 개인영업자'), true);
check('approve writes members overlay', authSrc.includes('v4/users/${uid}'), true);
check('partner match reads v4 overlay', authSrc.includes("get(ref(db, 'v4/partners'))"), true);

console.log(`authorization simulation: ${passed}/${passed} PASS`);
