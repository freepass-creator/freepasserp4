import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripDetachedEsignAppendices } from '../lib/domain/esign-document-boundary';

const template = readFileSync('public/contract-template/rental-contract.html', 'utf8');
const mainContract = stripDetachedEsignAppendices(template);
const signPage = readFileSync('app/sign/[token]/page.tsx', 'utf8');
const server = readFileSync('lib/server/freepass-esign.ts', 'utf8');
const documentBuilder = readFileSync('lib/server/freepass-esign-document.ts', 'utf8');

assert.match(template, /부속서류 1 · 차량 인수증/);
assert.doesNotMatch(mainContract, /부속서류 1 · 차량 인수증/);
assert.doesNotMatch(mainContract, /부속서류 7 · 자동이체\(CMS\)/);
assert.doesNotMatch(mainContract, /부속서류 8 · 연대보증/);
assert.match(documentBuilder, /stripDetachedEsignAppendices/);
assert.match(documentBuilder, /\[data-main-exclude\]\{display:none!important\}/);
assert.doesNotMatch(signPage.match(/const REQUIRED_CONSENTS[^;]+/)?.[0] || '', /cms/);
assert.doesNotMatch(server.match(/FREEPASS_ESIGN_REQUIRED_CONSENTS[^;]+/)?.[0] || '', /cms/);

console.log('✓ 본계약 문서 경계: 차량 인수증·CMS·연대보증 별도, 본계약 필수동의에서 CMS 제외');
