import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  emptyEsignDraftInput,
  esignAdditionalDriverLimit,
  esignDraftAdditionalDriverCount,
  validateEsignCenterContract,
} from '../lib/domain/esign-center';

const read = (path: string) => readFileSync(path, 'utf8');
const adminRoute = read('app/api/freepass-esign/contracts/[contractCode]/route.ts');
const publicRoute = read('app/api/freepass-esign/public/[token]/route.ts');
const publicDocumentRoute = read('app/api/freepass-esign/public/[token]/document/route.ts');
const publicPage = read('app/sign/[token]/page.tsx');
const contractTemplate = read('public/contract-template/rental-contract.html');
const assetRoute = read('app/api/freepass-esign/contracts/[contractCode]/asset/[kind]/route.ts');
const signedSnapshot = read('lib/domain/esign-signed-snapshot.ts');
const esignPage = read('app/esign/page.tsx');
const sendCenter = read('components/EsignSendCenter.tsx');
const deal = read('lib/domain/deal.ts');
const esignServer = read('lib/server/freepass-esign.ts');
const firebaseAdmin = read('lib/server/firebase-admin.ts');
const panes = read('components/FreepassEsignPanes.tsx');
const middleware = read('middleware.ts');
const esignCenter = read('lib/domain/esign-center.ts');
const esignInputs = read('lib/domain/esign-inputs.ts');
const formControls = read('components/ui/form-controls.tsx');
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };

