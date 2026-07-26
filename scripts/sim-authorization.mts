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
import { mapRole, type Session } from '../lib/auth-session';

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

console.log(`authorization simulation: ${passed}/${passed} PASS`);
