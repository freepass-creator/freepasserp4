import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  canApproveSign, makeSignToken, normalizeSignConsents, SIGN_REQUIRED_CONSENTS, SIGN_REQUIRED_CONSENTS_VALUE,
  validateSignData,
} from '../lib/domain/sign';
import { contractToSignPublic, isContractSignActive, SIGN_LINK_TTL_MS } from '../lib/firebase/contract-sign-public';

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
check('new public slot expires in seven days', Number(publicSlot.expires_at) > Date.now() + SIGN_LINK_TTL_MS - 5000, true);
check('active link accepted before expiry', isContractSignActive({ expires_at: Date.now() + 1000 }), true);
check('expired link rejected', isContractSignActive({ expires_at: Date.now() - 1 }), false);
check('revoked link rejected', isContractSignActive({ expires_at: Date.now() + 1000, revoked_at: Date.now() }), false);
check('revoked status rejected without timestamp', isContractSignActive({ expires_at: Date.now() + 1000, status: 'revoked' }), false);

const tokens = Array.from({ length: 100 }, () => makeSignToken());
check('sign tokens use 192-bit hex payload', tokens.every((token) => /^sign_[0-9a-f]{48}$/.test(token)), true);
check('generated sign tokens are unique', new Set(tokens).size, tokens.length);
check('approval rejects sent link without submission', canApproveSign({ sign_status: '발송' }), false);
check('approval rejects pending review without signature', canApproveSign({ sign_status: '검토대기', sign_consents: 'required' }), false);
check('approval rejects pending review without consent', canApproveSign({ sign_status: '검토대기', sign_signature: 'data:image/png;base64,AA' }), false);
check('approval accepts reviewed signature and consent', canApproveSign({
  sign_status: '검토대기',
  sign_signature: 'data:image/png;base64,AA',
  sign_consents: SIGN_REQUIRED_CONSENTS_VALUE,
}), true);
check('consents normalize to stable ids', normalizeSignConsents([...SIGN_REQUIRED_CONSENTS]), SIGN_REQUIRED_CONSENTS_VALUE);
assert.throws(() => normalizeSignConsents(SIGN_REQUIRED_CONSENTS.slice(0, -1)), /필수 약관 동의/);
passed++;
const validSignData = {
  customer_name: '홍길동',
  customer_phone: '010-1234-5678',
  signature: 'data:image/png;base64,AA==',
  consents: [...SIGN_REQUIRED_CONSENTS],
};
validateSignData(validSignData);
passed++;
assert.throws(() => validateSignData({ ...validSignData, customer_phone: '1234' }), /연락처/);
passed++;
assert.throws(() => validateSignData({ ...validSignData, signature: 'data:image/svg+xml;base64,AA==' }), /PNG/);
passed++;
assert.throws(() => validateSignData({ ...validSignData, signature: `data:image/png;base64,${'A'.repeat(600000)}` }), /PNG/);
passed++;

const rules = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'database.rules.json'), 'utf8')).rules.contract_sign.$token;
check('anonymous write requires sent state', rules['.write'].includes("data.child('status').val() === 'sent'"), true);
check('anonymous write requires pending review target', rules['.write'].includes("newData.child('status').val() === 'pending_review'"), true);
check('agent write requires owned uid', rules['.write'].includes("data.child('agent_uid').val() === auth.uid"), true);
check('channel manager write requires owned channel', rules['.write'].includes("data.child('agent_channel_code')"), true);
check('contract code is immutable', rules['.validate'].includes("newData.child('contract_code').val() === data.child('contract_code').val()"), true);
check('amount snapshot is immutable', rules['.validate'].includes("rent_amount_snapshot"), true);
check('signature has size limit', rules.sign_signature['.validate'].includes('600000'), true);
check('signature must be PNG data url', rules.sign_signature['.validate'].includes("beginsWith('data:image/png;base64,')"), true);
check('signed timestamp rejects stale client values', rules.sign_signed_at['.validate'].includes('now - 300000'), true);
check('unknown anonymous fields are immutable', rules.$other['.validate'].includes('newData.val() === data.val()'), true);
check('anonymous read checks expiry', rules['.read'].includes("expires_at") && rules['.read'].includes('> now'), true);
check('anonymous read checks revocation', rules['.read'].includes("revoked_at"), true);
check('anonymous write checks expiry', rules['.write'].includes("expires_at") && rules['.write'].includes('> now'), true);
check('anonymous submission requires exact consent set', rules['.write'].includes(`sign_consents').val() === '${SIGN_REQUIRED_CONSENTS_VALUE}`), true);
check('anonymous submission requires consent version', rules['.write'].includes("sign_consent_version').val() === 'v1'"), true);
check('expiry becomes immutable', rules['.validate'].includes("newData.child('expires_at').val() === data.child('expires_at').val()"), true);

const contractRules = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'database.rules.json'), 'utf8')).rules.v4.contracts.$contract_id;
check('contract approval requires pending public submission', contractRules.sign_status['.validate'].includes("child('status').val() === 'pending_review'"), true);
check('contract approval requires public signature', contractRules.sign_status['.validate'].includes("child('sign_signature').isString()"), true);
check('agreement step requires signed public slot', contractRules.provider_agreement_sent['.validate'].includes("child('status').val() === 'signed'"), true);

console.log(`contract sign rules simulation: ${passed}/${passed} PASS`);
