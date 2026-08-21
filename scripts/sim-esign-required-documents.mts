import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_ESIGN_REQUIRED_DOCUMENTS,
  CUSTOMER_INSURANCE_CERTIFICATE,
  esignDocumentPreset,
  freepassEsignRequiredDocuments,
  mergeEsignRequiredDocuments,
  normalizeEsignRequiredDocuments,
  policyEsignRequiredDocuments,
  serializeEsignRequiredDocuments,
} from '../lib/domain/esign-required-documents';

const personal = esignDocumentPreset('personal-basic');
assert.equal(personal.length, 2);
assert.equal(personal.every((row) => row.required), true);
assert.equal(policyEsignRequiredDocuments({ esign_required_documents: serializeEsignRequiredDocuments(personal) }).length, 2);
assert.deepEqual(normalizeEsignRequiredDocuments('깨진 JSON'), []);
assert.equal(normalizeEsignRequiredDocuments([
  { key: 'same', label: '등본', required: true },
  { key: 'same', label: '가족관계', required: false },
]).map((row) => row.key).join('|'), 'same|same_2');
assert.equal(normalizeEsignRequiredDocuments(Array.from({ length: 20 }, (_, index) => ({
  key: `doc_${index}`, label: `서류 ${index}`, required: true,
}))).length, MAX_ESIGN_REQUIRED_DOCUMENTS);
const directInsuranceDocuments = freepassEsignRequiredDocuments({ esign_required_documents: [
  { key: 'customer_insurance_certificate', label: '중복 보험증명서', required: false },
  { key: 'income_certificate', label: '소득금액증명원', required: true },
] }, '고객직접');
assert.equal(directInsuranceDocuments[0].key, CUSTOMER_INSURANCE_CERTIFICATE.key);
assert.equal(directInsuranceDocuments.filter((row) => row.key === CUSTOMER_INSURANCE_CERTIFICATE.key).length, 1);
assert.equal(directInsuranceDocuments.find((row) => row.key === CUSTOMER_INSURANCE_CERTIFICATE.key)?.required, true);
assert.equal(freepassEsignRequiredDocuments({}, '회사포함').length, 0);
assert.equal(mergeEsignRequiredDocuments([CUSTOMER_INSURANCE_CERTIFICATE], [CUSTOMER_INSURANCE_CERTIFICATE]).length, 1);

// ⚠ 줄끝 정규화 — core.autocrlf=true 라 체크아웃하면 CRLF 로 깔린다. 소스 문자열 단언이 줄끝에 걸려 깨지면 안 된다(2026-08-20).
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const server = read('lib/server/freepass-esign.ts');
const publicRoute = read('app/api/freepass-esign/public/[token]/route.ts');
const uploadRoute = read('app/api/freepass-esign/public/[token]/supporting-document/[docKey]/route.ts');
const assetRoute = read('app/api/freepass-esign/contracts/[contractCode]/asset/[kind]/route.ts');
const approvalRoute = read('app/api/freepass-esign/contracts/[contractCode]/route.ts');
const handoverRoute = read('app/api/freepass-esign/contracts/[contractCode]/handover/route.ts');
const customerPage = read('app/sign/[token]/page.tsx');
const policyPage = read('app/policy/page.tsx');

assert.match(server, /const requiredDocuments = freepassEsignRequiredDocuments\(args\.policy, template\.insuranceSide\)/);
assert.match(uploadRoute, /MAX_SUPPORTING_DOCUMENT_BYTES = 5_000_000/);
assert.match(uploadRoute, /사진\(JPG·PNG·WEBP·HEIC\) 또는 PDF/);
assert.match(uploadRoute, /supportingUploads/);
assert.match(uploadRoute, /\['sent', 'opened'\]\.includes\(S\(current\.status\)\)/);
assert.match(uploadRoute, /hasFrozenFreepassTemplateState\(session\)/);
assert.match(uploadRoute, /supporting\/\$\{docKey\}\/\$\{contentSha256\}/);
assert.match(publicRoute, /필수 첨부서류를 제출해 주세요/);
assert.match(publicRoute, /supporting_documents: supportingDocuments/);
assert.match(publicRoute, /required\.add\('documents'\)/);
assert.match(assetRoute, /supporting-\(\[a-z0-9\]/);
assert.match(customerPage, /kind: 'documents'/);
assert.match(customerPage, /uploadSupportingDocuments/);
assert.match(customerPage, /accept="image\/\*,application\/pdf"/);
assert.match(customerPage, /렌터카사 요청서류/);
assert.match(policyPage, /PolicyRequiredDocumentsEditor/);
assert.match(approvalRoute, /가입증명서에서 회사 질권 설정을 확인한 뒤 승인/);
assert.match(assetRoute, /supportingDocument/);
assert.match(approvalRoute, /customerInsuranceEvidenceConfirmed !== true/);
assert.match(approvalRoute, /customer_insurance_evidence/);
assert.match(approvalRoute, /customerInsuranceEvidence,/);
assert.match(approvalRoute, /supportingDocumentsIntegrityError/);
assert.match(approvalRoute, /privateEsignFileSha256\(path\)/);
assert.match(handoverRoute, /const insuranceSide = S\(snapshotKind\.insuranceSide\)/);
assert.match(handoverRoute, /customer_insurance_evidence/);
assert.match(handoverRoute, /esign_verifications/);

console.log('✓ 공급사 정책별 추가서류: 보험별도 가입증명서·질권 확인 · 고객 업로드 · 관리자 전용 열람');
