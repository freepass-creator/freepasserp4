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
const publicPage = read('app/sign/[token]/page.tsx');
const esignPage = read('app/esign/page.tsx');
const sendCenter = read('components/EsignSendCenter.tsx');
const deal = read('lib/domain/deal.ts');
const esignServer = read('lib/server/freepass-esign.ts');
const firebaseAdmin = read('lib/server/firebase-admin.ts');
const panes = read('components/FreepassEsignPanes.tsx');
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
assert.match(adminRoute, /로그인이 만료되었거나 유효하지 않습니다/);
assert.doesNotMatch(adminRoute, /contract_sign\//);
assert.match(esignServer, /actor\.rawRole === 'agent'/);
assert.match(esignServer, /actor\.rawRole === 'agent_admin'/);
assert.match(esignServer, /actor\.rawRole === 'agent_manager'/);
assert.match(firebaseAdmin, /code\.startsWith\('auth\/'\)/);
assert.match(firebaseAdmin, /throw verifyError/);
assert.match(panes, /getIdToken\(forceRefresh\)/);
assert.match(panes, /response\.status === 401/);
assert.match(panes, /새 링크 다시 생성/);
assert.match(panes, /loadError/);
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
assert.match(sendCenter, /label: '회사선택'/);
assert.match(sendCenter, /label: '계약서 종류'/);
assert.match(sendCenter, /label: '계약정책'/);
assert.ok(sendCenter.indexOf("...SUPPLIER_FIELDS") < sendCenter.indexOf("...TEMPLATE_FIELDS"));
assert.ok(sendCenter.indexOf("...TEMPLATE_FIELDS") < sendCenter.indexOf("...POLICY_FIELDS"));
assert.match(sendCenter, /standardTemplateId: ''/);
assert.doesNotMatch(sendCenter, /Excel 계약서로 새로 만들기/);
assert.doesNotMatch(sendCenter, /초안만 저장/);
assert.match(sendCenter, /FreepassEsignLinkPane/);
assert.match(sendCenter, /FreepassEsignProgressPane/);
assert.match(sendCenter, /입력 내용 확인/);
assert.match(sendCenter, /A4 계약서 만들기/);
assert.match(sendCenter, /전체 입력 지우기/);
assert.doesNotMatch(sendCenter, /⑥ 계약서 만들기/);
assert.ok(sendCenter.indexOf('② ERP 차량 선택') < sendCenter.indexOf('③ 기간·운전자 연령·대여 조건'));
assert.ok(sendCenter.indexOf('③ 기간·운전자 연령·대여 조건') < sendCenter.indexOf('④ 고객 정보'));
assert.ok(sendCenter.indexOf('④ 고객 정보') < sendCenter.indexOf('⑤ 특약사항'));
assert.match(sendCenter, /fields=\{VEHICLE_CONTRACT_FIELDS\}/);
assert.match(sendCenter, /fields=\{RENT_CONTRACT_FIELDS\}/);
assert.match(sendCenter, /setDraftValue\('specialTerms', value\)/);
assert.match(sendCenter, /key: 'emergencyContact', label: '비상연락처'/);
assert.match(sendCenter, /key: 'emergencyRelation', label: '비상연락 관계'/);
assert.match(sendCenter, /const ADDITIONAL_DRIVER_SLOTS =/);
assert.match(sendCenter, /addAdditionalDriver/);
assert.match(sendCenter, /removeAdditionalDriver/);
assert.match(sendCenter, /<Plus size=\{ICON\.md\}/);
assert.match(sendCenter, /<Trash2 size=\{ICON\.md\}/);
assert.match(sendCenter, /draftAdditionalDriverLimit/);
assert.match(sendCenter, /⑥ 추가 운전자/);
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
assert.match(panes, /① A4 계약서 확인/);
assert.match(panes, /② 고객 링크 만들기/);
assert.match(panes, /고객 계약 링크 만들기/);
assert.match(panes, /링크만 생성됩니다/);
assert.match(panes, /① 고객에게 링크 전달/);
assert.match(panes, /ariaLabel="고객 계약 링크"/);
assert.match(panes, /readOnly/);
assert.match(panes, /링크 복사/);
assert.doesNotMatch(deal.match(/export async function createDirectEsignContract[\s\S]*?return code;/)?.[0] || '', /provider_agreement_done:\s*'yes'/);

assert.ok(packageJson.scripts?.dev?.includes('next dev -p 4004'));
assert.ok(!packageJson.scripts?.dev?.includes('ensure-chakhandeal-dev'));
assert.ok(packageJson.scripts?.['dev:with-chakhandeal']?.includes('ensure-chakhandeal-dev'));

assert.equal(esignAdditionalDriverLimit({ additional_driver_allowance_count: '불가' }), 0);
assert.equal(esignAdditionalDriverLimit({ additional_driver_allowance_count: 1 }), 1);
assert.equal(esignAdditionalDriverLimit({ additional_driver_allowance_count: '2인' }), 2);
assert.equal(esignAdditionalDriverLimit({ additional_driver_allowance_count: '무제한' }), 3);
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
