import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const adminRoute = read('app/api/freepass-esign/contracts/[contractCode]/route.ts');
const publicRoute = read('app/api/freepass-esign/public/[token]/route.ts');
const publicPage = read('app/sign/[token]/page.tsx');
const esignPage = read('app/esign/page.tsx');
const sendCenter = read('components/EsignSendCenter.tsx');
const deal = read('lib/domain/deal.ts');
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };

assert.match(adminRoute, /v4\/esign_sessions/);
assert.match(adminRoute, /v4\/esign_private/);
assert.match(adminRoute, /canManageFreepassEsign/);
assert.doesNotMatch(adminRoute, /contract_sign\//);

assert.match(publicRoute, /transaction\(/);
assert.match(publicRoute, /imageFile\(form\.get\('idCard'/);
assert.match(publicRoute, /imageFile\(form\.get\('selfie'/);
assert.match(publicRoute, /status: 'pending_review'/);
assert.doesNotMatch(publicRoute, /getStore\(\)/);

assert.match(publicPage, /\/api\/freepass-esign\/public\/\$\{encodeURIComponent/);
assert.doesNotMatch(publicPage, /contract-sign-public|@\/lib\/domain\/sign/);
assert.match(esignPage, /return <EsignSendCenter \/>/);
assert.match(sendCenter, /Excel 계약서 넣기/);
assert.match(sendCenter, /직접 작성/);
assert.match(sendCenter, /ERP 계약에서/);
assert.match(sendCenter, /FreepassEsignLinkPane/);
assert.match(sendCenter, /FreepassEsignProgressPane/);
assert.doesNotMatch(deal.match(/export async function createDirectEsignContract[\s\S]*?return code;/)?.[0] || '', /provider_agreement_done:\s*'yes'/);

assert.ok(packageJson.scripts?.dev?.includes('next dev -p 4004'));
assert.ok(!packageJson.scripts?.dev?.includes('ensure-chakhandeal-dev'));
assert.ok(packageJson.scripts?.['dev:with-chakhandeal']?.includes('ensure-chakhandeal-dev'));

console.log('✓ 프리패스 자체 전자계약: 발송센터 3입구 · 자체 링크/진행 패널 · 민감정보 서버 저장 · 가짜 ERP 약정 제거');
