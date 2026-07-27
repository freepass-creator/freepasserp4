import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

type Role = 'admin' | 'provider' | 'agent';
type User = { uid: string; role: Role; company?: string; channel?: string };
type Contract = Record<string, unknown> & {
  contract_code: string;
  contract_status: string;
  product_code: string;
  agent_uid: string;
  agent_code: string;
  agent_channel_code: string;
  provider_company_code: string;
};

const agentFields = [
  'agent_delivery_inquiry', 'agent_docs_submitted', 'agent_balance_paid',
  'agent_final_paid', 'provider_agreement_done', 'agent_handover_confirmed',
] as const;
const providerFields = [
  'provider_delivery_response', 'provider_docs_review',
  'provider_balance_confirmed', 'provider_release_completed',
] as const;
const immutable = [
  'contract_code', 'product_code', 'agent_uid', 'agent_code',
  'agent_channel_code', 'provider_company_code', 'rent_month_snapshot',
  'rent_amount_snapshot', 'deposit_amount_snapshot', 'fee_rate_snapshot',
  'payout_rate_snapshot',
] as const;

const same = (a: Contract, b: Contract, fields: readonly string[]) =>
  fields.every((field) => a[field] === b[field]);
const isParticipant = (user: User, next: Contract) =>
  user.role === 'admin'
  || (user.role === 'provider' && !!user.company && next.provider_company_code === user.company)
  || (user.role !== 'provider' && (
    next.agent_uid === user.uid || (!!user.channel && next.agent_channel_code === user.channel)
  ));
const complete = (c: Contract) =>
  c.agent_delivery_inquiry === 'yes'
  && (c.provider_delivery_response === '출고 가능' || c.provider_delivery_response === '출고 협의')
  && c.agent_docs_submitted === 'yes'
  && c.provider_docs_review === '승인'
  && c.agent_balance_paid === 'yes'
  && c.agent_final_paid === 'yes'
  && c.provider_balance_confirmed === 'yes'
  && c.provider_agreement_done === 'yes'
  && c.provider_agreement_sent === 'yes'
  && c.agent_handover_confirmed === 'yes'
  && c.provider_release_completed === 'yes';
const validStatus = (c: Contract) =>
  c.contract_status === '계약요청'
  || c.contract_status === '계약취소'
  || (c.contract_status === '계약완료' && complete(c));
const canWrite = (user: User, next: Contract, previous?: Contract) => {
  if (!isParticipant(user, next) || !validStatus(next)) return false;
  if (!previous) return next.contract_status === '계약요청';
  if (!same(next, previous, immutable)) return false;
  if (user.role === 'provider' && !same(next, previous, agentFields)) return false;
  if (user.role !== 'provider' && user.role !== 'admin') {
    if (!same(next, previous, providerFields)) return false;
    if (
      next.provider_agreement_sent !== previous.provider_agreement_sent
      && next.sign_status !== '서명완료'
    ) return false;
  }
  return true;
};

let passed = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected, name);
  passed += 1;
};

const agent: User = { uid: 'agent-1', role: 'agent', channel: 'A-100' };
const provider: User = { uid: 'provider-1', role: 'provider', company: 'P-100' };
const admin: User = { uid: 'admin-1', role: 'admin' };
const base: Contract = {
  contract_code: 'TMP-1', contract_status: '계약요청', product_code: 'VEH-1',
  agent_uid: 'agent-1', agent_code: 'AG-1', agent_channel_code: 'A-100',
  provider_company_code: 'P-100', rent_month_snapshot: 36,
  rent_amount_snapshot: 500000, deposit_amount_snapshot: 0,
  fee_rate_snapshot: 0.1, payout_rate_snapshot: 0.04,
};

check('agent can create own requested contract', canWrite(agent, base), true);
check('provider can create own-company requested contract', canWrite(provider, base), true);
check('unrelated agent cannot create contract', canWrite({ ...agent, uid: 'agent-2', channel: 'A-200' }, base), false);
check('agent can update agent step', canWrite(agent, { ...base, agent_docs_submitted: 'yes' }, base), true);
check('provider cannot update agent step', canWrite(provider, { ...base, agent_docs_submitted: 'yes' }, base), false);
check('provider can update provider step', canWrite(provider, { ...base, provider_docs_review: '승인' }, base), true);
check('agent cannot update provider step', canWrite(agent, { ...base, provider_docs_review: '승인' }, base), false);
check('agent can confirm agreement after signed review', canWrite(agent, { ...base, sign_status: '서명완료', provider_agreement_sent: 'yes' }, { ...base, sign_status: '서명완료' }), true);
check('agent cannot confirm agreement before signed review', canWrite(agent, { ...base, provider_agreement_sent: 'yes' }, base), false);
check('participant cannot transfer ownership', canWrite(agent, { ...base, agent_uid: 'agent-2' }, base), false);
check('participant cannot alter fee snapshot', canWrite(provider, { ...base, fee_rate_snapshot: 0.5 }, base), false);
check('incomplete contract cannot become complete', canWrite(admin, { ...base, contract_status: '계약완료' }, base), false);
const done: Contract = {
  ...base, agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능',
  agent_docs_submitted: 'yes', provider_docs_review: '승인',
  agent_balance_paid: 'yes', agent_final_paid: 'yes', provider_balance_confirmed: 'yes',
  provider_agreement_done: 'yes', provider_agreement_sent: 'yes',
  agent_handover_confirmed: 'yes', provider_release_completed: 'yes',
  contract_status: '계약완료',
};
check('fully checked contract can become complete', canWrite(admin, done, { ...done, contract_status: '계약요청' }), true);
check('unknown contract status is denied', canWrite(admin, { ...base, contract_status: '임의완료' }, base), false);
check('admin can correct either role step', canWrite(admin, { ...base, provider_docs_review: '승인', agent_docs_submitted: 'yes' }, base), true);

const rules = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'database.rules.json'), 'utf8')).rules;
const v4 = rules.v4.contracts;
check('contract collection has no broad write', v4['.write'], undefined);
check('contract writes are record-scoped', typeof v4.$contract_id['.write'], 'string');
check('contract deletion is denied', v4.$contract_id['.write'].includes('newData.exists()'), true);
check('contract ownership is required', v4.$contract_id['.write'].includes("newData.child('provider_company_code')"), true);
check('contract identity snapshots are immutable', v4.$contract_id.fee_rate_snapshot['.validate'].includes("newData.val() === data.val()"), true);
check('contract identity fields are immutable', v4.$contract_id.agent_uid['.validate'].includes("newData.val() === data.val()"), true);
check('cross-role agent step is guarded at child', v4.$contract_id.agent_docs_submitted['.validate'].includes("role').val() === 'agent'"), true);
check('cross-role provider step is guarded at child', v4.$contract_id.provider_docs_review['.validate'].includes("role').val() === 'provider'"), true);
check('completion requires final provider step', v4.$contract_id.contract_status['.validate'].includes("provider_release_completed"), true);
check('agreement exception requires signed state', v4.$contract_id.provider_agreement_sent['.validate'].includes("sign_status").valueOf(), true);

console.log(`contract rules simulation: ${passed}/${passed} PASS`);
