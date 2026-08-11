import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const adminRoute = read('app/api/freepass-esign/contracts/[contractCode]/route.ts');
const publicRoute = read('app/api/freepass-esign/public/[token]/route.ts');
const publicPage = read('app/sign/[token]/page.tsx');
const esignPage = read('app/esign/page.tsx');
const sendCenter = read('components/EsignSendCenter.tsx');
const deal = read('lib/domain/deal.ts');
const esignServer = read('lib/server/freepass-esign.ts');
const firebaseAdmin = read('lib/server/firebase-admin.ts');
const panes = read('components/FreepassEsignPanes.tsx');
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };

assert.match(adminRoute, /v4\/esign_sessions/);
assert.match(adminRoute, /v4\/esign_private/);
assert.match(adminRoute, /canManageFreepassEsign/);
assert.match(adminRoute, /authUnavailable/);
assert.match(adminRoute, /BearerTokenError/);
assert.match(adminRoute, /throwTokenError: true/);
assert.match(adminRoute, /로그인이 만료되었거나 유효하지 않습니다/);
assert.doesNotMatch(adminRoute, /contract_sign\//);
assert.match(esignServer, /actor\.rawRole === 'agent'/);
assert.match(esignServer, /actor\.rawRole === 'agent_admin'/);
assert.match(esignServer, /actor\.rawRole === 'agent_manager'/);
assert.match(firebaseAdmin, /code\.startsWith\('auth\/'\)/);
assert.match(firebaseAdmin, /throw verifyError/);
assert.match(panes, /getIdToken\(\)/);
assert.match(firebaseAdmin, /waitMs <= 5_000/);
assert.match(firebaseAdmin, /verifyIdToken\(token\)/);

assert.match(publicRoute, /\[`progress\/\$\{step\}`\]: now/);
assert.match(publicRoute, /상태 필드는 건드리지 않는다/);
assert.match(publicRoute, /imageFile\(form\.get\('idCard'/);
assert.match(publicRoute, /imageFile\(form\.get\('selfie'/);
assert.match(publicRoute, /status: 'pending_review'/);
assert.match(publicRoute, /snapshot\/landlord/);
assert.match(publicRoute, /bundle\.partner\?\.company_name/);
assert.match(publicRoute, /Number\(savedProgress\[step\] \|\| 0\) > 0/);
assert.match(publicRoute, /reused: true/);
assert.doesNotMatch(publicRoute, /progressTx/);
assert.doesNotMatch(publicRoute, /getStore\(\)/);

assert.match(publicPage, /\/api\/freepass-esign\/public\/\$\{encodeURIComponent/);
assert.match(publicPage, /임대인 회사명/);
assert.match(publicPage, /snapshot\.landlord\?\.companyName/);
assert.match(publicPage, /차량번호 미정/);
assert.match(publicPage, /model_snapshot/);
assert.doesNotMatch(publicPage, /contract-sign-public|@\/lib\/domain\/sign/);
assert.match(esignPage, /return <EsignSendCenter \/>/);
assert.match(sendCenter, /직접 작성/);
assert.doesNotMatch(sendCenter, /Excel 계약서로 새로 만들기/);
assert.match(sendCenter, /FreepassEsignLinkPane/);
assert.match(sendCenter, /FreepassEsignProgressPane/);
assert.doesNotMatch(deal.match(/export async function createDirectEsignContract[\s\S]*?return code;/)?.[0] || '', /provider_agreement_done:\s*'yes'/);

assert.ok(packageJson.scripts?.dev?.includes('next dev -p 4004'));
assert.ok(!packageJson.scripts?.dev?.includes('ensure-chakhandeal-dev'));
assert.ok(packageJson.scripts?.['dev:with-chakhandeal']?.includes('ensure-chakhandeal-dev'));

console.log('✓ 프리패스 자체 전자계약: 직접 작성 · 운영관리자 링크 생성 · 자체 링크/진행 패널 · 민감정보 서버 저장');
