import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  emptyEsignDraftInput,
  esignAdditionalDriverLimit,
  esignDraftAdditionalDriverCount,
  validateEsignCenterContract,
} from '../lib/domain/esign-center';
import {
  canonicalFreepassDirectManualTerms,
  canonicalFreepassDirectManualTermsDraft,
} from '../lib/domain/freepass-direct-manual-terms';
import { approvedFreepassManualOffer } from '../lib/domain/freepass-manual-offer';
import { contractLayerOf, partnerUsesFreepassContract } from '../lib/domain/policy-tier';
import { searchContractVehicles } from '../lib/domain/esign-vehicle-selection';

// ⚠ 줄끝 정규화 — core.autocrlf=true 라 체크아웃하면 CRLF 로 깔린다. 소스 문자열 단언이 줄끝에 걸려 깨지면 안 된다(2026-08-20).
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const adminRoute = read('app/api/freepass-esign/contracts/[contractCode]/route.ts');
const manualOfferCreateRoute = read('app/api/freepass-esign/manual-offers/create/route.ts');
const manualOfferAdminRoute = read('app/api/freepass-esign/manual-offers/route.ts');
const publicRoute = read('app/api/freepass-esign/public/[token]/route.ts');
const publicDocumentRoute = read('app/api/freepass-esign/public/[token]/document/route.ts');
const publicPage = read('app/sign/[token]/page.tsx');
const contractTemplate = read('public/contract-template/rental-contract.html');
const assetRoute = read('app/api/freepass-esign/contracts/[contractCode]/asset/[kind]/route.ts');
const documentRoute = read('app/api/freepass-esign/contracts/[contractCode]/document/route.ts');
const handoverRoute = read('app/api/freepass-esign/contracts/[contractCode]/handover/route.ts');
const signedSnapshot = read('lib/domain/esign-signed-snapshot.ts');
const esignPage = read('app/esign/page.tsx');
const sampleContractRoute = read('app/esign/sample-contract/route.ts');
const esignPreviewPage = read('app/esign/preview/[contractCode]/page.tsx');
const sendCenter = read('components/EsignSendCenter.tsx');
const workflowGuide = read('components/AgentWorkflowGuide.tsx');
const topBar = read('components/TopBar.tsx');
const deal = read('lib/domain/deal.ts');
const esignServer = read('lib/server/freepass-esign.ts');
const authGate = read('lib/auth-gate.ts');
const tabbar = read('lib/tabbar.tsx');
const firebaseAdmin = read('lib/server/firebase-admin.ts');
const panes = read('components/FreepassEsignPanes.tsx');
const middleware = read('middleware.ts');
const esignCenter = read('lib/domain/esign-center.ts');
const esignInputs = read('lib/domain/esign-inputs.ts');
const formControls = read('components/ui/form-controls.tsx');
const membersPage = read('app/members/page.tsx');
const memberFilter = read('features/members/member-filter.ts');
const listRows = read('components/list-rows.tsx');
const policyPage = read('app/policy/page.tsx');
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };

assert.equal(contractLayerOf({ contract_authoring: '프리패스가 작성' }, { esign_contract_enabled: '미사용' }), 'product');
assert.equal(contractLayerOf({ contract_authoring: '공급사가 작성' }, { esign_contract_enabled: '사용' }), 'contract');
assert.equal(partnerUsesFreepassContract({}, [{ contract_authoring: '프리패스가 작성' }]), true);

