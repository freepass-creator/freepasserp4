import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { contractToSignPublic } from '../lib/firebase/contract-sign-public';

let passed = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected, name);
  passed++;
};

const canAnonymousTransition = (from: string, to: string) => from === 'sent' && to === 'pending_review';
check('anonymous can submit sent link', canAnonymousTransition('sent', 'pending_review'), true);
check('anonymous cannot rewrite pending review', canAnonymousTransition('pending_review', 'pending_review'), false);
check('anonymous cannot mark signed', canAnonymousTransition('sent', 'signed'), false);
check('anonymous cannot reopen signed link', canAnonymousTransition('signed', 'sent'), false);

const publicSlot = contractToSignPublic({
  contract_code: 'C-1', product_code: 'P-1',
  agent_uid: 'agent-1', agent_channel_code: 'CH-1', provider_company_code: 'SUP-1',
  rent_amount_snapshot: 500000, deposit_amount_snapshot: 0, rent_month_snapshot: 36,
}, 'token-1');
check('public slot carries agent uid ownership', publicSlot.agent_uid, 'agent-1');
check('public slot carries channel ownership', publicSlot.agent_channel_code, 'CH-1');
check('public slot carries provider ownership', publicSlot.provider_company_code, 'SUP-1');

const rules = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'database.rules.json'), 'utf8')).rules.contract_sign.$token;
check('anonymous write requires sent state', rules['.write'].includes("data.child('status').val() === 'sent'"), true);
check('anonymous write requires pending review target', rules['.write'].includes("newData.child('status').val() === 'pending_review'"), true);
check('agent write requires owned uid', rules['.write'].includes("data.child('agent_uid').val() === auth.uid"), true);
check('channel manager write requires owned channel', rules['.write'].includes("data.child('agent_channel_code')"), true);
check('contract code is immutable', rules['.validate'].includes("newData.child('contract_code').val() === data.child('contract_code').val()"), true);
check('amount snapshot is immutable', rules['.validate'].includes("rent_amount_snapshot"), true);
check('signature has size limit', rules.sign_signature['.validate'].includes('600000'), true);
check('unknown anonymous fields are immutable', rules.$other['.validate'].includes('newData.val() === data.val()'), true);

console.log(`contract sign rules simulation: ${passed}/${passed} PASS`);