assert.match(adminRoute, /v4\/esign_sessions/);
assert.match(adminRoute, /v4\/esign_private/);
assert.match(adminRoute, /canManageFreepassEsign/);
assert.match(adminRoute, /authUnavailable/);
assert.match(adminRoute, /BearerTokenError/);
assert.match(adminRoute, /throwTokenError: true/);
assert.match(adminRoute, /고객 완료화면·관리자 상태·PDF 무결성 정보/);
assert.match(adminRoute, /ref\('v4'\)\.update\(/);
assert.match(adminRoute, /freepassEsignEventUpdates\(contractCode, 'issued'/);
assert.match(adminRoute, /freepassEsignEventUpdates\(contractCode, 'revoked'/);
assert.match(adminRoute, /freepassEsignEventUpdates\(contractCode, 'rejected'/);
assert.match(adminRoute, /freepassEsignEventUpdates\(contractCode, 'approved'/);
assert.match(esignServer, /FREEPASS_ESIGN_PUBLIC_BASE_URL/);
assert.match(adminRoute, /publicFreepassSignUrl\(token, requestOrigin\)/);
assert.match(adminRoute, /canonicalFreepassSignUrl\(bundle\.contract\.esign_sign_url\)/);
assert.match(adminRoute, /approvalClaimId/);
assert.match(adminRoute, /status: 'approving'/);
assert.match(adminRoute, /다른 관리자가 이미 승인 처리 중/);
assert.match(adminRoute, /releaseApprovalClaim/);
assert.match(adminRoute, /APPROVAL_CLAIM_TIMEOUT_MS/);
assert.match(adminRoute, /export const maxDuration = 60/);
assert.match(adminRoute, /로그인이 만료되었거나 유효하지 않습니다/);
assert.doesNotMatch(adminRoute, /contract_sign\//);
assert.match(esignServer, /actor\.rawRole === 'agent'/);
assert.match(esignServer, /actor\.rawRole === 'agent_admin'/);
assert.match(esignServer, /actor\.rawRole === 'agent_manager'/);
assert.match(esignServer, /additionalDriverPolicy/);
assert.match(esignServer, /esignAdditionalDriverLimit\(args\.policy\)/);
assert.match(esignServer, /freepassSignTokenFromUrl/);
assert.match(esignServer, /publicFreepassSignUrl/);
assert.match(esignServer, /canonicalFreepassSignUrl/);
assert.match(firebaseAdmin, /code\.startsWith\('auth\/'\)/);
assert.match(firebaseAdmin, /throw verifyError/);
assert.match(panes, /getIdToken\(forceRefresh\)/);
assert.match(panes, /response\.status === 401/);
assert.match(panes, /새 링크 다시 생성/);
assert.match(panes, /loadError/);
assert.match(firebaseAdmin, /waitMs <= 5_000/);
assert.match(firebaseAdmin, /verifyIdToken\(token\)/);
assert.match(middleware, /sign\.freepasserp\.com/);
assert.match(middleware, /FREEPASS_TOKEN/);
assert.match(middleware, /NextResponse\.rewrite/);
assert.match(middleware, /LEGACY_TOKEN/);
assert.match(middleware, /chakhandeal\.vercel\.app/);

assert.match(publicRoute, /\[`progress\/\$\{step\}`\]: now/);
assert.match(publicRoute, /상태 필드는 건드리지 않는다/);
assert.match(publicRoute, /imageFile\(form\.get\('idCard'/);
assert.match(publicRoute, /imageFile\(form\.get\('selfie'/);
assert.match(publicRoute, /status: 'pending_review'/);
assert.match(publicRoute, /status === 'pending_review' \|\| status === 'approving'/);
assert.match(publicRoute, /driver_license_no: S\(payload\.driver_license_no\)/);
assert.match(publicRoute, /residentIdInfo\(customerId\)/);
assert.match(publicRoute, /residentAgeOn\(customerId, templateFields\.contract_start\)/);
assert.match(publicRoute, /ageRange\.min/);
assert.match(publicRoute, /ageRange\.max/);
assert.match(publicRoute, /additionalDriverLicense\$\{index \+ 1\}/);
assert.match(publicRoute, /additional_drivers: parsed\.additionalDrivers/);
assert.match(publicRoute, /추가 운전자는 최대/);
assert.match(publicRoute, /customer_name: parsed\.name/);
assert.match(publicRoute, /customer_phone: parsed\.phone/);
assert.match(publicRoute, /snapshot\/landlord/);
assert.match(publicRoute, /bundle\.partner\?\.company_name/);
assert.match(publicRoute, /Number\(savedProgress\[step\] \|\| 0\) > 0/);
assert.match(publicRoute, /reused: true/);
assert.match(publicRoute, /고객 제출자료·검토상태·목록표시/);
assert.match(publicRoute, /freepassEsignEventUpdates\(contractCode, 'submitted'/);
assert.match(publicRoute, /freepassEsignEventUpdates\(contractCode, 'opened'/);
assert.match(esignServer, /esign_events\/\$\{contractCode\}\/\$\{key\}/);
assert.match(publicRoute, /previewDocumentUrl/);
assert.match(publicRoute, /downloadUrl/);
assert.doesNotMatch(publicRoute, /progressTx/);
assert.doesNotMatch(publicRoute, /getStore\(\)/);

assert.match(publicPage, /\/api\/freepass-esign\/public\/\$\{encodeURIComponent/);
assert.match(publicPage, /임대인 회사명/);
assert.match(publicPage, /snapshot\.landlord\?\.companyName/);
assert.match(publicPage, /차량번호 미정/);
assert.match(publicPage, /model_snapshot/);
assert.match(publicPage, /운전면허번호 \*/);
assert.match(publicPage, /성명 \*/);
assert.match(publicPage, /연락처 \*/);
assert.match(publicPage, /if \(!form\.driver_license_no\.trim\(\)\)/);
assert.match(publicPage, /kind: 'additional-driver'/);
assert.match(publicPage, /추가 운전자 등록/);
assert.match(publicPage, /additionalDriverCost/);
assert.match(publicPage, /추가 운전자 개인정보 제공·면허증 제출/);
assert.match(publicPage, /운전면허증 사진/);
assert.match(publicPage, /본인이 직접 입력했으며 개인정보 제공과 면허증 제출에 동의/);
assert.match(publicPage, /모바일 계약서 전체보기/);
assert.match(publicPage, /계약서 미리보기/);
assert.doesNotMatch(publicPage, /A4 계약서 미리보기/);
assert.match(publicPage, /미리보기만으로 동의·서명 처리되지 않습니다/);
assert.match(publicPage, /완료 계약서 보기/);
assert.match(publicPage, /PDF 다운로드/);
assert.match(publicPage, /view\?\.status !== '검토대기'/);
assert.match(publicPage, /window\.setInterval/);
assert.match(publicPage, /visibilitychange/);
assert.match(publicPage, /보완요청·해지·만료/);
assert.match(publicPage, /window\.location\.reload\(\)/);
assert.match(publicPage, /자동차 대여 약관 보기/);
assert.match(publicPage, /개인정보 입력 단계로 이동/);
assert.match(publicDocumentRoute, /buildFrozenFreepassHtml\(snapshot, '', ''\)/);
assert.match(publicDocumentRoute, /renderFreepassPdf\(html\)/);
assert.match(publicDocumentRoute, /\['sent', 'opened'\]\.includes\(status\)/);
assert.match(publicDocumentRoute, /download \? 'attachment' : 'inline'/);
assert.match(publicDocumentRoute, /filename\*=UTF-8''/);
assert.match(adminRoute, /additionalDrivers/);
assert.match(assetRoute, /additional-driver-license-\(\[1-3\]\)/);
assert.doesNotMatch(publicPage, /면허번호는 별도로 입력하지 않습니다/);
assert.match(signedSnapshot, /driver_or_biz_no: driverLicenseNo/);
assert.match(signedSnapshot, /drv\$\{slot\}_name/);
assert.match(contractTemplate, /if\(ageSel && !SEALED\)/);
assert.doesNotMatch(publicPage, /contract-sign-public|@\/lib\/domain\/sign/);
assert.match(esignPage, /return <EsignSendCenter \/>/);
assert.match(sendCenter, /label: '회사선택'/);
assert.match(sendCenter, /label: '계약서 종류'/);
assert.match(sendCenter, /label: '계약정책'/);
assert.ok(sendCenter.indexOf("...SUPPLIER_FIELDS") < sendCenter.indexOf("...TEMPLATE_FIELDS"));
assert.ok(sendCenter.indexOf("...TEMPLATE_FIELDS") < sendCenter.indexOf("...POLICY_FIELDS"));
assert.equal(
  emptyEsignDraftInput('direct', '2026-08-14').standardTemplateId,
  'freepass-rent-standard',
  '새 계약서는 렌트·보험료 포함 표준계약서로 시작해야 함',
);
assert.doesNotMatch(sendCenter, /Excel 계약서로 새로 만들기/);
assert.doesNotMatch(sendCenter, /초안만 저장/);
assert.doesNotMatch(sendCenter, /회사를 선택하면 해당 회사 정책만/);
assert.doesNotMatch(sendCenter, /이 공급사는 상품만 공급합니다/);
assert.doesNotMatch(sendCenter, /이 정책 필수값 확인/);
assert.match(sendCenter, /FreepassEsignLinkPane/);
assert.match(sendCenter, /FreepassEsignProgressPane/);
assert.match(sendCenter, /입력 내용 확인/);
assert.match(sendCenter, /계약서 생성하기/);
assert.doesNotMatch(sendCenter, /window\.open\('about:blank'/);
assert.match(sendCenter, /selected && createdDraft/);
assert.match(sendCenter, /같은 패널에서 아래 순서대로 확인하고 링크를 만드세요/);
assert.match(sendCenter, /inlineResultRef\.current\?\.scrollIntoView/);
assert.match(sendCenter, /전체 입력 지우기/);
assert.doesNotMatch(sendCenter, /⑥ 계약서 만들기/);
assert.ok(sendCenter.indexOf('② ERP 차량 선택') < sendCenter.indexOf('③ 기간·운전자 연령·대여 조건'));
assert.ok(sendCenter.indexOf('③ 기간·운전자 연령·대여 조건') < sendCenter.indexOf('④ 특약사항'));
assert.doesNotMatch(sendCenter, /④ 고객 정보/);
assert.doesNotMatch(sendCenter, /const CUSTOMER_FIELDS/);
assert.match(sendCenter, /fields=\{VEHICLE_CONTRACT_FIELDS\}/);
assert.match(sendCenter, /fields=\{RENT_CONTRACT_FIELDS\}/);
assert.match(sendCenter, /setDraftValue\('specialTerms', value\)/);
assert.doesNotMatch(sendCenter, /const ADDITIONAL_DRIVER_SLOTS =/);
assert.doesNotMatch(sendCenter, /addAdditionalDriver/);
assert.doesNotMatch(sendCenter, /removeAdditionalDriver/);
assert.match(sendCenter, /draftAdditionalDriverLimit/);
assert.match(sendCenter, /고객이 계약 링크에서 직접 입력하고 면허증 첨부/);
assert.match(esignCenter, /esignAdditionalDriverLimit/);
assert.match(esignCenter, /additional_driver: additionalDriverCount \? `\$\{additionalDriverCount\}인 지정` : '없음'/);
assert.match(esignCenter, /emergency_relation: S\(form\.emergencyRelation\)/);
assert.match(esignCenter, /additionalDriverCount > additionalDriverLimit/);
assert.match(esignCenter, /추가 운전자 \$\{incompleteSlot \+ 1\}/);
assert.match(esignCenter, /drv2_name: S\(form\.additionalDriver2Name\)/);
assert.match(esignCenter, /drv3_name: S\(form\.additionalDriver3Name\)/);
assert.match(esignCenter, /\[S\(form\.emergencyRelation\), S\(form\.emergencyContact\)\]/);
assert.match(esignInputs, /saved\.additional_driver \|\| c\.additional_driver/);
assert.match(esignInputs, /add_driver_name: 'drv1_name'/);
assert.match(formControls, /const minHeight = Math\.ceil/);
assert.match(formControls, /style=\{\{ boxSizing: 'border-box', minHeight/);
assert.match(sendCenter, /차량번호·차종 검색 또는 눌러서 선택/);
assert.match(sendCenter, /vehiclePickerOpen/);
assert.match(sendCenter, /<EsignVehicleSelectRow/);
assert.match(sendCenter, /setVehiclePickerOpen\(false\)/);
assert.match(sendCenter, /key: 'workflow'/);
assert.match(sendCenter, /key: 'document'/);
assert.match(sendCenter, /title: '계약서·링크'/);
assert.doesNotMatch(sendCenter, /key: 'send'/);
assert.doesNotMatch(sendCenter, /key: 'progress'/);
assert.match(sendCenter, /mobileLayout="swap"/);
assert.match(sendCenter, /필수입력 \$\{draftBlocks\.length\}개 확인/);
assert.doesNotMatch(sendCenter, /disabled=\{busy \|\| draftBlocks\.length > 0\}/);
assert.match(panes, /발행 당시 계약 내용 보기/);
assert.match(panes, /approving: '승인 처리 중'/);
assert.match(panes, /① 생성된 계약서 미리보기/);
assert.match(panes, /② 계약 링크 만들기/);
assert.match(panes, /계약 링크 만들기/);
assert.match(panes, /HTTP \$\{response\.status\}/);
assert.match(panes, /링크만 생성됩니다/);
assert.match(panes, /① 계약 링크 복사·전달/);
assert.match(panes, /ariaLabel="계약 링크"/);
assert.match(panes, /영업자에게 전달/);
assert.match(panes, /영업자가 고객에게 전달/);
assert.match(panes, /readOnly/);
assert.match(panes, /링크 복사/);
assert.match(read('components/list-rows.tsx'), /Number\.isFinite\(mileage\)/);
assert.doesNotMatch(deal.match(/export async function createDirectEsignContract[\s\S]*?return code;/)?.[0] || '', /provider_agreement_done:\s*'yes'/);
assert.match(deal, /source !== 'direct' && !customerName/);

assert.ok(packageJson.scripts?.dev?.includes('next dev -p 4004'));
assert.ok(!packageJson.scripts?.dev?.includes('ensure-chakhandeal-dev'));
assert.ok(packageJson.scripts?.['dev:with-chakhandeal']?.includes('ensure-chakhandeal-dev'));

assert.equal(esignAdditionalDriverLimit({ additional_driver_allowance_count: '불가' }), 0);
assert.equal(esignAdditionalDriverLimit({ additional_driver_allowance_count: 1 }), 1);
assert.equal(esignAdditionalDriverLimit({ additional_driver_allowance_count: '2인' }), 2);
assert.equal(esignAdditionalDriverLimit({ additional_driver_allowance_count: '무제한' }), 3);
assert.equal(validateEsignCenterContract({
  provider_company_code: 'RP012', policy_code: 'POL1', rent_amount_snapshot: 650000,
  rent_month_snapshot: 36, payment_timing_snapshot: '선불', driver_age_snapshot: '만 18세 이상',
  vehicle_name_snapshot: '아반떼', contract_source: 'direct',
}, { partner_code: 'RP012' }, {
  provider_company_code: 'RP012', basic_driver_age: 26, driver_age_lowering: '만 18세까지',
}).some((check) => check.key === 'driver_age' && check.level === 'BLOCK'), true);
const restoredDriverDraft = emptyEsignDraftInput('direct', '2026-08-14');
restoredDriverDraft.additionalDriver2Name = '이바다';
restoredDriverDraft.additionalDriver2Relation = '형제';
restoredDriverDraft.additionalDriver2Phone = '01022223333';
assert.equal(esignDraftAdditionalDriverCount(restoredDriverDraft), 2);
const driverContract = {
  additional_driver: '2인 지정',
  contract_draft: JSON.stringify({
    additional_driver: '2인 지정',
    drv1_name: '김운전', drv1_relation: '배우자', drv1_phone: '01011112222',
    drv2_name: '이운전', drv2_relation: '형제', drv2_phone: '01033334444',
  }),
};
const driverPolicy = { additional_driver_allowance_count: '2인' };
assert.equal(validateEsignCenterContract(driverContract, null, driverPolicy)
  .find((check) => check.key === 'additional_driver')?.level, 'PASS');
assert.match(validateEsignCenterContract(driverContract, null, { additional_driver_allowance_count: '1인' })
  .find((check) => check.key === 'additional_driver')?.message || '', /1명까지/);
assert.match(validateEsignCenterContract({
  ...driverContract,
  contract_draft: JSON.stringify({ additional_driver: '2인 지정', drv1_name: '김운전', drv1_relation: '배우자', drv1_phone: '01011112222' }),
}, null, driverPolicy).find((check) => check.key === 'additional_driver')?.message || '', /추가 운전자 2/);

console.log('✓ 프리패스 자체 전자계약: 직접 작성 · 운영관리자 링크 생성 · 자체 링크/진행 패널 · 민감정보 서버 저장');