// RTDB JSON object의 child 순서가 달라도 같은 직접계약 초안은 seal과 다시 맞아야 한다.
// 반대로 임의 PDF 필드 key를 끼워 넣는 입력은 발행 전에 닫는다.
const orderedDirectTerms = canonicalFreepassDirectManualTermsDraft({
  special_terms: '없음', deposit_installment: '일시납', special_terms_choice: '없음',
});
const reorderedDirectTerms = canonicalFreepassDirectManualTermsDraft({
  deposit_installment: '일시납', special_terms_choice: '없음', special_terms: '없음',
});
assert.equal(orderedDirectTerms, reorderedDirectTerms);
assert.equal(canonicalFreepassDirectManualTermsDraft({ unsafe_pdf_field: '위조' }), null);
assert.deepEqual(canonicalFreepassDirectManualTerms(orderedDirectTerms), {
  deposit_installment: '일시납', special_terms: '없음', special_terms_choice: '없음',
});
assert.deepEqual(canonicalFreepassDirectManualTerms({ buyback_option: '만기 협의' }), { buyback_option: '만기 협의' });
const manualOffer = approvedFreepassManualOffer('manual_offer_01', {
  status: 'approved', provider_company_code: 'SONOGONG', policy_code: 'sonogong_policy',
  standard_template_id: 'sonogong-rent-draft', product_type: '렌탈', rent_months: 36,
  rent_amount: 500000, deposit_amount: 0, annual_mileage: '연 20,000km', driver_age: '만 26세 이상',
  payment_timing: '선불', maturity: '반납형', deposit_installment: '일시납',
});
assert.equal(manualOffer?.templateId, 'sonogong-rent-draft');
assert.equal(manualOffer?.customerType, '개인');
assert.equal(approvedFreepassManualOffer('manual_offer_corp', {
  status: 'approved', provider_company_code: 'SONOGONG', policy_code: 'sonogong_policy', standard_template_id: 'sonogong-rent-draft', product_type: '렌탈',
  rent_months: 36, rent_amount: 500000, deposit_amount: 0, annual_mileage: '연 20,000km', driver_age: '만 26세 이상', payment_timing: '선불', maturity: '반납형', customer_type: '법인',
})?.customerType, '법인');
assert.equal(approvedFreepassManualOffer('manual_offer_invalid_customer_type', {
  status: 'approved', provider_company_code: 'SONOGONG', policy_code: 'sonogong_policy', standard_template_id: 'sonogong-rent-draft', product_type: '렌탈',
  rent_months: 36, rent_amount: 500000, deposit_amount: 0, annual_mileage: '연 20,000km', driver_age: '만 26세 이상', payment_timing: '선불', maturity: '반납형', customer_type: '임의구분',
}), null);
assert.equal(approvedFreepassManualOffer('manual_offer_02', { ...manualOffer, status: 'draft' }), null);
assert.match(manualOfferCreateRoute, /ref\('v4\/esign_manual_offers'\)/);
assert.match(manualOfferAdminRoute, /actor\?\.rawRole === 'admin'/);
assert.match(manualOfferAdminRoute, /status: 'draft'/);
assert.match(manualOfferAdminRoute, /\['approve', 'disable'\]/);
assert.match(manualOfferAdminRoute, /같은 계약서 범위에 승인된 기본조건이 이미 있거나 상태가 변경되었습니다/);
assert.match(manualOfferAdminRoute, /ref\('v4\/esign_manual_offers'\);\s*const approvedAt[\s\S]*?root\.transaction/);
assert.match(manualOfferAdminRoute, /S\(fresh\.status\) !== 'draft'/);
assert.match(manualOfferCreateRoute, /수기 계약에는 승인 오퍼 밖의 금액·정책·서식 값을 넣을 수 없습니다/);
assert.match(manualOfferCreateRoute, /offer\.templateId === expectedTemplateId/);
assert.match(manualOfferCreateRoute, /canUseOffer\(actor, offer\)/);
assert.match(manualOfferCreateRoute, /이 계약서의 기본 조건 설정이 필요합니다|승인 계약조건이 없습니다/);
assert.match(manualOfferCreateRoute, /차량 픽업 확인서는 고객 서명 링크를 만들 수 없습니다/);
assert.match(esignServer, /customerType === '법인' \? 'corporate'/);
assert.match(esignServer, /partyDocuments/);
assert.match(esignServer, /function customerTypeIssueError/);
assert.doesNotMatch(esignServer, /function unsupportedCustomerTypeIssueError/);
assert.match(esignServer, /계약자 유형별 필수 증빙을 동결하지 못했습니다/);
assert.match(manualOfferCreateRoute, /loadFreepassManualOfferSource/);
assert.match(manualOfferCreateRoute, /buyback_option: '만기 협의'/);
assert.match(manualOfferCreateRoute, /templateRow\.id\.startsWith\('sonogong-'/);
// ERP 차량 빠른계약은 브라우저 가격·정책을 받지 않고, 상품 코드+기간만 보내 서버가
// v4 상품 원장 가격표/재고 상태를 다시 확인한 뒤 seal 한다.
assert.match(manualOfferCreateRoute, /loadFreepassDirectSource\(productCode, offer\.policyCode\)/);
assert.match(manualOfferCreateRoute, /isStockedProduct\(product\).*isContractAvailableVehicle\(product\)/);
assert.match(manualOfferCreateRoute, /priceList\(product as never\)\.find\(\(price\) => price\.m === rentMonths\)/);
assert.match(manualOfferCreateRoute, /선택한 기간의 차량 가격표를 확인할 수 없습니다/);
assert.match(manualOfferCreateRoute, /rent_amount_snapshot: sealedRent, deposit_amount_snapshot: sealedDeposit/);
assert.match(manualOfferCreateRoute, /customer_type: offer\.customerType, customer_type_snapshot: offer\.customerType/);
assert.match(manualOfferCreateRoute, /product_offer_created/);
assert.match(manualOfferCreateRoute, /v4\/esign_contract_seals/);
assert.match(manualOfferCreateRoute, /manual_offer_created/);
assert.match(esignServer, /loadFreepassManualOfferSource/);

assert.match(adminRoute, /v4\/esign_sessions/);
assert.match(adminRoute, /v4\/esign_private/);
assert.match(adminRoute, /canManageFreepassEsign/);
assert.match(adminRoute, /canAccessFreepassEsignContract/);
assert.match(adminRoute, /canReviewFreepassEsign/);
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
assert.match(esignServer, /resolveFreepassSettlementRateBasis/);
assert.match(esignServer, /v4\/partners_private/);
assert.match(esignServer, /v4\/users_private/);
assert.match(esignServer, /admin_review_required/);
assert.match(adminRoute, /publicFreepassSignUrl\(token, requestOrigin\)/);
assert.match(adminRoute, /internal_sign_url/);
assert.match(adminRoute, /settlement_rate_status/);
assert.match(adminRoute, /fee_rate_snapshot: settlementRateBasis\.feeRate/);
assert.match(adminRoute, /payout_rate_snapshot: settlementRateBasis\.payoutRate/);
assert.match(adminRoute, /settlement_rate_basis/);
assert.match(adminRoute, /esign_sign_url: null/);
assert.match(adminRoute, /protectedSignUrl/);
assert.match(adminRoute, /privatizeLegacySignUrl/);
assert.match(adminRoute, /hashFreepassSignToken\(token\) === hash/);
assert.match(adminRoute, /submission\?\.internal_sign_url/);
assert.doesNotMatch(adminRoute, /submission\?\.internal_sign_url \|\| bundle\.contract\.esign_sign_url/);
const legacyUrlMigrationStart = adminRoute.indexOf('async function privatizeLegacySignUrl');
const legacyUrlMigrationEnd = adminRoute.indexOf('\ntype LoadedBundle', legacyUrlMigrationStart);
const legacyUrlMigration = adminRoute.slice(legacyUrlMigrationStart, legacyUrlMigrationEnd);
assert.match(legacyUrlMigration, /privateRef\.transaction/);
assert.match(legacyUrlMigration, /contractRef\.transaction/);
assert.match(legacyUrlMigration, /sessionHashFromContract\(row\)/);
assert.doesNotMatch(legacyUrlMigration, /ref\('v4'\)\.update\(/);
assert.match(adminRoute, /hasFrozenFreepassTemplateState\(session\)/);
assert.match(adminRoute, /hasFrozenFreepassConsentProfile\(session\)/);
assert.match(adminRoute, /frozenSessionTemplateId\(currentSession\)/);
const activeSessionIndexes = [...adminRoute.matchAll(/activeSession\(currentSession\)\s*&&\s*hasFrozenFreepassTemplateState\(currentSession\)\s*&&\s*hasFrozenFreepassConsentProfile\(currentSession\)/g)].map((match) => match.index ?? -1);
assert.equal(activeSessionIndexes.length, 1, '기존 링크 이관은 issuance claim을 잡은 뒤 한 곳에서만 실행한다');
assert.ok(activeSessionIndexes[0]! > adminRoute.indexOf('if (!issueClaim.committed'), '기존 고객 링크 이관은 issuance claim 아래에서 실행한다');
assert.ok(activeSessionIndexes[0]! < adminRoute.indexOf('const refreshedBlocked = issueBlockersFor'), '기존 고객 링크 이관은 현재 정책 blocker보다 먼저 실행한다');
assert.match(publicRoute, /childUpdates\(`esign_private\/\$\{contractCode\}\/\$\{hash\}`, submission\)/);
assert.match(publicDocumentRoute, /hasFrozenFreepassTemplateState\(session\)/);
assert.match(publicDocumentRoute, /hasFrozenFreepassConsentProfile\(session\)/);
assert.match(adminRoute, /approvalClaimId/);
assert.match(adminRoute, /status: 'approving'/);
assert.match(adminRoute, /다른 관리자가 이미 승인 처리 중/);
assert.match(adminRoute, /releaseApprovalClaim/);
assert.match(adminRoute, /APPROVAL_CLAIM_TIMEOUT_MS/);
assert.match(adminRoute, /REJECTION_CLAIM_TIMEOUT_MS/);
assert.match(adminRoute, /rejectionClaimId/);
assert.match(adminRoute, /status: 'rejecting'/);
assert.match(adminRoute, /다른 관리자가 이미 승인 또는 보완 요청을 처리하고 있습니다/);
assert.match(adminRoute, /releaseRejectionClaim/);
assert.match(adminRoute, /ISSUE_CLAIM_TIMEOUT_MS/);
assert.match(adminRoute, /v4\/esign_issue_claims\/\$\{contractCode\}/);
assert.match(adminRoute, /다른 사용자가 이 계약의 링크를 생성하고 있습니다/);
assert.match(adminRoute, /\['submitting', 'pending_review', 'approving', 'rejecting'\]\.includes\(currentStatus\)/);
assert.match(adminRoute, /supersededBy: hash/);
assert.match(adminRoute, /\['sent', 'opened'\]\.includes\(S\(current\.status\)\)/);
assert.match(adminRoute, /고객 제출 후에는 링크를 해지할 수 없습니다/);
assert.match(adminRoute, /S\(current\.esign_session_hash\) !== hash/);
assert.match(adminRoute, /이전 세션만 닫고 새 계약 상태는 건드리지 않는다/);
assert.match(adminRoute, /export const maxDuration = 60/);
assert.match(adminRoute, /로그인이 만료되었거나 유효하지 않습니다/);
assert.doesNotMatch(adminRoute, /contract_sign\//);
assert.match(esignServer, /actor\.rawRole === 'agent'/);
assert.match(esignServer, /actor\.rawRole === 'agent_admin'/);
assert.match(esignServer, /actor\.rawRole === 'agent_manager'/);
assert.match(esignServer, /S\(contract\.agent_uid\) === actor\.uid/);
assert.match(esignServer, /actor\?\.rawRole === 'admin'/);
assert.match(documentRoute, /canAccessFreepassEsignContract/);
assert.match(assetRoute, /canReviewFreepassEsign/);
assert.match(handoverRoute, /canReviewFreepassEsign/);
assert.match(handoverRoute, /cmsRequiredBeforeHandover === true/);
assert.match(adminRoute, /관리자만 전자계약 보완을 요청/);
assert.match(adminRoute, /관리자만 전자계약을 최종 승인/);
assert.match(esignServer, /additionalDriverPolicy/);
assert.doesNotMatch(
  esignServer.match(/function publicContractSnapshot[\s\S]*?return out;/)?.[0] || '',
  /customer_name|customer_phone|customer_birth|customer_address/,
);
assert.match(esignServer, /esignAdditionalDriverLimit\(args\.policy\)/);
assert.match(esignServer, /freepassSignTokenFromUrl/);
assert.match(esignServer, /publicFreepassSignUrl/);
assert.match(esignServer, /canonicalFreepassSignUrl/);
assert.match(firebaseAdmin, /code\.startsWith\('auth\/'\)/);
assert.match(firebaseAdmin, /throw verifyError/);
assert.match(panes, /getIdToken\(forceRefresh\)/);
assert.match(panes, /response\.status === 401/);
assert.match(panes, /링크 다시 만들기/);
assert.match(panes, /needsConsentReissue/);
assert.match(panes, /이전 동의 기준 링크는 더 이상 고객 정보를 받지 않습니다/);
assert.match(panes, /고객 링크를 다시 만들어야 합니다/);
assert.match(panes, /「계약서·링크」에서 새 고객 링크를 만드세요/);
assert.match(panes, /구 동의 기준으로 완료된 회차입니다/);
assert.match(panes, /구 동의 기준 회차는 인도일을 확정할 수 없습니다/);
assert.match(panes, /reissueRequiresNewContract/);
assert.match(panes, /새 계약서 만들기/);
assert.match(adminRoute, /reissueRequiresNewContract/);
assert.match(adminRoute, /const requiresServerSeal = !bundle\.legacyContractExists \|\| isIndependentEsignSource\(bundle\.contract\)/);
assert.match(panes, /전자계약 상태 확인 중/);
assert.match(panes, /const link = needsConsentReissue \? '' : savedLink/);
assert.match(panes, /\(flags\.revoked \|\| flags\.expired\) && !needsConsentReissue/);
assert.match(adminRoute, /customerLinkUsable:\s*hasFrozenFreepassTemplateState\(session\)\s*&&\s*hasFrozenFreepassConsentProfile\(session\)/);
const documentPaneStart = panes.indexOf('export function FreepassEsignDocumentPane');
const consentReissueCardStart = panes.indexOf("} else if (needsConsentReissue)", documentPaneStart);
const consentReissueCard = panes.slice(consentReissueCardStart, panes.indexOf("} else if (linkRecoveryNeeded)", consentReissueCardStart));
assert.match(consentReissueCard, /disabled=\{busy \|\| \(reissueRequiresNewContract && !onCreateNewContract\)\}/);
assert.doesNotMatch(consentReissueCard, /selectionError|blocked\.length/);
assert.match(panes, /linkRecoveryNeeded/);
assert.match(panes, /고객 링크 복구/);
const recoveryCardStart = panes.indexOf("} else if (linkRecoveryNeeded)");
const recoveryCard = panes.slice(recoveryCardStart, panes.indexOf("} else if (stage === '발송 전' && !issued)", recoveryCardStart));
assert.match(recoveryCard, /disabled=\{busy\}/);
assert.doesNotMatch(recoveryCard, /selectionError|blocked\.length/);
assert.match(panes, /loadError/);
assert.match(firebaseAdmin, /waitMs <= 5_000/);
assert.match(firebaseAdmin, /verifyIdToken\(token\)/);
assert.match(middleware, /sign\.freepasserp\.com/);
assert.match(middleware, /FREEPASS_TOKEN/);
assert.match(middleware, /NextResponse\.rewrite/);
assert.match(middleware, /LEGACY_TOKEN/);
assert.match(middleware, /chakhandeal\.vercel\.app/);
assert.match(middleware, /pathname === '\/'/);
assert.match(middleware, /target\.pathname = '\/esign'/);
assert.match(sendCenter, /\/login\?next=\$\{encodeURIComponent\(basePath\)\}/);
assert.match(esignPreviewPage, /\/login\?next=\/esign/);
const loginPage = read('app/login/page.tsx');
assert.match(loginPage, /function loginDestination/);
assert.match(loginPage, /!next\.startsWith\('\/\/'\)/);

assert.match(publicRoute, /ref\(`v4\/esign_sessions\/\$\{hash\}`\)\.transaction/);
assert.match(publicRoute, /Number\(current\.revokedAt \|\| 0\)/);
assert.match(publicRoute, /\['sent', 'opened'\]\.includes\(S\(current\.status\)\)/);
assert.match(publicRoute, /progressWrites: writes/);
assert.match(publicRoute, /S\(current\.esign_session_hash\) !== hash/);
assert.match(publicRoute, /imageFile\(form\.get\('idCard'/);
assert.match(publicRoute, /imageFile\(form\.get\('selfie'/);
assert.match(publicRoute, /status: 'pending_review'/);
assert.match(publicRoute, /status === 'pending_review' \|\| status === 'approving'/);
assert.match(publicRoute, /status === 'rejecting'/);
assert.match(publicRoute, /driver_license_no: S\(payload\.driver_license_no\)/);
assert.match(publicRoute, /const birth = birthDate\(payload\.customer_birth\)/);
assert.match(publicRoute, /sales_proof_method/);
assert.match(publicRoute, /residentIdEncrypted: encryptRrn/);
assert.match(publicRoute, /ageRange\.min/);
assert.match(publicRoute, /ageRange\.max/);
assert.match(publicRoute, /additionalDriverLicense\$\{index \+ 1\}/);
assert.match(publicRoute, /additional_drivers: parsed\.additionalDrivers/);
assert.match(publicRoute, /추가 운전자는 최대/);
assert.match(publicRoute, /key !== 'identity' && !Number\(confirmations\[key\] \|\| 0\)/);
assert.match(publicRoute, /customer_name: parsed\.name/);
assert.match(publicRoute, /customer_phone: parsed\.phone/);
assert.match(publicRoute, /snapshot\/landlord/);
assert.match(publicRoute, /bundle\.partner\?\.company_name/);
assert.match(publicRoute, /reused: true/);
assert.match(publicRoute, /고객 제출자료·검토상태·목록표시/);
assert.match(publicRoute, /freepassEsignEventUpdates\(contractCode, 'submitted'/);
assert.match(publicRoute, /freepassEsignEventUpdates\(contractCode, 'opened'/);
assert.match(esignServer, /esign_events\/\$\{contractCode\}\/\$\{key\}/);
assert.match(publicRoute, /previewDocumentUrl/);
assert.match(publicRoute, /downloadUrl/);
assert.match(publicRoute, /agreementReadAt/);
assert.doesNotMatch(publicRoute, /documentPreviewedAt/);
assert.doesNotMatch(publicRoute, /progressTx/);
assert.doesNotMatch(publicRoute, /getStore\(\)/);

assert.match(publicPage, /\/api\/freepass-esign\/public\/\$\{encodeURIComponent/);
assert.match(publicPage, /임대인 회사명/);
assert.match(publicPage, /snapshot\.landlord\?\.companyName/);
// 신차 임시번호는 A4 완료본과 같이 「미정 (신차)」로 보여 실제 등록번호처럼 오인하지 않는다.
assert.match(publicPage, /snapshot\.templateState\?\.car === '신차'/);
assert.match(publicPage, /'미정 \(신차\)'/);
assert.match(publicPage, /model_snapshot/);
assert.match(publicPage, /세부 계약과 약관을 확인해 주세요/);
assert.match(publicPage, /위 세부 계약조건과 아래 자동차 대여약관 전문은 이번 전자계약의 내용입니다/);
assert.doesNotMatch(publicPage, /모바일 계약서 전체보기/);
assert.doesNotMatch(publicPage, /계약서 원본 열람 · 확대해서 보기/);
// 필수 표시는 별표가 아니라 시각 태그다. 추가 운전자 입력값·검증 키는 그대로 유지한다.
assert.match(publicPage, /function ReqTag\(\)/);
assert.match(publicPage, /<ReqTag \/>/);
assert.doesNotMatch(publicPage, /운전면허번호 \*/);
assert.doesNotMatch(publicPage, /성명 \*/);
assert.doesNotMatch(publicPage, /연락처 \*/);
// 조건값은 축약본을 새로 만들지 않는다. 현재 공통 WorkTable 값 칸에 원문을 두고,
// article은 조문 참조로만 표시한다.
assert.match(publicPage, /function conditionValue\(value: string, article\?: string\)/);
assert.match(publicPage, /<WorkTable title=\{step\.title \|\| '계약 조건'\}>/);
assert.match(publicPage, /\{conditionValue\(row\.value \|\| '—', row\.article\)\}/);
assert.match(publicPage, /관련 약관 \{article\}/);
assert.match(publicPage, /const formatDeposit = \(value: unknown\)/);
assert.match(publicPage, /Number\(digits\) === 0 \? '무보증'/);
assert.doesNotMatch(publicPage, /customer_name: S\(contract\.customer_name\)/);
assert.match(publicPage, /const corporate = view\?\.snapshot\?\.templateState\?\.ct === '법인'/);
assert.match(publicPage, /사업자등록번호 10자리를 입력해 주세요/);
assert.match(publicPage, /세금계산서 사업자 정보/);
assert.match(publicPage, /매출증빙/);
assert.match(publicPage, /생년월일/);
assert.match(publicPage, /tax_biz_name: '', tax_biz_no: ''/);
assert.match(publicRoute, /세금계산서 사업자 정보를 확인해 주세요/);
assert.match(publicRoute, /tax_issue_type: '개인사업자 \(사업자등록번호 발행\)'/);
assert.match(signedSnapshot, /tax_biz_name: S\(submission\.tax_biz_name\)/);
assert.match(publicPage, /metrics\.points >= 5 && metrics\.pathLength >= 55/);
assert.match(publicPage, /additionalDriverLimit > 0/);
assert.match(publicPage, /추가 운전자 등록/);
assert.match(publicPage, /additionalDriverCost/);
assert.match(publicPage, /추가 운전자 개인정보 제공·면허증 제출/);
assert.match(publicPage, /운전면허증 사진/);
assert.match(publicPage, /ariaLabel="추가 운전자 개인정보 제공·면허증 제출 동의"/);
assert.doesNotMatch(publicPage, /모바일 계약서 전체보기/);
assert.doesNotMatch(publicPage, /계약서 미리보기/);
assert.doesNotMatch(publicPage, /A4 계약서 미리보기/);
assert.match(publicPage, /완료 계약서 보기/);
assert.match(publicPage, /PDF 다운로드/);
assert.match(publicPage, /view\?\.status !== '검토대기'/);
assert.match(publicPage, /window\.setInterval/);
assert.match(publicPage, /visibilitychange/);
assert.match(publicPage, /보완요청·해지·만료/);
assert.match(publicPage, /window\.location\.reload\(\)/);
assert.match(publicPage, /자동차 대여약관 전문은 이번 전자계약의 내용입니다/);
assert.match(publicPage, /세부계약 확인으로/);
assert.match(publicDocumentRoute, /buildFrozenFreepassHtml\(snapshot, '', ''\)/);
assert.match(publicDocumentRoute, /renderFreepassPdf\(html\)/);
assert.match(publicDocumentRoute, /\['sent', 'opened'\]\.includes\(status\)/);
assert.match(publicDocumentRoute, /Number\(session\.revokedAt \|\| 0\)/);
assert.match(publicDocumentRoute, /download \? 'attachment' : 'inline'/);
assert.match(publicDocumentRoute, /filename\*=UTF-8''/);
assert.match(adminRoute, /additionalDrivers/);
assert.match(assetRoute, /additional-driver-license-\(\[1-3\]\)/);
assert.doesNotMatch(publicPage, /면허번호는 별도로 입력하지 않습니다/);
assert.match(signedSnapshot, /driver_or_biz_no: driverLicenseNo/);
assert.match(signedSnapshot, /drv\$\{slot\}_name/);
assert.match(contractTemplate, /if\(ageSel && !SEALED\)/);
// 약관 조판은 각 칼럼을 안전 높이 안에서만 채우고, 넘침은 다음 칼럼/페이지로 보낸다.
assert.match(contractTemplate, /var targetHeight=colCapacity-12;/);
assert.match(contractTemplate, /contentHeight\(col\)>targetHeight/);
assert.match(contractTemplate, /colOverflow\(col,col\.closest\('\.page'\)\)/);
assert.doesNotMatch(publicPage, /contract-sign-public|@\/lib\/domain\/sign/);
assert.match(esignPage, /return <EsignSendCenter quickEntry \/>/);
// 검토용 샘플도 정적 PDF 사본이 아니라 실제 봉인 HTML/PDF 경로를 재사용해야 한다.
assert.match(sampleContractRoute, /buildFrozenFreepassHtml\(SAMPLE_SNAPSHOT, '', ''\)/);
assert.match(sampleContractRoute, /renderFreepassPdf\(html\)/);
assert.doesNotMatch(sampleContractRoute, /readFile|freepass-standard-rental-contract-v1-review\.pdf/);
assert.equal(existsSync('public/contract-template/freepass-standard-rental-contract-v1-review.pdf'), false);
assert.match(sendCenter, /label: '공급사'/);
assert.doesNotMatch(sendCenter, /label: '회사선택'/);
// 사장님 2026-08-20 — 계약서 종류 select 폐지. 차량 상품구분 × 정책 보험조건으로 정해진다(고르지 않는다).
assert.doesNotMatch(sendCenter, /label: '계약서 종류'/);
assert.match(sendCenter, /templateForKindAndInsurance\(productContractKind\(draftProduct\), insuranceSideFromPolicy\(draftPolicy\)\)/);
assert.match(sendCenter, /label: '계약정책'/);
assert.match(sendCenter, /params\.get\('product'\)/);
assert.match(sendCenter, /contractVehicleSnapshot\(product\)/);
assert.match(sendCenter, /const COMPANY_STEP_FIELDS: Field\[\] = \[\.\.\.SUPPLIER_FIELDS\]/);
assert.match(sendCenter, /const VEHICLE_POLICY_FIELDS: Field\[\] = \[\.\.\.POLICY_FIELDS\]/);
  // 공유 공급사·정책 master는 계약 작성 화면에서 임시값으로 만들거나 바꾸지 않는다.
  // 영업자도 사용할 수 있는 화면이므로 보완은 권한·revision을 가진 관리 화면에서만 한다.
  assert.doesNotMatch(sendCenter, /applyPolicyDefaults\(/);
  assert.doesNotMatch(sendCenter, /프리패스 기본으로 정책 등록/);
  assert.doesNotMatch(sendCenter, /공급사 정책으로 저장하고 적용/);
  assert.doesNotMatch(sendCenter, /선택한 정책 보완/);
  assert.doesNotMatch(sendCenter, /getStore\(\)\.update\('policy'/);
  assert.doesNotMatch(sendCenter, /getStore\(\)\.save\('policy'/);
  assert.doesNotMatch(sendCenter, /contract_authoring: '프리패스가 작성'/);
  assert.match(sendCenter, /const openPolicyEditor/);
  assert.match(sendCenter, /router\.push\(partnerPolicyManageUrl\(providerCode, policyCode\)\)/);
  assert.match(sendCenter, /const openPartnerManager/);
  assert.match(sendCenter, /router\.push\(partnerManagePartnerUrl\(/);
  assert.match(sendCenter, /ESIGN_POLICY_DRAFT_SESSION_KEY/);
assert.match(sendCenter, /\.\.\.policyDraftPatch\(policy\)/);
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
// 2026-08-19 재편 — 상태는 useFreepassEsign 한 번, 칸 2·3=계약 진행(StagePane) · 칸 4=계약서·링크(DocumentPane)
assert.match(sendCenter, /useFreepassEsign\(selected, load\)/);
assert.match(sendCenter, /FreepassEsignStagePane/);
assert.match(sendCenter, /FreepassEsignDocumentPane/);
assert.doesNotMatch(sendCenter, /FreepassEsignLinkPane|FreepassEsignProgressPane|ContractSendWorkspace/);
assert.doesNotMatch(sendCenter, /④ 계약서 확인·링크 만들기/);
// 선택한 정책이 어떤 조건인지는 칸 4 「계약내용 확인」에 접지 않고 쭉 펼친다. 공급사 정보가 비면 「파트너사관리에서 입력」.
assert.doesNotMatch(sendCenter, /title="계약서 만들기"/);
assert.match(sendCenter, /<EsignContractContentPane/);
  assert.match(sendCenter, /onFixPartner=\{openPartnerManager\}/);
  assert.match(sendCenter, /onFixPolicy=\{draft\.policyCode \? \(\) => openPolicyEditor/);
assert.match(panes, /export function EsignContractContentPane/);
assert.match(panes, /공급사\(임대인\) 정보 — 계약서에 그대로 실림/);
assert.match(panes, /계약정책 조건 · /);
assert.match(panes, /계약내용 확인 · 발행 당시 동결값/);
assert.doesNotMatch(panes, /<details>[\s\S]*발행 당시 계약 내용/);
assert.match(sendCenter, /계약서 만들기/);
assert.doesNotMatch(sendCenter, /A4 미리보기 → 계약 링크 만들기 → 링크 복사/);
assert.match(sendCenter, /계약서를 확인하고 링크를 만드세요/);
assert.match(sendCenter, /미지정 · 링크를 받은 사람이 직접 입력/);
assert.doesNotMatch(sendCenter, /BUSINESS_FIELDS/);
assert.doesNotMatch(sendCenter, /window\.open\('about:blank'/);
assert.doesNotMatch(sendCenter, /createdDraft|inlineResultRef|개인정보 없는 계약서를 확인하고 고객 작성 링크를 만드세요/);
assert.match(sendCenter, /전체 입력 지우기/);
assert.doesNotMatch(sendCenter, /⑥ 계약서 만들기/);
/**
 * 차량번호가 첫 선택이다. 공급사는 선택적인 검색 필터이고 차량을 고르면 자동으로 확정된다.
 * 기간·약정주행거리·연령은 같은 금액 결정 축으로 계약 생성 전에 모두 확인한다.
 */
assert.match(sendCenter, /차량번호·차명을 바로 검색하거나, 공급사로 먼저 좁혀서 고를 수 있습니다/);
assert.match(sendCenter, /providerCompanyCode: S\(product\.provider_company_code\)/);
assert.match(sendCenter, /title="차량번호 선택"/);
assert.ok(sendCenter.indexOf('title="차량번호 선택"') < sendCenter.indexOf('title="기간별 대여료"'));
assert.ok(sendCenter.indexOf('title="기간별 대여료"') < sendCenter.indexOf('title="조건"'));
assert.ok(sendCenter.indexOf('<WorkTable title="계약서 종류">') < sendCenter.indexOf('<WorkTable title="차량"'));
assert.ok(sendCenter.indexOf('<WorkTable title="차량"') < sendCenter.indexOf("<WorkTable title={quickIsPickup ? '차량 인수 확인' : '계약조건'}>"));
// 빠른 작성은 ERP 차량이면 상품 가격표를 읽기 전용으로 보여 주고, 직접 입력이면 같은 조건을 직원이 적는다.
assert.match(sendCenter, /const QUICK_MANUAL_PERIODS = \[12, 24, 36, 48, 60\]/);
assert.match(sendCenter, /const useManualVehicle = \(\) =>/);
assert.match(sendCenter, /차량 직접입력으로 전환/);
assert.match(sendCenter, /if \(quickEntry\) \{[\s\S]*productPrice = priceList\(draftProduct\)/);
assert.match(sendCenter, /상품 가격표에서 표시됩니다/);
assert.match(sendCenter, /<WorkSplit label="추가 계약조건"/);
// /esign 빠른 작성은 손오공 전용 원문 세 종류를 고르고, 구독일 때만 보험료를 고른다.
assert.match(sendCenter, /손오공 렌트 계약서/);
assert.match(sendCenter, /손오공 구독 계약서/);
assert.match(sendCenter, /손오공 차량 픽업 확인서/);
assert.match(sendCenter, /quickContractType === 'sonogong-subscription'/);
assert.match(sendCenter, /보험료 포함/);
assert.match(sendCenter, /보험료 별도/);
assert.match(sendCenter, /quickIsPickup/);
assert.match(sendCenter, /차량 인수 확인/);
assert.match(sendCenter, /손오공 픽업 확인서 준비 중/);
// 손오공 빠른작성의 만기 협의는 선택값이 아니라 서버 seal과 같은 고정 조항이다.
assert.match(sendCenter, /quickMaturityConsultation/);
assert.match(sendCenter, /만기 협의/);
assert.match(sendCenter, /만기 협의 · 인수가 미정/);
// 빠른 작성은 공통 WorkTable 위에 동일한 value/input 행을 쓴다.
assert.match(sendCenter, /<WorkTable title="계약서 종류">/);
assert.match(sendCenter, /<WorkRow label="발송 상태"/);
assert.match(sendCenter, /<WorkRow label="월 대여료\/구독료"/);
assert.match(sendCenter, /<WorkRow label="만기 조건">만기 협의/);
assert.match(read('lib/domain/esign-templates.ts'), /'sonogong-rent-draft'/);
assert.match(read('lib/domain/esign-templates.ts'), /'sonogong-pickup-confirmation'/);
assert.match(sendCenter, /const draftVehicleReady = !!\(draftProduct && draftPolicy && draftTemplate\)/);
assert.match(sendCenter, /resolveVehiclePolicy\(product, providerPolicies\)/);
assert.match(sendCenter, /contractMileageOptions\(/);
assert.match(sendCenter, /contractRentForTerms\(/);
assert.match(sendCenter, /specialTermsChoice/);
/**
 * ★막는 이유는 «그걸 아는 단계»에서 바로 보여 준다(사장님 2026-08-20 「뭐 없어서 안 된다 이런 표시 해주지?」).
 *   회사만 골라도 임대인 정보는 이미 정해져 있고, 정책을 고르면 그 정책의 빈칸도 안다 — 4장을 다 채우고 알게 하지 않는다.
 */
assert.match(sendCenter, /draftSupplierBlockers/);
  // 공급사 정보도 공유 master이므로 이 화면의 직접 저장을 금지하고 파트너사관리로 넘긴다.
  assert.match(sendCenter, /openPartnerManager/);
  assert.match(sendCenter, /openPolicyEditor/);
  assert.doesNotMatch(sendCenter, /getStore\(\)\.update\('partner'/);
  assert.doesNotMatch(sendCenter, /getStore\(\)\.save\('partner'/);
  assert.doesNotMatch(sendCenter, /공급사 정보를 임시 저장했습니다/);
  assert.doesNotMatch(sendCenter, /INLINE_PARTNER_FIELDS/);
assert.match(membersPage, /return=esign|returnToEsign/);
assert.match(membersPage, /작성 중이던 전자계약으로/);
assert.match(sendCenter, /draftPolicyBlockers/);
assert.match(sendCenter, /회사정보 \$\{blocked\}개 필요/);
assert.match(read('lib/domain/esign-center.ts'), /export function esignPartnerChecks/);
// 손님 화면 따라보기 — 오버레이 + 다음/자동 넘김(postMessage). 고객 화면은 미리보기일 때만 바깥 조종을 받는다.
const walkthrough = read('components/EsignCustomerWalkthrough.tsx');
assert.match(walkthrough, /fp-esign-preview/);
assert.match(walkthrough, /event\.origin !== window\.location\.origin/);
assert.match(walkthrough, /window\.location\.origin\}\$\{parsed\.pathname\}/, '고객 링크는 현재 출처로 옮겨 띄워야 postMessage 가 통한다');
assert.match(publicPage, /if \(!preview\) return undefined;/, '실제 고객 화면은 바깥에서 조종할 수 없어야 한다');
assert.match(publicPage, /fp-esign-preview-state/);
assert.ok(sendCenter.indexOf('<QuickFormField label="특약사항">') < sendCenter.indexOf("'계약서 만들기'"));
assert.doesNotMatch(sendCenter, /repeat\(auto-fit, minmax\(min\(100%, 560px\)/);
assert.match(sendCenter, /state=\{draftVehicleReady \? 'complete' : 'active'\}/);
assert.doesNotMatch(sendCenter, /④ 고객 정보/);
assert.doesNotMatch(sendCenter, /const CUSTOMER_FIELDS/);
assert.match(sendCenter, /fields=\{VEHICLE_CONTRACT_FIELDS\}/);
assert.match(sendCenter, /fields=\{RENT_PAYMENT_FIELDS\}/);
assert.ok(sendCenter.indexOf("key: 'rentAmount'") < sendCenter.indexOf("key: 'paymentTiming'"));
assert.match(sendCenter, /setDraftValue\('specialTerms', value\)/);
assert.doesNotMatch(sendCenter, /const ADDITIONAL_DRIVER_SLOTS =/);
assert.doesNotMatch(sendCenter, /addAdditionalDriver/);
assert.doesNotMatch(sendCenter, /removeAdditionalDriver/);
assert.match(sendCenter, /draftAdditionalDriverLimit/);
assert.match(sendCenter, /고객이 링크에서 입력 \(최대 \$\{draftAdditionalDriverLimit\}명\) · 면허증 첨부/);
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
assert.match(sendCenter, /availableVehicleCountsByProvider/);
assert.match(sendCenter, /출고가능 \$\{\(availableVehicleCountsByProvider/);
assert.match(sendCenter, /partnerUsesFreepassContract/);
assert.match(sendCenter, /vehiclePickerOpen/);
assert.match(sendCenter, /<EsignVehicleSelectRow/);
// 차량번호 일부 숫자만으로 전체 출고가능 재고에서 바로 후보를 찾고, 빠른 선택 분기는
// 정책을 자동 매칭하지 않는다. 후보 행에는 가격표 요약도 함께 보인다.
const plateHits = searchContractVehicles([
  { product_code: 'plate-a', provider_company_code: 'A', car_number: '12가3456', model: '테스트A', vehicle_status: '출고가능', price: { 12: { rent: 500000, deposit: 0 } } },
  { product_code: 'plate-b', provider_company_code: 'B', car_number: '34나7890', model: '테스트B', vehicle_status: '출고가능', price: { 12: { rent: 600000, deposit: 1000000 } } },
] as never, '', null, '345');
assert.deepEqual(plateHits.map((row) => String(row.product_code)), ['plate-a']);
assert.match(sendCenter, /quickEntry \? '' : \(draft\?\.providerCompanyCode \|\| ''\)/);
assert.match(sendCenter, /const offerDraft = quickEntry;/);
assert.match(sendCenter, /productCode: S\(draft\.productCode\),\s*rentMonths: Number\(draft\.rentMonths\)/);
assert.match(sendCenter, /const quickOfferReady = manualOfferReady \|\| productOfferReady;/);
assert.match(sendCenter, /const quickMaturityConsultation = quickEntry && !quickIsPickup;/);
assert.match(sendCenter, /만기 협의 · 인수 조건과 금액은 별도 협의합니다/);
assert.doesNotMatch(sendCenter, /quickMaturityPreviewOnly/);
assert.match(read('components/list-rows.tsx'), /보증금 \$\{won\(price\.deposit\)\}/);
const selectionStart = sendCenter.indexOf('const selectVehicle =');
const quickVehicleBranch = sendCenter.slice(selectionStart, sendCenter.indexOf('const providerPolicies', selectionStart));
assert.doesNotMatch(quickVehicleBranch, /resolveVehiclePolicy/);
assert.match(sendCenter, /setVehiclePickerOpen\(false\)/);
assert.match(sendCenter, /key: 'input'/);
assert.match(sendCenter, /key: 'document'/);
assert.match(sendCenter, /key: 'progress'/);
assert.match(sendCenter, /title: '계약서 작성'/);
assert.match(sendCenter, /title: '계약서 확인'/);
assert.match(sendCenter, /title: '계약 진행'/);
assert.doesNotMatch(sendCenter, /key: 'send'/);
assert.match(sendCenter, /mobileLayout="stack"/);
assert.doesNotMatch(sendCenter, /mobileLayout="swap"/);
assert.match(sendCenter, /paneRatio=\{1\}/);
assert.doesNotMatch(sendCenter, /listMaxWidth=\{360\}/);
assert.doesNotMatch(sendCenter, /width: 360 \}/);
assert.match(sendCenter, /isEsignUiAllowed/);
assert.match(esignPreviewPage, /isEsignUiAllowed/);
assert.match(authGate, /role === 'admin' \|\| role === 'agent'/);
// 사장님 2026-08-19: 계약서관리(/esign)는 관리자 메뉴 — 관리 그룹 맨 위
assert.match(topBar, /href: '\/esign'.*roles: \['admin'\]/);
// 사장님 2026-08-19: 파트너사관리·회원관리는 메뉴에 있어야 하고, 재고관리 아래 구분선(=별도 그룹)으로 가른다.
const simpleGroups = topBar.match(/const SIMPLE_GROUPS[\s\S]*?\n\}\];/)?.[0] || '';
assert.match(simpleGroups, /\/members\?tab=partner/);
assert.match(simpleGroups, /\/members\?tab=user/);
// 그룹이 둘(=구분선 하나): 앞 그룹에 일하는 메뉴(재고관리 …), 뒤 그룹에 관리 메뉴(계약서관리·파트너사관리·회원관리).
const simpleGroupBlocks = simpleGroups.split(/\n\}, \{\n/);
assert.equal(simpleGroupBlocks.length, 2);
assert.match(simpleGroupBlocks[0], /'\/inventory'/);
assert.doesNotMatch(simpleGroupBlocks[0], /\/members\?tab=partner|'\/esign'/);
assert.match(simpleGroupBlocks[1], /'\/esign'[\s\S]*\/members\?tab=partner[\s\S]*\/members\?tab=user/);
assert.doesNotMatch(sendCenter, /공급사·계약정책 관리/);
assert.match(membersPage, /esign_contract_enabled/);
// 사장님 2026-08-19 — 파트너사 4패널(목록·기본정보·운영정책·수수료정책). 정책관리 메뉴는 없고, 운영정책 패널에서 공급사별 등록·수정·삭제(partnerPolicyUrl → /policy?provider=…&return=partner).
assert.match(membersPage, /title: '운영정책'/);
assert.match(membersPage, /title: '수수료정책'/);
assert.match(membersPage, /출고가능 차량/);
// 정책 등록·수정은 파트너사관리 안 인라인 편집기(PartnerPolicyEditor — 시트와 같은 차례·선택지)로, 삭제는 줄의 「삭제」로.
assert.match(membersPage, /<PartnerPolicyEditor/);
assert.match(membersPage, /removePartnerPolicy/);
assert.doesNotMatch(simpleGroups, /'\/policy'/);
assert.match(memberFilter, /\{ key: 'user', label: '회원' \}/);
assert.match(memberFilter, /\{ key: 'partner', label: '파트너사' \}/);
assert.match(memberFilter, /\{ key: 'sales', label: '영업자' \}/);
assert.match(memberFilter, /\{ key: 'provider', label: '공급사 직원' \}/);
assert.match(listRows, /영업채널·공급사를 등록합니다/);
assert.match(listRows, /가입을 마친 영업자·공급사 직원을 소속에 연결합니다/);
assert.match(membersPage, /memberRoleGroup\(row\.role\) !== 'operator'/);
assert.match(membersPage, /partnerTypeLabel\(row\.partner_type[\s\S]*?\) !== '운영사'/);
assert.match(membersPage, /label: '소속', type: 'select'/);
assert.match(membersPage, /roleGroup === 'provider' \? type === '공급사' : type === '영업채널'/);
assert.match(membersPage, /company_name: partner \? partnerCompanyDisplayName\(partner\)/);
assert.match(membersPage, /agent_channel_code: group === 'sales' \? v : ''/);
assert.match(membersPage, /소속 \$\{requiredType\}를 선택하세요/);
assert.match(policyPage, /파트너사 관리에서 회사별 정책을 추가하세요/);
assert.doesNotMatch(policyPage, /const G_ESIGN = \['contract_authoring'/);
// 사장님 2026-08-19: 계약서관리(/esign)는 하단탭에 없다(관리자 메뉴) — 라우트 판정만 admin 으로 남는다.
assert.doesNotMatch(tabbar, /href: '\/esign'/);
assert.match(tabbar, /path === '\/esign' \|\| path\.startsWith\('\/esign\/'\)\) return role == null \|\| role === 'admin'/);
assert.match(workflowGuide, /상품 확인은 ERP 안의 상품리스트가 기준입니다/);
assert.match(workflowGuide, /문의는 기존 카카오톡방/);
assert.match(workflowGuide, /router\.push\('\/esign'\)/);
assert.doesNotMatch(esignPage, /function LegacyEsignPage/);
// BLOCK 이면 버튼이 비활성 — 실패 경로가 정상 버튼처럼 보이지 않는다(정본 §1-6)
assert.doesNotMatch(sendCenter, /필수입력 \$\{draftBlocks\.length\}개 확인/);
assert.match(sendCenter, /disabled=\{busy \|\| !draftReachedReview \|\| draftBlocks\.length > 0 \|\| !!draftTemplateError\}/);
assert.match(panes, /발행 당시 동결값\(고객이 보는 순서\)/);
assert.match(panes, /'승인 처리 중'/);
// 번호는 스테퍼 하나 — 카드 안 ①② 금지
assert.doesNotMatch(panes, /① A4 계약서 확인|② 모바일 미리보기·전달 링크 준비|① 발송 전 미리보기|② 계약 링크 복사·전달/);
assert.match(panes, /'고객 서명 링크 생성'/);
assert.match(panes, /ESIGN_CENTER_STAGES\.map/);
assert.match(panes, /journeyRows/);
assert.doesNotMatch(panes, /ESIGN_STEPS/);
assert.match(panes, /HTTP \$\{response\.status\}/);
assert.match(panes, /수신자를 미리 지정하지 않는 링크/);
assert.match(panes, /모바일 미리보기/);
assert.match(panes, /A4 미리보기/);
assert.match(panes, /params\.set\('view', 'a4'\)/);
assert.match(panes, /params\.set\('back', basePath\)/);
assert.match(esignPreviewPage, /get\('view'\) === 'a4'/);
assert.match(esignPreviewPage, /format=pdf/);
assert.match(esignPreviewPage, /PDF 다운로드/);
assert.match(esignPreviewPage, /downloadDocument/);
assert.doesNotMatch(panes, /A4 계약서 출력|A4 PDF 저장/);
assert.match(read('lib/server/freepass-esign-document.ts'), /includePrintButton: false/);
assert.match(panes, /ariaLabel="고객 링크"/);
assert.match(panes, /고객에게 전달/);
assert.doesNotMatch(panes, /영업자에게 전달|영업자가 고객에게 전달/);
assert.match(panes, /const canReview = currentUser\?\.role === 'admin'/);
assert.match(panes, /readOnly/);
assert.match(panes, /링크 복사/);
assert.match(panes, /\['sent', 'opened'\]\.includes\(sessionStatus\)/);
assert.match(read('components/list-rows.tsx'), /Number\.isFinite\(mileage\)/);
assert.doesNotMatch(deal.match(/export async function createDirectEsignContract[\s\S]*?return code;/)?.[0] || '', /provider_agreement_done:\s*'yes'/);
assert.match(deal, /source !== 'direct' && !customerName/);
assert.match(deal, /source === 'excel' \? \{[\s\S]*?customer_name: customerName/);
assert.match(panes, /최초 제출자가 계약자로 접수됩니다/);
assert.match(adminRoute, /esignProductAvailabilityBlocker/);
assert.match(adminRoute, /freshApprovalBundle/);

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

console.log('✓ 프리패스 자체 전자계약: 영업자·관리자 작성/링크 생성 · 관리자 검토 분리 · 민감정보 서버 저장');

// ── 2026-08-19 재편 박제 ──
// 관리자 미리보기는 손님 「열람」을 오염시키지 않는다: preview=1 → peek=1 → 서버 무쓰기
assert.match(esignPreviewPage, /preview=1/);
assert.match(esignPreviewPage, /backPath/);
assert.match(publicPage, /get\('preview'\) === '1'/);
assert.match(publicPage, /\?peek=1/);
assert.match(publicPage, /관리자 미리보기입니다\. 제출되지 않습니다/);
assert.match(publicRoute, /searchParams\.get\('peek'\) === '1'/);
assert.match(publicRoute, /if \(!peek && !Number\(session\.openedAt \|\| 0\)\)/);
assert.match(publicRoute, /if \(!peek\) await db\.ref\(`v4\/esign_sessions\/\$\{hash\}\/snapshot\/landlord`\)/);
assert.match(publicRoute, /const opened = Number\(current\.openedAt \|\| 0\) \? \{\} : \{ status: 'opened', openedAt: now \}/);
// 단계 SSOT — 목록 뱃지·스테퍼·필터 칩·이력이 같은 이름
assert.match(esignCenter, /export const ESIGN_CENTER_STAGES: readonly EsignCenterStage\[\] = \['작성', '발송 전', '고객 작성 중', '검토 대기', '완료'\]/);
assert.match(esignCenter, /export function esignCenterStage\(/);
assert.match(esignCenter, /export function esignCenterFlags\(/);
assert.doesNotMatch(esignCenter, /esignCenterBucket|EsignCenterBucket|'발송대기'|'서명중'|'확인필요'/);
assert.match(listRows, /stage: EsignCenterStage/);
assert.match(listRows, /flagLabel \? <Badge tone="red" variant="solid">\{flagLabel\}<\/Badge> : null/);
assert.match(sendCenter, /QUEUE_FILTERS/);
assert.match(sendCenter, /listTools=\{\{/);
assert.match(sendCenter, /title: '계약 진행 상태'/);
assert.match(sendCenter, /onClear: \(\) => setQueueFilter\('all'\)/);
assert.match(sendCenter, /attentionLabel="확인 필요"/);
// 용어표: 위치 지시어·옛 이름 금지
assert.doesNotMatch(sendCenter, /오른쪽 계약서·링크 패널|왼쪽 맨 위의|아래에서 A4/);
assert.doesNotMatch(sendCenter, /계약회사|회원사|렌터카사/);
assert.doesNotMatch(panes, /프리패스 데이터 확인|직원 업무 순서|발송 후 진행 흐름/);

const customerMobileSample = read('scripts/create-esign-customer-mobile-sample.mts');
assert.match(customerMobileSample, /\/sign\/\$\{token\}/);
assert.match(customerMobileSample, /is_test: true/);
assert.match(customerMobileSample, /24 \* 60 \* 60 \* 1000/);
